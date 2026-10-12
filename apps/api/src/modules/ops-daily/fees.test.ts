/**
 * npx tsx src/modules/ops-daily/fees.test.ts
 */
import assert from "node:assert/strict";
import type { AppState, CatalogItem, FeeSnapshot, SkuDims } from "../../common/types.js";
import {
  buildWeeklyFeeRows,
  dimClass,
  feeForDim,
  shipWeight,
} from "./fees.js";
import type { FbnFeeTiers } from "./config.js";

const tiers: FbnFeeTiers = {
  packaging_weight_kg: 0.02,
  weight_step: 0.05,
  dim_limits_cm: {
    "Small envelope": { longest: 20, median: 15, shortest: 1 },
    "Standard envelope": { longest: 33, median: 23, shortest: 2.5 },
    "Large envelope": { longest: 33, median: 23, shortest: 5 },
    "Standard parcel": { longest: 50, median: 40, shortest: 30 },
    Oversize: { longest: 100, median: 80, shortest: 60 },
  },
  packaging_weight_by_dim_kg: {
    "Small envelope": 0.02,
    "Standard envelope": 0.04,
    "Large envelope": 0.04,
    "Standard parcel": 0.1,
    Oversize: 0.24,
    "Extra oversize": 0.24,
    default: 0.4,
  },
  weight_upgrade: {
    "Small envelope": { max_kg: 0.1, next: "Standard envelope" },
    "Standard envelope": { max_kg: 0.5, next: "Large envelope" },
    "Large envelope": { max_kg: 1.0, next: "Standard parcel" },
  },
  fees_sar: {
    "Small envelope": { lte25: 5.5, gt25: 7.5 },
    "Standard envelope": {
      bands: [
        { max_kg: 0.1, lte25: 6.0, gt25: 8.0 },
        { max_kg: 0.25, lte25: 6.5, gt25: 8.5 },
        { max_kg: 0.5, lte25: 7.0, gt25: 9.0 },
      ],
    },
    "Large envelope": {
      bands: [
        { max_kg: 0.5, lte25: 8.0, gt25: 10.0 },
        { max_kg: 1.0, lte25: 9.0, gt25: 11.0 },
      ],
    },
    "Standard parcel": {
      bands: [
        { max_kg: 2.0, lte25: 12.0, gt25: 14.0 },
        { max_kg: 5.0, lte25: 16.0, gt25: 18.0 },
      ],
    },
    Oversize: { default: 24.0 },
    "Extra oversize": { default: 30.0 },
  },
};

assert.equal(dimClass(10, 8, 0.5, tiers), "Small envelope");
assert.equal(dimClass(30, 20, 2, tiers), "Standard envelope");

const light = shipWeight(0.05, "Small envelope", tiers);
assert.equal(light.dimClass, "Small envelope");
assert.ok(light.shippingWeightKg > 0);

const heavySmall = shipWeight(0.2, "Small envelope", tiers);
assert.equal(heavySmall.dimClass, "Standard envelope");

assert.equal(feeForDim("Small envelope", 0.1, 20, tiers), 5.5);
assert.equal(feeForDim("Small envelope", 0.1, 30, tiers), 7.5);
assert.equal(feeForDim("Standard envelope", 0.2, 10, tiers), 6.5);

const dims: SkuDims[] = [
  {
    partnerSku: "N1AAA",
    lengthCm: 10,
    widthCm: 8,
    heightCm: 0.5,
    weightKg: 0.05,
    updatedAt: "2026-09-28T00:00:00.000Z",
  },
];
const fees: FeeSnapshot[] = [
  {
    partnerSku: "N1AAA",
    commissionRate: 0.1567,
    outboundFee: 6.33,
    taxAmount: 0,
    updatedAt: "2026-09-28T00:00:00.000Z",
  },
  {
    partnerSku: "N1BBB",
    commissionRate: 0.2,
    outboundFee: 8,
    taxAmount: 0,
    updatedAt: "2026-09-28T00:00:00.000Z",
  },
];
const catalog: CatalogItem[] = [
  {
    partnerSku: "N1AAA",
    noonSku: "SKU-A",
    title: "A",
    price: 19,
    activePrice: 19,
    isActive: true,
    updatedAt: "2026-09-28T00:00:00.000Z",
  } as CatalogItem,
];

const weekly = buildWeeklyFeeRows(
  {
    catalog,
    skuDims: dims,
    feeSnapshots: fees,
  } as AppState,
  { prefixes: ["N1"], tiers },
);
assert.equal(weekly.length, 2);
const a = weekly.find((r) => r.psku === "N1AAA")!;
assert.ok(typeof a.自己出库费 === "number");
assert.equal(a.佣金比例, 0.157);
assert.equal(a.平台实际出库费, 6.33);
const b = weekly.find((r) => r.psku === "N1BBB")!;
assert.equal(b.自己出库费, "");
assert.equal(b.佣金比例, 0.2);

console.log("ops-daily fees.test.ts OK");
