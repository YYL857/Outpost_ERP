import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AdsFact } from "../../common/types.js";
import { parseAdsContent } from "../../platforms/noon/portal/parsers.js";
import { windowStartYmd } from "./dates.js";

export type AdsWindowMetrics = {
  spend: number;
  orders: number;
  revenue: number;
  roas: number;
  /** 如「7天未投放」「7天广告不亏」 */
  tag: string;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Prep 风格窗标签（不等价毛利盈亏阈值；LOCK：广告列可与 golden 分报）
 * - spend<=0 → 未投放
 * - spend>0 && orders<=0 && spend<0.5 → 无法判断
 * - spend>0 && orders<=0 → 有花费无订单
 * - ROAS>=1 → 广告不亏
 * - else → 广告亏损
 */
export function adsWindowTag(
  prefix: string,
  spend: number,
  orders: number,
  roas: number,
): string {
  if (spend <= 1e-9) return `${prefix}天未投放`;
  if (orders <= 0) {
    if (spend < 0.5) return `${prefix}天无法判断`;
    return `${prefix}天有花费无订单`;
  }
  if (roas >= 1) return `${prefix}天广告不亏`;
  return `${prefix}天广告亏损`;
}

/** 汇总列「广告亏损判断标签」——近似 Prep，不追求 1:1 */
export function adLossSummaryTag(tags: {
  tag7: string;
  tag15: string;
  tag30: string;
}): string {
  const all = [tags.tag7, tags.tag15, tags.tag30];
  if (all.every((t) => t.includes("未投放"))) return "未投放";
  if (tags.tag30.includes("广告亏损") || tags.tag15.includes("广告亏损")) {
    return tags.tag7.includes("广告亏损") ? "短期亏损" : "长期亏损";
  }
  if (all.some((t) => t.includes("有花费无订单"))) return "有花费无订单";
  if (all.some((t) => t.includes("广告不亏"))) return "广告健康";
  if (all.some((t) => t.includes("无法判断"))) return "低花费样本不足";
  return "";
}

type DayFact = {
  sku: string;
  day: string;
  spend: number;
  orders: number;
  revenue: number;
};

function loadDailyAdsFromPortal(importDir: string): DayFact[] {
  if (!existsSync(importDir)) return [];
  const names = readdirSync(importDir).filter(
    (n) => /^ads_sku_.*\.csv$/i.test(n) && !n.startsWith("."),
  );
  const out: DayFact[] = [];
  for (const name of names) {
    const m = name.match(
      /ads_sku_(20\d{2}-\d{2}-\d{2}).{0,3}(20\d{2}-\d{2}-\d{2})/i,
    );
    if (!m) continue;
    const from = m[1]!;
    const to = m[2]!;
    // 只吃单日文件（与 Prep 按下载日堆对齐的可复算切片）
    if (from !== to) continue;
    const filePath = join(importDir, name);
    try {
      const content = readFileSync(filePath, "utf8");
      const rows = parseAdsContent(content, "csv", {
        filename: name,
        asOf: new Date(`${from}T12:00:00Z`),
      });
      for (const r of rows) {
        out.push({
          sku: r.partner_sku,
          day: from,
          spend: r.spend,
          orders: r.orders,
          revenue: r.revenue,
        });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

function dayFactsFromState(adsFacts: AdsFact[]): DayFact[] {
  const out: DayFact[] = [];
  for (const f of adsFacts ?? []) {
    if (!f.fromDate || !f.toDate) continue;
    if (f.fromDate !== f.toDate) continue;
    out.push({
      sku: f.partnerSku,
      day: f.fromDate,
      spend: f.spend,
      orders: f.orders,
      revenue: f.revenue,
    });
  }
  return out;
}

/** state 单日多活动累加，再叠 portal 单日 CSV（portal 同日覆盖） */
export function collectDailyAdsFactsMerged(
  importDir: string,
  adsFacts: AdsFact[],
): DayFact[] {
  const byKey = new Map<string, DayFact>();

  const add = (f: DayFact, replace: boolean) => {
    const key = `${f.sku}|${f.day}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...f });
      return;
    }
    if (replace) {
      byKey.set(key, { ...f });
      return;
    }
    prev.spend = round2(prev.spend + f.spend);
    prev.orders += f.orders;
    prev.revenue = round2(prev.revenue + f.revenue);
  };

  // state：同日多活动累加
  for (const f of dayFactsFromState(adsFacts)) add(f, false);

  // portal：同文件内多活动先就地累加到临时
  const portalRaw = loadDailyAdsFromPortal(importDir);
  const portalMerged = new Map<string, DayFact>();
  for (const f of portalRaw) {
    const key = `${f.sku}|${f.day}`;
    const prev = portalMerged.get(key);
    if (!prev) portalMerged.set(key, { ...f });
    else {
      prev.spend = round2(prev.spend + f.spend);
      prev.orders += f.orders;
      prev.revenue = round2(prev.revenue + f.revenue);
    }
  }
  // portal 覆盖同日（权威切片）
  for (const f of portalMerged.values()) add(f, true);

  return [...byKey.values()];
}

export function rollupAdsWindows(
  days: DayFact[],
  asOf: string,
  windows: number[] = [7, 15, 30],
): Map<string, Record<number, AdsWindowMetrics>> {
  const out = new Map<string, Record<number, AdsWindowMetrics>>();

  for (const n of windows) {
    const from = windowStartYmd(asOf, n);
    const acc = new Map<string, { spend: number; orders: number; revenue: number }>();
    for (const d of days) {
      if (d.day < from || d.day > asOf) continue;
      const a = acc.get(d.sku) ?? { spend: 0, orders: 0, revenue: 0 };
      a.spend += d.spend;
      a.orders += d.orders;
      a.revenue += d.revenue;
      acc.set(d.sku, a);
    }
    for (const [sku, a] of acc) {
      const spend = round2(a.spend);
      const revenue = round2(a.revenue);
      const orders = a.orders;
      const roas = spend > 0 ? round2(revenue / spend) : 0;
      const prefix = String(n);
      const m: AdsWindowMetrics = {
        spend,
        orders,
        revenue,
        roas,
        tag: adsWindowTag(prefix, spend, orders, roas),
      };
      const row = out.get(sku) ?? {};
      row[n] = m;
      out.set(sku, row);
    }
  }

  // 无花费 SKU 不出现在 map；build 时填默认未投放
  return out;
}

export function emptyAdsWindow(prefix: string): AdsWindowMetrics {
  return {
    spend: 0,
    orders: 0,
    revenue: 0,
    roas: 0,
    tag: `${prefix}天未投放`,
  };
}

export function portalAdsCoverage(
  importDir: string,
  asOf: string,
  lastN: number,
): { daysPresent: string[]; daysMissing: string[] } {
  const from = windowStartYmd(asOf, lastN);
  const present = new Set<string>();
  if (existsSync(importDir)) {
    for (const name of readdirSync(importDir)) {
      const m = name.match(
        /ads_sku_(20\d{2}-\d{2}-\d{2}).{0,3}(20\d{2}-\d{2}-\d{2})/i,
      );
      if (!m || m[1] !== m[2]) continue;
      const day = m[1]!;
      if (day >= from && day <= asOf) present.add(day);
    }
  }
  const daysPresent = [...present].sort();
  const daysMissing: string[] = [];
  // 枚举窗内日
  let cur = from;
  while (cur <= asOf) {
    if (!present.has(cur)) daysMissing.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    dt.setUTCDate(dt.getUTCDate() + 1);
    cur = dt.toISOString().slice(0, 10);
  }
  return { daysPresent, daysMissing };
}

export function shopHasAdsFiles(importDir: string): boolean {
  if (!existsSync(importDir)) return false;
  try {
    return readdirSync(importDir).some((n) =>
      /^ads_sku_.*\.csv$/i.test(n),
    );
  } catch {
    return false;
  }
}

export function adsImportMtime(importDir: string): number {
  if (!existsSync(importDir)) return 0;
  let max = 0;
  try {
    for (const n of readdirSync(importDir)) {
      if (!/^ads_sku_.*\.csv$/i.test(n)) continue;
      try {
        max = Math.max(max, statSync(join(importDir, n)).mtimeMs);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
  return max;
}
