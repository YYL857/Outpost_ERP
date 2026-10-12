import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADS_RANGE_LABELS, type AdsRangeMode } from "./ads-range.js";
import type { PwJobName, PwJobOpts, PwJobRun } from "./cli.js";

export const JOB_LABELS: Record<"ads" | "sales", string> = {
  ads: "广告导出",
  sales: "销量导出",
};

export type PwRunTrigger = "manual" | "schedule";

export type PwRunLog = {
  runId: string;
  job: "ads" | "sales";
  jobLabel: string;
  trigger: PwRunTrigger;
  status: "starting" | "running" | "ok" | "failed";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  口径: {
    range: string;
    rangeLabel: string;
    fromDate?: string;
    toDate?: string;
    days?: number;
  };
  filters: {
    shopIds: string[];
    cmd: string;
  };
  message: string | null;
  exitCode: number | null;
  stdout: string;
};

function rootDir(): string {
  return (
    process.env.OUTPOST_PW_RPA_LOG_DIR?.trim() ||
    join(
      process.env.OUTPOST_DATA_DIR?.trim() ||
        process.env.DATA_DIR?.trim() ||
        "D:\\outpost-data",
      "pw-rpa",
      "runs",
    )
  );
}

function dayDir(iso: string): string {
  const day = iso.slice(0, 10);
  return join(rootDir(), day);
}

function logPath(runId: string, startedAt: string): string {
  return join(dayDir(startedAt), `${runId}.json`);
}

function findLogPath(runId: string): string | null {
  const root = rootDir();
  if (!existsSync(root)) return null;
  const directHit = join(root, runId, `${runId}.json`);
  if (existsSync(directHit)) return directHit;
  for (const day of readdirSync(root)) {
    const p = join(root, day, `${runId}.json`);
    if (existsSync(p)) return p;
  }
  return null;
}

export function isExportJob(job: PwJobName): job is "ads" | "sales" {
  return job === "ads" || job === "sales";
}

function durationMs(startedAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) return null;
  const a = Date.parse(startedAt);
  const b = Date.parse(finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

export function buildRunLog(
  run: PwJobRun,
  extra?: { stdout?: string; trigger?: PwRunTrigger },
): PwRunLog | null {
  if (!isExportJob(run.job) || !run.runId || !run.startedAt) return null;
  const range = (run.opts?.range || "") as AdsRangeMode;
  const status =
    run.status === "ok" || run.status === "failed" || run.status === "running"
      ? run.status
      : run.status === "starting"
        ? "starting"
        : "failed";
  return {
    runId: run.runId,
    job: run.job,
    jobLabel: JOB_LABELS[run.job],
    trigger: extra?.trigger ?? run.opts?.trigger ?? "manual",
    status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: durationMs(run.startedAt, run.finishedAt),
    口径: {
      range: run.opts?.range || "",
      rangeLabel: range && ADS_RANGE_LABELS[range] ? ADS_RANGE_LABELS[range] : run.opts?.range || "",
      fromDate: run.opts?.fromDate,
      toDate: run.opts?.toDate,
      days: run.opts?.days,
    },
    filters: {
      shopIds: run.opts?.shopIds ?? [],
      cmd: run.opts?.cmd || "ui",
    },
    message: run.message,
    exitCode: run.exitCode,
    stdout: extra?.stdout ?? "",
  };
}

export function upsertRunLog(
  run: PwJobRun,
  extra?: { stdout?: string; trigger?: PwRunTrigger },
): PwRunLog | null {
  const next = buildRunLog(run, extra);
  if (!next) return null;
  const existingPath = findLogPath(next.runId);
  let stdout = next.stdout;
  if (existingPath && !stdout) {
    try {
      const prev = JSON.parse(readFileSync(existingPath, "utf8")) as PwRunLog;
      stdout = prev.stdout || "";
    } catch {
      /* keep */
    }
  }
  const saved: PwRunLog = { ...next, stdout: stdout.slice(-400_000) };
  const dest = existingPath || logPath(saved.runId, saved.startedAt);
  mkdirSync(dayDir(saved.startedAt), { recursive: true });
  writeFileSync(dest, JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

export function getRunLog(runId: string): PwRunLog | null {
  const p = findLogPath(runId);
  if (!p) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PwRunLog;
  } catch {
    return null;
  }
}

export type ListRunLogsQuery = {
  job?: "ads" | "sales";
  from?: string;
  to?: string;
  limit?: number;
};

function toSummary(log: PwRunLog) {
  const { stdout: _s, ...rest } = log;
  return rest;
}

export function listRunLogs(q: ListRunLogsQuery = {}) {
  const root = rootDir();
  const limit = Math.max(1, Math.min(200, Math.floor(q.limit ?? 20)));
  if (!existsSync(root)) return { items: [] as ReturnType<typeof toSummary>[], total: 0 };
  const fromMs = q.from ? Date.parse(q.from) : NaN;
  const toMs = q.to ? Date.parse(q.to) : NaN;
  const items: PwRunLog[] = [];
  const days = readdirSync(root)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  for (const day of days) {
    const dir = join(root, day);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const log = JSON.parse(readFileSync(join(dir, f), "utf8")) as PwRunLog;
        if (q.job && log.job !== q.job) continue;
        const t = Date.parse(log.startedAt);
        if (Number.isFinite(fromMs) && t < fromMs) continue;
        if (Number.isFinite(toMs) && t > toMs) continue;
        items.push(log);
      } catch {
        /* skip */
      }
    }
  }
  items.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return {
    items: items.slice(0, limit).map(toSummary),
    total: items.length,
  };
}
