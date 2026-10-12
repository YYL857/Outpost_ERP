/**
 * 广告导出：平台 job `ads`（python main.py ads ui）。
 */
import {
  startPwJob,
  getPwJobStatus,
  mapPwRunToRequestStatus,
} from "../pw-rpa/cli.js";

export type AdsPwExportOpts = {
  shopIds?: string[];
  range?: "yesterday" | "days";
  days?: number;
};

export type AdsPwExportRun = {
  status: "idle" | "starting" | "running" | "ok" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  pid: number | null;
  exitCode: number | null;
  message: string | null;
  runId: string | null;
  opts: AdsPwExportOpts | null;
};

function toAds(run: ReturnType<typeof getPwJobStatus>): AdsPwExportRun {
  return {
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    pid: run.pid,
    exitCode: run.exitCode,
    message: run.message,
    runId: run.runId,
    opts: run.opts
      ? {
          shopIds: run.opts.shopIds,
          range: run.opts.range,
          days: run.opts.days,
        }
      : null,
  };
}

export function getAdsPwExportStatus(): AdsPwExportRun {
  return toAds(getPwJobStatus("ads"));
}

export function startAdsPwExport(opts: AdsPwExportOpts = {}): AdsPwExportRun {
  return toAds(
    startPwJob("ads", {
      shopIds: opts.shopIds,
      range: opts.range,
      days: opts.days,
      cmd: "ui",
    }),
  );
}

export function mapAdsPwRunToRequestStatus(runId: string) {
  return mapPwRunToRequestStatus("ads", runId);
}
