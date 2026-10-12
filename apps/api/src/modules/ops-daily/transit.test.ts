/**
 * npx tsx src/modules/ops-daily/transit.test.ts
 */
import assert from "node:assert/strict";
import type { PurchaseLine } from "../../common/types.js";
import type { PackingLineRow } from "../../platforms/feishu/normalize/packing-lines.js";
import { rollupTransitByPsku } from "./transit.js";

function purchase(
  psku: string,
  qty: number,
  transitStatus: string,
): PurchaseLine {
  return {
    id: psku + transitStatus,
    partnerSku: psku,
    productName: "",
    qty,
    unitCost: 0,
    amount: 0,
    supplier: "",
    purchasedAt: null,
    status: "",
    remark: "",
    sheetTitle: "",
    updatedAt: "",
    source: "test",
    transitStatus,
  };
}

function pack(
  psku: string,
  qty: number,
  mode: "air" | "sea",
  arriveAt: string | null,
): PackingLineRow {
  return {
    boxNo: "2609-1-N1-K",
    partnerSku: psku,
    name: "",
    qty,
    unitWeightKg: null,
    totalWeightKg: null,
    logisticsNo: "",
    ticketNo: "",
    mode,
    modeRaw: mode === "air" ? "空运" : "海运",
    arriveAt,
    warehouseStatus: arriveAt ? "已入仓" : "在途",
    shipAt: null,
    forwarder: "",
  };
}

const m = rollupTransitByPsku({
  prefixes: ["N1"],
  purchaseLines: [
    purchase("N1AAA", 10, "采购中"),
    purchase("N1AAA", 5, "已到仓"),
    purchase("N2BBB", 99, "采购中"),
  ],
  packingLines: [
    pack("N1AAA", 3, "air", null),
    pack("N1AAA", 7, "sea", null),
    pack("N1AAA", 2, "air", "2026-09-01"),
  ],
});
const row = m.get("N1AAA")!;
assert.equal(row.purchasedQty, 10);
assert.equal(row.airInTransit, 3);
assert.equal(row.seaInTransit, 7);
assert.equal(m.has("N2BBB"), false);

console.log("ops-daily transit.test.ts OK");
