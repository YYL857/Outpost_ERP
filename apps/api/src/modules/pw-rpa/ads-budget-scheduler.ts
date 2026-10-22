/**
 * 广告预算峰期/低峰墙钟调度（上海时区）。
 * 试店默认 PRJ488078；API 进程需过夜常开才会触发。
 *
 * 默认：
 *   peak    00:10 → apply --mode peak   （回调 baseline）
 *   offpeak 09:10 → apply --mode offpeak（压到 5）
 *
 * 触发判定只认 slotRun（展示字段 last*Day 双写过渡）；收尾靠 onJobFinish，无 5s poll。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parseHhMm,
  shouldFireWallClock,
  formatMinuteOfDay,
  shanghaiParts,
} from "../morning-digest/clock.js";
import {
  startPwJob,
  getPwJobStatus,
  onJobFinish,
  type JobFinishInfo,
} from "./cli.js";
import { resolveOutpostDataRoot } from "./outpost-data-root.js";

/**
 * API 重启错过短 catchWindow 时的当日补跑：
 * - peak：00:10 之后、offpeak 时刻之前仍可补（把预算拉回 baseline）
 * - offpeak：09:10 之后、16:00 前仍可补（压到 5）
 */
/** 供测试 / 诊断：错过短窗后的当日补跑判定 */
export function shouldCatchUpMissedSlot(opts: {
  atMinuteOfDay: number;
  lastScheduledDay: string | null;
  catchUpUntilMinuteOfDay: number;
  now?: Date;
}): { fire: boolean; day: string; reason: string } {
  const parts = shanghaiParts(opts.now);
  if (opts.lastScheduledDay === parts.day) {
    return { fire: false, day: parts.day, reason: "already_ran_today" };
  }
  if (parts.minuteOfDay < opts.atMinuteOfDay) {
    return { fire: false, day: parts.day, reason: "not_yet" };
  }
  if (parts.minuteOfDay >= opts.catchUpUntilMinuteOfDay) {
    return { fire: false, day: parts.day, reason: "past_catchup_deadline" };
  }
  return { fire: true, day: parts.day, reason: "missed_catchup" };
}

export type AdsBudgetSlot = "peak" | "offpeak";

export type SlotRunStatus = "running" | "done" | "failed";

export type AdsBudgetSlotRun = {
  slot: AdsBudgetSlot;
  day: string;
  runId: string;
  status: SlotRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
};

/**
 * 仅成功时占当日槽位；失败保持旧 day，便于 catch-up 窗口内再试。
 * 运行中靠 getPwJobStatus(running) 防双开，不靠提前写 last*Day。
 */
export function slotDaysAfterFinish(opts: {
  slot: AdsBudgetSlot;
  day: string;
  ok: boolean;
  lastPeakDay: string | null;
  lastOffpeakDay: string | null;
}): { lastPeakDay: string | null; lastOffpeakDay: string | null } {
  if (!opts.ok) {
    return {
      lastPeakDay: opts.lastPeakDay,
      lastOffpeakDay: opts.lastOffpeakDay,
    };
  }
  if (opts.slot === "peak") {
    return {
      lastPeakDay: opts.day,
      lastOffpeakDay: opts.lastOffpeakDay,
    };
  }
  return {
    lastPeakDay: opts.lastPeakDay,
    lastOffpeakDay: opts.day,
  };
}

/**
 * 同槽失败后冷却，避免每 60s catch-up 叠开多个 Chrome 互掐登录。
 * 默认 30 分钟；环境变量 OUTPOST_ADS_BUDGET_RETRY_COOLDOWN_MIN。
 */
export function shouldSkipRetryCooldown(opts: {
  slot: AdsBudgetSlot;
  lastSlot: AdsBudgetSlot | null;
  lastOk: boolean | null;
  lastRunAt: string | null;
  cooldownMinutes?: number;
  now?: Date;
}): boolean {
  if (opts.lastOk !== false) return false;
  if (opts.lastSlot !== opts.slot) return false;
  if (!opts.lastRunAt) return false;
  const t = Date.parse(opts.lastRunAt);
  if (!Number.isFinite(t)) return false;
  const coolMin =
    opts.cooldownMinutes ??
    Math.max(1, Number(process.env.OUTPOST_ADS_BUDGET_RETRY_COOLDOWN_MIN) || 30);
  const now = (opts.now ?? new Date()).getTime();
  return now - t < coolMin * 60_000;
}

/**
 * 该槽今日是否已占用（done / running）。
 * slot 不匹配 → 未触发；failed → 未占用（允许补跑，另受 cooldown）。
 */
export function dayClaimedForSlot(
  slot: AdsBudgetSlot,
  day: string,
  slotRun: AdsBudgetSlotRun | null | undefined,
): boolean {
  if (!slotRun) return false;
  if (slotRun.slot !== slot || slotRun.day !== day) return false;
  if (slotRun.status === "done" || slotRun.status === "running") return true;
  return false;
}

/** 给 shouldFireWallClock / catch-up 用的「已调度日」：只认 slotRun */
export function lastScheduledDayFromSlotRun(
  slot: AdsBudgetSlot,
  slotRun: AdsBudgetSlotRun | null | undefined,
): string | null {
  if (!slotRun || slotRun.slot !== slot) return null;
  if (slotRun.status === "done" || slotRun.status === "running") {
    return slotRun.day;
  }
  return null;
}

/**
 * 部署首日迁移：无 slotRun 时用 last*Day===today 初始化 done，避免再跑一遍。
 * offpeak 优先（同日更晚的槽）。
 */
export function migrateSlotRunFromLastDays(opts: {
  slotRun: AdsBudgetSlotRun | null | undefined;
  lastPeakDay: string | null;
  lastOffpeakDay: string | null;
  lastRunAt: string | null;
  today: string;
}): AdsBudgetSlotRun | null {
  if (opts.slotRun) return opts.slotRun;
  if (opts.lastOffpeakDay === opts.today) {
    return {
      slot: "offpeak",
      day: opts.today,
      runId: "migrated",
      status: "done",
      startedAt: opts.lastRunAt,
      finishedAt: opts.lastRunAt,
    };
  }
  if (opts.lastPeakDay === opts.today) {
    return {
      slot: "peak",
      day: opts.today,
      runId: "migrated",
      status: "done",
      startedAt: opts.lastRunAt,
      finishedAt: opts.lastRunAt,
    };
  }
  return null;
}

/**
 * API 重启后：slotRun 卡在 running 且内存 runId 对不上 → failed。
 */
export function reconcileStaleSlotRun(opts: {
  slotRun: AdsBudgetSlotRun | null | undefined;
  memoryRunId: string | null;
  memoryStatus: string;
  nowIso?: string;
}): {
  slotRun: AdsBudgetSlotRun | null;
  changed: boolean;
  message: string | null;
} {
  const sr = opts.slotRun ?? null;
  if (!sr || sr.status !== "running") {
    return { slotRun: sr, changed: false, message: null };
  }
  const memAlive =
    (opts.memoryStatus === "running" || opts.memoryStatus === "starting") &&
    opts.memoryRunId != null &&
    opts.memoryRunId === sr.runId;
  if (memAlive) {
    return { slotRun: sr, changed: false, message: null };
  }
  const finishedAt = opts.nowIso ?? new Date().toISOString();
  const message = "重启后遗留的 running";
  return {
    slotRun: { ...sr, status: "failed", finishedAt },
    changed: true,
    message,
  };
}

export type AdsBudgetScheduleState = {
  enabled: boolean;
  shopIds: string[];
  peakAt: string;
  offpeakAt: string;
  catchWindowMinutes: number;
  lastPeakDay: string | null;
  lastOffpeakDay: string | null;
  lastRunAt: string | null;
  lastMessage: string | null;
  lastOk: boolean | null;
  lastSlot: AdsBudgetSlot | null;
  /** 触发态；判定只认此字段，last*Day 为展示双写 */
  slotRun: AdsBudgetSlotRun | null;
};

function dataRoot(): string {
  return resolveOutpostDataRoot();
}

function configPath(): string {
  return join(dataRoot(), "pw-rpa", "ads-budget-schedule.json");
}

function envDefaultEnabled(): boolean {
  const v = process.env.OUTPOST_ADS_BUDGET_SCHEDULE?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  // 默认开：试店过夜回调需要绑上；关则设 OUTPOST_ADS_BUDGET_SCHEDULE=0
  return true;
}

function defaultShops(): string[] {
  const raw = process.env.OUTPOST_ADS_BUDGET_SHOPS?.trim() || "PRJ488078";
  return [
    ...new Set(
      raw
        .split(/[,;\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

function defaults(): AdsBudgetScheduleState {
  return {
    enabled: envDefaultEnabled(),
    shopIds: defaultShops(),
    peakAt: process.env.OUTPOST_ADS_BUDGET_PEAK_AT?.trim() || "00:10",
    offpeakAt: process.env.OUTPOST_ADS_BUDGET_OFFPEAK_AT?.trim() || "09:10",
    catchWindowMinutes: Math.max(
      1,
      Number(process.env.OUTPOST_ADS_BUDGET_CATCH_MIN) || 8,
    ),
    lastPeakDay: null,
    lastOffpeakDay: null,
    lastRunAt: null,
    lastMessage: null,
    lastOk: null,
    lastSlot: null,
    slotRun: null,
  };
}

function normalizeSlotRun(
  raw: Partial<AdsBudgetSlotRun> | null | undefined,
): AdsBudgetSlotRun | null {
  if (!raw || typeof raw !== "object") return null;
  const slot = raw.slot === "offpeak" ? "offpeak" : raw.slot === "peak" ? "peak" : null;
  const status =
    raw.status === "done" || raw.status === "failed" || raw.status === "running"
      ? raw.status
      : null;
  const day = typeof raw.day === "string" && raw.day.trim() ? raw.day.trim() : null;
  const runId =
    typeof raw.runId === "string" && raw.runId.trim() ? raw.runId.trim() : null;
  if (!slot || !status || !day || !runId) return null;
  return {
    slot,
    day,
    runId,
    status,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : null,
  };
}

/** 纯读，不写盘。迁移在 startAdsBudgetScheduler → migrateOnStart 显式做一次。 */
function load(): AdsBudgetScheduleState {
  const base = defaults();
  const p = configPath();
  if (!existsSync(p)) return { ...base };
  try {
    const raw = JSON.parse(
      readFileSync(p, "utf8"),
    ) as Partial<AdsBudgetScheduleState>;
    return {
      ...base,
      ...raw,
      shopIds:
        Array.isArray(raw.shopIds) && raw.shopIds.length
          ? raw.shopIds.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
          : base.shopIds,
      slotRun: normalizeSlotRun(raw.slotRun) ?? null,
    };
  } catch {
    return { ...base };
  }
}

/**
 * onJobFinish 收尾纯函数（「只跑一次」最后一道闸）。
 * 匹配→写 done/failed；不匹配→原样；已终态→幂等不改。
 */
export function applySlotFinish(
  state: AdsBudgetScheduleState,
  info: {
    runId: string;
    status: "ok" | "failed";
    finishedAt: string;
    message: string | null;
  },
): { state: AdsBudgetScheduleState; applied: boolean } {
  const sr = state.slotRun;
  if (!sr || sr.runId !== info.runId) {
    return { state, applied: false };
  }
  if ((sr.status === "done" || sr.status === "failed") && sr.finishedAt) {
    return { state, applied: false };
  }
  const ok = info.status === "ok";
  const days = slotDaysAfterFinish({
    slot: sr.slot,
    day: sr.day,
    ok,
    lastPeakDay: state.lastPeakDay,
    lastOffpeakDay: state.lastOffpeakDay,
  });
  return {
    applied: true,
    state: {
      ...state,
      slotRun: {
        ...sr,
        status: ok ? "done" : "failed",
        finishedAt: info.finishedAt,
      },
      lastOk: ok,
      lastRunAt: info.finishedAt,
      lastMessage: info.message,
      lastSlot: sr.slot,
      lastPeakDay: days.lastPeakDay,
      lastOffpeakDay: days.lastOffpeakDay,
    },
  };
}

function save(state: AdsBudgetScheduleState) {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
}

function writeScheduleLastTxt(opts: {
  slot: AdsBudgetSlot;
  ok: boolean;
  status: string;
  message: string | null;
  shops: string[];
  finishedAt: string;
}) {
  try {
    const summaryPath = join(dataRoot(), "pw-rpa", "ads-budget-schedule-last.txt");
    mkdirSync(dirname(summaryPath), { recursive: true });
    writeFileSync(
      summaryPath,
      [
        `finishedAt: ${opts.finishedAt}`,
        `slot: ${opts.slot}`,
        `ok: ${opts.ok}`,
        `status: ${opts.status}`,
        `message: ${opts.message ?? ""}`,
        `shops: ${opts.shops.join(",")}`,
        `seeAlso: ${join(dataRoot(), "pw-rpa", "ads-budget-last.txt")}`,
        `history: ${join(dataRoot(), "pw-rpa", "ads-budget-runs.jsonl")}`,
        "",
      ].join("\n"),
      "utf8",
    );
  } catch (e) {
    console.log(`[ads-budget-sched] write schedule-last.txt fail: ${e}`);
  }
}

function applyJobFinish(info: JobFinishInfo) {
  const cfg = load();
  const { state, applied } = applySlotFinish(cfg, {
    runId: info.runId,
    status: info.status,
    finishedAt: info.finishedAt,
    message: info.message,
  });
  if (!applied || !state.slotRun) return;
  save(state);
  const slot = state.slotRun.slot;
  const ok = info.status === "ok";
  writeScheduleLastTxt({
    slot,
    ok,
    status: info.status,
    message: info.message,
    shops: state.shopIds,
    finishedAt: info.finishedAt,
  });
  console.log(
    `[ads-budget-sched] ${slot} done status=${info.status} ${info.message ?? ""}`,
  );
}

let timer: ReturnType<typeof setInterval> | null = null;
let enabled = envDefaultEnabled();
let offFinish: (() => void) | null = null;

export function getAdsBudgetSchedulerStatus() {
  const cfg = load();
  return {
    enabled,
    timerActive: Boolean(timer),
    pollEveryMs: 60_000,
    shopIds: cfg.shopIds,
    peakAt: cfg.peakAt,
    offpeakAt: cfg.offpeakAt,
    catchWindowMinutes: cfg.catchWindowMinutes,
    lastPeakDay: cfg.lastPeakDay,
    lastOffpeakDay: cfg.lastOffpeakDay,
    lastRunAt: cfg.lastRunAt,
    lastMessage: cfg.lastMessage,
    lastOk: cfg.lastOk,
    lastSlot: cfg.lastSlot,
    slotRun: cfg.slotRun,
    note: "上海时区墙钟；触发只认 slotRun。需 API 过夜常开。登录态复用 noon-ads-pw + OTP 自动回填。",
  };
}

export function setAdsBudgetScheduleEnabled(on: boolean) {
  enabled = on;
  const cfg = load();
  cfg.enabled = on;
  save(cfg);
  ensureTimer();
}

export function stopAdsBudgetScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  // 保留 onJobFinish：停表后若仍有 in-flight slotRun，收尾仍须写盘
}

function ensureFinishSubscription() {
  if (offFinish) return;
  offFinish = onJobFinish("ads-budget", (info) => {
    try {
      applyJobFinish(info);
    } catch (e) {
      console.log(`[ads-budget-sched] onJobFinish error: ${e}`);
    }
  });
}

function ensureTimer() {
  if (enabled) {
    ensureFinishSubscription();
    if (!timer) {
      timer = setInterval(() => tick(), 60_000);
      const cfg = load();
      console.log(
        `[ads-budget-sched] wall-clock poll 60s peak@${cfg.peakAt} offpeak@${cfg.offpeakAt} shops=${cfg.shopIds.join(",")}`,
      );
    }
  } else {
    stopAdsBudgetScheduler();
  }
}

function fireSlot(slot: AdsBudgetSlot, day: string) {
  const cfg = load();
  // 保留：peak 补跑窗顶到 09:10，与 offpeak 边界相邻；不能只靠 slotRun
  const st = getPwJobStatus("ads-budget");
  if (st.status === "starting" || st.status === "running") {
    console.log(`[ads-budget-sched] skip ${slot}: job already running`);
    return;
  }
  const busyAds = getPwJobStatus("ads");
  if (busyAds.status === "starting" || busyAds.status === "running") {
    console.log(`[ads-budget-sched] skip ${slot}: ads export running`);
    return;
  }

  console.log(
    `[ads-budget-sched] fire ${slot} day=${day} shops=${cfg.shopIds.join(",")}`,
  );
  ensureFinishSubscription();
  const run = startPwJob("ads-budget", {
    cmd: "apply",
    mode: slot,
    shopIds: cfg.shopIds,
    trigger: "schedule",
    extraEnv: {
      OUTPOST_ADS_BUDGET_SHOPS: cfg.shopIds.join(","),
      OUTPOST_ADS_BUDGET_TRIGGER: `schedule:${slot}`,
      // 定时跑允许有头；无桌面时可设 OUTPOST_ADS_PW_HEADLESS=1
    },
  });

  const next = load();
  next.lastSlot = slot;
  next.lastMessage = run.message;
  next.lastRunAt = run.startedAt || run.finishedAt || next.lastRunAt;

  if (run.status === "starting" || run.status === "running") {
    // 假 runId 永远匹配不上 emit → slotRun 永久卡 running；宁可 failed 可补跑
    if (!run.runId) {
      const finishedAt = new Date().toISOString();
      const msg = "startPwJob 未返回 runId";
      next.slotRun = {
        slot,
        day,
        runId: "missing-runId",
        status: "failed",
        startedAt: run.startedAt,
        finishedAt,
      };
      next.lastOk = false;
      next.lastRunAt = finishedAt;
      next.lastMessage = msg;
      save(next);
      writeScheduleLastTxt({
        slot,
        ok: false,
        status: "failed",
        message: msg,
        shops: cfg.shopIds,
        finishedAt,
      });
      console.log(`[ads-budget-sched] ${slot} failed: ${msg}`);
      return;
    }
    // 启动成功立刻写 running（推翻「启动不写」）
    next.slotRun = {
      slot,
      day,
      runId: run.runId,
      status: "running",
      startedAt: run.startedAt,
      finishedAt: null,
    };
    save(next);
    return;
  }

  // startPwJob 立刻 failed / ok：按返回写，勿无条件写 running
  const ok = run.status === "ok";
  const finishedAt = run.finishedAt || new Date().toISOString();
  next.slotRun = {
    slot,
    day,
    runId: run.runId || "immediate-no-runId",
    status: ok ? "done" : "failed",
    startedAt: run.startedAt,
    finishedAt,
  };
  next.lastOk = ok;
  next.lastRunAt = finishedAt;
  next.lastMessage = run.message;
  const days = slotDaysAfterFinish({
    slot,
    day,
    ok,
    lastPeakDay: next.lastPeakDay,
    lastOffpeakDay: next.lastOffpeakDay,
  });
  next.lastPeakDay = days.lastPeakDay;
  next.lastOffpeakDay = days.lastOffpeakDay;
  save(next);
  writeScheduleLastTxt({
    slot,
    ok,
    status: run.status,
    message: run.message,
    shops: cfg.shopIds,
    finishedAt,
  });
  console.log(
    `[ads-budget-sched] ${slot} finished immediately status=${run.status}`,
  );
}

function cooldownAnchor(cfg: AdsBudgetScheduleState, slot: AdsBudgetSlot): string | null {
  if (
    cfg.slotRun &&
    cfg.slotRun.slot === slot &&
    cfg.slotRun.status === "failed" &&
    cfg.slotRun.finishedAt
  ) {
    return cfg.slotRun.finishedAt;
  }
  return cfg.lastRunAt;
}

function tick() {
  if (!enabled) return;
  const cfg = load();
  if (!cfg.enabled) return;

  const peakMin = parseHhMm(cfg.peakAt, "00:10");
  const offMin = parseHhMm(cfg.offpeakAt, "09:10");
  // 低峰业务窗到 16:00；peak 补跑截止到 offpeak 墙钟前一分钟
  const offpeakEndMin = parseHhMm(
    process.env.OUTPOST_ADS_BUDGET_OFFPEAK_END?.trim() || "16:00",
    "16:00",
  );

  const peakClaimed = lastScheduledDayFromSlotRun("peak", cfg.slotRun);
  const peak = shouldFireWallClock({
    atMinuteOfDay: peakMin,
    lastScheduledDay: peakClaimed,
    catchWindowMinutes: cfg.catchWindowMinutes,
  });
  if (peak.fire) {
    fireSlot("peak", peak.day);
    return; // 同一分钟只跑一个槽，避免双开 Chrome
  }

  // API 半夜/早上才起来：短窗已过则补跑 peak（截止 offpeak 前）
  const peakCatch = shouldCatchUpMissedSlot({
    atMinuteOfDay: peakMin,
    lastScheduledDay: peakClaimed,
    catchUpUntilMinuteOfDay: offMin,
  });
  if (peakCatch.fire) {
    if (
      shouldSkipRetryCooldown({
        slot: "peak",
        lastSlot: cfg.lastSlot,
        lastOk: cfg.lastOk,
        lastRunAt: cooldownAnchor(cfg, "peak"),
      })
    ) {
      console.log(
        `[ads-budget-sched] skip catch-up peak: retry cooldown after fail`,
      );
    } else {
      console.log(
        `[ads-budget-sched] catch-up peak day=${peakCatch.day} reason=${peakCatch.reason}`,
      );
      fireSlot("peak", peakCatch.day);
    }
    return;
  }

  const offClaimed = lastScheduledDayFromSlotRun("offpeak", cfg.slotRun);
  const off = shouldFireWallClock({
    atMinuteOfDay: offMin,
    lastScheduledDay: offClaimed,
    catchWindowMinutes: cfg.catchWindowMinutes,
  });
  if (off.fire) {
    fireSlot("offpeak", off.day);
    return;
  }

  const offCatch = shouldCatchUpMissedSlot({
    atMinuteOfDay: offMin,
    lastScheduledDay: offClaimed,
    catchUpUntilMinuteOfDay: offpeakEndMin,
  });
  if (offCatch.fire) {
    if (
      shouldSkipRetryCooldown({
        slot: "offpeak",
        lastSlot: cfg.lastSlot,
        lastOk: cfg.lastOk,
        lastRunAt: cooldownAnchor(cfg, "offpeak"),
      })
    ) {
      console.log(
        `[ads-budget-sched] skip catch-up offpeak: retry cooldown after fail`,
      );
    } else {
      console.log(
        `[ads-budget-sched] catch-up offpeak day=${offCatch.day} reason=${offCatch.reason}`,
      );
      fireSlot("offpeak", offCatch.day);
    }
  }
}

function migrateOnStart() {
  const cfg = load();
  if (cfg.slotRun) return;
  const today = shanghaiParts().day;
  const migrated = migrateSlotRunFromLastDays({
    slotRun: null,
    lastPeakDay: cfg.lastPeakDay,
    lastOffpeakDay: cfg.lastOffpeakDay,
    lastRunAt: cfg.lastRunAt,
    today,
  });
  if (!migrated) return;
  cfg.slotRun = migrated;
  save(cfg);
  console.log(
    `[ads-budget-sched] migrated slotRun=${migrated.slot}/${migrated.day} status=done from last*Day`,
  );
}

function reconcileOnStart() {
  const cfg = load();
  const mem = getPwJobStatus("ads-budget");
  const r = reconcileStaleSlotRun({
    slotRun: cfg.slotRun,
    memoryRunId: mem.runId,
    memoryStatus: mem.status,
  });
  if (!r.changed || !r.slotRun) return;
  cfg.slotRun = r.slotRun;
  cfg.lastOk = false;
  cfg.lastRunAt = r.slotRun.finishedAt;
  cfg.lastMessage = r.message;
  cfg.lastSlot = r.slotRun.slot;
  save(cfg);
  console.log(
    `[ads-budget-sched] reconcile: slotRun → failed (${r.message}) runId=${r.slotRun.runId}`,
  );
}

export function startAdsBudgetScheduler(opts?: { enabled?: boolean }) {
  enabled = opts?.enabled ?? load().enabled;
  const cfg = load();
  cfg.enabled = enabled;
  save(cfg);
  stopAdsBudgetScheduler();
  ensureFinishSubscription();
  try {
    migrateOnStart();
  } catch (e) {
    console.log(`[ads-budget-sched] migrate error: ${e}`);
  }
  try {
    reconcileOnStart();
  } catch (e) {
    console.log(`[ads-budget-sched] reconcile error: ${e}`);
  }
  ensureTimer();
  if (enabled) {
    console.log(
      `[ads-budget-sched] started peak=${formatMinuteOfDay(parseHhMm(cfg.peakAt, "00:10"))} offpeak=${formatMinuteOfDay(parseHhMm(cfg.offpeakAt, "09:10"))} (startup tick + missed-slot catch-up; slotRun)`,
    );
    // 立刻判一次：避免等满 60s；也能吃到「刚启动已错过短窗」的补跑
    try {
      tick();
    } catch (e) {
      console.log(`[ads-budget-sched] startup tick error: ${e}`);
    }
  } else {
    console.log(
      "[ads-budget-sched] disabled (OUTPOST_ADS_BUDGET_SCHEDULE=0 or config)",
    );
  }
}
