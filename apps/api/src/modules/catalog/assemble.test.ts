/**
 * 轻量公式锁：node --import tsx src/modules/catalog/assemble.test.ts
 * 无测试框架依赖，失败 process.exit(1)。
 */
import {
  assembleCatalogRow,
  computeHeadhaulRmb,
  pickFbnFeeEstimate,
  sumAdsLatest,
  sumAdsWindow,
  sumInventory,
  sumSalesWindow,
} from "./assemble.js";
import type {
  AdsFact,
  CatalogItem,
  FeeSnapshot,
  SalesFact,
  ShippingConfig,
  SkuDims,
  SkuLocalCost,
  StockItem,
} from "../../common/types.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) {
    console.error("FAIL:", msg, "got", a, "expected", b);
    process.exit(1);
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const asOf = new Date("2026-09-15T12:00:00.000Z");

const item: CatalogItem = {
  partnerSku: "N1-TEST",
  title: "Test",
  isActive: true,
  noonSku: "Z-1",
  imageUrl: "",
  price: 100,
  currency: "SAR",
  listingType: "自建",
  source: "NOON",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const stock: StockItem[] = [
  {
    partnerSku: "N1-TEST",
    warehouseCode: "WH1",
    fulfillment: "fbn",
    qty: 10,
    inTransitQty: 2,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  {
    partnerSku: "N1-TEST",
    warehouseCode: "WH2",
    fulfillment: "fbp",
    qty: 5,
    inTransitQty: 0,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
];

const salesFacts: SalesFact[] = [
  {
    partnerSku: "N1-TEST",
    date: "2026-09-14",
    units: 7,
    amount: 700,
    updatedAt: "2026-09-14T00:00:00.000Z",
  },
  {
    partnerSku: "N1-TEST",
    date: "2026-09-10",
    units: 7,
    amount: 700,
    updatedAt: "2026-09-10T00:00:00.000Z",
  },
];

const adsFacts: AdsFact[] = [
  {
    partnerSku: "N1-TEST",
    campaign: "A",
    fromDate: "2026-09-09",
    toDate: "2026-09-15",
    spend: 50,
    revenue: 200,
    orders: 3,
    views: 1000,
    clicks: 80,
    atc: 20,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  {
    partnerSku: "N1-TEST",
    campaign: "B",
    fromDate: "2026-09-09",
    toDate: "2026-09-15",
    spend: 50,
    revenue: 100,
    orders: 1,
    views: 500,
    clicks: 40,
    atc: 8,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  // 半截区间：不应计入 7 日窗口
  {
    partnerSku: "N1-TEST",
    campaign: "C",
    fromDate: "2026-09-01",
    toDate: "2026-09-15",
    spend: 999,
    revenue: 999,
    orders: 9,
    views: 9,
    clicks: 9,
    atc: 1,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
];

const fee: FeeSnapshot = {
  partnerSku: "N1-TEST",
  commissionRate: 0.15,
  outboundFee: 7,
  taxAmount: 2.6,
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const localCost: SkuLocalCost = {
  partnerSku: "N1-TEST",
  headhaul: 10,
  purchaseCost: 20,
  preferAir: true,
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const dims: SkuDims = {
  partnerSku: "N1-TEST",
  weightKg: 1,
  lengthCm: 20,
  widthCm: 15,
  heightCm: 10,
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const shipping: ShippingConfig = {
  airFreightAedPerKg: 0,
  airLeadDays: 10,
  seaFreightAedPerCbm: 0,
  seaLeadDays: 60,
  airFreightRmbPerKg: 65,
  seaFreightRmbPerCbmPlug: 2200,
  seaFreightRmbPerCbmBuiltin: 2400,
  seaFreightRmbPerCbmGeneral: 1830,
  buybackRate: 1.8,
  volumetricDivisor: 6000,
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const inv = sumInventory(stock, "N1-TEST");
assertEq(inv.fbn, 10, "fbn");
assertEq(inv.fbp, 5, "fbp");
assertEq(inv.inTransit, 2, "inTransit");
assertEq(inv.total, 15, "total");

// 有真分仓时，Catalog 假仓 FBN/FBP 不得再加进 FBN（否则还能卖天数虚高）
const invWithHint = sumInventory(
  [
    ...stock,
    {
      partnerSku: "N1-TEST",
      warehouseCode: "FBN",
      fulfillment: "fbn",
      qty: 14,
      inTransitQty: 0,
      updatedAt: "2026-09-15T00:00:00.000Z",
    },
  ],
  "N1-TEST",
);
assertEq(invWithHint.fbn, 10, "ignore catalog FBN hint when real ledger exists");
assertEq(invWithHint.total, 15, "hint not in total");

// 仅有假仓时仍可读（冷启动尚未拉 Detailed）
const hintOnly = sumInventory(
  [
    {
      partnerSku: "N1-HINT",
      warehouseCode: "FBN",
      fulfillment: "fbn",
      qty: 7,
      inTransitQty: 0,
      updatedAt: "2026-09-15T00:00:00.000Z",
    },
  ],
  "N1-HINT",
);
assertEq(hintOnly.fbn, 7, "hint-only still counts");

const w7 = sumSalesWindow(salesFacts, "N1-TEST", asOf, 7);
assertEq(w7.units, 14, "7d units");
assertEq(w7.amount, 1400, "7d amount");
assertEq(w7.dailyAvg, 2, "7d avg");

const ads7 = sumAdsWindow(adsFacts, item, asOf, 7);
assertEq(ads7.spend, 100, "7d ads spend (A+B, not C)");
assertEq(ads7.revenue, 300, "7d ads revenue");
assertEq(ads7.roas, 3, "7d roas 300/100");
assertEq(ads7.hasData, true, "7d hasData");

const latest = sumAdsLatest(adsFacts, item);
assertEq(latest.spend, 100, "latest spend A+B same band");
assertEq(latest.roas, 3, "latest roas");

// 计费重 1kg ×65（preferAir 默认空运单方式，不再与海运取平均）
assertEq(
  computeHeadhaulRmb({
    chargeableKg: 1,
    volumeCm3: 3000,
    shipping,
  }),
  65,
  "air-only headhaul 1kg×65",
);
assertEq(
  computeHeadhaulRmb({
    chargeableKg: 1,
    volumeCm3: 1_000_000,
    cargoType: "general",
    shipping,
    preferAir: false,
  }),
  1830,
  "sea-only general 1cbm×1830",
);
assertEq(
  computeHeadhaulRmb({
    chargeableKg: 1,
    volumeCm3: 1_000_000,
    cargoType: "plug",
    shipping,
    preferAir: false,
  }),
  2200,
  "sea-only plug 1cbm×2200",
);
assertEq(
  computeHeadhaulRmb({
    chargeableKg: 1,
    volumeCm3: 1_000_000,
    cargoType: "builtin",
    shipping,
    preferAir: false,
  }),
  2400,
  "sea-only builtin 1cbm×2400",
);
assertEq(
  computeHeadhaulRmb({
    chargeableKg: 0.1,
    volumeCm3: 0,
    shipping,
  }),
  6.5,
  "air 0.1kg×65",
);
assertEq(
  computeHeadhaulRmb({
    chargeableKg: 1,
    volumeCm3: 3000,
    shipping,
    skuHeadhaulRmb: 12.5,
  }),
  12.5,
  "sku packing override wins",
);

const row1 = assembleCatalogRow({
  item,
  stock,
  salesFacts,
  adsFacts,
  fee,
  localCost,
  dims,
  replenish: {
    partnerSku: "N1-TEST",
    safetyDays: 7,
    urgentDays: 2,
    skip: false,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  shipping,
  asOf,
});

const row2 = assembleCatalogRow({
  item,
  stock,
  salesFacts,
  adsFacts,
  fee,
  localCost,
  dims,
  replenish: {
    partnerSku: "N1-TEST",
    safetyDays: 7,
    urgentDays: 2,
    skip: false,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  shipping,
  asOf,
});

assertEq(JSON.stringify(row1), JSON.stringify(row2), "deterministic");

assertEq(row1.fees.commissionAmount, 15, "commission 15%");
assertEq(row1.specs.volumetricWeightKg, 0.5, "vol weight");
assertEq(row1.specs.chargeableWeightKg, 1, "chargeable MAX");
assertEq(row1.fees.freightEst, 0, "freightEst deprecated");
// 飞书头程 10 忽略；空运单方式 1kg×65；purchase 20 CNY / 1.8
const headhaulRmb = 65;
const seaHeadhaulRmb = 5.49; // 0.003 cbm × 1830
const headhaulSar = round2(headhaulRmb / 1.8);
const purchaseSar = round2(20 / 1.8);
const taxOnly = round2((15 + 7) * 0.15);
const feeTotal = round2(15 + taxOnly + 7);
assertEq(row1.fees.headhaul, headhaulRmb, "headhaul from air rate RMB");
assertEq(row1.fees.freightMode, "air", "mode follows product preferAir");
assertEq(row1.fees.headhaulBasis, "fallback", "no packing summary → fallback");
const seaMode = assembleCatalogRow({
  item,
  stock,
  salesFacts,
  adsFacts,
  fee,
  localCost: { ...localCost, preferAir: false },
  dims,
  replenish: {
    partnerSku: "N1-TEST",
    safetyDays: 7,
    urgentDays: 2,
    skip: false,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  shipping,
  asOf,
});
assertEq(seaMode.fees.freightMode, "sea", "sea product mode");
assertEq(seaMode.fees.headhaul, seaHeadhaulRmb, "sea mode uses cbm×sea rate");
assertEq(
  assembleCatalogRow({
    item,
    stock: [],
    salesFacts: [],
    adsFacts: [],
    fee: null,
    localCost,
    dims,
    replenish: null,
    shipping,
    skuHeadhaul: {
      unitHeadhaulRmb: 8.8,
      basis: "actual",
      confidence: "actual",
    },
    asOf,
  }).fees.headhaul,
  8.8,
  "packing actual override in assemble",
);
assertEq(row1.fees.taxAmount, taxOnly, "tax = (comm+outbound)*0.15");
assertEq(row1.fees.total, feeTotal, "fee total = comm + tax + outbound");
assertEq(
  row1.profit.sar,
  round2(100 - feeTotal - headhaulSar - purchaseSar),
  "profit sar: platform fees + rate headhaul + purchase",
);
assert(row1.profit.rmb != null, "rmb set");
assertEq(row1.profit.rmb, Math.round(row1.profit.sar! * 1.8 * 100) / 100, "rmb");
assertEq(row1.profit.afterPurchase, row1.profit.sar, "afterPurchase == sar");
assertEq(row1.priceSource, "noon:catalog", "priceSource");
assertEq(row1.priceUpdatedAt, item.updatedAt, "priceUpdatedAt");
assertEq(row1.activePrice, null, "no activity price");
assertEq(row1.listPrice, null, "no list price");
assertEq(
  row1.profit.margin,
  round2(row1.profit.sar! / 100),
  "margin uses net after purchase",
);
assertEq(row1.profit.adsNet7d, 200, "ads net 300-100");
assertEq(row1.ads.d7.roas, 3, "assembled roas");
// d90: 14 units / 90 → dailyAvg round2 = 0.16；FBN 10 / 0.16 = 62.5（不含 supermall/fbp）
assertEq(row1.replenish.dailyAvg, round2(14 / 90), "replenish dailyAvg uses d90");
assertEq(
  row1.replenish.availableDays,
  round2(10 / round2(14 / 90)),
  "available days = FBN / d90 dailyAvg (ignore supermall)",
);
assertEq(row1.replenish.status, "stable", "status stable when days > safety");

// 超商有货、FBN 为空 → 可卖天 0（链接会下架）
const fbnEmpty = assembleCatalogRow({
  item,
  stock: [
    {
      partnerSku: "N1-TEST",
      warehouseCode: "RUHMS01",
      fulfillment: "supermall",
      qty: 50,
      inTransitQty: 0,
      updatedAt: "2026-09-15T00:00:00.000Z",
    },
  ],
  salesFacts,
  adsFacts: [],
  fee: null,
  localCost: null,
  dims: null,
  replenish: { partnerSku: "N1-TEST", safetyDays: 7, urgentDays: 2, skip: false },
  shipping,
  asOf,
});
assertEq(fbnEmpty.inventory.fbn, 0, "fbn empty");
assertEq(fbnEmpty.inventory.supermall, 50, "supermall still counted in inventory col");
assertEq(fbnEmpty.inventory.total, 0, "total excludes supermall");
assertEq(fbnEmpty.stockQty, 0, "stockQty = FBN only");
assertEq(fbnEmpty.replenish.availableDays, 0, "FBN=0 → 0 days even if supermall>0");
assertEq(fbnEmpty.replenish.status, "urgent", "FBN empty → urgent");

// 仅有采购、无回购汇率：无法把 CNY 换成 SAR，不展示伪毛利
const purchaseOnly = assembleCatalogRow({
  item,
  stock: [],
  salesFacts: [],
  adsFacts: [],
  fee: null,
  localCost: {
    partnerSku: "N1-TEST",
    purchaseCost: 40,
    headhaul: 0,
    preferAir: true,
    updatedAt: "2026-09-15T00:00:00.000Z",
    source: "test",
  },
  dims: null,
  replenish: null,
  shipping: { ...shipping, buybackRate: 0, airFreightRmbPerKg: 0 },
  asOf,
});
assertEq(purchaseOnly.profit.sar, null, "no FX → no fake SAR profit");
assertEq(purchaseOnly.profit.margin, null, "no FX → no fake margin");

// 有平台费 + 有采购但无汇率：仍出 SAR 毛利（只扣 SAR 平台税费，不扣未换算的人民币）
const feeNoFx = assembleCatalogRow({
  item,
  stock: [],
  salesFacts: [],
  adsFacts: [],
  fee: {
    partnerSku: "N1-TEST",
    commissionRate: 0.1,
    outboundFee: 5,
    taxAmount: 0,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  localCost: {
    partnerSku: "N1-TEST",
    purchaseCost: 40,
    headhaul: 10,
    preferAir: true,
    updatedAt: "2026-09-15T00:00:00.000Z",
    source: "test",
  },
  dims: null,
  replenish: null,
  shipping: { ...shipping, buybackRate: 0, airFreightRmbPerKg: 0 },
  asOf,
});
assertEq(feeNoFx.fees.taxAmount, 2.25, "(10+5)*0.15");
assertEq(feeNoFx.fees.total, 17.25, "10+2.25+5");
assertEq(feeNoFx.profit.sar, 82.75, "100-17.25; CNY not deducted without FX");
assertEq(feeNoFx.profit.rmb, null, "no FX → no RMB");
assertEq(feeNoFx.fees.headhaul, 0, "no dims/rate → headhaul 0");
assertEq(feeNoFx.fees.commissionAmount, 10, "commission still shown");

// 采购 CNY + 回购汇率：按 /buybackRate 扣减
const purchaseFx = assembleCatalogRow({
  item,
  stock: [],
  salesFacts: [],
  adsFacts: [],
  fee: null,
  localCost: {
    partnerSku: "N1-TEST",
    purchaseCost: 36,
    headhaul: 0,
    preferAir: true,
    updatedAt: "2026-09-15T00:00:00.000Z",
    source: "test",
  },
  dims: null,
  replenish: null,
  shipping: { ...shipping, buybackRate: 1.8, airFreightRmbPerKg: 0 },
  asOf,
});
assertEq(purchaseFx.profit.sar, 80, "36 CNY / 1.8 = 20 SAR; 100-20=80");
assertEq(purchaseFx.profit.margin, 0.8, "margin 80%");
assertEq(purchaseFx.specs.purchaseCost, 36, "purchase stays CNY in specs");

// TV 缺出仓时用 Estimated Fees 补缺
const withEstimate = assembleCatalogRow({
  item,
  stock: [],
  salesFacts: [],
  adsFacts: [],
  fee: {
    partnerSku: "N1-TEST",
    commissionRate: 0.1,
    outboundFee: 0,
    taxAmount: 0,
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  feeEstimate: {
    partnerSku: "N1-TEST",
    commissionRate: 0,
    outboundFee: 0,
    estimatedFeeTotal: 22.58,
    fulfillment: "fbn",
    updatedAt: "2026-09-15T00:00:00.000Z",
    source: "test",
  },
  localCost: null,
  dims: null,
  replenish: null,
  shipping: { ...shipping, buybackRate: 0, airFreightRmbPerKg: 0 },
  asOf,
});
assertEq(withEstimate.fees.commissionRate, 0.1, "TV commission kept");
assertEq(withEstimate.fees.outboundFee, 22.58, "estimate fills outbound");
assertEq(withEstimate.fees.commissionAmount, 10, "commission amount");

assertEq(
  pickFbnFeeEstimate(
    [
      {
        partnerSku: "N1-TEST",
        commissionRate: 0,
        outboundFee: 9,
        estimatedFeeTotal: 9,
        fulfillment: "fbp",
        updatedAt: "2026-09-15T00:00:00.000Z",
      },
      {
        partnerSku: "N1-TEST",
        commissionRate: 0,
        outboundFee: 8,
        estimatedFeeTotal: 8,
        fulfillment: "fbn",
        updatedAt: "2026-09-15T00:00:00.000Z",
      },
    ],
    "N1-TEST",
  )?.outboundFee,
  8,
  "pick FBN only",
);

const emptyFee = assembleCatalogRow({
  item,
  stock: [],
  salesFacts: [],
  adsFacts: [],
  fee: null,
  localCost: null,
  dims: null,
  replenish: null,
  shipping: { ...shipping, buybackRate: 0, airFreightRmbPerKg: 0 },
  asOf,
});
assertEq(emptyFee.fees.total, 0, "no fees when empty");
assertEq(emptyFee.profit.margin, null, "margin null without cost basis");
assertEq(emptyFee.profit.sar, null, "sar null without cost basis");
assertEq(emptyFee.profit.rmb, null, "rmb null when rate 0");
assertEq(emptyFee.profit.afterPurchase, null, "afterPurchase null");
assertEq(emptyFee.replenish.status, "unknown", "unknown when no sales");
assertEq(emptyFee.ads.d7.hasData, false, "no ads");
assertEq(emptyFee.ads.d7.roas, null, "roas null not zero");
assertEq(emptyFee.profit.adsNet7d, null, "adsNet null");

console.log("assemble.test.ts OK");
