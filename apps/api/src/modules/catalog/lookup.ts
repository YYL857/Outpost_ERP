/**
 * Catalog 请求级索引：按 partnerSku 分桶，避免每个 SKU 反复扫全表。
 */
import type {
  AdsFact,
  CatalogItem,
  FeeEstimate,
  FeeSnapshot,
  ReplenishConfig,
  SalesFact,
  SkuDims,
  SkuLocalCost,
  StockItem,
} from "../../common/types.js";

export type CatalogLookup = {
  salesBySku: Map<string, SalesFact[]>;
  adsBySku: Map<string, AdsFact[]>;
  stockBySku: Map<string, StockItem[]>;
  feeBySku: Map<string, FeeSnapshot>;
  /** 仅 FBN Estimated Fees */
  feeEstimateBySku: Map<string, FeeEstimate>;
  costBySku: Map<string, SkuLocalCost>;
  dimsBySku: Map<string, SkuDims[]>;
  replenishBySku: Map<string, ReplenishConfig>;
  /** 孤儿行用：最近有销量日的均价 */
  latestSalesBySku: Map<string, { price: number; updatedAt: string }>;
};

function pushMap<T>(map: Map<string, T[]>, key: string, row: T) {
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

export function buildCatalogLookup(state: {
  salesFacts: SalesFact[];
  adsFacts: AdsFact[];
  stock: StockItem[];
  feeSnapshots: FeeSnapshot[];
  feeEstimates?: FeeEstimate[];
  skuLocalCosts: SkuLocalCost[];
  skuDims: SkuDims[];
  replenishConfigs: ReplenishConfig[];
}): CatalogLookup {
  const salesBySku = new Map<string, SalesFact[]>();
  const adsBySku = new Map<string, AdsFact[]>();
  const stockBySku = new Map<string, StockItem[]>();
  const feeBySku = new Map<string, FeeSnapshot>();
  const feeEstimateBySku = new Map<string, FeeEstimate>();
  const costBySku = new Map<string, SkuLocalCost>();
  const dimsBySku = new Map<string, SkuDims[]>();
  const replenishBySku = new Map<string, ReplenishConfig>();
  const latestSalesBySku = new Map<
    string,
    { price: number; updatedAt: string; bestDate: string }
  >();

  for (const f of state.salesFacts) {
    pushMap(salesBySku, f.partnerSku, f);
    const cur = latestSalesBySku.get(f.partnerSku);
    const updatedAt = !cur || f.updatedAt > cur.updatedAt ? f.updatedAt : cur.updatedAt;
    let price = cur?.price ?? 0;
    let bestDate = cur?.bestDate ?? "";
    if (f.date >= bestDate && f.units > 0 && f.amount > 0) {
      bestDate = f.date;
      price = Math.round((f.amount / f.units) * 100) / 100;
    }
    latestSalesBySku.set(f.partnerSku, { price, updatedAt, bestDate });
  }

  for (const f of state.adsFacts) pushMap(adsBySku, f.partnerSku, f);
  for (const s of state.stock) pushMap(stockBySku, s.partnerSku, s);
  for (const f of state.feeSnapshots) feeBySku.set(f.partnerSku, f);
  for (const e of state.feeEstimates ?? []) {
    if (e.fulfillment !== "fbn") continue;
    if (!feeEstimateBySku.has(e.partnerSku)) feeEstimateBySku.set(e.partnerSku, e);
  }
  for (const c of state.skuLocalCosts) costBySku.set(c.partnerSku, c);
  for (const d of state.skuDims) pushMap(dimsBySku, d.partnerSku, d);
  for (const r of state.replenishConfigs) replenishBySku.set(r.partnerSku, r);

  const latestOut = new Map<string, { price: number; updatedAt: string }>();
  for (const [sku, v] of latestSalesBySku) {
    latestOut.set(sku, { price: v.price, updatedAt: v.updatedAt });
  }

  return {
    salesBySku,
    adsBySku,
    stockBySku,
    feeBySku,
    feeEstimateBySku,
    costBySku,
    dimsBySku,
    replenishBySku,
    latestSalesBySku: latestOut,
  };
}

/** 广告事实可能挂在 partnerSku 或 noonSku 上 */
export function adsFactsForItem(
  adsBySku: ReadonlyMap<string, AdsFact[]>,
  item: Pick<CatalogItem, "partnerSku" | "noonSku">,
): AdsFact[] {
  const a = adsBySku.get(item.partnerSku);
  const noon = item.noonSku?.trim();
  if (!noon || noon === item.partnerSku) return a ?? [];
  const b = adsBySku.get(noon);
  if (!a) return b ?? [];
  if (!b) return a;
  return a.concat(b);
}
