import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { startPwJob, getPwJobStatus, type PwJobOpts } from "./cli.js";
import { isAdsRangeMode, type AdsRangeMode } from "./ads-range.js";

export type ExportJobName = "ads" | "sales";

export type PwExportSchedule = {
  job: ExportJobName;
  enabled: boolean;
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

function defaults(job: ExportJobName): PwExportSchedule {
  return {
    job,
    enabled: false,
    everyMs: 24 * 60 * 60 * 1000,
    range: job === "ads" ? "yesterday" : "last90",
    shopIds: [],
    lastRunAt: null,
    lastMessage: null,
    lastOk: null,
  };
}

function loadAll(): Record<ExportJobName, PwExportSchedule> {
  const empty = { ads: defaults("ads"), sales: defaults("sales") };
  const p = configPath();
  if (!existsSync(p)) return empty;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<
      Record<ExportJobName, Partial<PwExportSchedule>>
    >;
    return {
      ads: { ...empty.ads, ...raw.ads, job: "ads" },
      sales: { ...empty.sales, ...raw.sales, job: "sales" },
    };
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

function stopOne(job: ExportJobName) {
  if (timers[job]) clearInterval(timers[job]);
  timers[job] = null;
}

function tick(job: ExportJobName) {
  const st = getPwJobStatus(job);
  if (st.status === "starting" || st.status === "running") return;
  const cfg = loadAll()[job];
  if (!cfg.enabled) return;
  const opts: PwJobOpts = {
    cmd: "ui",
    range: cfg.range,
    shopIds: cfg.shopIds,
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
    lastOk: run.status === "ok" ? true : run.status === "failed" ? false : all[job].lastOk,
  };
  saveAll(all);
}

function arm(job: ExportJobName) {
  stopOne(job);
  const cfg = loadAll()[job];
  if (!cfg.enabled) return;
  const every = Math.max(60_000, cfg.everyMs);
  timers[job] = setInterval(() => tick(job), every);
  console.log(`[pw-export] ${job} every ${Math.round(every / 60000)} min`);
}

export function listPwExportSchedules() {
  const all = loadAll();
  return (["ads", "sales"] as const).map((job) => ({
    ...all[job],
    timerActive: Boolean(timers[job]),
  }));
}

export function getPwExportSchedule(job: ExportJobName): PwExportSchedule & {
  timerActive: boolean;
} {
  return { ...loadAll()[job], timerActive: Boolean(timers[job]) };
}

export function upsertPwExportSchedule(
  job: ExportJobName,
  patch: Partial<PwExportSchedule>,
): PwExportSchedule & { timerActive: boolean } {
  const all = loadAll();
  const next: PwExportSchedule = { ...all[job] };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.everyMs === "number" && Number.isFinite(patch.everyMs)) {
    next.everyMs = Math.max(60_000, Math.floor(patch.everyMs));
  }
  if (patch.range && isAdsRangeMode(patch.range)) next.range = patch.range;
  if (Array.isArray(patch.shopIds)) {
    next.shopIds = [...new Set(patch.shopIds.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  }
  if (patch.fromDate !== undefined) next.fromDate = patch.fromDate || undefined;
  if (patch.toDate !== undefined) next.toDate = patch.toDate || undefined;
  all[job] = next;
  saveAll(all);
  arm(job);
  return getPwExportSchedule(job);
}

export function startPwExportSchedulers() {
  arm("ads");
  arm("sales");
}

export function runPwExportScheduleNow(job: ExportJobName) {
  tick(job);
  return getPwJobStatus(job);
}
