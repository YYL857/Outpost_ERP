/**
 * npx tsx src/modules/ops-daily/aging.test.ts
 */
import assert from "node:assert/strict";
import { fifoAgeForSku, parseFbnLedgerContent } from "./aging.js";

const csv = `transaction_date,sku,partner_sku,quantity_delta
2026-01-01,ZSKU1,N1AAA,100
2026-06-01,ZSKU1,N1AAA,-40
2026-08-01,ZSKU1,N1AAA,10
`;
const moves = parseFbnLedgerContent(csv);
const m = fifoAgeForSku(moves, "2026-09-28");
// inbound 100 then 10; outbound 40 → leftover 60 of Jan (age 270) + 10 of Aug (age 58)
assert.equal(m.buckets["0-90天"], 10);
assert.equal(m.buckets["181-270天"], 60);
assert.equal(m.buckets["91-180天"], 0);
assert.equal(m.risk, "中度积压");
assert.equal(m.daysInWarehouse, 271); // 2026-01-01 → 09-28 inclusive

const empty = fifoAgeForSku([], "2026-09-28");
assert.equal(empty.risk, "入仓天数缺失");
assert.equal(empty.daysInWarehouse, null);

console.log("ops-daily aging.test.ts OK");
