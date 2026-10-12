import assert from "node:assert/strict";
import { aggregatePackingShipQty } from "./ship-qty.js";

const values = [
  ["PSKU", "名称", "数量", "箱号", "运输方式"],
  ["N1SATBB001BLK", "拖把", 5, "A", "空运"],
  ["N1SATBB001BLK", "拖把", 10, "B", "海运"],
  ["N1SATBB001BLK", "拖把", 2, "C", "单品"],
  ["N1SATBB001BLK", "拖把", 0, "D", "空运"],
  ["未上架", "x", 3, "E", "空运"],
];

const map = aggregatePackingShipQty(values);
const qty = map.get("N1SATBB001BLK");
assert.ok(qty, "sku present");
assert.equal(qty.air, 5, "air pieces");
assert.equal(qty.sea, 10, "sea pieces");
assert.equal(qty.single, 2, "single pieces");
assert.equal(map.has("未上架"), false, "invalid psku skipped");

console.log("ship-qty.test.ts OK");
