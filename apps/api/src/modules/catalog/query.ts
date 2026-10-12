/**
 * Catalog 列表查询：筛选 + 排序 + 分页。
 * 装配结果按 state fingerprint 短缓存，翻页/预取不再重复全量 assemble。
 */
import type { AppState } from "../../common/types.js";
import {
  assembleFromState,
  type AssembledCatalogRow,
} from "./assemble.js";
import {
  catalogAssemblyMeta,
  listCatalogItemsForAssembly,
} from "./list-items.js";
import { buildCatalogLookup } from "./lookup.js";
import { buildCatalogProvenance } from "./provenance.js";
import { loadLatestPackingShipQty } from "../../platforms/feishu/normalize/ship-qty.js";
import { loadSkuHeadhaulMap } from "../shipping/headhaul/index.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const CACHE_TTL_MS = 30_000;

export type CatalogListQuery = {
  page: number;
  pageSize: number;
  /** 全量返回（Agent / 兼容旧客户端） */
  all: boolean;
  q: string;
  onlyFbn: boolean;
  onlyAds: boolean;
  onlyMissingLocal: boolean;
};

export type CatalogListMeta = {
  source: "NOON";
  assembly: "deterministic";
  joinKey: "partnerSku";
  count: number;
  total: number;
  matched: number;
  page: number;
  pageSize: number;
  pageCount: number;
  withImage: number;
  withAds: number;
  hiddenNoDisplay: number;
  orphanInMatched: number;
  asOf: string;
  localAlign: {
    matched: number;
    partial: number;
    missing: number;
    costRows: number;
    dimsRows: number;
  };
  officialCatalogCount: number;
  orphanCount: number;
  provenance: ReturnType<typeof buildCatalogProvenance>;
  cached?: boolean;
};

type AssembleCache = {
  fingerprint: string;
  builtAt: number;
  asOfIso: string;
  rows: AssembledCatalogRow[];
};

let assembleCache: AssembleCache | null = null;

function truthy(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function hasProductDisplay(r: AssembledCatalogRow): boolean {
  const title = (r.title || "").trim();
  const sku = (r.partnerSku || "").trim();
  if ((r.imageUrl || "").trim()) return true;
  if (title && title !== "—" && title.toLowerCase() !== sku.toLowerCase()) {
    return true;
  }
  return false;
}

function completenessScore(r: AssembledCatalogRow): number {
  let s = 0;
  if (r.local?.align === "matched") s += 50;
  else if (r.local?.align === "partial") s += 25;
  if ((r.specs?.purchaseCost ?? 0) > 0) s += 15;
  if ((r.specs?.weightKg ?? 0) > 0 || (r.specs?.volumeCm3 ?? 0) > 0) s += 10;
  if ((r.fees?.commissionRate ?? 0) > 0 || (r.fees?.outboundFee ?? 0) > 0)
    s += 15;
  if (r.profit?.sar != null) s += 20;
  if (r.imageUrl) s += 5;
  if (r.price > 0) s += 5;
  if (r.ads?.d7?.hasData || r.ads?.latest?.hasData) s += 5;
  if ((r.sales?.d7?.units ?? 0) > 0) s += 5;
  return s;
}

function listingAliveRank(r: AssembledCatalogRow): number {
  if (r.listingType === "orphan") return 0;
  if (r.isActive) return 2;
  return 1;
}

function maxIso(
  rows: Array<{ updatedAt?: string | null } | undefined>,
): string {
  let best = "";
  for (const r of rows) {
    const v = r?.updatedAt;
    if (v && v > best) best = v;
  }
  return best;
}

/** 内容指纹：长度 + 关键域最近更新，避免同长度误命中缓存 */
export function catalogStateFingerprint(state: AppState): string {
  return [
    state.catalog.length,
    state.stock.length,
    state.salesFacts.length,
    state.adsFacts.length,
    state.feeSnapshots.length,
    (state.feeEstimates ?? []).length,
    state.skuLocalCosts.length,
    state.skuDims.length,
    state.replenishConfigs.length,
    (state.feishuOpsSnapshots ?? []).length,
    (state.purchaseLines ?? []).length,
    maxIso(state.catalog),
    maxIso(state.stock),
    maxIso(state.salesFacts),
    maxIso(state.adsFacts),
    maxIso(state.feeSnapshots),
    maxIso(state.skuLocalCosts),
    maxIso(state.skuDims),
    maxIso(state.feishuOpsSnapshots ?? []),
    String(state.shipping?.buybackRate ?? ""),
    String(state.shipping?.updatedAt ?? ""),
  ].join("|");
}

export function parseCatalogListQuery(
  raw: Record<string, unknown> | undefined,
): CatalogListQuery {
  const q = raw ?? {};
  const all = truthy(q.all);
  let page = Number(q.page ?? 1);
  let pageSize = Number(q.pageSize ?? DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  pageSize = Math.min(MAX_PAGE_SIZE, Math.floor(pageSize));
  page = Math.floor(page);
  return {
    page,
    pageSize,
    all,
    q: String(q.q ?? "").trim(),
    onlyFbn: truthy(q.onlyFbn),
    onlyAds: truthy(q.onlyAds),
    onlyMissingLocal: truthy(q.onlyMissingLocal),
  };
}

/** 全量装配（带短缓存）；补货等投影复用，不做列表筛选 */
export function getAssembledCatalogRows(state: AppState): {
  rows: AssembledCatalogRow[];
  asOfIso: string;
  cached: boolean;
} {
  return assembleAllRows(state);
}

function assembleAllRows(state: AppState): {
  rows: AssembledCatalogRow[];
  asOfIso: string;
  cached: boolean;
} {
  const fingerprint = catalogStateFingerprint(state);
  const now = Date.now();
  if (
    assembleCache &&
    assembleCache.fingerprint === fingerprint &&
    now - assembleCache.builtAt < CACHE_TTL_MS
  ) {
    return {
      rows: assembleCache.rows,
      asOfIso: assembleCache.asOfIso,
      cached: true,
    };
  }

  const asOf = new Date();
  const lookup = buildCatalogLookup(state);
  const items = listCatalogItemsForAssembly(state, lookup);
  const shipQtyBySku = loadLatestPackingShipQty();
  const skuHeadhaulBySku = loadSkuHeadhaulMap(state.shipping);
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
      shipQtyBySku,
      skuHeadhaulBySku,
      lookup,
      asOf,
    }),
  );
  const asOfIso = asOf.toISOString();
  assembleCache = { fingerprint, builtAt: now, asOfIso, rows };
  return { rows, asOfIso, cached: false };
}

/** 测试或同步后可主动清缓存 */
export function clearCatalogAssembleCache() {
  assembleCache = null;
}

export function filterAndSortCatalogRows(
  rows: AssembledCatalogRow[],
  query: Pick<
    CatalogListQuery,
    "q" | "onlyFbn" | "onlyAds" | "onlyMissingLocal"
  >,
): AssembledCatalogRow[] {
  const needle = query.q.toLowerCase();
  const searching = Boolean(needle);
  const list = rows.filter((r) => {
    if (query.onlyFbn && (r.inventory?.fbn ?? 0) <= 0) return false;
    if (query.onlyAds && !r.ads?.d7?.hasData && !r.ads?.latest?.hasData)
      return false;
    if (query.onlyMissingLocal && r.local?.align === "matched") return false;
    if (searching) {
      return (
        r.partnerSku.toLowerCase().includes(needle) ||
        (r.noonSku ?? "").toLowerCase().includes(needle) ||
        r.title.toLowerCase().includes(needle)
      );
    }
    return hasProductDisplay(r);
  });
  list.sort((a, b) => {
    const alive = listingAliveRank(b) - listingAliveRank(a);
    if (alive !== 0) return alive;
    const display = Number(hasProductDisplay(b)) - Number(hasProductDisplay(a));
    if (display !== 0) return display;
    const d = completenessScore(b) - completenessScore(a);
    if (d !== 0) return d;
    return a.partnerSku.localeCompare(b.partnerSku);
  });
  return list;
}

export function queryCatalogList(
  state: AppState,
  query: CatalogListQuery,
): { data: AssembledCatalogRow[]; meta: CatalogListMeta } {
  const { rows, asOfIso, cached } = assembleAllRows(state);

  let withImage = 0;
  let withAds = 0;
  let localMatched = 0;
  let localPartial = 0;
  let localMissing = 0;
  let hiddenNoDisplay = 0;
  for (const r of rows) {
    if (r.imageUrl) withImage += 1;
    if (r.ads.d7.hasData || r.ads.latest.hasData) withAds += 1;
    if (r.local.align === "matched") localMatched += 1;
    else if (r.local.align === "partial") localPartial += 1;
    else localMissing += 1;
    if (!hasProductDisplay(r)) hiddenNoDisplay += 1;
  }

  const matched = filterAndSortCatalogRows(rows, query);
  const orphanInMatched = matched.filter(
    (r) => r.listingType === "orphan",
  ).length;
  const orphanMeta = catalogAssemblyMeta(state, rows.length);
  const provenance = buildCatalogProvenance(state);

  const total = rows.length;
  const matchedCount = matched.length;
  let page = query.page;
  let pageSize = query.pageSize;
  let pageCount = 1;
  let data: AssembledCatalogRow[];

  if (query.all) {
    data = matched;
    page = 1;
    pageSize = matchedCount || 1;
    pageCount = 1;
  } else {
    pageCount = Math.max(1, Math.ceil(matchedCount / pageSize));
    if (page > pageCount) page = pageCount;
    const start = (page - 1) * pageSize;
    data = matched.slice(start, start + pageSize);
  }

  return {
    data,
    meta: {
      source: "NOON",
      assembly: "deterministic",
      joinKey: "partnerSku",
      count: data.length,
      total,
      matched: matchedCount,
      page,
      pageSize,
      pageCount,
      withImage,
      withAds,
      hiddenNoDisplay,
      orphanInMatched,
      asOf: asOfIso,
      localAlign: {
        matched: localMatched,
        partial: localPartial,
        missing: localMissing,
        costRows: state.skuLocalCosts.length,
        dimsRows: state.skuDims.length,
      },
      ...orphanMeta,
      provenance,
      cached,
    },
  };
}

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
