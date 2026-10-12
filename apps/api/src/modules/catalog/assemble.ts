import type {
  AdsFact,
  CargoType,
  CatalogItem,
  FeeEstimate,
  FeeSnapshot,
  ReplenishConfig,
  SalesFact,
  ShippingConfig,
  SkuDims,
  SkuLocalCost,
  StockItem,
} from "../../common/types.js";
import {
  adsFactsForItem,
  type CatalogLookup,
} from "./lookup.js";

const EPS = 1e-6;

export type SalesWindow = {
  days: number;
  units: number;
  /** 窗口 GMV（SalesFact.amount 汇总） */
  amount: number;
  dailyAvg: number;
};

export type AdsWindow = {
  days: number;
  spend: number;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
  /** Add to Cart 汇总 */
  atc: number;
  /** Revenue / Spend；无广告花费时 null（禁止用 0 冒充） */
  roas: number | null;
  /** Spend / Revenue；无广告收入时 null */
  acos: number | null;
  hasData: boolean;
};

export type AssembledCatalogRow = {
  partnerSku: string;
  noonSku: string;
  title: string;
  imageUrl: string;
  price: number;
  currency: string;
  isActive: boolean;
  listingType: string;
  source: "NOON";
  updatedAt: string;
  /** 官方 Catalog 售价时间戳（悬停核对用） */
  priceUpdatedAt: string;
  priceSource: "noon:catalog";
  /** Catalog Export active_price；没有活动价时为 null */
  activePrice: number | null;
  /** Catalog Export price 底价；无则 null */
  listPrice: number | null;

  inventory: {
    fbn: number;
    fbp: number;
    /** noon 官方 Supermall 仓存 */
    supermall: number;
    inTransit: number;
    total: number;
  };

  sales: {
    d3: SalesWindow;
    d7: SalesWindow;
    d14: SalesWindow;
    d30: SalesWindow;
    d90: SalesWindow;
  };

  /** 投产比等广告指标（引用 adsFacts，非 Catalog 主存） */
  ads: {
    d7: AdsWindow;
    d14: AdsWindow;
    d30: AdsWindow;
    /** 最近一次导入区间（跨活动 Σ） */
    latest: AdsWindow & {
      fromDate: string | null;
      toDate: string | null;
    };
  };

  replenish: {
    status: "urgent" | "stable" | "skip" | "unknown";
    availableDays: number | null;
    safetyDays: number;
    dailyAvg: number;
    airLeadDays: number;
    seaLeadDays: number;
  };

  fees: {
    headhaul: number;
    freightEst: number;
    /** 该货的默认补货方式，不参与头程金额 */
    freightMode: "air" | "sea";
    /** 装箱明细按运输方式汇总的件数；没有快照时为 null */
    shipQty: { air: number; sea: number; single: number } | null;
    /** 头程口径：actual=装箱实付 / quote=大纲估 / fallback=全局单方式 */
    headhaulBasis?: "actual" | "quote" | "fallback";
    headhaulConfidence?: "detailed" | "approx" | "actual" | "fallback";
    commissionRate: number;
    commissionAmount: number;
    taxAmount: number;
    outboundFee: number;
    total: number;
  };

  profit: {
    margin: number | null;
    /** 无费用/采购成本口径时为 null，避免显示「售价即 100% 毛利」 */
    sar: number | null;
    rmb: number | null;
    /** 扣采购成本后的单件毛利 */
    afterPurchase: number | null;
    /** 7 日广告归因净额 Revenue−Spend；无广告数据 null */
    adsNet7d: number | null;
  };

  specs: {
    weightKg: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    volumetricWeightKg: number;
    chargeableWeightKg: number;
    purchaseCost: number;
    volumeCm3: number;
  };

  /**
   * 本地域对齐与追溯（飞书等）。
   * joinKey 固定 partnerSku；平台域仍以 source=NOON 为准。
   */
  local: {
    hasCost: boolean;
    hasDims: boolean;
    costSource: string | null;
    dimsSource: string | null;
    costUpdatedAt: string | null;
    dimsUpdatedAt: string | null;
    normalizeRunId: string | null;
    /** matched=成本+尺寸都有；partial=缺一；missing=都无 */
    align: "matched" | "partial" | "missing";
  };

  /** 兼容旧前端字段 */
  stockQty: number;
};

export type AssembleInput = {
  item: CatalogItem;
  stock: StockItem[];
  salesFacts: SalesFact[];
  adsFacts: AdsFact[];
  fee: FeeSnapshot | null;
  /** Estimated Fees 补缺；仅在 TV 缺佣金/出仓时使用 */
  feeEstimate?: FeeEstimate | null;
  localCost: SkuLocalCost | null;
  dims: SkuDims | null;
  replenish: ReplenishConfig | null;
  shipping: ShippingConfig;
  /** 装箱明细件数；不参与头程金额 */
  shipQty?: { air: number; sea: number; single: number } | null;
  /**
   * 装箱/大纲双轨汇总的单位头程（RMB）；有则覆盖全局费率估算。
   */
  skuHeadhaul?: {
    unitHeadhaulRmb: number;
    basis: "actual" | "quote" | "fallback";
    confidence: "detailed" | "approx" | "actual" | "fallback";
  } | null;
  /** 窗口截止日，默认今天 UTC */
  asOf?: Date;
};

/** Transaction View 优先；Estimated Fees 仅补缺 */
export function mergeFeeWithEstimate(
  fee: FeeSnapshot | null,
  estimate: FeeEstimate | null | undefined,
): FeeSnapshot | null {
  if (!fee && !estimate) return null;
  if (!estimate) return fee;
  const estOutbound =
    estimate.outboundFee > EPS
      ? estimate.outboundFee
      : estimate.estimatedFeeTotal > EPS
        ? estimate.estimatedFeeTotal
        : 0;
  if (!fee) {
    return {
      partnerSku: estimate.partnerSku,
      commissionRate: estimate.commissionRate,
      outboundFee: estOutbound,
      taxAmount: 0,
      updatedAt: estimate.updatedAt,
    };
  }
  let commissionRate = fee.commissionRate;
  let outboundFee = fee.outboundFee;
  if (commissionRate <= EPS && estimate.commissionRate > EPS) {
    commissionRate = estimate.commissionRate;
  }
  if (outboundFee <= EPS && estOutbound > EPS) {
    outboundFee = estOutbound;
  }
  if (
    commissionRate <= EPS &&
    outboundFee <= EPS &&
    estimate.estimatedFeeTotal > EPS
  ) {
    outboundFee = estimate.estimatedFeeTotal;
  }
  return {
    ...fee,
    commissionRate,
    outboundFee,
  };
}

/** 飞书产品 > 装箱 > Noon FBN；同源取第一条有尺寸的 */
export function pickDimsByPriority(
  skuDims: SkuDims[],
  partnerSku: string,
): SkuDims | null {
  const rows = skuDims.filter((d) => d.partnerSku === partnerSku);
  if (!rows.length) return null;
  const rank = (source?: string): number => {
    if (!source) return 1;
    if (source.startsWith("feishu:product") || source === "feishu:test")
      return 3;
    if (source.startsWith("feishu:packing")) return 2;
    if (source.startsWith("noon:fbn")) return 1;
    return 1;
  };
  const hasDim = (d: SkuDims) =>
    d.lengthCm > 0 || d.widthCm > 0 || d.heightCm > 0 || d.weightKg > 0;
  const scored = rows
    .filter(hasDim)
    .sort((a, b) => rank(b.source) - rank(a.source));
  return scored[0] ?? rows[0] ?? null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, delta: number): Date {
  const x = new Date(date.getTime());
  x.setUTCDate(x.getUTCDate() + delta);
  return x;
}

function emptyAdsWindow(days: number): AdsWindow {
  return {
    days,
    spend: 0,
    revenue: 0,
    orders: 0,
    views: 0,
    clicks: 0,
    atc: 0,
    roas: null,
    acos: null,
    hasData: false,
  };
}

function finalizeAdsMetrics(
  days: number,
  spend: number,
  revenue: number,
  orders: number,
  views: number,
  clicks: number,
  atc: number,
  hasData: boolean,
): AdsWindow {
  const s = round2(spend);
  const r = round2(revenue);
  return {
    days,
    spend: s,
    revenue: r,
    orders,
    views,
    clicks,
    atc,
    roas: hasData && s > EPS ? round4(r / s) : null,
    acos: hasData && r > EPS ? round4(s / r) : null,
    hasData,
  };
}

export function sumSalesWindow(
  facts: SalesFact[],
  partnerSku: string,
  asOf: Date,
  days: number,
): SalesWindow {
  const end = toDateOnly(asOf);
  const start = toDateOnly(addDays(asOf, -(days - 1)));
  let units = 0;
  let amount = 0;
  for (const f of facts) {
    if (f.partnerSku !== partnerSku) continue;
    if (f.date < start || f.date > end) continue;
    units += f.units;
    amount += f.amount;
  }
  return {
    days,
    units,
    amount: round2(amount),
    dailyAvg: round2(units / days),
  };
}

/** 一次扫描累加 d3/d7/d14/d30/d90（facts 已按 SKU 分桶时可省略 partnerSku 过滤成本） */
export function sumSalesWindows(
  facts: SalesFact[],
  partnerSku: string,
  asOf: Date,
): {
  d3: SalesWindow;
  d7: SalesWindow;
  d14: SalesWindow;
  d30: SalesWindow;
  d90: SalesWindow;
} {
  const end = toDateOnly(asOf);
  const start3 = toDateOnly(addDays(asOf, -2));
  const start7 = toDateOnly(addDays(asOf, -6));
  const start14 = toDateOnly(addDays(asOf, -13));
  const start30 = toDateOnly(addDays(asOf, -29));
  const start90 = toDateOnly(addDays(asOf, -89));
  let u3 = 0;
  let a3 = 0;
  let u7 = 0;
  let a7 = 0;
  let u14 = 0;
  let a14 = 0;
  let u30 = 0;
  let a30 = 0;
  let u90 = 0;
  let a90 = 0;
  for (const f of facts) {
    if (f.partnerSku !== partnerSku) continue;
    if (f.date < start90 || f.date > end) continue;
    u90 += f.units;
    a90 += f.amount;
    if (f.date >= start30) {
      u30 += f.units;
      a30 += f.amount;
    }
    if (f.date >= start14) {
      u14 += f.units;
      a14 += f.amount;
    }
    if (f.date >= start7) {
      u7 += f.units;
      a7 += f.amount;
    }
    if (f.date >= start3) {
      u3 += f.units;
      a3 += f.amount;
    }
  }
  const win = (days: number, units: number, amount: number): SalesWindow => ({
    days,
    units,
    amount: round2(amount),
    dailyAvg: round2(units / days),
  });
  return {
    d3: win(3, u3, a3),
    d7: win(7, u7, a7),
    d14: win(14, u14, a14),
    d30: win(30, u30, a30),
    d90: win(90, u90, a90),
  };
}

/**
 * 广告窗口：只汇总完全落在 [start,end] 内的报表区间，避免半截区间造成脏投产比。
 * SKU 对齐：partnerSku 或 noonSku（Ads 报表 SKU 列可能是任一种）。
 */
export function sumAdsWindow(
  facts: AdsFact[],
  item: Pick<CatalogItem, "partnerSku" | "noonSku">,
  asOf: Date,
  days: number,
): AdsWindow {
  const end = toDateOnly(asOf);
  const start = toDateOnly(addDays(asOf, -(days - 1)));
  let spend = 0;
  let revenue = 0;
  let orders = 0;
  let views = 0;
  let clicks = 0;
  let atc = 0;
  let hasData = false;

  for (const f of facts) {
    if (!adsSkuMatch(f.partnerSku, item)) continue;
    if (f.fromDate < start || f.toDate > end) continue;
    spend += f.spend;
    revenue += f.revenue;
    orders += f.orders;
    views += f.views;
    clicks += f.clicks;
    atc += f.atc ?? 0;
    hasData = true;
  }

  return finalizeAdsMetrics(days, spend, revenue, orders, views, clicks, atc, hasData);
}

/** 一次扫描：d7/d14/d30 + latest（facts 宜已按 SKU 收窄） */
export function sumAdsBundle(
  facts: AdsFact[],
  item: Pick<CatalogItem, "partnerSku" | "noonSku">,
  asOf: Date,
): {
  d7: AdsWindow;
  d14: AdsWindow;
  d30: AdsWindow;
  latest: AdsWindow & { fromDate: string | null; toDate: string | null };
} {
  const end = toDateOnly(asOf);
  const start7 = toDateOnly(addDays(asOf, -6));
  const start14 = toDateOnly(addDays(asOf, -13));
  const start30 = toDateOnly(addDays(asOf, -29));

  let s7 = 0;
  let r7 = 0;
  let o7 = 0;
  let v7 = 0;
  let c7 = 0;
  let a7 = 0;
  let h7 = false;
  let s14 = 0;
  let r14 = 0;
  let o14 = 0;
  let v14 = 0;
  let c14 = 0;
  let a14 = 0;
  let h14 = false;
  let s30 = 0;
  let r30 = 0;
  let o30 = 0;
  let v30 = 0;
  let c30 = 0;
  let a30 = 0;
  let h30 = false;

  let maxTo = "";
  for (const f of facts) {
    if (!adsSkuMatch(f.partnerSku, item)) continue;
    if (f.toDate > maxTo) maxTo = f.toDate;
    if (f.fromDate < start30 || f.toDate > end) continue;
    const fatc = f.atc ?? 0;
    s30 += f.spend;
    r30 += f.revenue;
    o30 += f.orders;
    v30 += f.views;
    c30 += f.clicks;
    a30 += fatc;
    h30 = true;
    if (f.fromDate >= start14) {
      s14 += f.spend;
      r14 += f.revenue;
      o14 += f.orders;
      v14 += f.views;
      c14 += f.clicks;
      a14 += fatc;
      h14 = true;
    }
    if (f.fromDate >= start7) {
      s7 += f.spend;
      r7 += f.revenue;
      o7 += f.orders;
      v7 += f.views;
      c7 += f.clicks;
      a7 += fatc;
      h7 = true;
    }
  }

  let latest: AdsWindow & { fromDate: string | null; toDate: string | null };
  if (!maxTo) {
    latest = { ...emptyAdsWindow(0), fromDate: null, toDate: null };
  } else {
    let maxFrom = "";
    for (const f of facts) {
      if (!adsSkuMatch(f.partnerSku, item)) continue;
      if (f.toDate !== maxTo) continue;
      if (f.fromDate > maxFrom) maxFrom = f.fromDate;
    }
    let spend = 0;
    let revenue = 0;
    let orders = 0;
    let views = 0;
    let clicks = 0;
    let atc = 0;
    for (const f of facts) {
      if (!adsSkuMatch(f.partnerSku, item)) continue;
      if (f.toDate !== maxTo || f.fromDate !== maxFrom) continue;
      spend += f.spend;
      revenue += f.revenue;
      orders += f.orders;
      views += f.views;
      clicks += f.clicks;
      atc += f.atc ?? 0;
    }
    const days =
      maxFrom && maxTo
        ? Math.max(
            1,
            Math.round(
              (Date.parse(`${maxTo}T00:00:00Z`) -
                Date.parse(`${maxFrom}T00:00:00Z`)) /
                86400000,
            ) + 1,
          )
        : 0;
    latest = {
      ...finalizeAdsMetrics(days, spend, revenue, orders, views, clicks, atc, true),
      fromDate: maxFrom || null,
      toDate: maxTo || null,
    };
  }

  return {
    d7: finalizeAdsMetrics(7, s7, r7, o7, v7, c7, a7, h7),
    d14: finalizeAdsMetrics(14, s14, r14, o14, v14, c14, a14, h14),
    d30: finalizeAdsMetrics(30, s30, r30, o30, v30, c30, a30, h30),
    latest,
  };
}

/** 最近一次导入区间：按 toDate 最大，同区间跨活动 ΣSpend/ΣRevenue 再算 ROAS */
export function sumAdsLatest(
  facts: AdsFact[],
  item: Pick<CatalogItem, "partnerSku" | "noonSku">,
): AdsWindow & { fromDate: string | null; toDate: string | null } {
  let maxTo = "";
  for (const f of facts) {
    if (!adsSkuMatch(f.partnerSku, item)) continue;
    if (f.toDate > maxTo) maxTo = f.toDate;
  }
  if (!maxTo) {
    return { ...emptyAdsWindow(0), fromDate: null, toDate: null };
  }
  let maxFrom = "";
  for (const f of facts) {
    if (!adsSkuMatch(f.partnerSku, item)) continue;
    if (f.toDate !== maxTo) continue;
    if (f.fromDate > maxFrom) maxFrom = f.fromDate;
  }
  let spend = 0;
  let revenue = 0;
  let orders = 0;
  let views = 0;
  let clicks = 0;
  let atc = 0;
  for (const f of facts) {
    if (!adsSkuMatch(f.partnerSku, item)) continue;
    if (f.toDate !== maxTo || f.fromDate !== maxFrom) continue;
    spend += f.spend;
    revenue += f.revenue;
    orders += f.orders;
    views += f.views;
    clicks += f.clicks;
    atc += f.atc ?? 0;
  }
  const days =
    maxFrom && maxTo
      ? Math.max(
          1,
          Math.round(
            (Date.parse(`${maxTo}T00:00:00Z`) -
              Date.parse(`${maxFrom}T00:00:00Z`)) /
              86400000,
          ) + 1,
        )
      : 0;
  return {
    ...finalizeAdsMetrics(days, spend, revenue, orders, views, clicks, atc, true),
    fromDate: maxFrom || null,
    toDate: maxTo || null,
  };
}

function adsSkuMatch(
  factSku: string,
  item: Pick<CatalogItem, "partnerSku" | "noonSku">,
): boolean {
  if (factSku === item.partnerSku) return true;
  if (item.noonSku && factSku === item.noonSku) return true;
  return false;
}

/** Catalog 导出塞的汇总假仓（warehouseCode=FBN/FBP），有真分仓时不得再加进可售 */
function isCatalogHintWarehouse(warehouseCode: string | undefined | null): boolean {
  const w = String(warehouseCode ?? "").trim().toUpperCase();
  return w === "FBN" || w === "FBP";
}

export function sumInventory(stock: StockItem[], partnerSku: string) {
  const skuRows = stock.filter((s) => s.partnerSku === partnerSku);
  const hasRealLedger = skuRows.some(
    (s) =>
      !isCatalogHintWarehouse(s.warehouseCode) &&
      (s.fulfillment === "fbn" ||
        s.fulfillment === "supermall" ||
        s.fulfillment === "transit"),
  );
  const rows = hasRealLedger
    ? skuRows.filter((s) => !isCatalogHintWarehouse(s.warehouseCode))
    : skuRows;

  let fbn = 0;
  let fbp = 0;
  let supermall = 0;
  let inTransit = 0;
  let unknown = 0;
  for (const s of rows) {
    inTransit += s.inTransitQty;
    if (s.fulfillment === "fbn") fbn += s.qty;
    else if (s.fulfillment === "fbp") fbp += s.qty;
    else if (s.fulfillment === "supermall") supermall += s.qty;
    else if (s.fulfillment === "transit") inTransit += s.qty;
    else unknown += s.qty;
  }
  // 实际库存合计不含 supermall：FBN 见底链接会下架，超商有货也不算可售
  const total = fbn + fbp + unknown;
  return { fbn, fbp, supermall, inTransit, total, unknown };
}

function volumetricWeightKg(
  dims: SkuDims | null,
  divisor: number,
): number {
  if (!dims || divisor <= 0) return 0;
  const { lengthCm, widthCm, heightCm } = dims;
  if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) return 0;
  return round2((lengthCm * widthCm * heightCm) / divisor);
}

function seaRateRmbPerCbm(
  shipping: ShippingConfig,
  cargoType: CargoType | undefined,
): number {
  const kind = cargoType ?? "general";
  if (kind === "plug") return shipping.seaFreightRmbPerCbmPlug ?? 2200;
  if (kind === "builtin") return shipping.seaFreightRmbPerCbmBuiltin ?? 2400;
  return shipping.seaFreightRmbPerCbmGeneral ?? 1830;
}

function airHeadhaulRmb(chargeableKg: number, shipping: ShippingConfig): number {
  const airRate = shipping.airFreightRmbPerKg ?? 65;
  if (airRate <= EPS || chargeableKg <= EPS) return 0;
  return round2(chargeableKg * airRate);
}

function seaHeadhaulRmb(args: {
  volumeCm3: number;
  cargoType?: CargoType;
  shipping: ShippingConfig;
}): number {
  const cbm = args.volumeCm3 / 1_000_000;
  const seaRate = seaRateRmbPerCbm(args.shipping, args.cargoType);
  if (seaRate <= EPS || cbm <= EPS) return 0;
  return round2(cbm * seaRate);
}

/**
 * 单位头程（RMB）。
 * 1) 若有装箱双轨汇总 skuHeadhaulRmb → 直接用
 * 2) 否则按 preferAir 走单方式全局费率（不再 (空+海)/2）
 */
export function computeHeadhaulRmb(args: {
  chargeableKg: number;
  volumeCm3: number;
  cargoType?: CargoType;
  shipping: ShippingConfig;
  preferAir?: boolean;
  skuHeadhaulRmb?: number | null;
}): number {
  if (args.skuHeadhaulRmb != null && args.skuHeadhaulRmb > EPS) {
    return round2(args.skuHeadhaulRmb);
  }
  const preferAir = args.preferAir ?? true;
  if (preferAir) return airHeadhaulRmb(args.chargeableKg, args.shipping);
  return seaHeadhaulRmb(args);
}

/** Estimated Fees 仅取 FBN；FBP 无参考价值 */
export function pickFbnFeeEstimate(
  estimates: FeeEstimate[] | undefined,
  partnerSku: string,
): FeeEstimate | null {
  return (
    estimates?.find(
      (f) => f.partnerSku === partnerSku && f.fulfillment === "fbn",
    ) ?? null
  );
}

function replenishStatus(args: {
  skip: boolean;
  availableDays: number | null;
  safetyDays: number;
  urgentDays: number;
  dailyAvg: number;
}): AssembledCatalogRow["replenish"]["status"] {
  if (args.skip) return "skip";
  if (args.dailyAvg <= EPS) return "unknown";
  if (args.availableDays == null) return "unknown";
  if (args.availableDays <= args.urgentDays) return "urgent";
  if (args.availableDays <= args.safetyDays) return "urgent";
  return "stable";
}

/**
 * 确定性 Catalog 行拼装：同一输入 → 同一输出。
 */
export function assembleCatalogRow(input: AssembleInput): AssembledCatalogRow {
  const asOf = input.asOf ?? new Date();
  const { item, shipping } = input;
  const inv = sumInventory(input.stock, item.partnerSku);

  const sales = sumSalesWindows(input.salesFacts, item.partnerSku, asOf);
  const { d3, d7, d14, d30, d90 } = sales;

  const ads = sumAdsBundle(input.adsFacts, item, asOf);
  const adsD7 = ads.d7;
  const adsD14 = ads.d14;
  const adsD30 = ads.d30;
  const adsLatest = ads.latest;

  // Noon：FBN 见底链接会下架（超商有货也不救）→ 可卖天 / 实际库存只看 FBN
  // 优先 Catalog Export stock_fbn_net（= 门户 Active Net Stock），与后台一致；无则回退 Impex 分仓 ledger
  const catalogFbnNet =
    item.stockFbnNet != null && Number.isFinite(item.stockFbnNet)
      ? Math.max(0, Math.floor(Number(item.stockFbnNet)))
      : null;
  const fbn = catalogFbnNet ?? inv.fbn;
  // 日均：近三个月（d90）销量 / 90，比近 7 日更稳
  const dailyAvg = d90.dailyAvg;
  const availableDays =
    dailyAvg > EPS ? round2(fbn / dailyAvg) : null;

  const safetyDays = input.replenish?.safetyDays ?? 7;
  const urgentDays = input.replenish?.urgentDays ?? 2;
  const skip = input.replenish?.skip ?? false;

  const mergedFee = mergeFeeWithEstimate(
    input.fee,
    input.feeEstimate ?? null,
  );

  /** 采购按人民币；头程改用费率表（非飞书 landed 差） */
  const purchaseCost = input.localCost?.purchaseCost ?? 0;
  const fx = shipping.buybackRate;
  const purchaseSar =
    fx > EPS && purchaseCost > EPS ? round2(purchaseCost / fx) : 0;

  const commissionRate = mergedFee?.commissionRate ?? 0;
  const outboundFee = mergedFee?.outboundFee ?? 0;
  const commissionAmount = round2(item.price * commissionRate);
  /** 税费(SAR) = (出仓 + 佣金) × 0.15 */
  const platformBaseSar = round2(commissionAmount + outboundFee);
  const taxAmount =
    platformBaseSar > EPS ? round2(platformBaseSar * 0.15) : 0;
  /** 合计(SAR) = 佣金 + 税费 + 出仓（不含头程） */
  const feeTotal = round2(commissionAmount + taxAmount + outboundFee);

  const vol = volumetricWeightKg(input.dims, shipping.volumetricDivisor);
  const weightKg = input.dims?.weightKg ?? 0;
  const lengthCm = input.dims?.lengthCm ?? 0;
  const widthCm = input.dims?.widthCm ?? 0;
  const heightCm = input.dims?.heightCm ?? 0;
  const volumeCm3 =
    lengthCm > 0 && widthCm > 0 && heightCm > 0
      ? round2(lengthCm * widthCm * heightCm)
      : 0;
  const chargeable = Math.max(weightKg, vol);
  const preferAir = input.localCost?.preferAir ?? true;
  const skuHh = input.skuHeadhaul;
  const headhaulRmb = computeHeadhaulRmb({
    chargeableKg: chargeable,
    volumeCm3,
    cargoType: input.localCost?.cargoType,
    shipping,
    preferAir,
    skuHeadhaulRmb: skuHh?.unitHeadhaulRmb,
  });
  const headhaulBasis =
    skuHh && skuHh.unitHeadhaulRmb > EPS
      ? skuHh.basis
      : ("fallback" as const);
  const headhaulConfidence =
    skuHh && skuHh.unitHeadhaulRmb > EPS
      ? skuHh.confidence
      : ("fallback" as const);
  const headhaulSar =
    fx > EPS && headhaulRmb > EPS ? round2(headhaulRmb / fx) : 0;
  /** 旧 AED 运费估已废弃；头程统一走 RMB 费率 */
  const freightEst = 0;

  // 毛利 SAR = 售价 − (佣金+税费+出仓) − 头程SAR − 采购SAR
  const hasPlatformFees = feeTotal > EPS;
  const hasLocalSar = headhaulSar > EPS || purchaseSar > EPS;
  const hasCostBasis = hasPlatformFees || hasLocalSar;
  const profitSar = hasCostBasis
    ? round2(item.price - feeTotal - headhaulSar - purchaseSar)
    : null;
  const margin =
    hasCostBasis && item.price > EPS && profitSar != null
      ? round2(profitSar / item.price)
      : null;
  const profitRmb =
    profitSar != null && fx > EPS ? round2(profitSar * fx) : null;
  /** 与 profit.sar 同口径（已含扣采） */
  const afterPurchase = profitSar;
  const adsNet7d = adsD7.hasData
    ? round2(adsD7.revenue - adsD7.spend)
    : adsLatest.hasData
      ? round2(adsLatest.revenue - adsLatest.spend)
      : null;

  return {
    partnerSku: item.partnerSku,
    noonSku: item.noonSku,
    title: item.title,
    imageUrl: item.imageUrl,
    price: item.price,
    currency: item.currency,
    isActive: item.isActive,
    listingType: item.listingType,
    source: "NOON",
    updatedAt: item.updatedAt,
    priceUpdatedAt: item.updatedAt,
    priceSource: "noon:catalog",
    activePrice:
      item.activePrice != null && item.activePrice > 0 ? item.activePrice : null,
    listPrice: item.listPrice != null && item.listPrice > 0 ? item.listPrice : null,
    inventory: {
      fbn,
      fbp: inv.fbp,
      supermall: inv.supermall,
      inTransit: inv.inTransit,
      // total 仍按可售口径：Catalog/Ledger FBN + FBP（不含 supermall）
      total: fbn + inv.fbp + inv.unknown,
    },
    sales: { d3, d7, d14, d30, d90 },
    ads: {
      d7: adsD7,
      d14: adsD14,
      d30: adsD30,
      latest: adsLatest,
    },
    replenish: {
      status: replenishStatus({
        skip,
        availableDays,
        safetyDays,
        urgentDays,
        dailyAvg,
      }),
      availableDays,
      safetyDays,
      dailyAvg,
      airLeadDays: shipping.airLeadDays,
      seaLeadDays: shipping.seaLeadDays,
    },
    fees: {
      /** 装箱双轨单位头程，或 preferAir 单方式全局费率（RMB） */
      headhaul: headhaulRmb,
      freightEst,
      freightMode: preferAir ? "air" : "sea",
      shipQty: input.shipQty ?? null,
      headhaulBasis,
      headhaulConfidence,
      commissionRate,
      commissionAmount,
      taxAmount,
      outboundFee,
      total: feeTotal,
    },
    profit: {
      margin,
      sar: profitSar,
      rmb: profitRmb,
      afterPurchase,
      adsNet7d,
    },
    specs: {
      weightKg,
      lengthCm,
      widthCm,
      heightCm,
      volumetricWeightKg: vol,
      chargeableWeightKg: chargeable,
      purchaseCost,
      volumeCm3,
    },
    local: {
      hasCost: Boolean(input.localCost),
      hasDims: Boolean(input.dims),
      costSource: input.localCost?.source ?? null,
      dimsSource: input.dims?.source ?? null,
      costUpdatedAt: input.localCost?.updatedAt ?? null,
      dimsUpdatedAt: input.dims?.updatedAt ?? null,
      normalizeRunId:
        input.localCost?.normalizeRunId ??
        input.dims?.normalizeRunId ??
        null,
      align:
        input.localCost && input.dims
          ? "matched"
          : input.localCost || input.dims
            ? "partial"
            : "missing",
    },
    stockQty: fbn,
  };
}

/** 从 AppState 切片拼装一行；传入 lookup 时走按 SKU 分桶，避免全表 find */
export function assembleFromState(
  item: CatalogItem,
  ctx: {
    stock: StockItem[];
    salesFacts: SalesFact[];
    adsFacts: AdsFact[];
    feeSnapshots: FeeSnapshot[];
    feeEstimates?: FeeEstimate[];
    skuLocalCosts: SkuLocalCost[];
    skuDims: SkuDims[];
    replenishConfigs: ReplenishConfig[];
    shipping: ShippingConfig;
    shipQtyBySku?: ReadonlyMap<
      string,
      { air: number; sea: number; single: number }
    >;
    skuHeadhaulBySku?: ReadonlyMap<
      string,
      {
        unitHeadhaulRmb: number;
        basis: "actual" | "quote" | "fallback";
        confidence: "detailed" | "approx" | "actual" | "fallback";
      }
    >;
    lookup?: CatalogLookup;
    asOf?: Date;
  },
): AssembledCatalogRow {
  const sku = item.partnerSku;
  const lookup = ctx.lookup;
  return assembleCatalogRow({
    item,
    stock: lookup?.stockBySku.get(sku) ?? ctx.stock,
    salesFacts: lookup?.salesBySku.get(sku) ?? ctx.salesFacts,
    adsFacts: lookup
      ? adsFactsForItem(lookup.adsBySku, item)
      : ctx.adsFacts,
    fee:
      lookup?.feeBySku.get(sku) ??
      ctx.feeSnapshots.find((f) => f.partnerSku === sku) ??
      null,
    feeEstimate:
      lookup?.feeEstimateBySku.get(sku) ??
      pickFbnFeeEstimate(ctx.feeEstimates, sku),
    localCost:
      lookup?.costBySku.get(sku) ??
      ctx.skuLocalCosts.find((c) => c.partnerSku === sku) ??
      null,
    dims: pickDimsByPriority(
      lookup?.dimsBySku.get(sku) ?? ctx.skuDims,
      sku,
    ),
    replenish:
      lookup?.replenishBySku.get(sku) ??
      ctx.replenishConfigs.find((r) => r.partnerSku === sku) ??
      null,
    shipping: ctx.shipping,
    shipQty: ctx.shipQtyBySku?.get(sku) ?? null,
    skuHeadhaul: ctx.skuHeadhaulBySku?.get(sku) ?? null,
    asOf: ctx.asOf,
  });
}
