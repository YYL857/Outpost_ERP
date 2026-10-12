import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Router } from "express";
import { PANEL_COLUMNS, MARGIN_EQUIV, PANEL_HEADER } from "./columns.js";
import {
  loadFbnFeeTiers,
  loadOpsDailySettings,
  loadWarehouseMap,
} from "./config.js";
import { buildPhase1Panel, panelRowsToCsv } from "./build-panel.js";
import { WEEKLY_FEE_HEADER } from "./fees.js";
import { LANDED_COST_HEADER } from "./landed.js";
import { runOpsDailyForShop, runOpsDailyAllShops } from "./run.js";
import {
  listOpsDailyArtifacts,
  resolveArtifactPath,
} from "./status.js";
import { getActiveShop, loadRegistry } from "../../shops/registry.js";
import { getShopState } from "../../shops/state-cache.js";
import { shanghaiYmd } from "./dates.js";

function findShop(shopId: string) {
  return loadRegistry().shops.find((s) => s.id === shopId) ?? null;
}

export function createOpsDailyRouter(): Router {
  const router = Router();

  router.get("/columns", (_req, res) => {
    res.json({
      header: PANEL_HEADER,
      columns: PANEL_COLUMNS,
      marginEquiv: MARGIN_EQUIV,
      phase4: {
        weeklyHeader: WEEKLY_FEE_HEADER,
        landedHeader: LANDED_COST_HEADER,
        files: [
          "landed_产品表每周信息.csv",
          "landed_到仓成本.csv",
        ],
        feishuProductWriteback:
          loadOpsDailySettings().feishu_product_writeback ?? false,
      },
      settings: loadOpsDailySettings(),
      warehouseMap: loadWarehouseMap(),
      fbnFeeTiers: loadFbnFeeTiers(),
    });
  });

  /** 产物目录与配置摘要（前端首页） */
  router.get("/status", (req, res) => {
    const shopId =
      String(req.query.shopId ?? "").trim() || getActiveShop().id;
    const shop = findShop(shopId);
    if (!shop) {
      res.status(404).json({ ok: false, error: `unknown shop ${shopId}` });
      return;
    }
    const settings = loadOpsDailySettings();
    const listed = listOpsDailyArtifacts(shop.rootDir);
    res.json({
      ok: true,
      shopId,
      todayShanghai: shanghaiYmd(),
      settings: {
        phase: settings.phase,
        timezone: settings.timezone,
        ads_coverage: settings.ads_coverage,
        feishu_product_writeback: settings.feishu_product_writeback ?? false,
        output_file_prefix: settings.output_file_prefix,
      },
      dir: listed.dir,
      artifacts: listed.artifacts.map((a) => ({
        name: a.name,
        kind: a.kind,
        sizeBytes: a.sizeBytes,
        mtimeIso: a.mtimeIso,
      })),
    });
  });

  /** 下载已写出的 CSV（panel / weekly / landed） */
  router.get("/download", (req, res) => {
    const shopId =
      String(req.query.shopId ?? "").trim() || getActiveShop().id;
    const shop = findShop(shopId);
    if (!shop) {
      res.status(404).json({ ok: false, error: `unknown shop ${shopId}` });
      return;
    }
    const kindRaw = String(req.query.kind ?? "panel").trim().toLowerCase();
    const kind =
      kindRaw === "weekly" || kindRaw === "landed" ? kindRaw : "panel";
    const asOf = String(req.query.asOf ?? "").trim() || null;
    const path = resolveArtifactPath(shop.rootDir, kind, asOf);
    if (!path || !existsSync(path)) {
      res.status(404).json({
        ok: false,
        error: `未找到 ${kind} 产物，请先「生成运营面板」`,
      });
      return;
    }
    const name = basename(path);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(name)}"`,
    );
    res.send(readFileSync(path));
  });

  /** Phase1 面板：CSV 或 JSON */
  router.get("/panel", (req, res) => {
    const shopId =
      String(req.query.shopId ?? "").trim() || getActiveShop().id;
    const shop = findShop(shopId);
    if (!shop) {
      res.status(404).json({ ok: false, error: `unknown shop ${shopId}` });
      return;
    }
    const asOf = String(req.query.asOf ?? "").trim() || null;
    const format = String(req.query.format ?? "json").toLowerCase();
    const limitRaw = Number(req.query.limit);
    const state = getShopState(shopId);
    const built = buildPhase1Panel(state, shop.rootDir, asOf);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ops_panel_${shopId}_${built.asOf}.csv"`,
      );
      res.send(panelRowsToCsv(built.rows));
      return;
    }
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 500)
        : null;
    const rows = limit ? built.rows.slice(0, limit) : built.rows;
    res.json({
      ok: true,
      shopId,
      phase: built.phase,
      asOf: built.asOf,
      meta: built.meta,
      header: PANEL_HEADER,
      rowCount: built.rows.length,
      previewLimit: limit,
      rows,
    });
  });

  /** 写出到 shops/{id}/ops_daily/ */
  router.post("/run", (req, res) => {
    const body = (req.body ?? {}) as {
      shopId?: string;
      all?: boolean;
      asOf?: string;
    };
    const asOf = body.asOf?.trim() || null;
    if (body.all) {
      const results = runOpsDailyAllShops({ asOf });
      res.json({
        ok: results.every((r) => r.ok),
        results,
      });
      return;
    }
    const shopId = body.shopId?.trim() || getActiveShop().id;
    const result = runOpsDailyForShop(shopId, { asOf });
    res.status(result.ok ? 200 : 400).json(result);
  });

  return router;
}
