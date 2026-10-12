import { Router } from "express";
import { isFeishuError } from "../../platforms/feishu/errors.js";
import {
  loadFeishuDocsConfig,
  pullFeishuRaw,
} from "../../platforms/feishu/index.js";
import { INFO_CHECK_DOC_IDS, loadInfoCheckBundle } from "./load-tables.js";
import { queryInfoCheck, serializeTableMeta } from "./query.js";
import type { InfoCheckQueryMode } from "./types.js";

function parseFields(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createInfoCheckRouter() {
  const router = Router();

  router.get("/meta", (_req, res) => {
    try {
      const bundle = loadInfoCheckBundle();
      res.json({ data: serializeTableMeta(bundle) });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/query", (req, res) => {
    try {
      const q = String(req.query.q ?? "");
      const modeRaw = String(req.query.mode ?? "fuzzy").toLowerCase();
      const mode: InfoCheckQueryMode =
        modeRaw === "exact" ? "exact" : "fuzzy";
      const fields = parseFields(req.query.fields);
      const limit = Number(req.query.limit);
      const bundle = loadInfoCheckBundle();
      const result = queryInfoCheck(bundle, {
        q,
        mode,
        fields,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json({
        data: result.rows,
        meta: {
          totalMatched: result.totalMatched,
          truncated: result.truncated,
          mode,
          fields,
          commonFields: bundle.commonFields,
        },
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/refresh", async (_req, res) => {
    try {
      const cfg = loadFeishuDocsConfig();
      const missing = INFO_CHECK_DOC_IDS.filter(
        (id) => !cfg.docs.some((d) => d.id === id && d.enabled !== false),
      );
      if (missing.length) {
        res.status(400).json({
          error: `feishu.docs.json 缺少或未启用: ${missing.join(", ")}`,
          hint: "参考 apps/api/config/feishu.docs.example.json 增加 monthly-deals / info-check",
        });
        return;
      }
      const manifest = await pullFeishuRaw(cfg, {
        docIds: [...INFO_CHECK_DOC_IDS],
      });
      const bundle = loadInfoCheckBundle();
      res.json({
        data: {
          runId: manifest.runId,
          results: manifest.results,
          tables: serializeTableMeta(bundle),
        },
      });
    } catch (e) {
      if (isFeishuError(e)) {
        res.status(400).json({ error: e.message, code: e.code, hint: e.hint });
        return;
      }
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
