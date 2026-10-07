import type {
  CatalogItem,
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
  dailyAvg: number;
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
    sar: number;
    rmb: number | null;
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

  /** 兼容旧前端字段 */
  stockQty: number;
};

export type AssembleInput = {
  item: CatalogItem;
  stock: StockItem[];
  salesFacts: SalesFact[];
  fee: FeeSnapshot | null;
  localCost: SkuLocalCost | null;
  dims: SkuDims | null;
  replenish: ReplenishConfig | null;
  shipping: ShippingConfig;
  /** 窗口截止日，默认今天 UTC */
  asOf?: Date;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, delta: number): Date {
  const x = new Date(date.getTime());
  x.setUTCDate(x.getUTCDate() + delta);
  return x;
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
  for (const f of facts) {
    if (f.partnerSku !== partnerSku) continue;
    if (f.date < start || f.date > end) continue;
    units += f.units;
  }
  return {
    days,
    units,
    dailyAvg: round2(units / days),
  };
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
  // unknown 计入 total，但不强行归入 FBN/FBP
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

  const dailyAvg = d7.dailyAvg;
  const availableDays =
    dailyAvg > EPS ? round2((inv.fbn + inv.fbp) / dailyAvg) : null;

  const safetyDays = input.replenish?.safetyDays ?? 7;
  const urgentDays = input.replenish?.urgentDays ?? 2;
  const skip = input.replenish?.skip ?? false;

  const headhaul = input.localCost?.headhaul ?? 0;
  const purchaseCost = input.localCost?.purchaseCost ?? 0;
  const commissionRate = input.fee?.commissionRate ?? 0;
  const outboundFee = input.fee?.outboundFee ?? 0;
  const taxAmount = input.fee?.taxAmount ?? 0;
  const commissionAmount = round2(item.price * commissionRate);

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
  let freightEst = 0;
  if (preferAir && shipping.airFreightAedPerKg > 0 && chargeable > 0) {
    // 配置单位为 AED/kg；与售价币种可能不同，先按数值累加（费用配置阶段再统一换算）
    freightEst = round2(chargeable * shipping.airFreightAedPerKg);
  } else if (!preferAir && shipping.seaFreightAedPerCbm > 0 && input.dims) {
    const cbm = volumeCm3 / 1_000_000;
    freightEst = round2(Math.max(0, cbm) * shipping.seaFreightAedPerCbm);
  }

  const feeTotal = round2(
    headhaul + freightEst + commissionAmount + taxAmount + outboundFee,
  );
  const profitSar = round2(item.price - feeTotal);
  const margin =
    item.price > EPS ? round2(profitSar / item.price) : null;
  const profitRmb =
    shipping.buybackRate > EPS
      ? round2(profitSar * shipping.buybackRate)
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
    inventory: {
      fbn: inv.fbn,
      fbp: inv.fbp,
      inTransit: inv.inTransit,
      total: inv.total,
    },
    sales: { d3, d7, d14, d30 },
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
      headhaul,
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
    stockQty: inv.total,
  };
}

/** 从 AppState 切片拼装一行 */
export function assembleFromState(
  item: CatalogItem,
  ctx: {
    stock: StockItem[];
    salesFacts: SalesFact[];
    feeSnapshots: FeeSnapshot[];
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
    fee: ctx.feeSnapshots.find((f) => f.partnerSku === item.partnerSku) ?? null,
    localCost:
      ctx.skuLocalCosts.find((c) => c.partnerSku === item.partnerSku) ?? null,
    dims: ctx.skuDims.find((d) => d.partnerSku === item.partnerSku) ?? null,
    replenish:
      ctx.replenishConfigs.find((r) => r.partnerSku === item.partnerSku) ?? null,
    shipping: ctx.shipping,
    asOf: ctx.asOf,
  });
}
