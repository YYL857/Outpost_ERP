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

  inventory: {
    fbn: number;
    fbp: number;
    inTransit: number;
    total: number;
  };

  sales: {
    d3: SalesWindow;
    d7: SalesWindow;
    d14: SalesWindow;
    d30: SalesWindow;
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
    freightMode: "air" | "sea";
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
  let hasData = false;

  for (const f of facts) {
    if (!adsSkuMatch(f.partnerSku, item)) continue;
    if (f.fromDate < start || f.toDate > end) continue;
    spend += f.spend;
    revenue += f.revenue;
    orders += f.orders;
    views += f.views;
    clicks += f.clicks;
    hasData = true;
  }

  return finalizeAdsMetrics(days, spend, revenue, orders, views, clicks, hasData);
}

/** 最近一次导入区间：按 toDate 最大，同区间跨活动 ΣSpend/ΣRevenue 再算 ROAS */
export function sumAdsLatest(
  facts: AdsFact[],
  item: Pick<CatalogItem, "partnerSku" | "noonSku">,
): AdsWindow & { fromDate: string | null; toDate: string | null } {
  const matched = facts.filter((f) => adsSkuMatch(f.partnerSku, item));
  if (!matched.length) {
    return { ...emptyAdsWindow(0), fromDate: null, toDate: null };
  }
  let maxTo = "";
  for (const f of matched) {
    if (f.toDate > maxTo) maxTo = f.toDate;
  }
  const onLatestTo = matched.filter((f) => f.toDate === maxTo);
  let maxFrom = "";
  for (const f of onLatestTo) {
    if (f.fromDate > maxFrom) maxFrom = f.fromDate;
  }
  // 优先同一 from+to；若多段止于同日，取 from 最大的那一段
  const band = onLatestTo.filter((f) => f.fromDate === maxFrom);
  let spend = 0;
  let revenue = 0;
  let orders = 0;
  let views = 0;
  let clicks = 0;
  for (const f of band) {
    spend += f.spend;
    revenue += f.revenue;
    orders += f.orders;
    views += f.views;
    clicks += f.clicks;
  }
  const days =
    maxFrom && maxTo
      ? Math.max(
          1,
          Math.round(
            (Date.parse(`${maxTo}T00:00:00Z`) - Date.parse(`${maxFrom}T00:00:00Z`)) /
              86400000,
          ) + 1,
        )
      : 0;
  return {
    ...finalizeAdsMetrics(days, spend, revenue, orders, views, clicks, true),
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

export function sumInventory(stock: StockItem[], partnerSku: string) {
  let fbn = 0;
  let fbp = 0;
  let inTransit = 0;
  let unknown = 0;
  for (const s of stock) {
    if (s.partnerSku !== partnerSku) continue;
    inTransit += s.inTransitQty;
    if (s.fulfillment === "fbn") fbn += s.qty;
    else if (s.fulfillment === "fbp") fbp += s.qty;
    else unknown += s.qty;
  }
  const total = fbn + fbp + unknown;
  return { fbn, fbp, inTransit, total, unknown };
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

/**
 * 费率表头程（RMB）：空运 = 计费重×单价；海运 = cbm×分档。
 * 海运缺体积但有计费重时，按空运单价兜底（避免头程静默为 0）。
 * 飞书 landed−采购头程不参与毛利（避免双计）。
 */
export function computeHeadhaulRmb(args: {
  preferAir: boolean;
  chargeableKg: number;
  volumeCm3: number;
  cargoType?: CargoType;
  shipping: ShippingConfig;
}): number {
  const airRate = args.shipping.airFreightRmbPerKg ?? 65;
  if (args.preferAir) {
    if (airRate <= EPS || args.chargeableKg <= EPS) return 0;
    return round2(args.chargeableKg * airRate);
  }
  const cbm = args.volumeCm3 / 1_000_000;
  const seaRate = seaRateRmbPerCbm(args.shipping, args.cargoType);
  if (seaRate > EPS && cbm > EPS) return round2(cbm * seaRate);
  // 缺 L×W×H：用计费重×空运单价兜底
  if (airRate > EPS && args.chargeableKg > EPS) {
    return round2(args.chargeableKg * airRate);
  }
  return 0;
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

  const d3 = sumSalesWindow(input.salesFacts, item.partnerSku, asOf, 3);
  const d7 = sumSalesWindow(input.salesFacts, item.partnerSku, asOf, 7);
  const d14 = sumSalesWindow(input.salesFacts, item.partnerSku, asOf, 14);
  const d30 = sumSalesWindow(input.salesFacts, item.partnerSku, asOf, 30);

  const adsD7 = sumAdsWindow(input.adsFacts, item, asOf, 7);
  const adsD14 = sumAdsWindow(input.adsFacts, item, asOf, 14);
  const adsD30 = sumAdsWindow(input.adsFacts, item, asOf, 30);
  const adsLatest = sumAdsLatest(input.adsFacts, item);

  const dailyAvg = d7.dailyAvg;
  const availableDays =
    dailyAvg > EPS ? round2((inv.fbn + inv.fbp) / dailyAvg) : null;

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
  const headhaulRmb = computeHeadhaulRmb({
    preferAir,
    chargeableKg: chargeable,
    volumeCm3,
    cargoType: input.localCost?.cargoType,
    shipping,
  });
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
    inventory: {
      fbn: inv.fbn,
      fbp: inv.fbp,
      inTransit: inv.inTransit,
      total: inv.total,
    },
    sales: { d3, d7, d14, d30 },
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
      /** 费率表头程（RMB） */
      headhaul: headhaulRmb,
      freightEst,
      freightMode: preferAir ? "air" : "sea",
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
    stockQty: inv.total,
  };
}

/** 从 AppState 切片拼装一行 */
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
    asOf?: Date;
  },
): AssembledCatalogRow {
  return assembleCatalogRow({
    item,
    stock: ctx.stock,
    salesFacts: ctx.salesFacts,
    adsFacts: ctx.adsFacts,
    fee: ctx.feeSnapshots.find((f) => f.partnerSku === item.partnerSku) ?? null,
    feeEstimate: pickFbnFeeEstimate(ctx.feeEstimates, item.partnerSku),
    localCost:
      ctx.skuLocalCosts.find((c) => c.partnerSku === item.partnerSku) ?? null,
    dims: pickDimsByPriority(ctx.skuDims, item.partnerSku),
    replenish:
      ctx.replenishConfigs.find((r) => r.partnerSku === item.partnerSku) ?? null,
    shipping: ctx.shipping,
    asOf: ctx.asOf,
  });
}
