/**
 * pnpm exec tsx src/modules/replenish/workbook/build.test.ts
 */
import assert from "node:assert/strict";
import {
  assignSalesRanks,
  ceilSuggestQty,
  clampCoverMonths,
  demandFromMonthlyAvg,
  isManualSkip,
} from "./build.js";
import {
  filterAsnEmptyTransitLines,
  summarizeAsnTransitBySku,
} from "./asn-transit.js";
import type { PackingLineRow } from "../../../platforms/feishu/normalize/packing-lines.js";

assert.equal(demandFromMonthlyAvg(10), 45, "10×3+15=45");
assert.equal(demandFromMonthlyAvg(10, 3), 45, "显式月数3");
assert.equal(demandFromMonthlyAvg(10, 2), 35, "10×2+15=35");
assert.equal(demandFromMonthlyAvg(10, 6), 75, "10×6+15=75");
assert.equal(demandFromMonthlyAvg(10, 2.5), 40, "10×2.5+15=40");
assert.equal(demandFromMonthlyAvg(0), 15, "公式本身含+15；装配层无销量不调用");

assert.equal(clampCoverMonths(2.54), 2.5, "月数一位小数");
assert.equal(clampCoverMonths(2.56), 2.6, "月数四舍五入到一位");
assert.equal(ceilSuggestQty(6.1), 7, "建议补往上取整");
assert.equal(ceilSuggestQty(6.0), 6);
assert.equal(ceilSuggestQty(-1), 0);
assert.equal(ceilSuggestQty(0.01), 1);

const ranks = assignSalesRanks([
  { monthlyAvg: 1 },
  { monthlyAvg: 10 },
  { monthlyAvg: 0 },
  { monthlyAvg: 5 },
]);
assert.equal(ranks[1]!.salesRank, 1);
assert.equal(ranks[3]!.salesRank, 2);
assert.equal(ranks[0]!.salesRank, 3);
assert.equal(ranks[2]!.salesRank, null);
assert.equal(ranks[1]!.salesWeight, 1);
assert.ok(ranks[0]!.salesWeight < ranks[3]!.salesWeight);

assert.equal(isManualSkip("淘汰", ""), true);
assert.equal(isManualSkip("清仓", ""), true);
assert.equal(isManualSkip("暂时不补", ""), true);
assert.equal(isManualSkip("", "清仓处理"), true);
assert.equal(isManualSkip("N/A", ""), false, "N/A 忽略");
assert.equal(isManualSkip("", "N/A"), false, "备注 N/A 忽略");
assert.equal(isManualSkip("", "正常"), false);

function line(partial: Partial<PackingLineRow> & { partnerSku: string; qty: number }): PackingLineRow {
  return {
    boxNo: partial.boxNo ?? "B1",
    partnerSku: partial.partnerSku,
    name: partial.name ?? "",
    qty: partial.qty,
    unitWeightKg: null,
    totalWeightKg: null,
    logisticsNo: "",
    ticketNo: "",
    mode: partial.mode ?? "sea",
    modeRaw: partial.modeRaw ?? "海运",
    arriveAt: partial.arriveAt ?? null,
    warehouseStatus: "",
    shipAt: null,
    forwarder: "",
    asn: partial.asn ?? "",
  };
}

const lines = [
  line({ partnerSku: "N1SAAAA001BLK", qty: 20, asn: "" }),
  line({ partnerSku: "N1SAAAA001BLK", qty: 10, asn: "", mode: "air", modeRaw: "空运" }),
  line({ partnerSku: "N1SAAAA001BLK", qty: 5, asn: "ASN123" }),
  line({ partnerSku: "N1PACK", qty: 100, asn: "", name: "包装盒-黑色" }),
  line({ partnerSku: "N2SABBB001WHT", qty: 8, asn: "" }),
];

const filtered = filterAsnEmptyTransitLines(lines);
assert.equal(filtered.length, 3, "ASN有值与包装盒排除");

const bySku = summarizeAsnTransitBySku(lines, ["N1"]);
const a = bySku.get("N1SAAAA001BLK");
assert.ok(a);
assert.equal(a!.qty, 30);
assert.equal(a!.air, 10);
assert.equal(a!.sea, 20);
assert.equal(a!.shipModesLabel, "空运+海运");
assert.equal(bySku.has("N2SABBB001WHT"), false);
assert.equal(bySku.has("N1PACK"), false);

console.log("workbook build.test.ts OK");
