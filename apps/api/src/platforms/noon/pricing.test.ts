/**
 * pnpm exec tsx src/platforms/noon/pricing.test.ts
 */
import { nextLivePrice, overlayCatalogDtoPrices, pickOfferAmount } from "./pricing.js";
import type { NoonCatalogDto } from "./types.js";

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) {
    console.error("FAIL:", msg, "got", a, "expected", b);
    process.exit(1);
  }
}

const row = (price: number): NoonCatalogDto => ({
  partner_sku: "N1",
  title: "t",
  is_active: true,
  noon_sku: "",
  image_url: "",
  price,
  currency: "SAR",
  listing_type: "noon",
  updated_at: "2026-01-03 00:00:00",
});

assertEq(nextLivePrice(23.9, 39.9), 39.9, "stale catalog price replaced");
assertEq(nextLivePrice(33.9, 33.9), null, "same price kept");
assertEq(nextLivePrice(33.9, 33.901), null, "sub-cent noise ignored");
assertEq(nextLivePrice(33.9, 0), null, "zero does not wipe");
assertEq(nextLivePrice(33.9, null), null, "missing does not wipe");

const now = "2026-09-19T06:00:00.000Z";
const overlaid = overlayCatalogDtoPrices(
  [row(23.9), { ...row(98), partner_sku: "N2" }],
  new Map([
    ["N1", 39.9],
    ["N2", 98],
  ]),
  now,
);
assertEq(overlaid[0]!.price, 39.9, "overlay price");
assertEq(overlaid[0]!.updated_at, now, "overlay bumps version so upsert is not stale-locked");
assertEq(overlaid[1]!.price, 98, "unchanged sku");
assertEq(overlaid[1]!.updated_at, "2026-01-03 00:00:00", "unchanged sku keeps timestamp");

const insulin = {
  offers: [
    { country_code: "ae", live_status: false, price: { amount: 69, currency: "AED" } },
    { country_code: "sa", live_status: true, price: { amount: 29.9, currency: "SAR" } },
  ],
};
assertEq(pickOfferAmount(insulin, "sa"), 29.9, "sa offer price not ae list price");
assertEq(pickOfferAmount({ offers: [{ country_code: "sa", price: null }] }, "sa"), null, "null price skipped");

console.log("pricing.test ok");
