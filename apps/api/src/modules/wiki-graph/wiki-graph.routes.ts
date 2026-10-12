import { Router } from "express";
import { z } from "zod";
import { rebuildWikiGraph, wikiGraphStats } from "./build.js";
import { buildContextPack } from "./context-pack.js";
import { lookupByKey } from "./lookup.js";
import {
  OUTPOST_SCHEMA_MAP,
  schemaMapToMarkdown,
} from "./schema-catalog.js";
import {
  buildAgentPreloadCard,
  estimateTokens,
} from "./agent-preload.js";
import type { WikiKeyType } from "./types.js";

const keyTypeSchema = z.enum([
  "boxNo",
  "ticketNo",
  "logisticsNo",
  "partnerSku",
  "forwarder",
  "orderId",
  "trackingNo",
]);

const sourceSchema = z.enum(["schema", "packing", "accounts", "freight"]);

export function createWikiGraphRouter() {
  const router = Router();

  /**
   * Agent 默认入口：压缩预加载卡（焦点字段 + 关联路径）
   * 完整字段清单用 /schema-map
   */
  router.get("/agent-preload", (req, res) => {
    const card = buildAgentPreloadCard();
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
        fullSchema: "/api/wiki-graph/schema-map",
      },
    });
  });

  /** 完整 Schema Map（字段全量 + pitfalls）；细节不够时再读 */
  router.get("/schema-map", (req, res) => {
    const format = String(req.query.format ?? "json");
    if (format === "md" || format === "markdown") {
      res.type("text/markdown").send(schemaMapToMarkdown(OUTPOST_SCHEMA_MAP));
      return;
    }
    res.json({ ok: true, data: OUTPOST_SCHEMA_MAP });
  });

  router.get("/stats", async (_req, res) => {
    try {
      const data = await wikiGraphStats();
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/rebuild", async (req, res) => {
    const body = z
      .object({
        sources: z.array(sourceSchema).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ ok: false, error: body.error.flatten() });
      return;
    }
    const report = await rebuildWikiGraph({ sources: body.data.sources });
    res.status(report.ok ? 200 : 500).json({ ok: report.ok, data: report });
  });

  router.get("/lookup", async (req, res) => {
    const q = z
      .object({
        keyType: keyTypeSchema,
        keyValue: z.string().min(1),
      })
      .safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ ok: false, error: q.error.flatten() });
      return;
    }
    try {
      const hit = await lookupByKey(
        q.data.keyType as WikiKeyType,
        q.data.keyValue,
      );
      if (!hit) {
        res.status(404).json({ ok: false, error: "not_found" });
        return;
      }
      res.json({ ok: true, data: hit });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/context-pack", async (req, res) => {
    const q = z
      .object({
        keyType: keyTypeSchema,
        keyValue: z.string().min(1),
        hops: z.coerce.number().int().min(1).max(3).optional(),
      })
      .safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ ok: false, error: q.error.flatten() });
      return;
    }
    try {
      const pack = await buildContextPack({
        keyType: q.data.keyType as WikiKeyType,
        keyValue: q.data.keyValue,
        hops: q.data.hops,
      });
      if (!pack) {
        res.status(404).json({ ok: false, error: "not_found" });
        return;
      }
      res.json({ ok: true, data: pack });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
