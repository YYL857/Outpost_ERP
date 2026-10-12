/**
 * pnpm exec tsx src/platforms/feishu/normalize/forwarder-board.test.ts
 */
import assert from "node:assert/strict";
import {
  aggregateForwarders,
  classifyShipMode,
  extractPackingBoxRows,
  rankForwarders,
  transitDaysBetween,
} from "./forwarder-board.js";

assert.equal(classifyShipMode("空运"), "air");
assert.equal(classifyShipMode("海运整柜"), "sea");
assert.equal(transitDaysBetween("2025/11/19", "2026/01/11"), 53);
assert.equal(transitDaysBetween("2025/08/19", "2025/08/05"), null, "negative skip");

const values = [
  [
    "箱号",
    "票号",
    "物流编号",
    "货代名称",
    "运输方式",
    "产品PCS-箱级",
    "FBA号/ASN号",
    "发货时间",
    "送仓时间",
    "整票国内运费",
    "整票跨境实付",
    "实收跨境费",
    "到仓情况",
    "货物重量",
    "方数",
  ],
  // 同票两箱：整票 1000 只应计一次；实收可加总
  [
    "B1",
    "T1",
    "L1",
    "甲货代",
    "空运",
    10,
    "A1",
    "2025/01/01",
    "2025/01/10",
    20,
    1000,
    500,
    "已入库",
    10,
    0.1,
  ],
  [
    "B2",
    "T1",
    "L2",
    "甲货代",
    "空运",
    10,
    "A1",
    "2025/01/01",
    "2025/01/12",
    20,
    1000,
    500,
    "已入库",
    10,
    0.1,
  ],
  [
    "B3",
    "T2",
    "L3",
    "乙货代",
    "海运",
    20,
    "A2",
    "2025/01/01",
    "2025/02/15",
    0,
    2000,
    2000,
    "在途中",
    5,
    1,
  ],
  [
    "B4",
    "T3",
    "L4",
    "乙货代",
    "海运",
    5,
    "A3",
    "2025/01/05",
    "2025/02/10",
    0,
    800,
    800,
    "已入库",
    5,
    1,
  ],
  [
    "B5",
    "T4",
    "L5",
    "乙货代",
    "海运",
    5,
    "A4",
    "2025/01/08",
    "2025/02/20",
    0,
    900,
    900,
    "已入库",
    5,
    1,
  ],
];

const rows = extractPackingBoxRows(values);
assert.equal(rows.length, 5);
assert.equal(rows[0]!.transitDays, 9);

const aggs = aggregateForwarders(rows);
const jia = aggs.find((a) => a.forwarder === "甲货代")!;
assert.ok(jia);
assert.equal(jia.boxes, 2);
assert.equal(jia.ticketFreightSum, 1000, "ticket fee deduped");
assert.equal(jia.boxFreightSum, 1000, "box fees summed");
assert.equal(jia.rmbPerKg, 50);

const yi = aggs.find((a) => a.forwarder === "乙货代")!;
assert.equal(yi.inTransitBoxes, 1);
assert.equal(yi.tickets, 3);

{
  // 送仓时间为空 → 计在途（即使状态未写「在途」）
  const emptyArrive = [
    values[0]!,
    [
      "B8",
      "T8",
      "L8",
      "丙货代",
      "海运",
      3,
      "A8",
      "2025/04/01",
      "",
      0,
      100,
      100,
      "",
      2,
      0.5,
    ],
  ];
  const rows2 = extractPackingBoxRows(emptyArrive);
  assert.equal(rows2[0]!.arriveAt, null);
  const aggs2 = aggregateForwarders(rows2);
  assert.equal(aggs2[0]!.inTransitBoxes, 1, "empty 送仓时间 = in transit");
}

const ranking = rankForwarders(aggs);
assert.ok(ranking.length >= 1);
assert.equal(ranking[0]!.rank, 1);

{
  const aliasValues = [
    values[0]!,
    [
      "B6",
      "T6",
      "L6",
      "起客",
      "空运",
      1,
      "A6",
      "2025/03/01",
      "2025/03/10",
      0,
      100,
      100,
      "已入库",
      2,
      0.01,
    ],
    [
      "B7",
      "T7",
      "L7",
      "起克",
      "空运",
      1,
      "A7",
      "2025/03/02",
      "2025/03/11",
      0,
      100,
      100,
      "已入库",
      2,
      0.01,
    ],
  ];
  const aliasRows = extractPackingBoxRows(aliasValues);
  const aliasAggs = aggregateForwarders(aliasRows);
  assert.equal(aliasAggs.length, 1, "起客+起克 merge");
  assert.equal(aliasAggs[0]!.forwarder, "起克", "canonical 起克");
  assert.equal(aliasAggs[0]!.boxes, 2);
}

console.log("forwarder-board.test.ts OK");
