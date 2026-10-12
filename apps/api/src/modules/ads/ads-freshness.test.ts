/**
 * tsx src/modules/ads/ads-freshness.test.ts
 */
import assert from "node:assert/strict";
import type { AdsFact } from "../../common/types.js";
import { assessAdsFreshness, localYesterdayIso } from "./ads-freshness.js";

const y = localYesterdayIso(new Date(2026, 8, 23)); // Sep 23 → Sep 22
assert.equal(y, "2026-09-22");

function fact(partial: Partial<AdsFact> & Pick<AdsFact, "fromDate" | "toDate">): AdsFact {
  return {
    partnerSku: partial.partnerSku ?? "SKU-A",
    campaign: partial.campaign ?? "",
    fromDate: partial.fromDate,
    toDate: partial.toDate,
    spend: 1,
    revenue: 2,
    orders: 0,
    views: 10,
    clicks: 1,
    atc: 0,
    updatedAt: "2026-09-23T00:00:00.000Z",
  };
}

const empty = assessAdsFreshness({ adsFacts: [] }, new Date(2026, 8, 23));
assert.equal(empty.hasYesterday, false);
assert.equal(empty.yesterday, "2026-09-22");

const ok = assessAdsFreshness(
  {
    adsFacts: [
      fact({ fromDate: "2026-09-22", toDate: "2026-09-22" }),
      fact({ partnerSku: "SKU-B", fromDate: "2026-09-20", toDate: "2026-09-20" }),
    ],
  },
  new Date(2026, 8, 23),
);
assert.equal(ok.hasYesterday, true);
assert.equal(ok.yesterdayFactCount, 1);
assert.equal(ok.yesterdaySkuCount, 1);

const span = assessAdsFreshness(
  { adsFacts: [fact({ fromDate: "2026-09-16", toDate: "2026-09-22" })] },
  new Date(2026, 8, 23),
);
assert.equal(span.hasYesterday, true);

console.log("ads/ads-freshness.test.ts OK");
