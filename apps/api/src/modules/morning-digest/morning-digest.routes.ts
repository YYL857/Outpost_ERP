/**
 * 晨报 HTTP：状态 / 手动跑 / 预览门禁
 */
import { Router } from "express";
import type { AppState } from "../../common/types.js";
import { loadMorningDigestConfig } from "./config.js";
import { loadLastRun } from "./persist.js";
import { checkMiReadiness, checkStoreReadiness } from "./readiness.js";
import { runMiMorningDigest } from "./run-mi.js";
import { runStoreMorningDigest } from "./run-store.js";
import {
  getMorningDigestSchedulerStatus,
  setMiDigestEnabled,
  setStoreDigestEnabled,
} from "./scheduler.js";

export function createMorningDigestRouter(getState: () => AppState) {
  const router = Router();

  router.get("/status", (_req, res) => {
    const cfg = loadMorningDigestConfig();
    res.json({
      data: {
        config: {
          storeAt: cfg.storeAtLabel,
          miAt: cfg.miAtLabel,
          gateRetryMax: cfg.gateRetryMax,
          gateRetryMs: cfg.gateRetryMs,
          miNotifyEmpty: cfg.miNotifyEmpty,
        },
        scheduler: getMorningDigestSchedulerStatus(),
        lastStore: loadLastRun("store"),
        lastMi: loadLastRun("market-intel"),
      },
    });
  });

  router.get("/readiness", (_req, res) => {
    res.json({
      data: {
        store: checkStoreReadiness(getState()),
        mi: checkMiReadiness(),
      },
    });
  });

  router.post("/store/run", async (req, res) => {
    try {
      const force = Boolean(req.body?.force);
      const skipAssembly = Boolean(req.body?.skipAssembly);
      const recipientIds = Array.isArray(req.body?.recipientIds)
        ? req.body.recipientIds.map(String)
        : undefined;
      const chatId =
        typeof req.body?.chatId === "string" ? req.body.chatId : undefined;
      const result = await runStoreMorningDigest(getState, {
        triggeredBy: "manual",
        force,
        skipAssembly,
        recipientIds,
        chatId,
      });
      res.status(result.ok ? 200 : 400).json({ data: result, message: result.message });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/mi/run", async (req, res) => {
    try {
      const force = Boolean(req.body?.force);
      const recipientIds = Array.isArray(req.body?.recipientIds)
        ? req.body.recipientIds.map(String)
        : undefined;
      const chatId =
        typeof req.body?.chatId === "string" ? req.body.chatId : undefined;
      const result = await runMiMorningDigest({
        triggeredBy: "manual",
        force,
        recipientIds,
        chatId,
      });
      res.status(result.ok ? 200 : 400).json({ data: result, message: result.message });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/store/enabled", (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    setStoreDigestEnabled(enabled);
    res.json({ data: getMorningDigestSchedulerStatus() });
  });

  router.post("/mi/enabled", (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    setMiDigestEnabled(enabled);
    res.json({ data: getMorningDigestSchedulerStatus() });
  });

  return router;
}
