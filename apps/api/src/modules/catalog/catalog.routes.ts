import { Router } from "express";
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { assembleFromState } from "./assemble.js";
import { enrichCatalogImages } from "./enrich-images.js";
import {
  catalogAssemblyMeta,
  listCatalogItemsForAssembly,
} from "./list-items.js";
import { buildCatalogProvenance } from "./provenance.js";
import {
  formatIngestError,
  ingestFeishuLocalIntoState,
} from "../../platforms/feishu/ingest/local.js";
import { isFeishuError } from "../../platforms/feishu/errors.js";

export function createCatalogRouter(getState: () => AppState) {
  const router = Router();

  router.get("/", (_req, res) => {
    const state = getState();
    const asOf = new Date();
    const items = listCatalogItemsForAssembly(state);
    const rows = items.map((item) =>
      assembleFromState(item, {
        stock: state.stock,
        salesFacts: state.salesFacts,
        adsFacts: state.adsFacts,
        feeSnapshots: state.feeSnapshots,
        feeEstimates: state.feeEstimates ?? [],
        skuLocalCosts: state.skuLocalCosts,
        skuDims: state.skuDims,
        replenishConfigs: state.replenishConfigs,
        shipping: state.shipping,
        asOf,
      }),
    );
    const withImage = rows.filter((r) => Boolean(r.imageUrl)).length;
    const localMatched = rows.filter((r) => r.local.align === "matched").length;
    const localPartial = rows.filter((r) => r.local.align === "partial").length;
    const localMissing = rows.filter((r) => r.local.align === "missing").length;
    const withAds = rows.filter(
      (r) => r.ads.d7.hasData || r.ads.latest.hasData,
    ).length;
    const provenance = buildCatalogProvenance(state);
    const orphanMeta = catalogAssemblyMeta(state, rows.length);
    res.json({
      data: rows,
      meta: {
        source: "NOON",
        assembly: "deterministic",
        joinKey: "partnerSku",
        count: rows.length,
        withImage,
        withAds,
        asOf: asOf.toISOString(),
        localAlign: {
          matched: localMatched,
          partial: localPartial,
          missing: localMissing,
          costRows: state.skuLocalCosts.length,
          dimsRows: state.skuDims.length,
        },
        ...orphanMeta,
        provenance,
      },
    });
  });

  /**
   * 将最近一次飞书 M3 规范化 CSV 按 partnerSku 入库（本地域）。
   * 不覆盖 Noon catalog/stock/sales/fees/ads。
   */
  router.post("/ingest-feishu-local", (req, res) => {
    try {
      const state = getState();
      const dryRun = req.body?.dryRun === true;
      const report = ingestFeishuLocalIntoState(state, { dryRun });
      if (!dryRun) saveState(state);
      res.json({
        data: report,
        message: dryRun
          ? "dryRun：未写库"
          : `已按 partnerSku 入库成本 ${report.cost.upserted} / 尺寸 ${report.dims.upserted}`,
      });
    } catch (e) {
      const status = isFeishuError(e) ? 400 : 500;
      res.status(status).json({ error: formatIngestError(e) });
    }
  });

  /** Catalog 导出无图：用 Content GetContent 按 sku_parent 补主图 */
  router.post("/enrich-images", async (req, res) => {
    try {
      const limit = Number(req.body?.limit ?? 500);
      const result = await enrichCatalogImages(getState(), {
        limit: Number.isFinite(limit) ? limit : 500,
        onlyMissing: req.body?.onlyMissing !== false,
      });
      res.json({ data: result, message: result.message });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.get("/stock", (_req, res) => {
    res.json({ data: getState().stock });
  });

  router.post("/favorites", (req, res) => {
    const state = getState();
    const partnerSku = String(req.body?.partnerSku ?? "");
    if (!partnerSku) {
      res.status(400).json({ error: "partnerSku 必填" });
      return;
    }
    if (state.favorites.some((f) => f.partnerSku === partnerSku)) {
      res.status(409).json({ error: "已在收藏列表" });
      return;
    }
    const row = {
      id: `fav-${Date.now()}`,
      partnerSku,
      note: String(req.body?.note ?? ""),
      createdAt: new Date().toISOString(),
    };
    state.favorites.unshift(row);
    saveState(state);
    res.json({ data: row });
  });

  router.get("/favorites", (_req, res) => {
    res.json({ data: getState().favorites });
  });

  return router;
}
