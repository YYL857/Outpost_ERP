/**
 * npx tsx src/modules/ops-daily/sales-export.test.ts
 */
import assert from "node:assert/strict";
import {
  parseSalesExportContent,
  rollupSalesMetrics,
} from "./sales-export.js";

const csv = `id_partner,partner_sku,sku,status,order_timestamp
396770,N1AAA001,ZSKU1,Delivered,2026-09-20 10:00:00
396770,N1AAA001,ZSKU1,Delivered,2026-09-25 10:00:00
396770,N1AAA001,ZSKU1,Returned,2026-09-26 10:00:00
396770,N1AAA001,ZSKU1,Cancelled,2026-09-27 10:00:00
396770,N1AAA001,ZSKU1,Delivered,2026-08-01 10:00:00
`;

const lines = parseSalesExportContent(csv);
assert.equal(lines.length, 5);

const m = rollupSalesMetrics(lines, "2026-09-28", 30);
const row = m.get("ZSKU1");
assert.ok(row);
// window: 08-30..09-28 → 4 lines (exclude Aug); valid = Delivered×2 (Returned+Cancelled invalid)
assert.equal(row!.units30, 2);
assert.equal(row!.returnRate30, 1 / 4);

console.log("ops-daily sales-export.test.ts OK");
