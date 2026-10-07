/**
 * 轻量公式锁：node --import tsx src/modules/catalog/assemble.test.ts
 * 无测试框架依赖，失败 process.exit(1)。
 */
import {
  assembleCatalogRow,
  sumInventory,
  sumSalesWindow,
} from "./assemble.js";
import type {
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
  purchaseCost: 0,
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
  airFreightAedPerKg: 10,
  airLeadDays: 10,
  seaFreightAedPerCbm: 0,
  seaLeadDays: 60,
  buybackRate: 1.8,
  volumetricDivisor: 6000,
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const inv = sumInventory(stock, "N1-TEST");
assertEq(inv.fbn, 10, "fbn");
assertEq(inv.fbp, 5, "fbp");
assertEq(inv.inTransit, 2, "inTransit");
assertEq(inv.total, 15, "total");

const w7 = sumSalesWindow(salesFacts, "N1-TEST", asOf, 7);
assertEq(w7.units, 14, "7d units");
assertEq(w7.dailyAvg, 2, "7d avg");

const row1 = assembleCatalogRow({
  item,
  stock,
  salesFacts,
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
// vol = 20*15*10/6000 = 0.5; chargeable = max(1, 0.5) = 1; freight = 10
assertEq(row1.specs.volumetricWeightKg, 0.5, "vol weight");
assertEq(row1.fees.freightEst, 10, "freight");
assertEq(row1.fees.total, 10 + 10 + 15 + 2.6 + 7, "fee total");
assertEq(row1.profit.sar, 100 - row1.fees.total, "profit sar");
assert(row1.profit.rmb != null, "rmb set");
assertEq(row1.profit.rmb, Math.round(row1.profit.sar * 1.8 * 100) / 100, "rmb");
assertEq(row1.replenish.availableDays, 7.5, "available days 15/2");
assertEq(row1.replenish.status, "stable", "status stable");

const emptyFee = assembleCatalogRow({
  item,
  stock: [],
  salesFacts: [],
  fee: null,
  localCost: null,
  dims: null,
  replenish: null,
  shipping: { ...shipping, buybackRate: 0, airFreightAedPerKg: 0 },
  asOf,
});
assertEq(emptyFee.fees.total, 0, "no fees when empty");
assertEq(emptyFee.profit.rmb, null, "rmb null when rate 0");
assertEq(emptyFee.replenish.status, "unknown", "unknown when no sales");

console.log("assemble.test.ts OK");
