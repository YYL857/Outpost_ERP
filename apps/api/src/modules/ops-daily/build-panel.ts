import type { AppState, CatalogItem } from "../../common/types.js";
import { PANEL_HEADER } from "./columns.js";
import { shanghaiYmd } from "./dates.js";
import {
  adLossSummaryTag,
  collectDailyAdsFactsMerged,
  emptyAdsWindow,
  portalAdsCoverage,
  rollupAdsWindows,
} from "./ads.js";
import {
  loadLatestSalesExportLines,
  rollupSalesMetrics,
  rollupSalesMetricsByPsku,
  shopImportDir,
} from "./sales-export.js";
import { resolveStockChannels } from "./stock.js";
import { loadTrafficLines, rollupTrafficMetrics } from "./traffic.js";
import { loadOpsDailySettings } from "./config.js";
import {
  AGE_BUCKETS,
  AGING_MISSING_LABEL,
  loadFbnLedgerMoves,
  rollupAgingBySku,
  type AgingMetrics,
} from "./aging.js";
import { rollupTransitByPsku } from "./transit.js";
import { inferStorePrefixes } from "../../platforms/feishu/ingest/local.js";

export type PanelRow = Record<string, string | number>;

export type BuildPanelResult = {
  asOf: string;
  phase: number;
  rows: PanelRow[];
  meta: {
    catalogCount: number;
    stockSkuCount: number;
    salesExportFile: string | null;
    salesExportLines: number;
    stockFile: string | null;
    trafficFiles: string[];
    trafficLines: number;
    adsDaysPresent: string[];
    adsDaysMissing: string[];
    adsCoverage: "partial" | "full";
    agingFiles: string[];
    agingMoves: number;
    transitSkuCount: number;
  };
};

function partnerNumericFromShopRoot(shopRootDir: string): string {
  const m = shopRootDir.replace(/\\/g, "/").match(/PRJ(\d+)/i);
  return m?.[1] ?? "";
}

function emptyRow(asOf: string): PanelRow {
  const row: PanelRow = {};
  for (const h of PANEL_HEADER) row[h] = "";
  row["日期"] = asOf;
  row["30销量"] = 0;
  row["30访客"] = 0;
  row["30转化率"] = 0;
  row["近30天退货率"] = 0;
  row["FBN"] = 0;
  row["supermall"] = 0;
  row["365天以上"] = 0;
  row["271-365天"] = 0;
  row["181-270天"] = 0;
  row["91-180天"] = 0;
  row["0-90天"] = 0;
  row["空运在途"] = 0;
  row["海运在途"] = 0;
  row["已采购数量"] = 0;
  for (const n of [7, 15, 30] as const) {
    const e = emptyAdsWindow(String(n));
    row[`${n}天广告盈亏标签`] = e.tag;
    row[`${n}广告花费`] = 0;
    row[`${n}广告订单`] = 0;
    row[`${n}广告销售额`] = 0;
    row[`${n}ROAS`] = 0;
  }
  row["广告亏损判断标签"] = "未投放";
  return row;
}

function onlinePrice(c: CatalogItem): number {
  if (c.activePrice != null && Number.isFinite(c.activePrice)) {
    return c.activePrice;
  }
  return Number(c.price) || 0;
}

function applyAging(row: PanelRow, aging: AgingMetrics | null) {
  if (!aging) {
    row["入仓天数"] = AGING_MISSING_LABEL;
    row["库龄风险等级"] = AGING_MISSING_LABEL;
    for (const b of AGE_BUCKETS) row[b] = 0;
    return;
  }
  row["入仓天数"] =
    aging.daysInWarehouse == null
      ? AGING_MISSING_LABEL
      : aging.daysInWarehouse;
  row["库龄风险等级"] = aging.risk;
  for (const b of AGE_BUCKETS) row[b] = aging.buckets[b];
}

/**
 * Phase1–3 面板：Catalog + stock + sales + traffic + ads + FIFO 库龄 + 在途/采购。
 * Phase4 费用/到仓为旁路 CSV（见 run.ts / fees.ts / landed.ts），不改本 48 列。
 * 粒度为 Noon SKU；同 SKU 优先 live。
 */
export function buildPhase1Panel(
  state: AppState,
  shopRootDir: string,
  asOfInput?: string | null,
): BuildPanelResult {
  const settings = loadOpsDailySettings();
  const asOf = (asOfInput?.trim() || shanghaiYmd()).slice(0, 10);
  const importDir = shopImportDir(shopRootDir);
  const partnerId = partnerNumericFromShopRoot(shopRootDir);

  const { lines, fileName } = loadLatestSalesExportLines(importDir, asOf);
  const bySku = rollupSalesMetrics(lines, asOf, 30);
  const byPsku = rollupSalesMetricsByPsku(lines, asOf, 30);
  const stockResolved = resolveStockChannels(
    state.stock ?? [],
    importDir,
    asOf,
  );
  const stockByPsku = stockResolved.byPsku;

  const traffic = loadTrafficLines(shopRootDir, partnerId);
  const trafficByKey = rollupTrafficMetrics(traffic.lines, asOf, 30);

  const adsDays = collectDailyAdsFactsMerged(importDir, state.adsFacts ?? []);
  const adsBySku = rollupAdsWindows(adsDays, asOf, [7, 15, 30]);
  const adsCov = portalAdsCoverage(importDir, asOf, 30);
  const adsCoverage: "partial" | "full" =
    adsCov.daysMissing.length > 0
      ? "partial"
      : (settings.ads_coverage ?? "partial");

  const ledger = loadFbnLedgerMoves(shopRootDir, partnerId);
  const agingByKey = rollupAgingBySku(ledger.moves, asOf);

  const prefixes = inferStorePrefixes(state.catalog ?? []);
  const transitByPsku = rollupTransitByPsku({
    purchaseLines: state.purchaseLines ?? [],
    opsSnapshots: state.feishuOpsSnapshots ?? [],
    prefixes,
  });

  const catalog = [...(state.catalog ?? [])];
  catalog.sort((a, b) => {
    const ka = a.noonSku || a.partnerSku;
    const kb = b.noonSku || b.partnerSku;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return Number(b.isActive) - Number(a.isActive);
  });
  const seen = new Set<string>();
  const spine: CatalogItem[] = [];
  for (const c of catalog) {
    const key = (c.noonSku || c.partnerSku).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    spine.push(c);
  }

  const rows: PanelRow[] = [];
  for (const c of spine) {
    const row = emptyRow(asOf);
    const sku = (c.noonSku || "").trim();
    const psku = (c.partnerSku || "").trim();
    row["PSKU"] = psku;
    row["SKU"] = sku;
    row["产品名称"] = c.title ?? "";
    row["当前在线状态"] = c.isActive ? "在线" : "不在线";
    row["在线价"] = onlinePrice(c);

    const sales = (sku && bySku.get(sku)) || byPsku.get(psku);
    row["30销量"] = sales?.units30 ?? 0;
    row["近30天退货率"] = sales?.returnRate30 ?? 0;

    const tr =
      (sku && trafficByKey.get(sku)) ||
      (psku && trafficByKey.get(psku)) ||
      null;
    row["30访客"] = tr?.visitors30 ?? 0;
    row["30转化率"] = tr?.conversion30 ?? 0;

    const st = stockByPsku.get(psku);
    row["FBN"] = st?.fbn ?? 0;
    row["supermall"] = st?.supermall ?? 0;

    const aging =
      (sku && agingByKey.get(sku)) ||
      (psku && agingByKey.get(psku)) ||
      null;
    applyAging(row, aging);

    const trn = transitByPsku.get(psku);
    row["空运在途"] = trn?.airInTransit ?? 0;
    row["海运在途"] = trn?.seaInTransit ?? 0;
    row["已采购数量"] = trn?.purchasedQty ?? 0;

    const ads = (sku && adsBySku.get(sku)) || null;
    const w7 = ads?.[7] ?? emptyAdsWindow("7");
    const w15 = ads?.[15] ?? emptyAdsWindow("15");
    const w30 = ads?.[30] ?? emptyAdsWindow("30");
    for (const [n, w] of [
      [7, w7],
      [15, w15],
      [30, w30],
    ] as const) {
      row[`${n}天广告盈亏标签`] = w.tag;
      row[`${n}广告花费`] = w.spend;
      row[`${n}广告订单`] = w.orders;
      row[`${n}广告销售额`] = w.revenue;
      row[`${n}ROAS`] = w.roas;
    }
    row["广告亏损判断标签"] = adLossSummaryTag({
      tag7: w7.tag,
      tag15: w15.tag,
      tag30: w30.tag,
    });

    rows.push(row);
  }

  return {
    asOf,
    phase: settings.phase ?? 3,
    rows,
    meta: {
      catalogCount: spine.length,
      stockSkuCount: stockByPsku.size,
      salesExportFile: fileName,
      salesExportLines: lines.length,
      stockFile: stockResolved.sourceFile,
      trafficFiles: traffic.files,
      trafficLines: traffic.lines.length,
      adsDaysPresent: adsCov.daysPresent,
      adsDaysMissing: adsCov.daysMissing,
      adsCoverage,
      agingFiles: ledger.files,
      agingMoves: ledger.moves.length,
      transitSkuCount: transitByPsku.size,
    },
  };
}

export function panelRowsToCsv(rows: PanelRow[]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [PANEL_HEADER.join(",")];
  for (const row of rows) {
    lines.push(PANEL_HEADER.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}
