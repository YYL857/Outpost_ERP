import { Router } from "express";
import { requireAdmin } from "../../auth/middleware.js";
import { setAuditDetail } from "../audit/detail.js";
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
import {
  getAdsBudgetSchedulerStatus,
  setAdsBudgetScheduleEnabled,
} from "./ads-budget-scheduler.js";
import {
  deleteBaselineRow,
  importBaselineBudgets,
  listBaseline,
  listBudgetProductMeta,
  patchBaselineRow,
  upsertBaselineRow,
  type AdsBudgetImportItem,
} from "./ads-budget-baseline.js";
import { listAdsBudgetRuns } from "./ads-budget-runs.js";
import { resolveOutpostDataRoot } from "./outpost-data-root.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADS_BUDGET_PILOT = "PRJ488078";

function resolveBudgetShopId(raw: unknown): string {
  const sid = String(raw || ADS_BUDGET_PILOT)
    .trim()
    .toUpperCase();
  return sid || ADS_BUDGET_PILOT;
}

function parseBody(body: Record<string, unknown>) {
  let shopIds: string[] = [];
  if (Array.isArray(body.shopIds)) {
    shopIds = body.shopIds.map((x) => String(x || "").trim()).filter(Boolean);
  } else if (typeof body.shopId === "string" && body.shopId.trim()) {
    shopIds = [body.shopId.trim()];
  }
  const cmdRaw = String(body.cmd || "ui").toLowerCase();
  let cmd: "ui" | "login" | "probe" | "apply" | "sync" = "ui";
  if (cmdRaw === "login" || cmdRaw === "probe") cmd = cmdRaw;
  else if (cmdRaw === "apply" || cmdRaw === "sync") cmd = cmdRaw;
  const modeRaw = String(body.mode || "").toLowerCase();
  const mode =
    modeRaw === "peak" ||
    modeRaw === "offpeak" ||
    modeRaw === "auto" ||
    modeRaw === "idle"
      ? modeRaw
      : undefined;
  const dryRun = Boolean(body.dryRun);
  const refreshBaseline = Boolean(body.refreshBaseline);
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
  return {
    shopIds,
    cmd,
    mode,
    dryRun,
    refreshBaseline,
    range,
    days,
    fromDate,
    toDate,
    extraEnv,
  };
}

function adsBudgetDataRoot(): string {
  return resolveOutpostDataRoot();
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
          mode: data.opts.mode,
          dryRun: data.opts.dryRun,
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
        hint: "ads / sales / keepalive / ads-budget；市场情报仍走影刀",
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

  router.get("/ads-budget/schedule", (_req, res) => {
    res.json({ data: getAdsBudgetSchedulerStatus() });
  });

  router.put("/ads-budget/schedule", requireAdmin, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.enabled === "boolean") {
      setAdsBudgetScheduleEnabled(body.enabled);
      setAuditDetail(req, {
        summary: `广告预算峰期调度 → ${body.enabled ? "开启" : "关闭"}`,
        entityType: "adsBudgetSchedule",
        entityId: "global",
        detail: { enabled: body.enabled },
      });
    }
    res.json({ data: getAdsBudgetSchedulerStatus() });
  });

  router.get("/ads-budget/last", (_req, res) => {
    const p = join(adsBudgetDataRoot(), "pw-rpa", "ads-budget-last.json");
    if (!existsSync(p)) {
      res.json({ data: null });
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      res.json({ data: raw });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "读 ads-budget-last 失败",
      });
    }
  });

  /** 广告预算运行历史（全局 jsonl，可选按店过滤） */
  router.get("/ads-budget/runs", (req, res) => {
    try {
      const shopRaw = String(req.query.shopId || "").trim();
      const limitNum = Number(req.query.limit);
      const data = listAdsBudgetRuns({
        shopId: shopRaw || undefined,
        limit: Number.isFinite(limitNum) ? limitNum : 50,
      });
      res.json({ data });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "读 ads-budget-runs 失败",
      });
    }
  });

  /** 权威高峰预算表（与 Python apply 同一 baseline.csv）；各店可读 */
  router.get("/ads-budget/baseline", (req, res) => {
    const shopId = resolveBudgetShopId(req.query.shopId);
    try {
      res.json({ data: listBaseline(shopId) });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "读预算表失败",
      });
    }
  });

  /** 预算店 Catalog 缩略图（按 shopId，勿用顶栏当前店） */
  router.get("/ads-budget/product-meta", (req, res) => {
    const shopId = resolveBudgetShopId(req.query.shopId);
    try {
      res.json({ data: listBudgetProductMeta(shopId) });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "读产品图失败",
      });
    }
  });

  router.post("/ads-budget/baseline", requireAdmin, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const shopId = resolveBudgetShopId(body.shopId ?? req.query.shopId);
    try {
      const row = upsertBaselineRow(
        shopId,
        {
          campaignId: String(body.campaignId || ""),
          campaignName:
            body.campaignName === undefined
              ? undefined
              : String(body.campaignName || ""),
          psku: body.psku === undefined ? undefined : String(body.psku || ""),
          baselineBudget:
            body.baselineBudget === undefined
              ? undefined
              : body.baselineBudget === null || body.baselineBudget === ""
                ? null
                : Number(body.baselineBudget),
          offpeakBudget:
            body.offpeakBudget === undefined
              ? undefined
              : body.offpeakBudget === null || body.offpeakBudget === ""
                ? null
                : Number(body.offpeakBudget),
          enabled:
            typeof body.enabled === "boolean" ? body.enabled : undefined,
        },
        "ui",
      );
      setAuditDetail(req, {
        summary: `广告预算写入 ${shopId} · ${row.psku || row.campaignId} 高峰=${row.baselineBudget ?? "空"} 低峰=${row.offpeakBudget ?? "默认"}`,
        entityType: "adsBudgetBaseline",
        entityId: `${shopId}:${row.campaignId}`,
        detail: {
          shopId,
          campaignId: row.campaignId,
          psku: row.psku,
          baselineBudget: row.baselineBudget,
          offpeakBudget: row.offpeakBudget,
          enabled: row.enabled,
        },
      });
      res.json({ data: row, meta: listBaseline(shopId) });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "写入预算表失败",
      });
    }
  });

  router.patch("/ads-budget/baseline/:campaignId", requireAdmin, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const shopId = resolveBudgetShopId(body.shopId ?? req.query.shopId);
    const campaignId = String(req.params.campaignId || "").trim();
    if (!campaignId) {
      res.status(400).json({ error: "活动编号必填" });
      return;
    }
    try {
      // 拒绝客户端改观测列
      if ("lastSeenBudget" in body || "mode" in body) {
        res.status(400).json({
          error: "禁止改「页面现状」；请用同步列表或应用任务",
        });
        return;
      }
      const row = patchBaselineRow(
        shopId,
        campaignId,
        {
          baselineBudget:
            body.baselineBudget === undefined
              ? undefined
              : body.baselineBudget === null || body.baselineBudget === ""
                ? null
                : Number(body.baselineBudget),
          offpeakBudget:
            body.offpeakBudget === undefined
              ? undefined
              : body.offpeakBudget === null || body.offpeakBudget === ""
                ? null
                : Number(body.offpeakBudget),
          enabled:
            typeof body.enabled === "boolean" ? body.enabled : undefined,
          psku: body.psku === undefined ? undefined : String(body.psku || ""),
          campaignName:
            body.campaignName === undefined
              ? undefined
              : String(body.campaignName || ""),
        },
        "ui",
      );
      setAuditDetail(req, {
        summary: `广告预算更新 ${shopId} · ${row.psku || campaignId} 高峰=${row.baselineBudget ?? "空"} 低峰=${row.offpeakBudget ?? "默认"}${
          typeof body.enabled === "boolean"
            ? body.enabled
              ? " · 启用"
              : " · 停用"
            : ""
        }`,
        entityType: "adsBudgetBaseline",
        entityId: `${shopId}:${campaignId}`,
        detail: {
          shopId,
          campaignId,
          psku: row.psku,
          baselineBudget: row.baselineBudget,
          offpeakBudget: row.offpeakBudget,
          enabled: row.enabled,
        },
      });
      res.json({ data: row });
    } catch (e) {
      res.status(404).json({
        error: e instanceof Error ? e.message : "更新预算表失败",
      });
    }
  });

  /** 导入对比表：按 campaignId 批量更新高峰/低峰（不改页面现状） */
  router.post("/ads-budget/baseline/import", requireAdmin, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const shopId = resolveBudgetShopId(body.shopId ?? req.query.shopId);
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    if (!rawRows.length) {
      res.status(400).json({ error: "rows 不能为空" });
      return;
    }
    if (rawRows.length > 5000) {
      res.status(400).json({ error: "单次最多导入 5000 行" });
      return;
    }
    const parseOptNum = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const items: AdsBudgetImportItem[] = [];
    for (const raw of rawRows) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const campaignId = String(r.campaignId || "").trim();
      if (!campaignId) continue;
      const item: AdsBudgetImportItem = { campaignId };
      if ("baselineBudget" in r) {
        const n = parseOptNum(r.baselineBudget);
        if (n !== undefined) item.baselineBudget = n;
      }
      if ("offpeakBudget" in r) {
        const n = parseOptNum(r.offpeakBudget);
        if (n !== undefined) item.offpeakBudget = n;
      }
      if (typeof r.enabled === "boolean") item.enabled = r.enabled;
      else if (r.enabled !== undefined && r.enabled !== null && r.enabled !== "") {
        const s = String(r.enabled).trim().toLowerCase();
        item.enabled = ["1", "true", "yes", "y", "on"].includes(s);
      }
      if (typeof r.psku === "string") item.psku = r.psku;
      if (typeof r.campaignName === "string") item.campaignName = r.campaignName;
      items.push(item);
    }
    if (!items.length) {
      res.status(400).json({ error: "没有有效的 campaignId 行" });
      return;
    }
    try {
      const result = importBaselineBudgets(shopId, items, "ui-import");
      setAuditDetail(req, {
        summary: `广告预算导入 ${shopId} · 更新 ${result.updated} / 跳过 ${result.skipped}`,
        entityType: "adsBudgetBaseline",
        entityId: shopId,
        detail: result,
      });
      res.json({ data: result, meta: listBaseline(shopId) });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "导入失败",
      });
    }
  });

  router.delete("/ads-budget/baseline/:campaignId", requireAdmin, (req, res) => {
    const shopId = resolveBudgetShopId(req.query.shopId);
    const campaignId = String(req.params.campaignId || "").trim();
    if (!campaignId) {
      res.status(400).json({ error: "活动编号必填" });
      return;
    }
    const ok = deleteBaselineRow(shopId, campaignId);
    if (!ok) {
      res.status(404).json({ error: `找不到 campaignId=${campaignId}` });
      return;
    }
    setAuditDetail(req, {
      summary: `广告预算删除 ${shopId} · ${campaignId}`,
      entityType: "adsBudgetBaseline",
      entityId: `${shopId}:${campaignId}`,
    });
    res.json({ data: { ok: true, campaignId }, meta: listBaseline(shopId) });
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
    const dailyAt =
      typeof body.dailyAt === "string" ? body.dailyAt.trim() : undefined;
    const catchWindowMinutes = Number(body.catchWindowMinutes);
    const data = upsertPwExportSchedule(job, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      dailyAt,
      catchWindowMinutes: Number.isFinite(catchWindowMinutes)
        ? catchWindowMinutes
        : undefined,
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
    const {
      shopIds,
      cmd,
      mode,
      dryRun,
      refreshBaseline,
      range,
      days,
      fromDate,
      toDate,
      extraEnv,
    } = parseBody(body);
    // 广告预算：其他店只开放记录（sync/probe）；改 Noon 的 apply / 刷新基准仅试店
    let effectiveShops = shopIds;
    if (job === "ads-budget") {
      const pilot = ADS_BUDGET_PILOT;
      const ids = (shopIds.length ? shopIds : [pilot]).map((s) =>
        s.trim().toUpperCase(),
      );
      const isRecordOnly = cmd === "sync" || cmd === "probe" || cmd === "ui";
      const touchesNoon =
        cmd === "apply" || (cmd === "sync" && refreshBaseline);
      if (touchesNoon) {
        const bad = ids.filter((s) => s !== pilot);
        if (bad.length) {
          res.status(400).json({
            error: `改预算/刷新基准仅试店 ${pilot}；其他店只开放记录（同步列表）`,
          });
          return;
        }
        effectiveShops = [pilot];
      } else if (isRecordOnly) {
        effectiveShops = ids.length ? ids : [pilot];
      } else {
        effectiveShops = ids;
      }
    }
    const data = startPwJob(job, {
      shopIds: effectiveShops,
      cmd,
      mode,
      dryRun,
      refreshBaseline,
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
