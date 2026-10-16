import { Router } from "express";
import { OUTPOST_SYSTEM_CATALOG } from "./catalog.js";
import { persistSystemMap } from "./persist.js";
import {
  buildSystemMapMarkdown,
  buildSystemPreload,
  estimateTokens,
} from "./render.js";

export function createSystemMapRouter() {
  const router = Router();

  /** L0：默认先读 */
  router.get("/agent-preload", (req, res) => {
    const card = buildSystemPreload();
    const format = String(req.query.format ?? "json");
    if (format === "md" || format === "markdown") {
      res.type("text/markdown").send(card.markdown);
      return;
    }
    res.json({
      ok: true,
      data: card,
      meta: {
        charCount: card.charCount,
        approxTokens: estimateTokens(card.charCount),
        fullMap: "/api/system-map",
      },
    });
  });

  /** L1：全挂载 / UI / RPA / 易错点 */
  router.get("/", (req, res) => {
    const format = String(req.query.format ?? "json");
    const markdown = buildSystemMapMarkdown();
    if (format === "md" || format === "markdown") {
      res.type("text/markdown").send(markdown);
      return;
    }
    res.json({
      ok: true,
      data: OUTPOST_SYSTEM_CATALOG,
      markdown,
    });
  });

  router.post("/persist", (_req, res) => {
    try {
      const written = persistSystemMap();
      res.json({ ok: true, data: written });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
