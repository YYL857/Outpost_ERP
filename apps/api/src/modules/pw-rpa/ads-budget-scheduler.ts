/**
 * 广告预算峰期/低峰墙钟调度（上海时区）。
 * 试店默认 PRJ488078；API 进程需过夜常开才会触发。
 *
 * 默认：
 *   peak    00:10 → apply --mode peak   （回调 baseline）
 *   offpeak 09:10 → apply --mode offpeak（压到 5）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parseHhMm,
  shouldFireWallClock,
  formatMinuteOfDay,
  shanghaiParts,
} from "../morning-digest/clock.js";
import { startPwJob, getPwJobStatus } from "./cli.js";
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
  };
}

function load(): AdsBudgetScheduleState {
  const base = defaults();
  const p = configPath();
  if (!existsSync(p)) return base;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<AdsBudgetScheduleState>;
    return {
      ...base,
      ...raw,
      shopIds:
        Array.isArray(raw.shopIds) && raw.shopIds.length
          ? raw.shopIds.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
          : base.shopIds,
    };
  } catch {
    return base;
  }
}

function save(state: AdsBudgetScheduleState) {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
}

let timer: ReturnType<typeof setInterval> | null = null;
let enabled = envDefaultEnabled();

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
    note: "上海时区墙钟；需 API 过夜常开。登录态复用 noon-ads-pw + OTP 自动回填。",
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
}

function ensureTimer() {
  if (enabled) {
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

  console.log(`[ads-budget-sched] fire ${slot} day=${day} shops=${cfg.shopIds.join(",")}`);
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
  next.lastRunAt = run.startedAt;
  next.lastMessage = run.message;
  next.lastOk =
    run.status === "ok" ? true : run.status === "failed" ? false : next.lastOk;
  next.lastSlot = slot;
  // 不在启动时写 last*Day：失败须能在当日 catch-up 窗口再试
  if (run.status === "ok" || run.status === "failed") {
    const days = slotDaysAfterFinish({
      slot,
      day,
      ok: run.status === "ok",
      lastPeakDay: next.lastPeakDay,
      lastOffpeakDay: next.lastOffpeakDay,
    });
    next.lastPeakDay = days.lastPeakDay;
    next.lastOffpeakDay = days.lastOffpeakDay;
  }
  save(next);

  if (run.status === "ok" || run.status === "failed") {
    console.log(
      `[ads-budget-sched] ${slot} finished immediately status=${run.status}`,
    );
    return;
  }

  // 异步收尾：子进程结束后再刷一次状态（cli 会更新 lastByJob）
  const runId = run.runId;
  const poll = setInterval(() => {
    const cur = getPwJobStatus("ads-budget");
    if (!runId || cur.runId !== runId) {
      clearInterval(poll);
      return;
    }
    if (cur.status === "ok" || cur.status === "failed") {
      clearInterval(poll);
      const done = load();
      done.lastRunAt = cur.finishedAt || cur.startedAt;
      done.lastMessage = cur.message;
      done.lastOk = cur.status === "ok";
      done.lastSlot = slot;
      const days = slotDaysAfterFinish({
        slot,
        day,
        ok: cur.status === "ok",
        lastPeakDay: done.lastPeakDay,
        lastOffpeakDay: done.lastOffpeakDay,
      });
      done.lastPeakDay = days.lastPeakDay;
      done.lastOffpeakDay = days.lastOffpeakDay;
      save(done);
      // 调度侧也落一条可读摘要（Python job 会写更完整的 runs.jsonl）
      try {
        const summaryPath = join(dataRoot(), "pw-rpa", "ads-budget-schedule-last.txt");
        const when = cur.finishedAt || new Date().toISOString();
        mkdirSync(dirname(summaryPath), { recursive: true });
        writeFileSync(
          summaryPath,
          [
            `finishedAt: ${when}`,
            `slot: ${slot}`,
            `ok: ${cur.status === "ok"}`,
            `status: ${cur.status}`,
            `message: ${cur.message ?? ""}`,
            `shops: ${cfg.shopIds.join(",")}`,
            `seeAlso: ${join(dataRoot(), "pw-rpa", "ads-budget-last.txt")}`,
            `history: ${join(dataRoot(), "pw-rpa", "ads-budget-runs.jsonl")}`,
            "",
          ].join("\n"),
          "utf8",
        );
      } catch (e) {
        console.log(`[ads-budget-sched] write schedule-last.txt fail: ${e}`);
      }
      console.log(
        `[ads-budget-sched] ${slot} done status=${cur.status} ${cur.message ?? ""}`,
      );
    }
  }, 5_000);
  setTimeout(() => clearInterval(poll), 30 * 60_000);
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

  const peak = shouldFireWallClock({
    atMinuteOfDay: peakMin,
    lastScheduledDay: cfg.lastPeakDay,
    catchWindowMinutes: cfg.catchWindowMinutes,
  });
  if (peak.fire) {
    fireSlot("peak", peak.day);
    return; // 同一分钟只跑一个槽，避免双开 Chrome
  }

  // API 半夜/早上才起来：短窗已过则补跑 peak（截止 offpeak 前）
  const peakCatch = shouldCatchUpMissedSlot({
    atMinuteOfDay: peakMin,
    lastScheduledDay: cfg.lastPeakDay,
    catchUpUntilMinuteOfDay: offMin,
  });
  if (peakCatch.fire) {
    if (
      shouldSkipRetryCooldown({
        slot: "peak",
        lastSlot: cfg.lastSlot,
        lastOk: cfg.lastOk,
        lastRunAt: cfg.lastRunAt,
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

  const off = shouldFireWallClock({
    atMinuteOfDay: offMin,
    lastScheduledDay: cfg.lastOffpeakDay,
    catchWindowMinutes: cfg.catchWindowMinutes,
  });
  if (off.fire) {
    fireSlot("offpeak", off.day);
    return;
  }

  const offCatch = shouldCatchUpMissedSlot({
    atMinuteOfDay: offMin,
    lastScheduledDay: cfg.lastOffpeakDay,
    catchUpUntilMinuteOfDay: offpeakEndMin,
  });
  if (offCatch.fire) {
    if (
      shouldSkipRetryCooldown({
        slot: "offpeak",
        lastSlot: cfg.lastSlot,
        lastOk: cfg.lastOk,
        lastRunAt: cfg.lastRunAt,
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

export function startAdsBudgetScheduler(opts?: { enabled?: boolean }) {
  enabled = opts?.enabled ?? load().enabled;
  const cfg = load();
  cfg.enabled = enabled;
  save(cfg);
  stopAdsBudgetScheduler();
  ensureTimer();
  if (enabled) {
    console.log(
      `[ads-budget-sched] started peak=${formatMinuteOfDay(parseHhMm(cfg.peakAt, "00:10"))} offpeak=${formatMinuteOfDay(parseHhMm(cfg.offpeakAt, "09:10"))} (startup tick + missed-slot catch-up)`,
    );
    // 立刻判一次：避免等满 60s；也能吃到「刚启动已错过短窗」的补跑
    try {
      tick();
    } catch (e) {
      console.log(`[ads-budget-sched] startup tick error: ${e}`);
    }
  } else {
    console.log("[ads-budget-sched] disabled (OUTPOST_ADS_BUDGET_SCHEDULE=0 or config)");
  }
}
