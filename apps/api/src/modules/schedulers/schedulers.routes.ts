import { Router } from "express";
import type { AppState } from "../../common/types.js";
import { requireAdmin } from "../../auth/middleware.js";
import {
  getScheduler,
  isSchedulerId,
  listSchedulers,
  runScheduler,
  startScheduler,
  stopScheduler,
} from "./registry.js";

export function createSchedulersRouter(getState: () => AppState) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ data: listSchedulers() });
  });

  router.get("/:id", (req, res) => {
    const id = String(req.params.id ?? "");
    if (!isSchedulerId(id)) {
      res.status(404).json({ error: `unknown scheduler: ${id}` });
      return;
    }
    res.json({ data: getScheduler(id) });
  });

  router.post("/:id/start", requireAdmin, (req, res) => {
    const id = String(req.params.id ?? "");
    if (!isSchedulerId(id)) {
      res.status(404).json({ error: `unknown scheduler: ${id}` });
      return;
    }
    res.json({ data: startScheduler(id, getState) });
  });

  router.post("/:id/stop", requireAdmin, (req, res) => {
    const id = String(req.params.id ?? "");
    if (!isSchedulerId(id)) {
      res.status(404).json({ error: `unknown scheduler: ${id}` });
      return;
    }
    res.json({ data: stopScheduler(id, getState) });
  });

  router.post("/:id/run", requireAdmin, async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!isSchedulerId(id)) {
      res.status(404).json({ error: `unknown scheduler: ${id}` });
      return;
    }
    try {
      const result = await runScheduler(id, getState);
      res.json({ data: getScheduler(id), result });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
        data: getScheduler(id),
      });
    }
  });

  return router;
}
