import { Router } from "express";
import { requireAdmin } from "../../auth/middleware.js";
import {
  getPwJobStatus,
  isPwJobName,
  listPwJobStatus,
  startPwJob,
  type PwJobName,
} from "./cli.js";
import { isAdsRangeMode, type AdsRangeMode } from "./ads-range.js";
import { getRunLog, isExportJob, listRunLogs } from "./run-log.js";
import {
  getPwExportSchedule,
  listPwExportSchedules,
  runPwExportScheduleNow,
  upsertPwExportSchedule,
  type ExportJobName,
} from "./export-scheduler.js";
import { getPwSessionStatus } from "./session-status.js";

function parseBody(body: Record<string, unknown>) {
  let shopIds: string[] = [];
  if (Array.isArray(body.shopIds)) {
    shopIds = body.shopIds.map((x) => String(x || "").trim()).filter(Boolean);
  } else if (typeof body.shopId === "string" && body.shopId.trim()) {
    shopIds = [body.shopId.trim()];
  }
  const cmdRaw = String(body.cmd || "ui").toLowerCase();
  const cmd: "ui" | "login" | "probe" =
    cmdRaw === "login" || cmdRaw === "probe" ? cmdRaw : "ui";
  const rangeRaw = String(body.range || "yesterday").toLowerCase();
  const range: AdsRangeMode = isAdsRangeMode(rangeRaw) ? rangeRaw : "yesterday";
  const daysNum = Number(body.days);
  const days = Number.isFinite(daysNum) ? daysNum : undefined;
  const fromDate = String(body.fromDate || body.from || "").trim() || undefined;
  const toDate = String(body.toDate || body.to || "").trim() || undefined;
  let extraEnv: Record<string, string> | undefined;
  if (Array.isArray(body.targets) && body.targets.length) {
    extraEnv = {
      OUTPOST_PW_KEEPALIVE_TARGETS: body.targets
        .map((x) => String(x || "").trim().toLowerCase())
        .filter(Boolean)
        .join(","),
    };
  }
  return { shopIds, cmd, range, days, fromDate, toDate, extraEnv };
}

function serialize(job: PwJobName) {
  const data = getPwJobStatus(job);
  return {
    job: data.job,
    status: data.status,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    pid: data.pid,
    exitCode: data.exitCode,
    message: data.message,
    runId: data.runId,
    taskId: data.runId,
    opts: data.opts
      ? {
          shopIds: data.opts.shopIds,
          range: data.opts.range,
          days: data.opts.days,
          fromDate: data.opts.fromDate,
          toDate: data.opts.toDate,
          cmd: data.opts.cmd,
          trigger: data.opts.trigger,
        }
      : null,
  };
}

function isExportJobName(s: string): s is ExportJobName {
  return s === "ads" || s === "sales";
}

export function createPwRpaRouter() {
  const router = Router();

  router.get("/jobs", (_req, res) => {
    res.json({
      data: listPwJobStatus().map((j) => serialize(j.job)),
      meta: {
        hint: "ads / sales / keepalive；市场情报仍走影刀",
        adsRanges: [
          "today",
          "yesterday",
          "last7",
          "last30",
          "last90",
          "ytd",
          "all",
          "custom",
        ],
      },
    });
  });

  /** 读本地 storage_state cookie 过期；须在 /:job/* 之前注册 */
  router.get("/session-status", (_req, res) => {
    res.json({ data: getPwSessionStatus() });
  });

  router.get("/logs", (req, res) => {
    const jobRaw = String(req.query.job || "").toLowerCase();
    const job = isExportJob(jobRaw as PwJobName) ? jobRaw : undefined;
    const from = String(req.query.from || "").trim() || undefined;
    const to = String(req.query.to || "").trim() || undefined;
    const limitNum = Number(req.query.limit);
    const data = listRunLogs({
      job: job as "ads" | "sales" | undefined,
      from,
      to,
      limit: Number.isFinite(limitNum) ? limitNum : 20,
    });
    res.json({ data });
  });

  router.get("/logs/:runId", (req, res) => {
    const row = getRunLog(String(req.params.runId || ""));
    if (!row) {
      res.status(404).json({ error: "找不到该次运行日志" });
      return;
    }
    res.json({ data: row });
  });

  router.get("/schedules", (_req, res) => {
    res.json({ data: listPwExportSchedules() });
  });

  router.put("/schedules/:job", requireAdmin, (req, res) => {
    const job = String(req.params.job || "").toLowerCase();
    if (!isExportJobName(job)) {
      res.status(400).json({ error: "只能给广告/销量设定时" });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const everyHours = Number(body.everyHours);
    const everyMs = Number.isFinite(everyHours)
      ? Math.round(everyHours * 60 * 60 * 1000)
      : Number(body.everyMs);
    const shopIds = Array.isArray(body.shopIds)
      ? body.shopIds.map((x) => String(x || ""))
      : undefined;
    const data = upsertPwExportSchedule(job, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      everyMs: Number.isFinite(everyMs) ? everyMs : undefined,
      range: typeof body.range === "string" && isAdsRangeMode(body.range)
        ? body.range
        : undefined,
      shopIds,
      fromDate:
        body.fromDate === undefined ? undefined : String(body.fromDate || ""),
      toDate: body.toDate === undefined ? undefined : String(body.toDate || ""),
    });
    res.json({ data });
  });

  router.post("/schedules/:job/run", requireAdmin, (req, res) => {
    const job = String(req.params.job || "").toLowerCase();
    if (!isExportJobName(job)) {
      res.status(400).json({ error: "只能立刻跑广告/销量定时" });
      return;
    }
    const data = runPwExportScheduleNow(job);
    res.json({ data: serialize(job), meta: { hint: data.message } });
  });

  router.post("/:job/run", requireAdmin, (req, res) => {
    const job = String(req.params.job || "").toLowerCase();
    if (!isPwJobName(job)) {
      res.status(400).json({ error: `未知 job ${job}` });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const { shopIds, cmd, range, days, fromDate, toDate, extraEnv } =
      parseBody(body);
    const data = startPwJob(job, {
      shopIds,
      cmd,
      range,
      days,
      fromDate,
      toDate,
      extraEnv,
      trigger: "manual",
    });
    res.json({
      data: serialize(job),
      meta: {
        hint:
          data.status === "running" || data.status === "starting"
            ? `Playwright ${job} 已启动`
            : data.message,
      },
    });
  });

  router.get("/:job/status", (req, res) => {
    const job = String(req.params.job || "").toLowerCase();
    if (!isPwJobName(job)) {
      res.status(400).json({ error: `未知 job ${job}` });
      return;
    }
    res.json({ data: serialize(job) });
  });

  return router;
}
