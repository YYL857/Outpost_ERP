/**
 * 一次性：用 portalCache.stock 原子救回 HFY state.stock（修复清空+duplicate 空仓后）。
 *   npx tsx scripts/_recover-hfy-stock-from-portal-cache.mts
 */
import { applyStockLedgerSnapshot } from "../src/modules/sync/live-impex-domains.js";
import { clearCatalogAssembleCache } from "../src/modules/catalog/query.js";
import {
  getShopState,
  runAsShop,
  saveShopState,
} from "../src/shops/state-cache.js";
import type { NoonStockDto } from "../src/platforms/noon/types.js";

const SHOP = "PRJ482387";

runAsShop(SHOP, () => {
  const state = getShopState(SHOP);
  const cached = state.portalCache?.stock ?? [];
  console.log("before stock=", state.stock.length, "portalCache.stock=", cached.length);
  if (!cached.length) {
    throw new Error("portalCache.stock 为空，无法救回");
  }
  const rows: NoonStockDto[] = cached.map((r) => ({
    partner_sku: r.partner_sku,
    warehouse_code: r.warehouse_code,
    qty: Number(r.qty) || 0,
    fulfillment: r.fulfillment ?? "unknown",
    in_transit_qty: Number(r.in_transit_qty ?? 0) || 0,
    updated_at: r.updated_at || new Date().toISOString(),
  }));
  const n = applyStockLedgerSnapshot(state, rows);
  state.cursors.stockSince = new Date().toISOString();
  const job = state.syncJobs.find((j) => j.domain === "stock");
  if (job) {
    job.status = "success";
    job.lastSuccessAt = state.cursors.stockSince;
    job.lastError = null;
  }
  clearCatalogAssembleCache();
  saveShopState(SHOP, state);
  const fbn = state.stock
    .filter((s) => s.fulfillment === "fbn")
    .reduce((a, s) => a + s.qty, 0);
  console.log("after stock=", state.stock.length, "applied=", n, "fbnQtySum=", fbn);
});
