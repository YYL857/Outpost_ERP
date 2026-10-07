import { Router } from "express";
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { assembleFromState } from "./assemble.js";
import { enrichCatalogImages } from "./enrich-images.js";

export function createCatalogRouter(getState: () => AppState) {
  const router = Router();

  router.get("/", (_req, res) => {
    const state = getState();
    const asOf = new Date();
    const rows = state.catalog.map((item) =>
      assembleFromState(item, {
        stock: state.stock,
        salesFacts: state.salesFacts,
        feeSnapshots: state.feeSnapshots,
        skuLocalCosts: state.skuLocalCosts,
        skuDims: state.skuDims,
        replenishConfigs: state.replenishConfigs,
        shipping: state.shipping,
        asOf,
      }),
    );
    const withImage = rows.filter((r) => Boolean(r.imageUrl)).length;
    res.json({
      data: rows,
      meta: {
        source: "NOON",
        assembly: "deterministic",
        count: rows.length,
        withImage,
        asOf: asOf.toISOString(),
      },
    });
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
