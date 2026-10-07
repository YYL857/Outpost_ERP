/**
 * Catalog 列表用商品主档：Noon catalog + 有销量/费用/本地域但未进 catalog 的孤儿 PSKU。
 * 不写回 state.catalog（避免污染官方主档）；仅拼装视图可见可搜。
 */
import type {
  AdsFact,
  AppState,
  CatalogItem,
  FeeEstimate,
  FeeSnapshot,
  SalesFact,
  SkuDims,
  SkuLocalCost,
} from "../../common/types.js";

function latestSalesPrice(facts: SalesFact[], partnerSku: string): {
  price: number;
  updatedAt: string;
} {
  let price = 0;
  let updatedAt = "";
  let bestDate = "";
  for (const f of facts) {
    if (f.partnerSku !== partnerSku) continue;
    if (f.date >= bestDate && f.units > 0 && f.amount > 0) {
      bestDate = f.date;
      price = Math.round((f.amount / f.units) * 100) / 100;
    }
    if (f.updatedAt > updatedAt) updatedAt = f.updatedAt;
  }
  return { price, updatedAt };
}

function maxIso(values: Array<string | undefined | null>): string {
  let best = "";
  for (const v of values) {
    if (v && v > best) best = v;
  }
  return best || new Date().toISOString();
}

/** 官方 catalog ∪ 有平台经营痕迹的孤儿行（销量/费用/广告；不含纯飞书未上架） */
export function listCatalogItemsForAssembly(state: {
  catalog: CatalogItem[];
  salesFacts: SalesFact[];
  feeSnapshots: FeeSnapshot[];
  feeEstimates?: FeeEstimate[];
  skuLocalCosts: SkuLocalCost[];
  skuDims: SkuDims[];
  adsFacts?: AdsFact[];
}): CatalogItem[] {
  const known = new Set(state.catalog.map((c) => c.partnerSku));
  const orphans = new Set<string>();
  const add = (sku: string | undefined) => {
    const s = (sku ?? "").trim();
    if (!s || known.has(s)) return;
    orphans.add(s);
  };
  // 仅平台域孤儿：避免飞书全量产品表把未上架 PSKU 灌进 Catalog
  for (const r of state.salesFacts) add(r.partnerSku);
  for (const r of state.feeSnapshots) add(r.partnerSku);
  for (const r of state.feeEstimates ?? []) add(r.partnerSku);
  for (const r of state.adsFacts ?? []) add(r.partnerSku);

  if (orphans.size === 0) return state.catalog;

  const extras: CatalogItem[] = [...orphans]
    .sort((a, b) => a.localeCompare(b))
    .map((partnerSku) => {
      const fromSales = latestSalesPrice(state.salesFacts, partnerSku);
      const fee = state.feeSnapshots.find((f) => f.partnerSku === partnerSku);
      const cost = state.skuLocalCosts.find((c) => c.partnerSku === partnerSku);
      const dims = state.skuDims.find((d) => d.partnerSku === partnerSku);
      return {
        partnerSku,
        title: `（未在线 Catalog）${partnerSku}`,
        isActive: false,
        noonSku: "",
        imageUrl: "",
        price: fromSales.price,
        currency: "SAR",
        listingType: "orphan",
        source: "NOON" as const,
        updatedAt: maxIso([
          fromSales.updatedAt,
          fee?.updatedAt,
          cost?.updatedAt,
          dims?.updatedAt,
        ]),
      };
    });

  return [...state.catalog, ...extras];
}

export function catalogAssemblyMeta(state: AppState, assembledCount: number) {
  const official = state.catalog.length;
  return {
    officialCatalogCount: official,
    orphanCount: Math.max(0, assembledCount - official),
  };
}
