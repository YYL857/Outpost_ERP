import { Router } from "express";
import { z } from "zod";
import { isFeishuError } from "../../platforms/feishu/errors.js";
import {
  loadAsnCapture,
  patchAsnCapture,
  toBookingCapture,
} from "./asn-captures.js";
import { loadHolidayDates } from "./holidays.js";
import { formatNotifyDraft, normalizeScheduleSlot } from "./notify.js";
import {
  syncBookingCaptureToPackingSheet,
  type PackingSheetSyncResult,
} from "./packing-sheet-write.js";
import { findShopPreset, loadShopPresets } from "./pack-ticket.js";
import {
  applyCapture,
  createSession,
  findSessionByAsn,
  getActiveSession,
  listRecentSessions,
  loadSession,
  patchSession,
  setActiveSessionId,
  updateSessionCapture,
} from "./store.js";

function ok(res: import("express").Response, data: unknown) {
  res.json({ ok: true, data });
}

function fail(
  res: import("express").Response,
  status: number,
  error: string,
) {
  res.status(status).json({ ok: false, error });
}

export function createWarehouseBookingRouter(): Router {
  const router = Router();

  router.get("/holidays", (_req, res) => {
    ok(res, { dates: loadHolidayDates() });
  });

  /** 四店预设 + 按 projectCode / 前缀解析 */
  router.get("/shop-presets", (_req, res) => {
    ok(res, { shops: loadShopPresets() });
  });

  router.get("/resolve-shop", (req, res) => {
    const projectCode = String(req.query.projectCode || "").trim();
    const prefix = String(req.query.prefix || "").trim();
    const shop = findShopPreset({ projectCode, prefix });
    ok(res, { shop });
  });

  /** 按 ASN 查已记住的约仓结果（关侧栏后仍可找回） */
  router.get("/captures/:asnId", (req, res) => {
    const stored = loadAsnCapture(String(req.params.asnId));
    if (!stored) {
      fail(res, 404, `未找到 ASN=${req.params.asnId} 的约仓记忆`);
      return;
    }
    const session = findSessionByAsn(stored.asnId);
    ok(res, {
      capture: toBookingCapture(stored),
      stored,
      session: session || null,
    });
  });

  /** 手动改 ASN 记忆（不依赖会话）；有会话时也可一并挂上 */
  router.put("/captures/:asnId", (req, res) => {
    const parsed = z
      .object({
        warehouse: z.string().optional(),
        scheduledDate: z.string().optional(),
        scheduleSlot: z.string().optional(),
        region: z.string().nullable().optional(),
        sessionId: z.string().nullable().optional(),
        attachToSession: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, 400, "参数无效");
      return;
    }
    try {
      const slot =
        parsed.data.scheduleSlot !== undefined
          ? normalizeScheduleSlot(parsed.data.scheduleSlot)
          : undefined;
      const stored = patchAsnCapture(String(req.params.asnId), {
        ...parsed.data,
        scheduleSlot: slot,
        source: "manual",
      });
      let session = parsed.data.sessionId
        ? loadSession(parsed.data.sessionId)
        : null;
      if (!session && parsed.data.attachToSession !== false) {
        session = findSessionByAsn(stored.asnId) || getActiveSession();
      }
      if (session) {
        session = updateSessionCapture(session.id, {
          asnId: stored.asnId,
          warehouse: stored.warehouse,
          scheduledDate: stored.scheduledDate,
          scheduleSlot: stored.scheduleSlot,
        });
        ok(res, {
          capture: session.capture,
          stored,
          session,
          notifyDraft: formatNotifyDraft(session),
        });
        return;
      }
      ok(res, {
        capture: toBookingCapture(stored),
        stored,
        session: null,
        notifyDraft: null,
      });
    } catch (e) {
      fail(res, 400, e instanceof Error ? e.message : String(e));
    }
  });

  router.get("/sessions/active", (_req, res) => {
    const session = getActiveSession();
    ok(res, { session });
  });

  router.get("/sessions", (_req, res) => {
    ok(res, { sessions: listRecentSessions(30) });
  });

  router.get("/sessions/:id", (req, res) => {
    const session = loadSession(String(req.params.id));
    if (!session) {
      fail(res, 404, "会话不存在");
      return;
    }
    ok(res, { session });
  });

  router.post("/sessions", (req, res) => {
    const parsed = z
      .object({ ticketPrefix: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, "需要 ticketPrefix");
      return;
    }
    try {
      const session = createSession(parsed.data.ticketPrefix);
      ok(res, { session });
    } catch (e) {
      fail(res, 400, e instanceof Error ? e.message : String(e));
    }
  });

  router.patch("/sessions/:id", (req, res) => {
    const parsed = z
      .object({
        activeShopPrefix: z.string().nullable().optional(),
        notes: z.string().optional(),
        step: z
          .enum(["ticket", "align", "asn", "schedule", "notify", "done"])
          .optional(),
        shopAsn: z
          .object({
            shopPrefix: z.string(),
            asnId: z.string(),
          })
          .optional(),
        shopPacked: z
          .object({
            shopPrefix: z.string(),
            confirmed: z.boolean(),
          })
          .optional(),
        setActive: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, "参数无效");
      return;
    }
    try {
      const session = patchSession(String(req.params.id), parsed.data);
      if (parsed.data.setActive !== false) setActiveSessionId(session.id);
      ok(res, { session });
    } catch (e) {
      fail(res, 400, e instanceof Error ? e.message : String(e));
    }
  });

  /** 用户核对后改会话内约仓结果（同步写入 ASN 记忆） */
  router.put("/sessions/:id/capture", (req, res) => {
    const parsed = z
      .object({
        asnId: z.string().optional(),
        warehouse: z.string().optional(),
        scheduledDate: z.string().optional(),
        scheduleSlot: z.string().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, 400, "参数无效");
      return;
    }
    try {
      const session = updateSessionCapture(String(req.params.id), {
        ...parsed.data,
        scheduleSlot:
          parsed.data.scheduleSlot !== undefined
            ? normalizeScheduleSlot(parsed.data.scheduleSlot)
            : undefined,
      });
      ok(res, {
        session,
        capture: session.capture,
        notifyDraft: formatNotifyDraft(session),
      });
    } catch (e) {
      fail(res, 400, e instanceof Error ? e.message : String(e));
    }
  });

  router.post("/capture", async (req, res) => {
    const parsed = z
      .object({
        sessionId: z.string().nullable().optional(),
        asnId: z.string().min(1),
        warehouse: z.string().optional(),
        scheduledDate: z.string().min(1),
        scheduleSlot: z.string().min(1),
        region: z.string().nullable().optional(),
        pageUrl: z.string().nullable().optional(),
        source: z.enum(["extension", "manual"]).optional(),
        flags: z.array(z.string()).optional(),
        /** 默认不自动写装箱表：先按 ASN 记住，用户核对可改后再点回填 */
        syncPackingSheet: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, "需要 asnId / scheduledDate / scheduleSlot");
      return;
    }
    try {
      const result = applyCapture({
        ...parsed.data,
        scheduleSlot: normalizeScheduleSlot(parsed.data.scheduleSlot),
      });
      const draft = result.session
        ? formatNotifyDraft(result.session)
        : null;
      let packingSync: PackingSheetSyncResult | { error: string } | null = null;
      if (parsed.data.syncPackingSheet === true && result.session) {
        try {
          packingSync = await syncBookingCaptureToPackingSheet(result.session);
        } catch (e) {
          packingSync = {
            error: isFeishuError(e)
              ? `${e.message}${e.hint ? `（${e.hint}）` : ""}`
              : e instanceof Error
                ? e.message
                : String(e),
          };
        }
      }
      ok(res, {
        session: result.session,
        capture: result.capture,
        stored: result.stored,
        savedWithoutSession: result.savedWithoutSession,
        notifyDraft: draft,
        packingSync,
      });
    } catch (e) {
      fail(res, 400, e instanceof Error ? e.message : String(e));
    }
  });

  router.get("/sessions/:id/notify-draft", (req, res) => {
    const session = loadSession(String(req.params.id));
    if (!session) {
      fail(res, 404, "会话不存在");
      return;
    }
    ok(res, { draft: formatNotifyDraft(session), session });
  });

  /** 手动/重试：把当前店约仓结果回填装箱表 */
  router.post("/sessions/:id/sync-packing-sheet", async (req, res) => {
    const parsed = z
      .object({
        shopPrefix: z.string().optional(),
        dryRun: z.boolean().optional(),
        refreshSnapshot: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, 400, "参数无效");
      return;
    }
    const session = loadSession(String(req.params.id));
    if (!session) {
      fail(res, 404, "会话不存在");
      return;
    }
    try {
      const packingSync = await syncBookingCaptureToPackingSheet(session, {
        shopPrefix: parsed.data.shopPrefix,
        dryRun: parsed.data.dryRun,
        refreshSnapshot: parsed.data.refreshSnapshot,
      });
      ok(res, { session, packingSync });
    } catch (e) {
      const msg = isFeishuError(e)
        ? `${e.message}${e.hint ? `（${e.hint}）` : ""}`
        : e instanceof Error
          ? e.message
          : String(e);
      fail(res, 400, msg);
    }
  });

  return router;
}
