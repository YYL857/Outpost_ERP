/**
 * Catalog / 汇总同步用的域溯源（来源 + 时效 + 落盘痕迹）
 * 边界：只读磁盘与 state，不改业务表。
 */
import type { AppState } from "../../common/types.js";
import { pickLatestAdsSkuFile } from "../../platforms/noon/portal/auto-ingest.js";
import {
  isCatalogStockHintWarehouse,
  stockLastImpexAt,
  stockLedgerRowMaxAt,
} from "../sync/live-impex-domains.js";

const STALE_ADS_MS = 36 * 60 * 60 * 1000;
/** 分仓库存超过此时长未真正 Impex → 标 stale（与默认 6h 刷新对齐并留一点缓冲） */
const STALE_STOCK_MS = 8 * 60 * 60 * 1000;

export type DomainProvenance = {
  source: string;
  label: string;
  note?: string;
  reportFrom?: string | null;
  reportTo?: string | null;
  syncedAt?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  fileMtime?: string | null;
  factsCount?: number;
  stale?: boolean;
};

/** 页面上一栏数据的来源与两个时间：数字代表的业务日，以及写入本系统的时间 */
export type ProvenanceSlice = {
  key: string;
  column: string;
  source: string;
  /** 已格式化的业务时间节点 */
  dataNode: string;
  syncedAt: string | null;
  syncedToday: boolean;
  count: number;
  stale?: boolean;
  note?: string;
};

export type CatalogProvenance = {
  asOf: string;
  /** 上海日历日 YYYY-MM-DD，用来判断「今天同步」 */
  today: string;
  joinKey: "partnerSku";
  domains: {
    noon: DomainProvenance;
    ads: DomainProvenance;
    feishu: DomainProvenance;
  };
  slices: ProvenanceSlice[];
};

const SHANGHAI = "Asia/Shanghai";

function shanghaiDay(input: string | Date): string | null {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts || null;
}

function shanghaiClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function maxIso(dates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d > best) best = d;
  }
  return best;
}

/** 当前店 portal-imports 下最新 ads_sku_*.csv */
export function findLatestAdsImportFile(importDir?: string): {
  fileName: string;
  filePath: string;
  fileMtime: string;
  reportFrom: string | null;
  reportTo: string | null;
} | null {
  const picked = pickLatestAdsSkuFile(importDir);
  if (!picked) return null;
  return {
    fileName: picked.fileName,
    filePath: picked.filePath,
    fileMtime: new Date(picked.mtimeMs).toISOString(),
    reportFrom: picked.reportFrom,
    reportTo: picked.reportTo,
  };
}

export function buildAdsProvenance(state: AppState): DomainProvenance {
  const file = findLatestAdsImportFile();
  const facts = state.adsFacts ?? [];
  let reportFrom: string | null = file?.reportFrom ?? null;
  let reportTo: string | null = file?.reportTo ?? null;
  if ((!reportFrom || !reportTo) && facts.length) {
    let maxTo = "";
    for (const f of facts) {
      if (f.toDate > maxTo) maxTo = f.toDate;
    }
    reportTo = maxTo || null;
    let minFrom = maxTo;
    for (const f of facts) {
      if (f.toDate === maxTo && f.fromDate < minFrom) minFrom = f.fromDate;
    }
    reportFrom = minFrom || null;
  }
  const syncedAt =
    maxIso([
      file?.fileMtime,
      ...facts.map((f) => f.updatedAt),
      state.noon.portal.lastImportAt,
    ]) ?? null;
  const stale = syncedAt
    ? Date.now() - Date.parse(syncedAt) > STALE_ADS_MS
    : facts.length === 0;

  return {
    source: "yingdao-ads",
    label: "影刀广告·昨日",
    note:
      facts.length === 0
        ? "无广告事实：请先跑影刀导出昨日表，再汇总同步"
        : "投产比按落在近窗内的广告事实汇总；仅昨日报时≈昨日 ROAS",
    reportFrom,
    reportTo,
    syncedAt,
    fileName: file?.fileName ?? null,
    filePath: file?.filePath ?? null,
    fileMtime: file?.fileMtime ?? null,
    factsCount: facts.length,
    stale,
  };
}

function listOf<T>(rows: T[] | null | undefined): T[] {
  return rows ?? [];
}

function jobSuccessAt(state: AppState, domain: string): string | null {
  const job = listOf(state.syncJobs).find(
    (j) => j.domain === domain && j.lastSuccessAt,
  );
  return job?.lastSuccessAt ?? null;
}

function newestByUpdatedAt<T extends { updatedAt?: string | null }>(
  rows: T[],
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!row.updatedAt) continue;
    if (!best?.updatedAt || row.updatedAt > best.updatedAt) best = row;
  }
  return best;
}

function dateSpan(dates: Array<string | null | undefined>): {
  min: string | null;
  max: string | null;
} {
  let min: string | null = null;
  let max: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return { min, max };
}

function localSourceLabel(source: string | null | undefined, fallback: string): string {
  if (!source) return fallback;
  if (source.startsWith("feishu")) return `飞书 · ${source}`;
  return source;
}

function makeSlice(
  today: string,
  slice: Omit<ProvenanceSlice, "syncedToday">,
): ProvenanceSlice {
  const day = slice.syncedAt ? shanghaiDay(slice.syncedAt) : null;
  return {
    ...slice,
    syncedToday: Boolean(day && day === today),
  };
}

export function buildCatalogProvenance(state: AppState): CatalogProvenance {
  const asOf = new Date().toISOString();
  const today = shanghaiDay(asOf) ?? asOf.slice(0, 10);
  const portal = state.noon?.portal;
  const catalog = listOf(state.catalog);
  const stock = listOf(state.stock);
  const sales = listOf(state.salesFacts);
  const fees = listOf(state.feeSnapshots);
  const estimates = listOf(state.feeEstimates);
  const costs = listOf(state.skuLocalCosts);
  const dims = listOf(state.skuDims);
  const ads = buildAdsProvenance(state);

  const catalogAt = maxIso(catalog.map((r) => r.updatedAt));
  const stockLedgerAt = stockLedgerRowMaxAt(state);
  const stockHintAt = maxIso(
    stock
      .filter((r) => isCatalogStockHintWarehouse(r.warehouseCode))
      .map((r) => r.updatedAt),
  );
  const stockAt = stockLedgerAt ?? stockHintAt;
  const stockPulledAt = stockLastImpexAt(state);
  const salesIngested = maxIso(sales.map((r) => r.updatedAt));
  const salesDates = dateSpan(sales.map((r) => r.date));
  const feeAt = maxIso(fees.map((r) => r.updatedAt));
  const estimateAt = maxIso(estimates.map((r) => r.updatedAt));
  const costRow = newestByUpdatedAt(costs);
  const dimsRow = newestByUpdatedAt(dims);
  const costUpdated = costRow?.updatedAt ?? null;
  const dimsUpdated = dimsRow?.updatedAt ?? null;
  const shippingAt = state.shipping?.updatedAt ?? null;

  const priceSynced =
    jobSuccessAt(state, "catalog") ??
    portal?.lastFetchAt ??
    portal?.lastImportAt ??
    catalogAt;
  const priceNote = portal?.lastImportSummary
    ? portal.lastImportSummary.slice(0, 120)
    : "商品栏的售价、标题、在售状态";

  let feeSource = "Noon 费用";
  let feeNode = "无费用数据";
  let feeSynced = jobSuccessAt(state, "fees");
  let feeCount = 0;
  let feeNote = "佣金、出仓、税费";
  if (fees.length > 0) {
    feeSource = "Noon 费用快照";
    feeNode = feeAt ? `费用快照 ${shanghaiClock(feeAt)}` : "费用快照时间未知";
    feeSynced = jobSuccessAt(state, "fees") ?? feeAt;
    feeCount = fees.length;
    feeNote = estimates.length
      ? "有快照的 SKU 用快照；没有快照时用估费补缺"
      : "佣金、出仓、税费";
  } else if (estimates.length > 0) {
    feeSource = "Noon 估费";
    feeNode = estimateAt
      ? `估费 ${shanghaiClock(estimateAt)}`
      : "估费时间未知";
    feeSynced = estimateAt;
    feeCount = estimates.length;
    feeNote = "没有费用快照，页面费用来自估费";
  }

  const adsNode =
    ads.reportFrom && ads.reportTo
      ? `报表 ${ads.reportFrom} → ${ads.reportTo}`
      : "无报表区间";

  const stockSyncedAt = stockPulledAt ?? stockLedgerAt;
  const stockStale = stockSyncedAt
    ? Date.now() - Date.parse(stockSyncedAt) > STALE_STOCK_MS
    : stock.length > 0;
  const stockNoteParts = [
    "FBN / Supermall / 在途（Detailed ledger）",
    stockPulledAt
      ? `上次分仓拉取 ${shanghaiClock(stockPulledAt)}`
      : "尚无分仓拉取游标（cursors.stockSince）",
    stockHintAt && !stockLedgerAt
      ? "当前仅有 Catalog 库存提示，未拉分仓账"
      : null,
  ].filter(Boolean);

  const slices: ProvenanceSlice[] = [
    makeSlice(today, {
      key: "price",
      column: "售价·在售",
      source: "Noon Catalog",
      dataNode: catalogAt ? `标价 ${shanghaiClock(catalogAt)}` : "无 Catalog",
      syncedAt: priceSynced,
      count: catalog.length,
      note: priceNote,
    }),
    makeSlice(today, {
      key: "stock",
      column: "库存",
      source: "Noon 库存",
      dataNode: stockAt
        ? `库存行 ${shanghaiClock(stockAt)}`
        : "无库存",
      syncedAt: stockSyncedAt,
      count: stock.length,
      stale: stockStale,
      note: stockNoteParts.join(" · "),
    }),
    makeSlice(today, {
      key: "sales",
      column: "销量·销售额",
      source: "Noon Sales",
      dataNode:
        salesDates.min && salesDates.max
          ? `成交日 ${salesDates.min} → ${salesDates.max}`
          : "无销量事实",
      syncedAt: jobSuccessAt(state, "sales") ?? salesIngested,
      count: sales.length,
      note: "近 3/7/14/30 日按打开页面的时刻往回滚，不是文件上的固定日期",
    }),
    makeSlice(today, {
      key: "ads",
      column: "广告投产",
      source: "影刀广告",
      dataNode: adsNode,
      syncedAt: ads.syncedAt ?? null,
      count: ads.factsCount ?? 0,
      stale: ads.stale,
      note: [ads.note, ads.fileName].filter(Boolean).join(" · "),
    }),
    makeSlice(today, {
      key: "fees",
      column: "平台费用",
      source: feeSource,
      dataNode: feeNode,
      syncedAt: feeSynced,
      count: feeCount,
      note: feeNote,
    }),
    makeSlice(today, {
      key: "cost",
      column: "采购成本",
      source: localSourceLabel(costRow?.source, "飞书"),
      dataNode: costUpdated
        ? `表内更新 ${shanghaiClock(costUpdated)}`
        : "无采购成本",
      syncedAt: costUpdated,
      count: costs.length,
      note: "毛利里的采购价。入库时间就是飞书表写入本系统的时间",
    }),
    makeSlice(today, {
      key: "dims",
      column: "尺寸重量",
      source: localSourceLabel(dimsRow?.source, "飞书"),
      dataNode: dimsUpdated
        ? `表内更新 ${shanghaiClock(dimsUpdated)}`
        : "无尺寸",
      syncedAt: dimsUpdated,
      count: dims.length,
      note: "规格栏的重量和长宽高",
    }),
    makeSlice(today, {
      key: "shipping",
      column: "头程·汇率",
      source: "本地费率表",
      dataNode: shippingAt
        ? `配置 ${shanghaiClock(shippingAt)}`
        : "未记录配置时间",
      syncedAt: shippingAt,
      count: shippingAt ? 1 : 0,
      note: "毛利里的头程和人民币换算用这份配置，不随 Noon 同步",
    }),
  ];

  return {
    asOf,
    today,
    joinKey: "partnerSku",
    domains: {
      noon: {
        source: "noon-impex",
        label: "Noon Impex",
        note: "价/库/销/费时间各自不同，见 slices",
        syncedAt:
          portal?.lastFetchAt ?? portal?.lastImportAt ?? priceSynced ?? null,
        factsCount: catalog.length,
      },
      ads,
      feishu: {
        source: "feishu-local",
        label: "飞书本地",
        note: "采购成本与尺寸的表内更新时间可能不同",
        syncedAt: maxIso([costUpdated, dimsUpdated]),
        factsCount: costs.length + dims.length,
      },
    },
    slices,
  };
}
