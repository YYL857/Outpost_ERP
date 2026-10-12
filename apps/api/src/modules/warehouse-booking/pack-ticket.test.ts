import assert from "node:assert/strict";
import {
  buildShopBucketsFromLines,
  logisticsSuffix,
  matchesTicket,
} from "./pack-ticket.js";
import { formatNotifyDraft, normalizeScheduleSlot } from "./notify.js";
import type { PackingLineRow } from "../../platforms/feishu/normalize/packing-lines.js";
import type { WarehouseBookingSession } from "./types.js";

function line(
  partial: Partial<PackingLineRow> & {
    partnerSku: string;
    logisticsNo: string;
    qty: number;
  },
): PackingLineRow {
  return {
    boxNo: partial.boxNo || "B1",
    partnerSku: partial.partnerSku,
    name: partial.name || "x",
    qty: partial.qty,
    unitWeightKg: null,
    totalWeightKg: null,
    logisticsNo: partial.logisticsNo,
    ticketNo: partial.ticketNo || "",
    mode: "air",
    modeRaw: "空运",
    arriveAt: null,
    warehouseStatus: "",
    shipAt: null,
    forwarder: "汉沙",
  };
}

const ticket = "10002160";
const lines = [
  line({
    partnerSku: "N1SAMHBJ001MLT",
    logisticsNo: "10002160U001",
    qty: 10,
    name: "A",
  }),
  line({
    partnerSku: "N1SAYEWD001TRA",
    logisticsNo: "10002160U001",
    qty: 20,
    name: "B",
  }),
  line({
    partnerSku: "N1SAXXX001",
    logisticsNo: "10002160U002",
    qty: 5,
    name: "C",
  }),
  line({
    partnerSku: "N2SAYYY001",
    logisticsNo: "10002160U001",
    qty: 3,
    name: "D",
  }),
];

assert.equal(matchesTicket(lines[0]!, ticket), true);
assert.equal(logisticsSuffix("10002160U001", ticket), "U001");

const shops = buildShopBucketsFromLines(lines, ticket, {
  prefixMap: { N1: "PRJ396770", N2: "PRJ482387" },
});
assert.equal(shops.length, 2, "two shops");
const n1 = shops.find((s) => s.shopPrefix === "N1")!;
assert.equal(n1.boxes.length, 2, "N1 two boxes");
assert.equal(n1.boxes.find((b) => b.suffix === "U001")!.pcs, 30);
assert.equal(n1.projectCode, "PRJ396770");
assert.equal(n1.shopLabel, "店1");
assert.equal(n1.shopName, "HUI Beauty");
assert.ok(n1.asnCreateUrl?.includes("PRJ396770"));

const n2 = shops.find((s) => s.shopPrefix === "N2")!;
assert.equal(n2.boxes.length, 1);
assert.equal(n2.items[0]!.qty, 3);

assert.equal(normalizeScheduleSlot("2pm-4pm"), "14:00-16:00");
assert.equal(normalizeScheduleSlot("14:00 - 16:00"), "14:00-16:00");

const session: WarehouseBookingSession = {
  id: "t1",
  ticketPrefix: ticket,
  step: "notify",
  createdAt: "",
  updatedAt: "",
  shops: [
    {
      ...n1,
      asnId: "A06223432PN",
      asnSource: "manual",
      asnPackedConfirmed: true,
    },
  ],
  activeShopPrefix: "N1",
  capture: {
    asnId: "A06223432PN",
    warehouse: "RUH01S",
    scheduledDate: "2026-09-26",
    scheduleSlot: "14:00-16:00",
    region: "sa",
    pageUrl: null,
    capturedAt: "",
    source: "extension",
    flags: [],
  },
  holidaysBlocked: [],
  bookingDefaults: {
    warehouse: "RUH01S",
    dates: ["2026-09-26"],
    timeRangeStart: "2pm",
    timeRangeEnd: "4pm",
    preferredStart: "",
    region: "sa",
    hints: [],
  },
  notes: "",
};

const draft = formatNotifyDraft(session);
assert.ok(draft.text.includes("10002160U001"));
assert.ok(draft.text.includes("的ASN号: A06223432PN"));
assert.ok(draft.text.includes("送仓时间: 2026.09.26 14:00"));
assert.equal(draft.pdfHint, "A06223432PN.pdf");

console.log("warehouse-booking pack-ticket.test.ts OK");
