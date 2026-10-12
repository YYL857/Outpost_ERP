/**
 * 店内晨报：从 Catalog 拼装压缩载荷给模型（只读）。
 */
import type { AppState } from "../../common/types.js";
import { assembleFromState } from "../catalog/assemble.js";
import { listCatalogItemsForAssembly } from "../catalog/list-items.js";
import { buildCatalogLookup } from "../catalog/lookup.js";
import { getActiveShop } from "../../shops/registry.js";
import type { StoreReadiness } from "./readiness.js";

export type StoreDigestSkuRow = {
  partnerSku: string;
  title: string;
  price: number;
  stockTotal: number;
  sales7u: number;
  sales7Amt: number;
  adsSpend: number;
  adsRoas: number | null;
  adsNet7d: number | null;
  replenish: string;
  availableDays: number | null;
  margin: number | null;
};

export type StoreDigestPayload = {
  kind: "store";
  shopId: string;
  shopName: string;
  asOf: string;
  today: string;
  softNotes: string[];
  ads: StoreReadiness["ads"];
  overview: {
    skuCount: number;
    sales7Units: number;
    sales7Amount: number;
    adsSpend: number;
    urgentCount: number;
    negativeAdsNetCount: number;
  };
  topSales: StoreDigestSkuRow[];
  urgentReplenish: StoreDigestSkuRow[];
  adsWatch: StoreDigestSkuRow[];
};

function rowFromAssembled(
  r: ReturnType<typeof assembleFromState>,
): StoreDigestSkuRow {
  return {
    partnerSku: r.partnerSku,
    title: (r.title || r.partnerSku).slice(0, 80),
    price: r.price,
    stockTotal: r.inventory.total,
    sales7u: r.sales.d7.units,
    sales7Amt: Math.round(r.sales.d7.amount * 100) / 100,
    adsSpend: Math.round(r.ads.latest.spend * 100) / 100,
    adsRoas: r.ads.latest.roas,
    adsNet7d: r.profit.adsNet7d,
    replenish: r.replenish.status,
    availableDays: r.replenish.availableDays,
    margin: r.profit.margin,
  };
}

export function buildStoreDigestPayload(
  state: AppState,
  readiness: StoreReadiness,
  opts?: { topN?: number },
): StoreDigestPayload {
  const topN = opts?.topN ?? 12;
  const shop = getActiveShop();
  const lookup = buildCatalogLookup(state);
  const items = listCatalogItemsForAssembly(state, lookup);
  const rows = items.map((item) =>
    rowFromAssembled(
      assembleFromState(item, {
        stock: state.stock,
        salesFacts: state.salesFacts,
        adsFacts: state.adsFacts ?? [],
        feeSnapshots: state.feeSnapshots,
        feeEstimates: state.feeEstimates,
        skuLocalCosts: state.skuLocalCosts,
        skuDims: state.skuDims,
        replenishConfigs: state.replenishConfigs,
        shipping: state.shipping,
        lookup,
      }),
    ),
  );

  let sales7Units = 0;
  let sales7Amount = 0;
  let adsSpend = 0;
  let urgentCount = 0;
  let negativeAdsNetCount = 0;
  for (const r of rows) {
    sales7Units += r.sales7u;
    sales7Amount += r.sales7Amt;
    adsSpend += r.adsSpend;
    if (r.replenish === "urgent") urgentCount += 1;
    if (r.adsNet7d != null && r.adsNet7d < 0) negativeAdsNetCount += 1;
  }

  const bySales = [...rows]
    .filter((r) => r.sales7u > 0)
    .sort((a, b) => b.sales7u - a.sales7u || b.sales7Amt - a.sales7Amt)
    .slice(0, topN);

  const urgentReplenish = [...rows]
    .filter((r) => r.replenish === "urgent")
    .sort(
      (a, b) =>
        (a.availableDays ?? 999) - (b.availableDays ?? 999) ||
        b.sales7u - a.sales7u,
    )
    .slice(0, topN);

  const adsWatch = [...rows]
    .filter((r) => r.adsSpend > 0)
    .sort((a, b) => {
      const aBad = a.adsNet7d != null && a.adsNet7d < 0 ? 1 : 0;
      const bBad = b.adsNet7d != null && b.adsNet7d < 0 ? 1 : 0;
      if (aBad !== bBad) return bBad - aBad;
      const aRoas = a.adsRoas ?? 99;
      const bRoas = b.adsRoas ?? 99;
      return aRoas - bRoas || b.adsSpend - a.adsSpend;
    })
    .slice(0, topN);

  return {
    kind: "store",
    shopId: shop.id,
    shopName: shop.name,
    asOf: new Date().toISOString(),
    today: readiness.today,
    softNotes: readiness.softNotes,
    ads: readiness.ads,
    overview: {
      skuCount: rows.length,
      sales7Units,
      sales7Amount: Math.round(sales7Amount * 100) / 100,
      adsSpend: Math.round(adsSpend * 100) / 100,
      urgentCount,
      negativeAdsNetCount,
    },
    topSales: bySales,
    urgentReplenish,
    adsWatch,
  };
}
