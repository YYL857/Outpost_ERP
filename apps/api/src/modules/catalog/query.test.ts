/**
 * Catalog 分页查询轻测：node --import tsx src/modules/catalog/query.test.ts
 */
import {
  clearCatalogAssembleCache,
  filterAndSortCatalogRows,
  parseCatalogListQuery,
} from "./query.js";
import type { AssembledCatalogRow } from "./assemble.js";

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

clearCatalogAssembleCache();

const parsed = parseCatalogListQuery({
  page: "2",
  pageSize: "25",
  q: "abc",
  onlyFbn: "1",
});
assertEq(parsed.page, 2, "page");
assertEq(parsed.pageSize, 25, "pageSize");
assertEq(parsed.q, "abc", "q");
assert(parsed.onlyFbn, "onlyFbn");
assert(!parsed.all, "all default false");

const allParsed = parseCatalogListQuery({ all: "1" });
assert(allParsed.all, "all=1");

const base = {
  noonSku: "",
  currency: "SAR",
  isActive: true,
  listingType: "fbn",
  source: "NOON" as const,
  updatedAt: "",
  priceUpdatedAt: "",
  priceSource: "noon:catalog" as const,
  activePrice: null,
  listPrice: null,
  inventory: { fbn: 0, fbp: 0, supermall: 0, inTransit: 0, total: 0 },
  sales: {
    d3: { days: 3, units: 0, amount: 0, dailyAvg: 0 },
    d7: { days: 7, units: 0, amount: 0, dailyAvg: 0 },
    d14: { days: 14, units: 0, amount: 0, dailyAvg: 0 },
    d30: { days: 30, units: 0, amount: 0, dailyAvg: 0 },
    d90: { days: 90, units: 0, amount: 0, dailyAvg: 0 },
  },
  ads: {
    d7: {
      days: 7,
      spend: 0,
      revenue: 0,
      orders: 0,
      views: 0,
      clicks: 0,
      atc: 0,
      roas: null,
      acos: null,
      hasData: false,
    },
    d14: {
      days: 14,
      spend: 0,
      revenue: 0,
      orders: 0,
      views: 0,
      clicks: 0,
      atc: 0,
      roas: null,
      acos: null,
      hasData: false,
    },
    d30: {
      days: 30,
      spend: 0,
      revenue: 0,
      orders: 0,
      views: 0,
      clicks: 0,
      atc: 0,
      roas: null,
      acos: null,
      hasData: false,
    },
    latest: {
      days: 1,
      spend: 0,
      revenue: 0,
      orders: 0,
      views: 0,
      clicks: 0,
      atc: 0,
      roas: null,
      acos: null,
      hasData: false,
      fromDate: null,
      toDate: null,
    },
  },
  replenish: {
    status: "unknown" as const,
    availableDays: null,
    safetyDays: 0,
    dailyAvg: 0,
    airLeadDays: 0,
    seaLeadDays: 0,
  },
  fees: {
    headhaul: 0,
    freightEst: 0,
    freightMode: "air" as const,
    shipQty: null,
    commissionRate: 0,
    commissionAmount: 0,
    taxAmount: 0,
    outboundFee: 0,
    total: 0,
  },
  profit: { margin: null, sar: null, rmb: null, afterPurchase: null, adsNet7d: null },
  specs: {
    weightKg: 0,
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0,
    volumetricWeightKg: 0,
    chargeableWeightKg: 0,
    purchaseCost: 0,
    volumeCm3: 0,
  },
  local: {
    hasCost: false,
    hasDims: false,
    costSource: null,
    dimsSource: null,
    costUpdatedAt: null,
    dimsUpdatedAt: null,
    normalizeRunId: null,
    align: "missing" as const,
  },
  stockQty: 0,
};

const rows = [
  {
    ...base,
    partnerSku: "A",
    title: "Alpha Coffee",
    imageUrl: "http://x/a.jpg",
    price: 10,
    inventory: { fbn: 5, fbp: 0, supermall: 0, inTransit: 0, total: 5 },
  },
  {
    ...base,
    partnerSku: "B",
    title: "B",
    imageUrl: "",
    price: 0,
    isActive: false,
  },
] as AssembledCatalogRow[];

const visible = filterAndSortCatalogRows(rows, {
  q: "",
  onlyFbn: false,
  onlyAds: false,
  onlyMissingLocal: false,
});
assertEq(visible.length, 1, "hide no-display by default");
assertEq(visible[0]?.partnerSku, "A", "keep displayable");

const searched = filterAndSortCatalogRows(rows, {
  q: "B",
  onlyFbn: false,
  onlyAds: false,
  onlyMissingLocal: false,
});
assertEq(searched.length, 1, "search recalls hidden");
assertEq(searched[0]?.partnerSku, "B", "search hit B");

const fbnOnly = filterAndSortCatalogRows(rows, {
  q: "",
  onlyFbn: true,
  onlyAds: false,
  onlyMissingLocal: false,
});
assertEq(fbnOnly.length, 1, "onlyFbn");

console.log("catalog query.test.ts OK");
