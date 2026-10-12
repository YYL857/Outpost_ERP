import { Router } from "express";
import type { AuthedRequest } from "../../auth/middleware.js";
import {
  capabilityForOpsSurface,
  hasCapability,
  requireCapability,
} from "../../auth/permissions.js";
import type { AppState } from "../../common/types.js";
import { parseBomRequest, type BomQuote } from "./bom.js";
import { runDocsAssist, type DocsKind } from "./docs.js";
import { explainBomQuote } from "./explain-bom.js";
import { interpretSurface, type OpsSurface } from "./interpret.js";

function isQuote(value: BomQuote | { error: string }): value is BomQuote {
  return !("error" in value);
}

export function createOpsAssistRouter(getState: () => AppState) {
  const router = Router();

  router.post("/interpret", async (req, res) => {
    const surface = String(req.body?.surface || "") as OpsSurface;
    if (surface !== "sales" && surface !== "replenish" && surface !== "finance") {
      res.status(400).json({ error: "surface 必须是 sales、replenish 或 finance" });
      return;
    }
    const cap = capabilityForOpsSurface(surface);
    const user = (req as AuthedRequest).user;
    if (!cap || !hasCapability(user?.role, cap)) {
      res.status(403).json({
        error: `解读 ${surface} 需要权限：${cap ?? "unknown"}`,
        code: "FORBIDDEN",
        capability: cap,
      });
      return;
    }
    try {
      const data = await interpretSurface(getState(), surface);
      res.json({ data });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "解读失败",
      });
    }
  });

  router.post("/docs", async (req, res) => {
    const kind = String(req.body?.kind || "") as DocsKind;
    const text = String(req.body?.text ?? "");
    try {
      const data = await runDocsAssist({ kind, text });
      if ("error" in data) {
        res.status(400).json({ error: data.error });
        return;
      }
      res.json({ data });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "文档整理失败",
      });
    }
  });

  router.post("/bom", requireCapability("bom.read"), (req, res) => {
    const quote = parseBomRequest(req.body);
    if (!isQuote(quote)) {
      res.status(400).json({ error: quote.error });
      return;
    }
    res.json({ data: quote });
  });

  router.post(
    "/bom/explain",
    requireCapability("bom.read"),
    async (req, res) => {
    const quote = parseBomRequest(req.body);
    if (!isQuote(quote)) {
      res.status(400).json({ error: quote.error });
      return;
    }
    try {
      const explanation = await explainBomQuote(quote);
      res.json({ data: { ...quote, explanation } });
      return;
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "定价说明失败",
      });
    }
  });

  return router;
}
