/**
 * npx tsx src/modules/ops-daily/ads.test.ts
 */
import assert from "node:assert/strict";
import {
  adLossSummaryTag,
  adsWindowTag,
  rollupAdsWindows,
} from "./ads.js";

assert.equal(adsWindowTag("7", 0, 0, 0), "7天未投放");
assert.equal(adsWindowTag("7", 0.3, 0, 0), "7天无法判断");
assert.equal(adsWindowTag("7", 1.2, 0, 0), "7天有花费无订单");
assert.equal(adsWindowTag("7", 10, 2, 3), "7天广告不亏");
assert.equal(adsWindowTag("7", 10, 1, 0.5), "7天广告亏损");

assert.equal(
  adLossSummaryTag({
    tag7: "7天未投放",
    tag15: "15天未投放",
    tag30: "30天未投放",
  }),
  "未投放",
);
assert.equal(
  adLossSummaryTag({
    tag7: "7天广告不亏",
    tag15: "15天广告不亏",
    tag30: "30天广告不亏",
  }),
  "广告健康",
);

const m = rollupAdsWindows(
  [
    { sku: "Z1", day: "2026-09-25", spend: 5, orders: 1, revenue: 20 },
    { sku: "Z1", day: "2026-09-28", spend: 5, orders: 1, revenue: 20 },
  ],
  "2026-09-28",
  [7],
);
const w = m.get("Z1")![7]!;
assert.equal(w.spend, 10);
assert.equal(w.orders, 2);
assert.equal(w.roas, 4);

console.log("ops-daily ads.test.ts OK");
