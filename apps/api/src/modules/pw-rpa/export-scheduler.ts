/**
 * 广告 / 销量导出：上海时区墙钟日更。
 * 默认每天 17:00 ads、17:20 sales（错开，避免互斥 busy），店铺前两家老店。
 * API 进程需过夜常开才会触发。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parseHhMm,
  shouldFireWallClock,
  formatMinuteOfDay,
} from "../morning-digest/clock.js";
import { startPwJob, getPwJobStatus, type PwJobOpts, PW_JOBS } from "./cli.js";
import { isAdsRangeMode, type AdsRangeMode } from "./ads-range.js";

export type ExportJobName = "ads" | "sales";

/** 广告/销量定时默认只跑这两家老店 */
export const DEFAULT_EXPORT_SHOP_IDS = ["PRJ396770", "PRJ482387"] as const;

export type PwExportSchedule = {
  job: ExportJobName;
  enabled: boolean;
  /** 上海时区每天触发时刻 HH:MM */
  dailyAt: string;
  /** 触发窗口（分钟）；窗口内若对端忙可下一分钟重试 */
  catchWindowMinutes: number;
  /** 当日已成功拉起过的上海日历日 YYYY-MM-DD */
  lastScheduledDay: string | null;
  /** @deprecated 旧间隔模式；墙钟生效后仅作兼容展示 */
  everyMs: number;
  range: AdsRangeMode;
  shopIds: string[];
  fromDate?: string;
  toDate?: string;
  lastRunAt: string | null;
  lastMessage: string | null;
  lastOk: boolean | null;
};

function configPath(): string {
  const root =
    process.env.OUTPOST_DATA_DIR?.trim() ||
    process.env.DATA_DIR?.trim() ||
    "D:\\outpost-data";
  return join(root, "pw-rpa", "schedules.json");
}

function defaultDailyAt(job: ExportJobName): string {
  if (job === "ads") {
    return process.env.OUTPOST_PW_ADS_AT?.trim() || "17:00";
  }
  return process.env.OUTPOST_PW_SALES_AT?.trim() || "17:20";
}

function defaultShopIds(): string[] {
  const raw = process.env.OUTPOST_PW_EXPORT_SHOPS?.trim();
  if (raw) {
    const ids = [
      ...new Set(
        raw
          .split(/[,;\s]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (ids.length) return ids;
  }
  return [...DEFAULT_EXPORT_SHOP_IDS];
}

function defaults(job: ExportJobName): PwExportSchedule {
  return {
    job,
    enabled: false,
    dailyAt: defaultDailyAt(job),
    catchWindowMinutes: Math.max(
      1,
      Number(process.env.OUTPOST_PW_EXPORT_CATCH_MIN) || 25,
    ),
    lastScheduledDay: null,
    everyMs: 24 * 60 * 60 * 1000,
    range: job === "ads" ? "yesterday" : "last90",
    shopIds: defaultShopIds(),
    lastRunAt: null,
    lastMessage: null,
    lastOk: null,
  };
}

function normalizeShopIds(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw) || !raw.length) return [...fallback];
  const ids = [
    ...new Set(
      raw.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean),
    ),
  ];
  return ids.length ? ids : [...fallback];
}

function loadAll(): Record<ExportJobName, PwExportSchedule> {
  const empty = { ads: defaults("ads"), sales: defaults("sales") };
  const p = configPath();
  if (!existsSync(p)) return empty;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<
      Record<ExportJobName, Partial<PwExportSchedule> & { everyMs?: number }>
    >;
    const merge = (job: ExportJobName): PwExportSchedule => {
      const base = empty[job];
      const row = raw[job] || {};
      const dailyAt =
        typeof row.dailyAt === "string" && /^\d{1,2}:\d{2}$/.test(row.dailyAt.trim())
          ? row.dailyAt.trim()
          : base.dailyAt;
      return {
        ...base,
        ...row,
        job,
        dailyAt,
        catchWindowMinutes: Math.max(
          1,
          Number(row.catchWindowMinutes) || base.catchWindowMinutes,
        ),
        lastScheduledDay:
          typeof row.lastScheduledDay === "string" ? row.lastScheduledDay : null,
        shopIds: normalizeShopIds(row.shopIds, base.shopIds),
        everyMs:
          typeof row.everyMs === "number" && Number.isFinite(row.everyMs)
            ? Math.max(60_000, row.everyMs)
            : base.everyMs,
      };
    };
    return { ads: merge("ads"), sales: merge("sales") };
  } catch {
    return empty;
  }
}

function saveAll(all: Record<ExportJobName, PwExportSchedule>) {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(all, null, 2), "utf8");
}

const timers: Record<ExportJobName, ReturnType<typeof setInterval> | null> = {
  ads: null,
  sales: null,
};

const POLL_MS = 60_000;

function stopOne(job: ExportJobName) {
  if (timers[job]) clearInterval(timers[job]);
  timers[job] = null;
}

function peerBusy(self: ExportJobName): boolean {
  for (const j of PW_JOBS) {
    if (j === self) continue;
    const st = getPwJobStatus(j);
    if (st.status === "starting" || st.status === "running") return true;
  }
  return false;
}

function tick(job: ExportJobName) {
  const cfg = loadAll()[job];
  if (!cfg.enabled) return;

  const atMod = parseHhMm(cfg.dailyAt, defaultDailyAt(job));
  const check = shouldFireWallClock({
    atMinuteOfDay: atMod,
    lastScheduledDay: cfg.lastScheduledDay,
    catchWindowMinutes: cfg.catchWindowMinutes,
  });
  if (!check.fire) return;

  const st = getPwJobStatus(job);
  if (st.status === "starting" || st.status === "running") return;

  // 对端忙则不消耗当日额度，窗口内下一分钟再试
  if (peerBusy(job)) {
    console.log(`[pw-export] ${job} defer@${formatMinuteOfDay(atMod)}: peer busy`);
    return;
  }

  const opts: PwJobOpts = {
    cmd: "ui",
    range: cfg.range,
    shopIds: cfg.shopIds.length ? cfg.shopIds : defaultShopIds(),
    trigger: "schedule",
    ...(cfg.range === "custom"
      ? { fromDate: cfg.fromDate, toDate: cfg.toDate }
      : {}),
  };
  console.log(
    `[pw-export] fire ${job} day=${check.day} at=${cfg.dailyAt} shops=${opts.shopIds?.join(",")}`,
  );
  const run = startPwJob(job, opts);
  const spawned =
    run.status === "starting" ||
    run.status === "running" ||
    run.status === "ok";

  const all = loadAll();
  all[job] = {
    ...all[job],
    lastRunAt: run.startedAt,
    lastMessage: run.message,
    lastOk:
      run.status === "ok" ? true : run.status === "failed" ? false : all[job].lastOk,
    // 只有真正拉起（或瞬时完成）才记当日，避免 busy 误记导致整天跳过
    lastScheduledDay: spawned ? check.day : all[job].lastScheduledDay,
  };
  saveAll(all);
}

function arm(job: ExportJobName) {
  stopOne(job);
  const cfg = loadAll()[job];
  if (!cfg.enabled) return;
  timers[job] = setInterval(() => tick(job), POLL_MS);
  console.log(
    `[pw-export] ${job} wall-clock poll 60s @${cfg.dailyAt} shops=${cfg.shopIds.join(",")}`,
  );
}

export function listPwExportSchedules() {
  const all = loadAll();
  return (["ads", "sales"] as const).map((job) => ({
    ...all[job],
    timerActive: Boolean(timers[job]),
    pollEveryMs: POLL_MS,
    note: "上海时区墙钟日更；需 API 过夜常开。",
  }));
}

export function getPwExportSchedule(job: ExportJobName): PwExportSchedule & {
  timerActive: boolean;
  pollEveryMs: number;
  note: string;
} {
  const row = listPwExportSchedules().find((s) => s.job === job)!;
  return row;
}

export function upsertPwExportSchedule(
  job: ExportJobName,
  patch: Partial<PwExportSchedule>,
): PwExportSchedule & { timerActive: boolean; pollEveryMs: number; note: string } {
  const all = loadAll();
  const next: PwExportSchedule = { ...all[job] };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.dailyAt === "string" && /^\d{1,2}:\d{2}$/.test(patch.dailyAt.trim())) {
    next.dailyAt = patch.dailyAt.trim();
  }
  if (
    typeof patch.catchWindowMinutes === "number" &&
    Number.isFinite(patch.catchWindowMinutes)
  ) {
    next.catchWindowMinutes = Math.max(1, Math.floor(patch.catchWindowMinutes));
  }
  if (typeof patch.everyMs === "number" && Number.isFinite(patch.everyMs)) {
    next.everyMs = Math.max(60_000, Math.floor(patch.everyMs));
  }
  if (patch.range && isAdsRangeMode(patch.range)) next.range = patch.range;
  if (Array.isArray(patch.shopIds)) {
    next.shopIds = normalizeShopIds(patch.shopIds, defaultShopIds());
  }
  if (patch.fromDate !== undefined) next.fromDate = patch.fromDate || undefined;
  if (patch.toDate !== undefined) next.toDate = patch.toDate || undefined;
  if (patch.lastScheduledDay !== undefined) {
    next.lastScheduledDay = patch.lastScheduledDay;
  }
  all[job] = next;
  saveAll(all);
  arm(job);
  return getPwExportSchedule(job);
}

export function startPwExportSchedulers() {
  // 启动时把空店铺补成默认两家，并确保墙钟字段落盘（迁移旧 interval 配置）
  const all = loadAll();
  let dirty = false;
  for (const job of ["ads", "sales"] as const) {
    const row = all[job];
    if (!row.shopIds.length) {
      row.shopIds = defaultShopIds();
      dirty = true;
    }
    if (!row.dailyAt) {
      row.dailyAt = defaultDailyAt(job);
      dirty = true;
    }
  }
  if (dirty) saveAll(all);
  arm("ads");
  arm("sales");
}

export function runPwExportScheduleNow(job: ExportJobName) {
  const cfg = loadAll()[job];
  const st = getPwJobStatus(job);
  if (st.status === "starting" || st.status === "running") return st;
  if (peerBusy(job)) {
    console.log(`[pw-export] ${job} run-now skip: peer busy`);
    return getPwJobStatus(job);
  }
  const opts: PwJobOpts = {
    cmd: "ui",
    range: cfg.range,
    shopIds: cfg.shopIds.length ? cfg.shopIds : defaultShopIds(),
    trigger: "schedule",
    ...(cfg.range === "custom"
      ? { fromDate: cfg.fromDate, toDate: cfg.toDate }
      : {}),
  };
  const run = startPwJob(job, opts);
  const all = loadAll();
  all[job] = {
    ...all[job],
    lastRunAt: run.startedAt,
    lastMessage: run.message,
    lastOk:
      run.status === "ok" ? true : run.status === "failed" ? false : all[job].lastOk,
  };
  saveAll(all);
  return getPwJobStatus(job);
}
