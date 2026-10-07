import { Router } from "express";
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";

export function createListingRouter(getState: () => AppState) {
  const router = Router();

  router.get("/quota", (_req, res) => {
    const { listingUsed, listingQuota } = getState().store;
    res.json({
      data: {
        used: listingUsed,
        quota: listingQuota,
        remaining: Math.max(0, listingQuota - listingUsed),
      },
    });
  });

  router.get("/tasks", (_req, res) => {
    res.json({ data: getState().listings });
  });

  router.post("/tasks", (req, res) => {
    const state = getState();
    const partnerSku = String(req.body?.partnerSku ?? "");
    const title = String(req.body?.title ?? partnerSku);
    if (!partnerSku) {
      res.status(400).json({ error: "partnerSku 必填" });
      return;
    }
    if (state.store.listingUsed >= state.store.listingQuota) {
      res.status(409).json({ error: "本月上架额度已用尽" });
      return;
    }

    const task = {
      id: `list-${Date.now()}`,
      partnerSku,
      title,
      status: "queued" as const,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    state.listings.unshift(task);
    state.store.listingUsed += 1;
    saveState(state);

    // 模拟异步上架结果（真实环境改为调 NOON listing API）
    setTimeout(() => {
      const latest = getState();
      const row = latest.listings.find((t) => t.id === task.id);
      if (!row) return;
      row.status = "success";
      row.finishedAt = new Date().toISOString();
      saveState(latest);
    }, 800);

    res.json({ data: task });
  });

  return router;
}
