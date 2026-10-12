import { Router } from "express";
import type { AppState, SyncJobStatus } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { requireAdmin } from "../../auth/middleware.js";
import { listInbox } from "./inbox.js";
import { processPendingInbox, pullDomain } from "./pipeline.js";
import { pushAlert } from "./alerts.js";
import {
  getLastAssemblySync,
  isAssemblySyncRunning,
  runAssemblySync,
} from "./assembly-sync.js";
import {
  auditAllShopGaps,
  getLastDataBackfill,
  healthGateComplete,
  isDataBackfillRunning,
  runDataBackfill,
} from "./data-backfill.js";
import { getHealthGateShopIds } from "../../shops/registry.js";

function overallTone(state: AppState): SyncJobStatus {
  if (!state.noon.enabled) return "warning";
  if (state.noon.lastError) return "failed";
  if (state.syncJobs.some((j) => j.status === "failed")) return "failed";
  if (state.syncJobs.some((j) => j.status === "warning" || j.status === "running")) {
    return "warning";
  }
  if (state.syncAlerts.some((a) => !a.acknowledged && a.level === "danger")) {
    return "failed";
  }
  if (state.syncAlerts.some((a) => !a.acknowledged && a.level === "warning")) {
    return "warning";
  }
  return "success";
}

export function createSyncRouter(getState: () => AppState) {
  const router = Router();

  router.get("/health", (_req, res) => {
    const state = getState();
    const domains = {
      orders: {
        count: state.orders.length,
        lastSuccessAt:
          state.syncJobs.find((j) => j.domain === "orders")?.lastSuccessAt ??
          null,
        primaryPage: "销量统计 / 同步健康",
      },
      catalog: {
        count: state.catalog.length,
        lastSuccessAt:
          state.syncJobs.find((j) => j.domain === "catalog")?.lastSuccessAt ??
          null,
        primaryPage: "Catalog",
      },
      stock: {
        count: state.stock.length,
        lastSuccessAt:
          state.syncJobs.find((j) => j.domain === "stock")?.lastSuccessAt ??
          null,
        primaryPage: "Catalog（库存列）",
      },
      sales: {
        count: state.salesFacts.length,
        lastSuccessAt:
          state.syncJobs.find((j) => j.domain === "sales")?.lastSuccessAt ??
          null,
        primaryPage: "销量统计",
      },
      fees: {
        count: state.feeSnapshots.length,
        lastSuccessAt:
          state.syncJobs.find((j) => j.domain === "fees")?.lastSuccessAt ?? null,
        primaryPage: "财务报表",
      },
      ads: {
        count: state.adsFacts.length,
        lastSuccessAt:
          state.syncJobs.find((j) => j.domain === "ads")?.lastSuccessAt ?? null,
        primaryPage: "Catalog（投产比） / 广告管理",
      },
    };
    res.json({
      data: {
        overall: overallTone(state),
        platform: "NOON",
        noonMode: state.noon.mode,
        noonEnabled: state.noon.enabled,
        cursors: state.cursors,
        inboxPending: state.inbox.filter((e) => e.status === "pending").length,
        inboxFailed: state.inbox.filter((e) => e.status === "failed").length,
        orderCount: state.orders.length,
        domains,
        jobs: state.syncJobs,
        alerts: state.syncAlerts.filter((a) => !a.acknowledged),
        openAlertCount: state.syncAlerts.filter((a) => !a.acknowledged).length,
        lastImportSummary: state.noon.portal?.lastImportSummary ?? null,
      },
    });
  });

  router.get("/jobs", (_req, res) => {
    res.json({ data: getState().syncJobs });
  });

  router.get("/alerts", (_req, res) => {
    res.json({ data: getState().syncAlerts });
  });

  router.post("/alerts/clear", requireAdmin, (_req, res) => {
    const state = getState();
    const cleared = state.syncAlerts.length;
    state.syncAlerts = [];
    saveState(state);
    res.json({ data: { cleared } });
  });

  router.get("/inbox", (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    res.json({ data: listInbox(getState(), limit) });
  });

  router.post("/alerts/:id/ack", (req, res) => {
    const state = getState();
    const alert = state.syncAlerts.find((a) => a.id === req.params.id);
    if (!alert) {
      res.status(404).json({ error: "告警不存在" });
      return;
    }
    alert.acknowledged = true;
    saveState(state);
    res.json({ data: alert });
  });

  router.post("/run/:domain", requireAdmin, async (req, res) => {
    const domain = req.params.domain;
    const state = getState();

    if (domain === "reconcile") {
      const local = state.orders.length;
      const expectedMin = 1;
      if (local < expectedMin && state.noon.enabled) {
        pushAlert(state, {
          level: "danger",
          title: "对账发现缺口",
          detail: `本地订单 ${local}，低于预期，请触发 orders 增量回补`,
        });
        const job = state.syncJobs.find((j) => j.domain === "reconcile");
        if (job) {
          job.status = "failed";
          job.lastError = "订单数量低于预期";
          job.backlog = expectedMin - local;
        }
        saveState(state);
        res.status(409).json({ error: "对账未通过", data: { local, expectedMin } });
        return;
      }
      const job = state.syncJobs.find((j) => j.domain === "reconcile");
      if (job) {
        job.status = "success";
        job.lastSuccessAt = new Date().toISOString();
        job.lastError = null;
        job.backlog = 0;
      }
      saveState(state);
      res.json({ data: job, message: "对账通过" });
      return;
    }

    if (
      domain !== "orders" &&
      domain !== "catalog" &&
      domain !== "stock" &&
      domain !== "sales" &&
      domain !== "fees"
    ) {
      res.status(404).json({ error: "未知同步域" });
      return;
    }

    try {
      await pullDomain(state, domain);
      res.json({
        data: state.syncJobs.find((j) => j.domain === domain),
        message: `已从 NOON(${state.noon.mode}) 增量拉取 ${domain}`,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "同步失败",
      });
    }
  });

  router.post("/process-inbox", requireAdmin, async (_req, res) => {
    const result = await processPendingInbox(getState());
    res.json({ data: result });
  });

  /**
   * 汇总同步：Noon → 影刀广告落盘入库 → 飞书本地域
   * body: { skipNoon?, skipAds?, skipFeishu?, forceIngest?, feishuDocIds? }
   */
  router.post("/assembly-sync", requireAdmin, async (req, res) => {
    if (isAssemblySyncRunning()) {
      res.status(409).json({
        error: "汇总同步正在进行中",
        data: getLastAssemblySync(),
      });
      return;
    }
    const state = getState();
    try {
      const result = await runAssemblySync(state, {
        triggeredBy: "manual",
        skipNoon: Boolean(req.body?.skipNoon),
        skipAds: Boolean(req.body?.skipAds),
        skipFeishu: Boolean(req.body?.skipFeishu),
        skipOpsDaily: Boolean(req.body?.skipOpsDaily),
        forceIngest: Boolean(req.body?.forceIngest),
        feishuDocIds: Array.isArray(req.body?.feishuDocIds)
          ? req.body.feishuDocIds.map(String)
          : undefined,
      });
      res.status(result.ok ? 200 : 207).json({
        data: result,
        message: result.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushAlert(state, {
        level: "danger",
        title: "汇总同步失败",
        detail: message,
      });
      saveState(state);
      res.status(500).json({ error: message });
    }
  });

  router.get("/assembly-sync/last", (_req, res) => {
    res.json({
      data: {
        running: isAssemblySyncRunning(),
        last: getLastAssemblySync(),
      },
    });
  });

  /** 各店数据缺口审计（不打外部接口） */
  router.get("/data-gaps", (_req, res) => {
    const lookbackDays = Number(_req.query.lookbackDays ?? 90);
    const audits = auditAllShopGaps(
      Number.isFinite(lookbackDays) ? lookbackDays : 90,
    );
    res.json({
      data: {
        /** 仅健康门禁店（默认前两家）齐全才算总览成功 */
        complete: healthGateComplete(audits),
        healthGateShopIds: getHealthGateShopIds(),
        shops: audits,
      },
    });
  });

  /**
   * 数据补洞：Noon 按域一次覆盖缺口区间；飞书直拉；缺 ads 触发 Playwright。
   * body: { shopIds?, skipNoon?, skipFeishu?, skipYingdao?|skipAdsRpa?, maxImpexPerShop?, maxImpexTotal? }
   */
  router.post("/data-backfill", requireAdmin, async (req, res) => {
    if (isDataBackfillRunning()) {
      res.status(409).json({
        error: "数据补洞正在进行中",
        data: getLastDataBackfill(),
      });
      return;
    }
    try {
      const result = await runDataBackfill({
        triggeredBy: "manual",
        shopIds: Array.isArray(req.body?.shopIds)
          ? req.body.shopIds.map(String)
          : undefined,
        skipNoon: Boolean(req.body?.skipNoon),
        skipFeishu: Boolean(req.body?.skipFeishu),
        skipYingdao: Boolean(
          req.body?.skipYingdao ?? req.body?.skipAdsRpa,
        ),
        maxImpexPerShop:
          req.body?.maxImpexPerShop != null
            ? Number(req.body.maxImpexPerShop)
            : undefined,
        maxImpexTotal:
          req.body?.maxImpexTotal != null
            ? Number(req.body.maxImpexTotal)
            : undefined,
        lookbackDays:
          req.body?.lookbackDays != null
            ? Number(req.body.lookbackDays)
            : undefined,
      });
      res.status(result.ok ? 200 : 207).json({
        data: result,
        message: result.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get("/data-backfill/last", (_req, res) => {
    res.json({
      data: {
        running: isDataBackfillRunning(),
        last: getLastDataBackfill(),
      },
    });
  });

  router.post("/alerts/demo-fail", requireAdmin, (_req, res) => {
    const state = getState();
    const alert = pushAlert(state, {
      level: "danger",
      title: "对账发现缺口",
      detail: "本地订单比 NOON 少 3 单，已写入回补队列",
    });
    const reconcile = state.syncJobs.find((j) => j.domain === "reconcile");
    if (reconcile) {
      reconcile.status = "failed";
      reconcile.lastError = alert.detail;
      reconcile.backlog = 3;
    }
    saveState(state);
    res.json({ data: alert });
  });

  return router;
}
