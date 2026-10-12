/**
 * 从店 state + ASN 在途装配补货表行。
 */
import type { AppState } from "../../../common/types.js";
import { getAssembledCatalogRows } from "../../catalog/query.js";
import { sumInventory } from "../../catalog/assemble.js";
import { shopPrefixFromPartnerSku } from "../../../platforms/feishu/normalize/packing-lines.js";
import { loadAsnTransitBySku, type AsnTransitSku } from "./asn-transit.js";
import type { ReplenishWorkbookRow } from "./types.js";

/**
 * 人工排除 → 一律「不补货」。
 * N/A 为旧表报错残留，忽略不参与判定。
 */
const SKIP_TAGS = ["淘汰", "清仓", "暂时不补", "走线下", "不补"];

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 备货月数默认 3；合法范围 0.1–24，保留一位小数 */
export const DEFAULT_COVER_MONTHS = 3;

export function clampCoverMonths(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_COVER_MONTHS;
  const oneDecimal = Math.round(n * 10) / 10;
  if (oneDecimal < 0.1) return 0.1;
  if (oneDecimal > 24) return 24;
  return oneDecimal;
}

/** 建议补货数量：小数一律往上取整 */
export function ceilSuggestQty(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(0, Math.ceil(raw - 1e-9));
}

/** 需求库存 = 月均 × 备货月数 + 15 */
export function demandFromMonthlyAvg(
  monthlyAvg: number,
  coverMonths: number = DEFAULT_COVER_MONTHS,
): number {
  const months = clampCoverMonths(coverMonths);
  return round2(monthlyAvg * months + 15);
}

/** 标记/备注命中排除词 → 不补货（N/A 不算） */
export function isManualSkip(tag: string, note: string): boolean {
  const blob = `${tag} ${note}`.replace(/\bN\/A\b/gi, "").trim();
  if (!blob) return false;
  // 先匹配更长的「暂时不补」，再匹配「不补」，避免歧义依赖顺序时漏检
  return SKIP_TAGS.some((t) => blob.includes(t));
}

export function assignSalesRanks(
  rows: Array<{ monthlyAvg: number }>,
): Array<{ salesRank: number | null; salesWeight: number }> {
  const indexed = rows.map((r, i) => ({ i, avg: r.monthlyAvg }));
  const withSales = indexed.filter((x) => x.avg > 0);
  withSales.sort((a, b) => b.avg - a.avg || a.i - b.i);
  const n = withSales.length;
  const out: Array<{ salesRank: number | null; salesWeight: number }> =
    rows.map(() => ({ salesRank: null, salesWeight: 0 }));
  withSales.forEach((x, rank0) => {
    const rank = rank0 + 1;
    out[x.i] = {
      salesRank: rank,
      salesWeight: n > 0 ? round4((n - rank + 1) / n) : 0,
    };
  });
  return out;
}

export type ManualOverride = { manualTag: string; note: string };

export function buildWorkbookRows(opts: {
  state: AppState;
  shopPrefix: string;
  /** 备货月数（需求=月均×月数+15），默认 3 */
  coverMonths?: number;
  /** 已有表人工列，按 PSKU */
  manualBySku?: Map<string, ManualOverride>;
  transitBySku?: Map<string, AsnTransitSku>;
}): ReplenishWorkbookRow[] {
  const prefix = opts.shopPrefix.toUpperCase();
  const coverMonths = clampCoverMonths(opts.coverMonths);
  const assembled = getAssembledCatalogRows(opts.state);
  const transit =
    opts.transitBySku ?? loadAsnTransitBySku([prefix]);
  const manual = opts.manualBySku ?? new Map();

  type Draft = {
    partnerSku: string;
    title: string;
    salesD90: number;
    monthlyAvg: number;
    /** 可售 = FBN仓 + supermall */
    fbn: number;
    fbnWh: number;
    supermall: number;
    imageUrl: string;
    noonSku: string;
    manualTag: string;
    note: string;
  };

  const drafts: Draft[] = [];
  for (const row of assembled.rows) {
    const psku = (row.partnerSku || "").trim();
    if (!psku) continue;
    const p = shopPrefixFromPartnerSku(psku);
    if (p !== prefix) continue;

    const salesD90 = Number(row.sales.d90.units) || 0;
    const monthlyAvg = round4(salesD90 / 3);
    const m = manual.get(psku);
    // 可售口径：分仓 FBN + supermall（比 Catalog stock_fbn_net 更接近门户 Active Net）
    const inv = sumInventory(opts.state.stock ?? [], psku);
    const fbnWh = Number(inv.fbn) || 0;
    const supermall = Number(inv.supermall) || 0;
    drafts.push({
      partnerSku: psku,
      title: row.title || psku,
      salesD90,
      monthlyAvg,
      fbn: fbnWh + supermall,
      fbnWh,
      supermall,
      imageUrl: row.imageUrl || "",
      noonSku: row.noonSku || "",
      manualTag: m?.manualTag ?? "",
      note: m?.note ?? "",
    });
  }

  const ranks = assignSalesRanks(drafts);
  const out: ReplenishWorkbookRow[] = drafts.map((d, i) => {
    const t = transit.get(d.partnerSku);
    const inTransit = t?.qty ?? 0;
    const inTransitAir = t?.air ?? 0;
    const inTransitSea = t?.sea ?? 0;
    // 无近90日销量：不进补货（与旧表 #N/A 一致）；有销量才用 ×月数+15
    const demandQty =
      d.monthlyAvg > 0
        ? demandFromMonthlyAvg(d.monthlyAvg, coverMonths)
        : 0;
    // d.fbn 已是可售合计（FBN仓+supermall）；建议补小数往上取整
    const rawSuggest = demandQty - d.fbn - inTransit;
    const suggestQty =
      d.monthlyAvg > 0 ? ceilSuggestQty(rawSuggest) : 0;
    const skipped = isManualSkip(d.manualTag, d.note);
    const needReplenish = !skipped && suggestQty > 0;
    return {
      partnerSku: d.partnerSku,
      title: d.title,
      salesD90: d.salesD90,
      monthlyAvg: d.monthlyAvg,
      salesRank: ranks[i]?.salesRank ?? null,
      salesWeight: ranks[i]?.salesWeight ?? 0,
      demandQty,
      fbn: d.fbn,
      fbnWh: d.fbnWh,
      supermall: d.supermall,
      inTransit,
      inTransitAir,
      inTransitSea,
      shipModesLabel: t?.shipModesLabel ?? "",
      suggestQty,
      needReplenish,
      needReplenishLabel: needReplenish ? "补货" : "不补货",
      manualTag: d.manualTag,
      note: d.note,
      imageUrl: d.imageUrl,
      noonSku: d.noonSku,
    };
  });

  // 有销量的按排名，无销量靠后，同排名按建议补货降序
  out.sort((a, b) => {
    const ar = a.salesRank ?? 1e9;
    const br = b.salesRank ?? 1e9;
    if (ar !== br) return ar - br;
    if (b.suggestQty !== a.suggestQty) return b.suggestQty - a.suggestQty;
    return a.partnerSku.localeCompare(b.partnerSku);
  });
  return out;
}
