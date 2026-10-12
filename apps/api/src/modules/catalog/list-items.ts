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
  FeishuOpsSnapshot,
  PurchaseLine,
  SalesFact,
  SkuDims,
  SkuLocalCost,
} from "../../common/types.js";
import type { CatalogLookup } from "./lookup.js";

function maxIso(values: Array<string | undefined | null>): string {
  let best = "";
  for (const v of values) {
    if (v && v > best) best = v;
  }
  return best || new Date().toISOString();
}

function orphanDisplayTitle(
  partnerSku: string,
  state: {
    feishuOpsSnapshots?: FeishuOpsSnapshot[];
    purchaseLines?: PurchaseLine[];
  },
): { title: string; from: "feishu" | "purchase" | "sku" } {
  const opsName = (state.feishuOpsSnapshots ?? [])
    .find((o) => o.partnerSku === partnerSku)
    ?.productName?.trim();
  if (opsName) return { title: opsName, from: "feishu" };

  const purchName = (state.purchaseLines ?? [])
    .find((p) => p.partnerSku === partnerSku)
    ?.productName?.trim();
  if (purchName) return { title: purchName, from: "purchase" };

  return { title: `（未在线 Catalog）${partnerSku}`, from: "sku" };
}

/** 官方 catalog ∪ 有平台经营痕迹的孤儿行（销量/费用/广告；不含纯飞书未上架） */
export function listCatalogItemsForAssembly(
  state: {
    catalog: CatalogItem[];
    salesFacts: SalesFact[];
    feeSnapshots: FeeSnapshot[];
    feeEstimates?: FeeEstimate[];
    skuLocalCosts: SkuLocalCost[];
    skuDims: SkuDims[];
    adsFacts?: AdsFact[];
    feishuOpsSnapshots?: FeishuOpsSnapshot[];
    purchaseLines?: PurchaseLine[];
  },
  lookup?: CatalogLookup,
): CatalogItem[] {
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

  const feeBySku = lookup?.feeBySku;
  const costBySku = lookup?.costBySku;
  const dimsBySku = lookup?.dimsBySku;
  const latestSales = lookup?.latestSalesBySku;

  const extras: CatalogItem[] = [...orphans]
    .sort((a, b) => a.localeCompare(b))
    .map((partnerSku) => {
      const fromSales = latestSales?.get(partnerSku) ?? {
        price: 0,
        updatedAt: "",
      };
      let price = fromSales.price;
      let salesUpdated = fromSales.updatedAt;
      if (!latestSales) {
        let bestDate = "";
        for (const f of state.salesFacts) {
          if (f.partnerSku !== partnerSku) continue;
          if (f.date >= bestDate && f.units > 0 && f.amount > 0) {
            bestDate = f.date;
            price = Math.round((f.amount / f.units) * 100) / 100;
          }
          if (f.updatedAt > salesUpdated) salesUpdated = f.updatedAt;
        }
      }
      const fee =
        feeBySku?.get(partnerSku) ??
        state.feeSnapshots.find((f) => f.partnerSku === partnerSku);
      const cost =
        costBySku?.get(partnerSku) ??
        state.skuLocalCosts.find((c) => c.partnerSku === partnerSku);
      const dims =
        dimsBySku?.get(partnerSku)?.[0] ??
        state.skuDims.find((d) => d.partnerSku === partnerSku);
      const named = orphanDisplayTitle(partnerSku, state);
      return {
        partnerSku,
        title: named.title,
        isActive: false,
        noonSku: "",
        imageUrl: "",
        price,
        currency: "SAR",
        listingType: "orphan",
        source: "NOON" as const,
        updatedAt: maxIso([
          salesUpdated,
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
