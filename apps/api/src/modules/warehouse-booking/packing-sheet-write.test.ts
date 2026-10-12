/**
 * npx tsx src/modules/warehouse-booking/packing-sheet-write.test.ts
 */
import assert from "node:assert/strict";
import {
  formatArriveAtForSheet,
  isPackagingOnlyRow,
  normalizeLogisticsKey,
  planSheetPatches,
  rowMatchesBookingShop,
  rowShopPrefix,
} from "./packing-sheet-write.js";

assert.equal(normalizeLogisticsKey("10001711U001"), "10001711#1");
assert.equal(normalizeLogisticsKey("100017110001", "10001711"), "10001711#1");
assert.equal(normalizeLogisticsKey("10001711001", "10001711"), "10001711#1");
assert.equal(normalizeLogisticsKey(" 10001711u003 "), "10001711#3");

assert.equal(formatArriveAtForSheet("2026-10-08"), "2026/10/08");
assert.equal(formatArriveAtForSheet("2026.10.10"), "2026/10/10");

assert.equal(
  rowShopPrefix({ shopCell: "N2", boxNo: "2607-328-N1-H", partnerSku: "" }),
  "N2",
);
// 箱号 N1、PSKU N2 → 以货（PSKU）为准
assert.equal(
  rowShopPrefix({
    shopCell: "",
    boxNo: "2607-328-N1-H",
    partnerSku: "N2SAXXX",
  }),
  "N2",
);
assert.equal(
  rowShopPrefix({
    shopCell: "N1",
    boxNo: "2606-253-N1-H",
    partnerSku: "N2SABMQ001PNK",
  }),
  "N2",
);
assert.equal(
  rowShopPrefix({ shopCell: "", boxNo: "", partnerSku: "N2SAQGZJ001WHT" }),
  "N2",
);

const logisticsNos = new Set([
  normalizeLogisticsKey("10001711U001", "10001711"),
  normalizeLogisticsKey("10001711U003", "10001711"),
]);
assert.equal(
  rowMatchesBookingShop({
    ticketPrefix: "10001711",
    shopPrefix: "N1",
    logisticsNos,
    ticketCell: "10001711",
    logisticsCell: "100017110001",
    shopCell: "N1",
    boxNo: "2607-328-N1-H",
    partnerSku: "N1SACJZB001YEL",
  }),
  true,
);
// 串店：本店清单没有该物流号 → 拒绝（即使同票、行上店码不同）
assert.equal(
  rowMatchesBookingShop({
    ticketPrefix: "10001711",
    shopPrefix: "N1",
    logisticsNos: new Set([normalizeLogisticsKey("10001711U003", "10001711")]),
    ticketCell: "10001711",
    logisticsCell: "10001711U001",
    shopCell: "N2",
    boxNo: "2607-328-N2-H",
    partnerSku: "N2SAXXX",
  }),
  false,
);
// 会话 N2 清单含 U001，箱号/店铺仍标 N1 → 仍回填（10001566 实况）
assert.equal(
  rowMatchesBookingShop({
    ticketPrefix: "10001566",
    shopPrefix: "N2",
    logisticsNos: new Set([
      normalizeLogisticsKey("10001566U001", "10001566"),
      normalizeLogisticsKey("10001566U009", "10001566"),
    ]),
    ticketCell: "10001566",
    logisticsCell: "10001566U001",
    shopCell: "N1",
    boxNo: "2606-253-N1-H",
    partnerSku: "N2SABMQ001PNK",
  }),
  true,
);
// 仅票号 + 店码（物流格式不同也能命中）
assert.equal(
  rowMatchesBookingShop({
    ticketPrefix: "10001711",
    shopPrefix: "N2",
    logisticsNos: new Set([normalizeLogisticsKey("10001711U002", "10001711")]),
    ticketCell: "10001711",
    logisticsCell: "",
    shopCell: "N2",
    boxNo: "2607-329-N2-H",
    partnerSku: "N2SAQGZJ001WHT",
  }),
  true,
);

const boxValues: unknown[][] = [
  [
    "箱号",
    "票号",
    "物流编号",
    "货代名称",
    "运输方式",
    "产品PCS",
    "FBA号/ASN号",
    "发货时间",
    "送仓时间",
    "当月箱数",
    "店铺Code",
    "",
    "",
    "",
    "到仓情况",
  ],
  [
    "2607-328-N1-H",
    "10001711",
    "100017110001",
    "汉沙",
    "海运",
    10,
    "",
    "2026/07/17",
    "",
    1,
    "N1",
    "",
    "",
    "",
    "在途中",
  ],
  [
    "2607-329-N2-H",
    "10001711",
    "100017110002",
    "汉沙",
    "海运",
    20,
    "",
    "2026/07/17",
    "",
    2,
    "N2",
    "",
    "",
    "",
    "在途中",
  ],
];

const n1Plan = planSheetPatches({
  target: "box",
  title: "箱表",
  sheetId: "box1",
  values: boxValues,
  ticketPrefix: "10001711",
  shopPrefix: "N1",
  logisticsNos: ["10001711U001"],
  asnId: "A06311385PN",
  arriveAtSheet: "2026/10/08",
});
assert.deepEqual(n1Plan.matchedRows, [2]);
assert.equal(
  n1Plan.patches.some((p) => p.field === "status"),
  false,
  "箱表不得写到仓情况",
);
assert.ok(n1Plan.patches.some((p) => p.field === "asn" && p.value === "A06311385PN"));
assert.ok(
  n1Plan.patches.some((p) => p.field === "arriveAt" && p.value === "2026/10/08"),
);

const n2Plan = planSheetPatches({
  target: "box",
  title: "箱表",
  sheetId: "box1",
  values: boxValues,
  ticketPrefix: "10001711",
  shopPrefix: "N2",
  logisticsNos: ["10001711U002"],
  asnId: "A06311429PN",
  arriveAtSheet: "2026/10/10",
});
assert.deepEqual(n2Plan.matchedRows, [3]);
assert.ok(n2Plan.patches.every((p) => p.sheetRow === 3));

const detailValues: unknown[][] = [
  [
    "箱号",
    "票号",
    "物流编号",
    "PSKU",
    "FBA号/ASN号",
    "送仓时间",
    "店铺Code",
    "到仓情况",
  ],
  [
    "2607-329-N2-H",
    "10001711",
    "10001711U002",
    "N2SAQGZJ001WHT",
    "",
    "",
    "N2",
    "在途中",
  ],
];
const detailPlan = planSheetPatches({
  target: "detail",
  title: "装箱明细",
  sheetId: "d1",
  values: detailValues,
  ticketPrefix: "10001711",
  shopPrefix: "N2",
  logisticsNos: ["10001711U002"],
  asnId: "A06311429PN",
  arriveAtSheet: "2026/10/10",
});
assert.ok(detailPlan.patches.some((p) => p.field === "status" && p.value === "已入库"));

assert.equal(isPackagingOnlyRow("RTV", "RTV包装盒"), true);
assert.equal(isPackagingOnlyRow("N1SACJZB001YEL", "餐巾桌布"), false);

const packingDetail: unknown[][] = [
  [
    "箱号",
    "票号",
    "物流编号",
    "PSKU",
    "名称",
    "FBA号/ASN号",
    "送仓时间",
    "到仓情况",
  ],
  [
    "2607-330-N1-H",
    "10001711",
    "10001711U001",
    "N1SACJZB001YEL",
    "餐巾",
    "",
    "",
    "在途中",
  ],
  [
    "2607-331-X-H",
    "10001711",
    "10001711U006",
    "RTV",
    "RTV包装盒",
    "",
    "",
    "在途中",
  ],
];
const packingPlan = planSheetPatches({
  target: "detail",
  title: "装箱明细",
  sheetId: "d1",
  values: packingDetail,
  ticketPrefix: "10001711",
  shopPrefix: "N1",
  logisticsNos: ["10001711U001"],
  asnId: "A06311385PN",
  arriveAtSheet: "2026/10/08",
  packagingLogisticsNos: ["10001711U006"],
});
assert.ok(
  packingPlan.patches.some(
    (p) => p.sheetRow === 2 && p.field === "asn" && p.value === "A06311385PN",
  ),
  "正常货应填 ASN",
);
assert.equal(
  packingPlan.patches.some((p) => p.sheetRow === 3 && p.field === "asn"),
  false,
  "包装盒不填 ASN",
);
assert.ok(
  packingPlan.patches.some(
    (p) =>
      p.sheetRow === 3 && p.field === "arriveAt" && p.value === "2026/10/08",
  ),
  "包装盒仍填送仓时间",
);
assert.ok(
  packingPlan.patches.some(
    (p) => p.sheetRow === 3 && p.field === "status" && p.value === "已入库",
  ),
  "包装盒明细可改到仓情况",
);

console.log("[packing-sheet-write] ok");
