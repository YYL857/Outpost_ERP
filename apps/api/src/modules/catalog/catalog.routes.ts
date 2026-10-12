import { Router } from "express";
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { enrichCatalogImages } from "./enrich-images.js";
import {
  clearCatalogAssembleCache,
  parseCatalogListQuery,
  queryCatalogList,
} from "./query.js";
import { redactCatalogRowsForRole } from "./redact.js";
import {
  formatIngestError,
  ingestFeishuLocalIntoState,
} from "../../platforms/feishu/ingest/local.js";
import { isFeishuError } from "../../platforms/feishu/errors.js";
import {
  hasCapability,
  loadUserFavorites,
  requireCapability,
  requireContextUser,
  saveUserFavorites,
} from "../../auth/index.js";
import { requireAdmin, type AuthedRequest } from "../../auth/middleware.js";

export function createCatalogRouter(getState: () => AppState) {
  const router = Router();

  /**
   * Catalog 列表。默认分页（page/pageSize）；Agent 等全量场景传 all=1。
   * 筛选：q / onlyFbn / onlyAds / onlyMissingLocal
   * all=1 需 catalog.bulk；成本字段需 catalog.cost，否则脱敏。
   */
  router.get("/", (req, res) => {
    const user = (req as AuthedRequest).user;
    const query = parseCatalogListQuery(
      req.query as Record<string, unknown>,
    );
    if (query.all && !hasCapability(user?.role, "catalog.bulk")) {
      res.status(403).json({
        error: "全量 Catalog（all=1）需要更高权限",
        code: "FORBIDDEN",
        capability: "catalog.bulk",
      });
      return;
    }
    const result = queryCatalogList(getState(), query);
    const canSeeCost = hasCapability(user?.role, "catalog.cost");
    res.json({
      ...result,
      data: redactCatalogRowsForRole(result.data, canSeeCost),
      meta: {
        ...result.meta,
        costVisible: canSeeCost,
      },
    });
  });

  /**
   * 将最近一次飞书 M3 规范化 CSV 按 partnerSku 入库（本地域）。
   * 不覆盖 Noon catalog/stock/sales/fees/ads。
   */
  router.post(
    "/ingest-feishu-local",
    requireAdmin,
    (req, res) => {
    try {
      const state = getState();
      const dryRun = req.body?.dryRun === true;
      const report = ingestFeishuLocalIntoState(state, { dryRun });
      if (!dryRun) {
        saveState(state);
        clearCatalogAssembleCache();
      }
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
  router.post(
    "/enrich-images",
    requireAdmin,
    async (req, res) => {
    try {
      const limit = Number(req.body?.limit ?? 500);
      const result = await enrichCatalogImages(getState(), {
        limit: Number.isFinite(limit) ? limit : 500,
        onlyMissing: req.body?.onlyMissing !== false,
      });
      clearCatalogAssembleCache();
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
    const user = requireContextUser();
    const favorites = loadUserFavorites(user.id);
    const partnerSku = String(req.body?.partnerSku ?? "");
    if (!partnerSku) {
      res.status(400).json({ error: "partnerSku 必填" });
      return;
    }
    if (favorites.some((f) => f.partnerSku === partnerSku)) {
      res.status(409).json({ error: "已在收藏列表" });
      return;
    }
    const row = {
      id: `fav-${Date.now()}`,
      partnerSku,
      note: String(req.body?.note ?? ""),
      createdAt: new Date().toISOString(),
    };
    favorites.unshift(row);
    saveUserFavorites(user.id, favorites);
    res.json({ data: row });
  });

  router.get("/favorites", (_req, res) => {
    const user = requireContextUser();
    res.json({ data: loadUserFavorites(user.id) });
  });

  return router;
}
