import { Router } from "express";
import type { AppState, SyncJobStatus } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { listInbox } from "./inbox.js";
import { processPendingInbox, pullDomain } from "./pipeline.js";
import { pushAlert } from "./alerts.js";

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

  router.post("/run/:domain", async (req, res) => {
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

    if (domain !== "orders" && domain !== "catalog" && domain !== "stock") {
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

  router.post("/process-inbox", async (_req, res) => {
    const result = await processPendingInbox(getState());
    res.json({ data: result });
  });

  router.post("/alerts/demo-fail", (_req, res) => {
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
