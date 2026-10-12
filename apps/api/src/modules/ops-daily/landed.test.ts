/**
 * npx tsx src/modules/ops-daily/landed.test.ts
 */
import assert from "node:assert/strict";
import type { PackingBoxRow } from "../../platforms/feishu/normalize/forwarder-board.js";
import type { PackingLineRow } from "../../platforms/feishu/normalize/packing-lines.js";
import { landedCostFromPacking } from "./landed.js";

const boxes: PackingBoxRow[] = [
  {
    boxNo: "B1",
    ticketNo: "T1",
    logisticsNo: "L1",
    forwarder: "X",
    mode: "air",
    modeRaw: "空运",
    pcs: 10,
    asn: "",
    shipAt: null,
    arriveAt: null,
    transitDays: null,
    warehouseStatus: "",
    domesticFreight: 100,
    ticketCrossFreight: 200,
    boxCrossFreight: null,
    weightKg: 10,
    cbm: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    settled: "",
  },
];

const lines: PackingLineRow[] = [
  {
    boxNo: "B1",
    partnerSku: "N1AAA",
    name: "A",
    qty: 4,
    unitWeightKg: 1,
    totalWeightKg: 4,
    logisticsNo: "L1",
    ticketNo: "T1",
    mode: "air",
    modeRaw: "空运",
    arriveAt: null,
    warehouseStatus: "",
    shipAt: null,
    forwarder: "X",
  },
  {
    boxNo: "B1",
    partnerSku: "N1BBB",
    name: "B",
    qty: 6,
    unitWeightKg: 1,
    totalWeightKg: 6,
    logisticsNo: "L1",
    ticketNo: "T1",
    mode: "air",
    modeRaw: "空运",
    arriveAt: null,
    warehouseStatus: "",
    shipAt: null,
    forwarder: "X",
  },
];

const purchase = new Map<string, number>([
  ["N1AAA", 10],
  ["N1BBB", 20],
]);

const rows = landedCostFromPacking(lines, boxes, purchase, ["N1"]);
assert.equal(rows.length, 2);

// 单箱票：本箱占比=1；A 箱内重量占比=0.4 → 头程分摊 (100+200)*0.4=120 → /4=30 → +采购10=40
const a = rows.find((r) => r.PSKU === "N1AAA")!;
assert.equal(a.运输方式, "空运");
assert.equal(a.最终单件SKU成本, 40);

// B: 0.6 * 300 / 6 = 30 → +20 = 50
const b = rows.find((r) => r.PSKU === "N1BBB")!;
assert.equal(b.最终单件SKU成本, 50);

console.log("ops-daily landed.test.ts OK");
