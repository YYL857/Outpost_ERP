/**
 * 用 Offer API 的 My Catalog 售价覆盖 state.catalog.price。
 * Pricing API 只是底价；Promo/Sale 时页面价不同。不走 Impex。
 */
import type { AppState } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { batchGetLivePrices, nextLivePrice } from "../../platforms/noon/pricing.js";

let refreshChain: Promise<unknown> = Promise.resolve();

export async function refreshCatalogLivePrices(state: AppState): Promise<{
  updated: number;
  checked: number;
}> {
  const run = refreshChain.then(() => refreshCatalogLivePricesUnlocked(state));
  refreshChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function refreshCatalogLivePricesUnlocked(state: AppState): Promise<{
  updated: number;
  checked: number;
}> {
  if (state.noon.mode !== "live" || !state.noon.enabled) {
    return { updated: 0, checked: 0 };
  }
  const skus = [
    ...new Set(state.catalog.map((c) => c.partnerSku.trim()).filter(Boolean)),
  ];
  if (skus.length === 0) return { updated: 0, checked: 0 };

  const prices = await batchGetLivePrices(state.noon, skus, state.noon.countryCode);
  const now = new Date().toISOString();
  let updated = 0;
  for (const item of state.catalog) {
    const price = nextLivePrice(item.price, prices.get(item.partnerSku));
    if (price == null) continue;
    item.price = price;
    item.updatedAt = now;
    updated += 1;
  }
  if (updated > 0) saveState(state);
  return { updated, checked: skus.length };
}
