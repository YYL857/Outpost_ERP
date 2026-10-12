/**
 * Listing 优化按需复用：判断当前店 adsFacts 是否已覆盖「昨天」。
 * 主数据来自凌晨定时导出；仅缺昨日时才写影刀 pending。
 */
import type { AdsFact, AppState } from "../../common/types.js";

export type AdsFreshness = {
  /** YYYY-MM-DD（本地日历昨天） */
  yesterday: string;
  hasYesterday: boolean;
  /** 报表区间触及昨天的 fact 条数 */
  yesterdayFactCount: number;
  /** 全量 fact 条数 */
  factCount: number;
  /** 触及昨天的去重 SKU 数 */
  yesterdaySkuCount: number;
  latestFromDate: string | null;
  latestToDate: string | null;
};

/** 本地时区日历昨天（与影刀 yesterday 导出一致，按本机日界） */
export function localYesterdayIso(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function coversDay(f: AdsFact, day: string): boolean {
  return Boolean(f.fromDate && f.toDate && f.fromDate <= day && f.toDate >= day);
}

export function assessAdsFreshness(
  state: Pick<AppState, "adsFacts">,
  now = new Date(),
): AdsFreshness {
  const yesterday = localYesterdayIso(now);
  const facts = state.adsFacts ?? [];
  let latestFromDate: string | null = null;
  let latestToDate: string | null = null;
  const ySkus = new Set<string>();
  let yesterdayFactCount = 0;

  for (const f of facts) {
    if (!latestFromDate || f.fromDate < latestFromDate) latestFromDate = f.fromDate;
    if (!latestToDate || f.toDate > latestToDate) latestToDate = f.toDate;
    if (coversDay(f, yesterday)) {
      yesterdayFactCount += 1;
      if (f.partnerSku) ySkus.add(f.partnerSku);
    }
  }

  return {
    yesterday,
    hasYesterday: yesterdayFactCount > 0,
    yesterdayFactCount,
    factCount: facts.length,
    yesterdaySkuCount: ySkus.size,
    latestFromDate,
    latestToDate,
  };
}
