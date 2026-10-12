/**
 * optimize-metrics 自检：tsx src/modules/listing/optimize-metrics.test.ts
 */
import assert from "node:assert/strict";
import type { AdsFact, CatalogItem, SalesFact } from "../../common/types.js";
import {
  applyCsvOverrideToBundle,
  cleanListingPerfFromState,
  computeShopBaseline,
  guessSkuFromListingUrl,
  parseAdsMetricsCsv,
} from "./optimize-metrics.js";

assert.equal(
  guessSkuFromListingUrl("https://www.noon.com/saudi-en/foo-bar/N12345678A/p/"),
  "N12345678A",
);

const csv = parseAdsMetricsCsv(
  "sku,views,clicks,orders,atc,spend,revenue\nSKU-A,1000,50,2,8,40,120\n",
);
assert.ok(csv);
assert.equal(csv!.partnerSku, "SKU-A");
assert.equal(csv!.atc, 8);

const catalog: CatalogItem[] = [
  {
    partnerSku: "SKU-A",
    noonSku: "N123",
    title: "Sample",
    isActive: true,
    imageUrl: "",
    price: 99,
    currency: "SAR",
    listingType: "自建",
    source: "NOON",
    updatedAt: "2026-09-20T00:00:00.000Z",
  },
  {
    partnerSku: "SKU-B",
    noonSku: "N456",
    title: "Peer",
    isActive: true,
    imageUrl: "",
    price: 80,
    currency: "SAR",
    listingType: "自建",
    source: "NOON",
    updatedAt: "2026-09-20T00:00:00.000Z",
  },
];

function fact(
  sku: string,
  views: number,
  clicks: number,
  orders: number,
  atc: number,
): AdsFact {
  return {
    partnerSku: sku,
    campaign: "PLA",
    fromDate: "2026-09-07",
    toDate: "2026-09-20",
    spend: 40,
    revenue: 120,
    orders,
    views,
    clicks,
    atc,
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}

const adsFacts: AdsFact[] = [
  fact("SKU-A", 2000, 10, 0, 1), // 低 CTR
  fact("SKU-B", 2000, 80, 4, 20),
  fact("SKU-C", 1500, 60, 3, 15),
  fact("SKU-D", 1800, 70, 3, 18),
  fact("SKU-E", 1600, 65, 3, 16),
  fact("SKU-F", 1700, 68, 3, 17),
];

const salesFacts: SalesFact[] = [
  {
    partnerSku: "SKU-A",
    date: "2026-09-18",
    units: 3,
    amount: 297,
    updatedAt: "2026-09-20T00:00:00.000Z",
  },
];

const state = {
  catalog,
  adsFacts,
  salesFacts,
  stock: [],
  skuDims: [],
  skuLocalCosts: [],
  feeSnapshots: [],
  feeEstimates: [],
  replenishConfigs: [],
} as Parameters<typeof cleanListingPerfFromState>[0]["state"];

const asOf = new Date("2026-09-20T12:00:00.000Z");
const baseline = computeShopBaseline(state, asOf, "SKU-A");
assert.ok(baseline.sampleSkuCount >= 5);
assert.ok(baseline.shopCtrP50 != null);
assert.ok(baseline.skuCtrVsP50 != null);
assert.ok(baseline.skuCtrVsP50! < 1);

const bundle = cleanListingPerfFromState({
  state,
  partnerSku: "SKU-A",
  asOf,
});
assert.equal(bundle.partnerSku, "SKU-A");
assert.ok(bundle.ads.latest.hasData || bundle.ads.d14.hasData);
assert.ok(bundle.funnel.stage === "exposure" || bundle.signals.some((s) => s.code === "low_ctr" || s.code === "views_no_clicks" || s.code === "funnel_exposure"));
assert.ok(bundle.baseline.sampleSkuCount >= 5);
assert.ok(bundle.ads.d14.atc != null || bundle.ads.latest.atc != null);

const overridden = applyCsvOverrideToBundle(
  bundle,
  "sku,views,clicks,orders,atc,spend,revenue\nSKU-A,500,40,0,1,10,0\n",
);
assert.equal(overridden.ads.d14.views, 500);
assert.equal(overridden.ads.d14.atc, 1);
assert.ok(overridden.funnel);

console.log("listing/optimize-metrics.test.ts OK");
