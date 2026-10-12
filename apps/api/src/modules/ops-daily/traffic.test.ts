/**
 * npx tsx src/modules/ops-daily/traffic.test.ts
 */
import assert from "node:assert/strict";
import {
  parseProductViewsContent,
  rollupTrafficMetrics,
} from "./traffic.js";

const csv = `Visit_Date,Partner_SKU,SKU,Your_Visitors,Shipped_Units,Conversion_Visitors_Percentage
2026-09-20,N1AAA,ZSKU1,100,5,5
2026-09-25,N1AAA,ZSKU1,50,0,0
2026-08-01,N1AAA,ZSKU1,999,9,1
`;

const lines = parseProductViewsContent(csv);
assert.equal(lines.length, 3);
const m = rollupTrafficMetrics(lines, "2026-09-28", 30);
const row = m.get("ZSKU1")!;
assert.equal(row.visitors30, 150);
assert.equal(row.unitsShipped30, 5);
assert.ok(Math.abs(row.conversion30 - 5 / 150) < 1e-9);

console.log("ops-daily traffic.test.ts OK");
