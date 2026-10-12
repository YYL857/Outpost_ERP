import { Router } from "express";
import { requireAdmin } from "../../auth/middleware.js";
import { shanghaiDay } from "./day.js";
import { auditRootDir } from "./paths.js";
import { listAuditEvents, readDailySummary } from "./query.js";

/** 操作日志只读：超管可按日追溯 */
export function createAuditRouter() {
  const router = Router();

  router.get("/daily", requireAdmin, (req, res) => {
    const day =
      typeof req.query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day)
        ? req.query.day
        : shanghaiDay();
    res.json({
      data: readDailySummary(day),
      meta: { auditRoot: auditRootDir() },
    });
  });

  router.get("/events", requireAdmin, (req, res) => {
    const day =
      typeof req.query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day)
        ? req.query.day
        : shanghaiDay();
    const module =
      typeof req.query.module === "string" ? req.query.module.trim() : undefined;
    const actor =
      typeof req.query.actor === "string" ? req.query.actor.trim() : undefined;
    const shopId =
      typeof req.query.shopId === "string" ? req.query.shopId.trim() : undefined;
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const offset =
      typeof req.query.offset === "string" ? Number(req.query.offset) : undefined;

    const result = listAuditEvents({
      day,
      module: module || undefined,
      actor: actor || undefined,
      shopId: shopId || undefined,
      limit,
      offset,
    });
    res.json({
      data: result.events,
      meta: {
        day: result.day,
        total: result.total,
        auditRoot: auditRootDir(),
      },
    });
  });

  return router;
}
