/**
 * 从已入库导出表（adsFacts / salesFacts / catalog）清洗出 Listing 优化用绩效包。
 * 含漏斗（浏览→点击→加购→订单）与店内中位基线。
 */
import type { AppState, CatalogItem } from "../../common/types.js";
import {
  sumAdsBundle,
  sumSalesWindows,
  type AdsWindow,
  type SalesWindow,
} from "../catalog/assemble.js";
import { adsFactsForItem, buildCatalogLookup } from "../catalog/lookup.js";
import type {
  ListingPerfBundle,
  PerfAdsWindow,
  PerfBaseline,
  PerfFunnel,
  PerfSalesWindow,
  PerfSignal,
} from "./optimize-types.js";

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) {
    return round4((s[mid - 1]! + s[mid]!) / 2);
  }
  return round4(s[mid]!);
}

function emptyAdsPerf(days: number): PerfAdsWindow {
  return {
    days,
    views: 0,
    clicks: 0,
    orders: 0,
    atc: 0,
    spend: 0,
    revenue: 0,
    ctr: null,
    cvr: null,
    atcRate: null,
    orderFromAtc: null,
    roas: null,
    acos: null,
    hasData: false,
    fromDate: null,
    toDate: null,
  };
}

function toAdsPerf(
  w: AdsWindow & { fromDate?: string | null; toDate?: string | null },
): PerfAdsWindow {
  const atc = w.atc ?? 0;
  const ctr = w.hasData && w.views > 0 ? round4(w.clicks / w.views) : null;
  const cvr = w.hasData && w.clicks > 0 ? round4(w.orders / w.clicks) : null;
  const atcRate = w.hasData && w.clicks > 0 ? round4(atc / w.clicks) : null;
  const orderFromAtc = w.hasData && atc > 0 ? round4(w.orders / atc) : null;
  return {
    days: w.days,
    views: w.views,
    clicks: w.clicks,
    orders: w.orders,
    atc,
    spend: w.spend,
    revenue: w.revenue,
    ctr,
    cvr,
    atcRate,
    orderFromAtc,
    roas: w.roas,
    acos: w.acos,
    hasData: w.hasData,
    fromDate: w.fromDate ?? null,
    toDate: w.toDate ?? null,
  };
}

function toSalesPerf(w: SalesWindow): PerfSalesWindow {
  return {
    days: w.days,
    units: w.units,
    amount: w.amount,
    dailyAvg: w.dailyAvg,
  };
}

function pickPrimary(
  ads: ListingPerfBundle["ads"],
): { key: PerfFunnel["primaryWindow"]; win: PerfAdsWindow } {
  if (ads.d14.hasData) return { key: "d14", win: ads.d14 };
  if (ads.d7.hasData) return { key: "d7", win: ads.d7 };
  if (ads.d30.hasData) return { key: "d30", win: ads.d30 };
  if (ads.latest.hasData) return { key: "latest", win: ads.latest };
  return { key: "d14", win: ads.d14 };
}

function buildFunnel(primary: PerfAdsWindow, key: PerfFunnel["primaryWindow"]): PerfFunnel {
  if (!primary.hasData) {
    return {
      primaryWindow: key,
      stage: "unknown",
      dropOff: "无广告窗口数据，无法判断漏斗断点",
    };
  }
  if (primary.views >= 200 && primary.clicks < 5) {
    return {
      primaryWindow: key,
      stage: "exposure",
      dropOff: "曝光后几乎无点击 → 优先主图/标题（CTR）",
    };
  }
  if (primary.clicks >= 20 && primary.atc < Math.max(2, primary.clicks * 0.03)) {
    return {
      primaryWindow: key,
      stage: "click",
      dropOff: "有点击、加购弱 → 优先价格/前几条卖点（ATC）",
    };
  }
  if (primary.atc >= 10 && primary.orders === 0) {
    return {
      primaryWindow: key,
      stage: "cart",
      dropOff: "有加购无成交 → 优先详情信任/规格/顾虑消除",
    };
  }
  if (primary.clicks >= 20 && primary.orders === 0) {
    return {
      primaryWindow: key,
      stage: "order",
      dropOff: "有点击无订单 → 卖点、价格与详情需加强",
    };
  }
  if (primary.cvr != null && primary.cvr < 0.02 && primary.clicks >= 20) {
    return {
      primaryWindow: key,
      stage: "order",
      dropOff: "CVR 偏低 → 强化差异卖点与信任信息",
    };
  }
  return {
    primaryWindow: key,
    stage: "ok",
    dropOff: "漏斗未出现明显硬断点；可做常规文案优化",
  };
}

export function computeShopBaseline(
  state: AppState,
  asOf: Date,
  focusSku: string,
): PerfBaseline {
  const empty: PerfBaseline = {
    shopCtrP50: null,
    shopCvrP50: null,
    shopAtcRateP50: null,
    skuCtrVsP50: null,
    skuCvrVsP50: null,
    skuAtcRateVsP50: null,
    sampleSkuCount: 0,
  };
  const lookup = buildCatalogLookup(state);
  const ctrs: number[] = [];
  const cvrs: number[] = [];
  const atcRates: number[] = [];
  let focus: { ctr: number | null; cvr: number | null; atcRate: number | null } = {
    ctr: null,
    cvr: null,
    atcRate: null,
  };

  for (const [sku, facts] of lookup.adsBySku) {
    const item = { partnerSku: sku, noonSku: sku };
    const bundle = sumAdsBundle(facts, item, asOf);
    const w = bundle.d14.hasData
      ? bundle.d14
      : bundle.d7.hasData
        ? bundle.d7
        : bundle.latest;
    if (!w.hasData) continue;
    if (w.views < 500 && w.clicks < 20) continue;
    const ctr = w.views > 0 ? w.clicks / w.views : null;
    const cvr = w.clicks > 0 ? w.orders / w.clicks : null;
    const atcRate = w.clicks > 0 ? (w.atc ?? 0) / w.clicks : null;
    if (ctr != null) ctrs.push(ctr);
    if (cvr != null) cvrs.push(cvr);
    if (atcRate != null) atcRates.push(atcRate);
    if (sku === focusSku) {
      focus = { ctr, cvr, atcRate };
    }
  }

  // focus 可能挂在 noonSku 桶上
  if (focus.ctr == null && focusSku) {
    const cat = state.catalog.find(
      (c) => c.partnerSku === focusSku || c.noonSku === focusSku,
    );
    if (cat) {
      const facts = adsFactsForItem(lookup.adsBySku, cat);
      const bundle = sumAdsBundle(facts, cat, asOf);
      const w = bundle.d14.hasData
        ? bundle.d14
        : bundle.d7.hasData
          ? bundle.d7
          : bundle.latest;
      if (w.hasData) {
        focus = {
          ctr: w.views > 0 ? w.clicks / w.views : null,
          cvr: w.clicks > 0 ? w.orders / w.clicks : null,
          atcRate: w.clicks > 0 ? (w.atc ?? 0) / w.clicks : null,
        };
      }
    }
  }

  const shopCtrP50 = median(ctrs);
  const shopCvrP50 = median(cvrs);
  const shopAtcRateP50 = median(atcRates);
  const ratio = (sku: number | null, p50: number | null) =>
    sku != null && p50 != null && p50 > 1e-9 ? round4(sku / p50) : null;

  return {
    shopCtrP50,
    shopCvrP50,
    shopAtcRateP50,
    skuCtrVsP50: ratio(focus.ctr, shopCtrP50),
    skuCvrVsP50: ratio(focus.cvr, shopCvrP50),
    skuAtcRateVsP50: ratio(focus.atcRate, shopAtcRateP50),
    sampleSkuCount: ctrs.length,
  };
}

function buildSignals(input: {
  ads: ListingPerfBundle["ads"];
  sales: ListingPerfBundle["sales"];
  baseline: PerfBaseline;
  funnel: PerfFunnel;
  primary: PerfAdsWindow;
}): { signals: PerfSignal[]; dataGaps: string[] } {
  const { ads, sales, baseline, funnel, primary } = input;
  const signals: PerfSignal[] = [];
  const dataGaps: string[] = [];

  if (!ads.d7.hasData && !ads.d14.hasData && !ads.d30.hasData && !ads.latest.hasData) {
    dataGaps.push("无广告导出（adsFacts）：无法算 CTR/ATC/CVR");
  }
  if (sales.d30.units <= 0 && sales.d14.units <= 0) {
    dataGaps.push("近 14/30 日销量事实为空或为 0");
  }
  if (baseline.sampleSkuCount < 5) {
    dataGaps.push(
      `店内可比样本不足（${baseline.sampleSkuCount} 个 SKU），相对基线仅供参考`,
    );
  }

  if (primary.hasData) {
    if (primary.clicks < 20 && primary.views < 500) {
      signals.push({
        code: "thin_sample",
        severity: "warn",
        message: "主窗口样本偏小（点击/浏览不足），诊断需降权",
      });
    }

    if (primary.views > 0 && primary.ctr != null && primary.ctr < 0.01) {
      signals.push({
        code: "low_ctr",
        severity: "danger",
        message: `主窗口 CTR ${(primary.ctr * 100).toFixed(2)}%，主图或标题吸引力可能不足`,
      });
    } else if (primary.views > 0 && primary.ctr != null && primary.ctr < 0.02) {
      signals.push({
        code: "mid_ctr",
        severity: "warn",
        message: `主窗口 CTR ${(primary.ctr * 100).toFixed(2)}%，仍有优化空间`,
      });
    }

    if (
      primary.clicks >= 20 &&
      primary.atcRate != null &&
      primary.atcRate < 0.05
    ) {
      signals.push({
        code: "low_atc",
        severity: "danger",
        message: `加购率 ${(primary.atcRate * 100).toFixed(2)}%（ATC/点击）偏低，卖点或价格可能劝退`,
      });
    }

    if (primary.atc >= 10 && primary.orders === 0) {
      signals.push({
        code: "atc_no_order",
        severity: "danger",
        message: "有加购无订单：优先改详情信任、规格与结账顾虑",
      });
    }

    if (primary.clicks >= 20 && primary.cvr != null && primary.cvr < 0.02) {
      signals.push({
        code: "low_cvr",
        severity: "danger",
        message: `主窗口 CVR ${(primary.cvr * 100).toFixed(2)}%（订单/点击），文案/卖点/价格可能拖转化`,
      });
    } else if (primary.clicks >= 10 && primary.cvr != null && primary.cvr < 0.04) {
      signals.push({
        code: "mid_cvr",
        severity: "warn",
        message: `主窗口 CVR ${(primary.cvr * 100).toFixed(2)}%，卖点清晰度可加强`,
      });
    }

    if (primary.views >= 200 && primary.clicks < 5) {
      signals.push({
        code: "views_no_clicks",
        severity: "danger",
        message: "有曝光几乎无点击：优先改主图/标题，而非长描述",
      });
    }

    if (primary.clicks >= 30 && primary.orders === 0) {
      signals.push({
        code: "clicks_no_orders",
        severity: "danger",
        message: "有点击无订单：优先改卖点、信任信息、价格与差异点",
      });
    }

    if (primary.acos != null && primary.acos > 0.45) {
      signals.push({
        code: "high_acos",
        severity: "warn",
        message: `ACOS ${(primary.acos * 100).toFixed(1)}% 偏高，Listing 转化弱时广告会更贵`,
      });
    }

    if (baseline.skuCtrVsP50 != null && baseline.skuCtrVsP50 < 0.7) {
      signals.push({
        code: "below_shop_ctr",
        severity: "warn",
        message: `CTR 约为店内中位的 ${(baseline.skuCtrVsP50 * 100).toFixed(0)}%，相对偏弱`,
      });
    }
    if (baseline.skuCvrVsP50 != null && baseline.skuCvrVsP50 < 0.7) {
      signals.push({
        code: "below_shop_cvr",
        severity: "warn",
        message: `CVR 约为店内中位的 ${(baseline.skuCvrVsP50 * 100).toFixed(0)}%，相对偏弱`,
      });
    }
  }

  if (funnel.stage !== "ok" && funnel.stage !== "unknown") {
    signals.push({
      code: `funnel_${funnel.stage}`,
      severity: "info",
      message: funnel.dropOff,
    });
  }

  if (sales.d7.units === 0 && sales.d30.units > 0) {
    signals.push({
      code: "sales_cooled",
      severity: "info",
      message: "近 7 日销量为 0，但 30 日仍有量：可能季节/库存/竞争变化",
    });
  }

  if (!signals.length && !dataGaps.length) {
    signals.push({
      code: "baseline_ok",
      severity: "info",
      message: "未触发硬阈值告警；仍可按文案与卖点做常规优化",
    });
  }

  return { signals, dataGaps };
}

function resolveCatalogItem(
  state: AppState,
  partnerSku: string,
  noonSku: string,
): CatalogItem | null {
  const ps = partnerSku.trim();
  const ns = noonSku.trim();
  if (ps) {
    const byPs = state.catalog.find((c) => c.partnerSku === ps);
    if (byPs) return byPs;
  }
  if (ns) {
    const byNs = state.catalog.find((c) => c.noonSku === ns);
    if (byNs) return byNs;
  }
  if (ps) {
    const byNsAsPs = state.catalog.find((c) => c.noonSku === ps);
    if (byNsAsPs) return byNsAsPs;
  }
  return null;
}

/** 从 Noon PDP URL 粗提可能的 SKU / zsku 片段 */
export function guessSkuFromListingUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return "";
  try {
    const path = new URL(u).pathname;
    const parts = path.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const m =
      last.match(/([A-Z0-9][A-Z0-9._-]{4,})/i) ||
      u.match(/\/([NZ][A-Z0-9]{6,})/i);
    return m?.[1]?.trim() || "";
  } catch {
    const m = u.match(/([A-Z0-9][A-Z0-9._-]{5,})/i);
    return m?.[1]?.trim() || "";
  }
}

function finalizeBundle(partial: {
  partnerSku: string;
  noonSku: string;
  catalogTitle: string;
  price: number | null;
  currency: string;
  isActive: boolean | null;
  asOf: string;
  ads: ListingPerfBundle["ads"];
  sales: ListingPerfBundle["sales"];
  baseline: PerfBaseline;
  sourceNote: string;
  extraGaps?: string[];
}): ListingPerfBundle {
  const { key, win } = pickPrimary(partial.ads);
  const funnel = buildFunnel(win, key);
  const { signals, dataGaps } = buildSignals({
    ads: partial.ads,
    sales: partial.sales,
    baseline: partial.baseline,
    funnel,
    primary: win,
  });
  for (const g of partial.extraGaps ?? []) {
    if (!dataGaps.includes(g)) dataGaps.unshift(g);
  }
  return {
    ...partial,
    funnel,
    signals,
    dataGaps,
  };
}

export function cleanListingPerfFromState(input: {
  state: AppState;
  partnerSku: string;
  noonSku?: string;
  asOf?: Date;
}): ListingPerfBundle {
  const asOf = input.asOf ?? new Date();
  const catalog = resolveCatalogItem(
    input.state,
    input.partnerSku,
    input.noonSku || "",
  );
  const partnerSku =
    catalog?.partnerSku || input.partnerSku.trim() || input.noonSku?.trim() || "";
  const noonSku = catalog?.noonSku || input.noonSku?.trim() || "";
  const item = {
    partnerSku: partnerSku || "UNKNOWN",
    noonSku: noonSku || partnerSku || "UNKNOWN",
  };

  const lookup = buildCatalogLookup(input.state);
  const salesFacts = lookup.salesBySku.get(item.partnerSku) ?? [];
  const adsFacts = adsFactsForItem(lookup.adsBySku, item);

  const salesRaw = sumSalesWindows(salesFacts, item.partnerSku, asOf);
  const adsRaw = sumAdsBundle(adsFacts, item, asOf);

  const ads = {
    d7: toAdsPerf(adsRaw.d7),
    d14: toAdsPerf(adsRaw.d14),
    d30: toAdsPerf(adsRaw.d30),
    latest: toAdsPerf(adsRaw.latest),
  };
  const sales = {
    d7: toSalesPerf(salesRaw.d7),
    d14: toSalesPerf(salesRaw.d14),
    d30: toSalesPerf(salesRaw.d30),
  };
  const baseline = computeShopBaseline(input.state, asOf, item.partnerSku);
  const extraGaps: string[] = [];
  if (!partnerSku) extraGaps.push("未提供可匹配的 partnerSku / noonSku");
  else if (!catalog) {
    extraGaps.push(`Catalog 未找到 SKU「${partnerSku}」，指标仅按事实表匹配`);
  }

  return finalizeBundle({
    partnerSku: partnerSku || "",
    noonSku: noonSku || "",
    catalogTitle: catalog?.title || "",
    price: catalog != null ? catalog.price : null,
    currency: catalog?.currency || "SAR",
    isActive: catalog != null ? catalog.isActive : null,
    asOf: asOf.toISOString(),
    ads,
    sales,
    baseline,
    sourceNote:
      "指标来自已同步广告导出（含 ATC）与销量事实；CTR=点击/浏览，ATC率=加购/点击，CVR=订单/点击；含店内中位对比。",
    extraGaps,
  });
}

/** 从粘贴/上传的简易 CSV 行覆盖广告窗口（可选） */
export function parseAdsMetricsCsv(content: string): {
  partnerSku: string;
  views: number;
  clicks: number;
  orders: number;
  atc: number;
  spend: number;
  revenue: number;
} | null {
  const text = String(content || "").trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const headers = lines[0]!.split(/[,;\t]/).map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => {
    const i = headers.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    return i;
  };
  const iSku = find("partner_sku", "partner sku", "sku", "psku");
  const iViews = find("views", "impressions", "浏览");
  const iClicks = find("clicks", "点击");
  const iOrders = find("orders", "conversions", "订单");
  const iAtc = find("atc", "add to cart", "加购");
  const iSpend = find("spend", "cost", "花费");
  const iRevenue = find("revenue", "sales", "收入", "gmv");
  if (iSku < 0) return null;

  let best: {
    partnerSku: string;
    views: number;
    clicks: number;
    orders: number;
    atc: number;
    spend: number;
    revenue: number;
  } | null = null;

  for (const line of lines.slice(1)) {
    const cols = line.split(/[,;\t]/).map((c) => c.trim());
    const sku = cols[iSku] || "";
    if (!sku || sku.toLowerCase() === "sku") continue;
    const num = (i: number) => {
      if (i < 0) return 0;
      const n = Number(String(cols[i] ?? "").replace(/[%$,]/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const row = {
      partnerSku: sku,
      views: Math.max(0, Math.floor(num(iViews))),
      clicks: Math.max(0, Math.floor(num(iClicks))),
      orders: Math.max(0, Math.floor(num(iOrders))),
      atc: Math.max(0, Math.floor(num(iAtc))),
      spend: Math.max(0, num(iSpend)),
      revenue: Math.max(0, num(iRevenue)),
    };
    if (!best || row.views + row.clicks > best.views + best.clicks) best = row;
  }
  return best;
}

export function applyCsvOverrideToBundle(
  bundle: ListingPerfBundle,
  csv: string,
): ListingPerfBundle {
  const parsed = parseAdsMetricsCsv(csv);
  if (!parsed) return bundle;
  const win = (days: number): PerfAdsWindow => {
    const ctr = parsed.views > 0 ? round4(parsed.clicks / parsed.views) : null;
    const cvr = parsed.clicks > 0 ? round4(parsed.orders / parsed.clicks) : null;
    const atcRate =
      parsed.clicks > 0 ? round4(parsed.atc / parsed.clicks) : null;
    const orderFromAtc =
      parsed.atc > 0 ? round4(parsed.orders / parsed.atc) : null;
    const roas =
      parsed.spend > 1e-6 ? round4(parsed.revenue / parsed.spend) : null;
    const acos =
      parsed.revenue > 1e-6 ? round4(parsed.spend / parsed.revenue) : null;
    return {
      days,
      views: parsed.views,
      clicks: parsed.clicks,
      orders: parsed.orders,
      atc: parsed.atc,
      spend: parsed.spend,
      revenue: parsed.revenue,
      ctr,
      cvr,
      atcRate,
      orderFromAtc,
      roas,
      acos,
      hasData: true,
      fromDate: null,
      toDate: null,
    };
  };
  const ads = {
    d7: win(7),
    d14: win(14),
    d30: win(30),
    latest: win(0),
  };
  return finalizeBundle({
    partnerSku: bundle.partnerSku || parsed.partnerSku,
    noonSku: bundle.noonSku,
    catalogTitle: bundle.catalogTitle,
    price: bundle.price,
    currency: bundle.currency,
    isActive: bundle.isActive,
    asOf: bundle.asOf,
    ads,
    sales: bundle.sales,
    baseline: bundle.baseline,
    sourceNote:
      "指标含用户上传/粘贴的广告 CSV 覆盖；CTR=点击/浏览，ATC率=加购/点击，CVR=订单/点击。",
  });
}

/** 测试/调试用：空窗口 */
export function emptyPerfAdsWindow(days = 14): PerfAdsWindow {
  return emptyAdsPerf(days);
}
