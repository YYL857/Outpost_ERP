import assert from "node:assert/strict";
import { resolveAdsRange, isAdsRangeMode } from "./ads-range.js";

assert.equal(isAdsRangeMode("yesterday"), true);
assert.equal(isAdsRangeMode("last30"), true);
assert.equal(isAdsRangeMode("foo"), false);

const y = resolveAdsRange({ range: "yesterday" });
assert.equal(y.range, "yesterday");
assert.equal(y.fromDate, y.toDate);
assert.equal(y.label, "Yesterday");

const l7 = resolveAdsRange({ range: "last7" });
assert.equal(l7.days, 7);
assert.equal(l7.fromDate < l7.toDate || l7.fromDate === l7.toDate, true);

const custom = resolveAdsRange({
  range: "custom",
  fromDate: "2026-09-01",
  toDate: "2026-09-10",
});
assert.equal(custom.days, 10);
assert.equal(custom.fromDate, "2026-09-01");
assert.equal(custom.toDate, "2026-09-10");

assert.throws(() => resolveAdsRange({ range: "custom" }));

const def = resolveAdsRange({});
assert.equal(def.range, "yesterday");

console.log("pw-rpa ads-range ok");
