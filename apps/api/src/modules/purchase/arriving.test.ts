/**
 * 今日关注列表去重 + 分批到货自检
 * pnpm exec tsx src/modules/purchase/arriving.test.ts
 */
import type {
  AppState,
  PurchaseArrivalReceipt,
  PurchaseLine,
} from "../../common/types.js";
import {
  arrivingDedupeKey,
  confirmArrival,
  listArrivingToday,
} from "./arriving.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function line(
  partial: Partial<PurchaseLine> & Pick<PurchaseLine, "id" | "partnerSku">,
): PurchaseLine {
  return {
    productName: partial.productName ?? "货",
    qty: partial.qty ?? 10,
    unitCost: 1,
    amount: 10,
    supplier: partial.supplier ?? "厂",
    purchasedAt: partial.purchasedAt ?? "2026-09-20",
    status: partial.status ?? "",
    remark: "",
    sheetTitle: "产品采购",
    updatedAt: "2026-09-23T00:00:00.000Z",
    source: "test",
    orderId: partial.orderId ?? "",
    trackingNo: partial.trackingNo ?? "",
    transitStatus: partial.transitStatus ?? "已签收",
    etaDate: null,
    ...partial,
  };
}

const emptyState = {
  purchaseLines: [] as PurchaseLine[],
  purchaseArrivalReceipts: [] as PurchaseArrivalReceipt[],
} as AppState;

assert(
  arrivingDedupeKey({
    id: "a",
    partnerSku: "N1SAAAA",
    orderId: "3316885033003002469",
  }) === "o:3316885033003002469|N1SAAAA",
  "key by order+sku",
);

const dupState = {
  ...emptyState,
  purchaseLines: [
    line({
      id: "row-1",
      partnerSku: "N1SACZZS001GLD",
      orderId: "3316885033003002469",
      qty: 300,
      transitStatus: "已签收",
      trackingNo: "",
    }),
    line({
      id: "row-2",
      partnerSku: "N1SACZZS001GLD",
      orderId: "3316885033003002469",
      qty: 300,
      transitStatus: "已签收",
      trackingNo: "79034738561875",
      supplier: "义乌厂",
    }),
    line({
      id: "row-3",
      partnerSku: "N1SAGZC8001MLT",
      orderId: "3317054772103002469",
      qty: 50,
      transitStatus: "已签收",
    }),
  ],
  purchaseArrivalReceipts: [],
} as AppState;

const listed = listArrivingToday(dupState, "2026-09-23");
assert(listed.length === 2, `dedupe → 2 rows, got ${listed.length}`);
const gold = listed.find((x) => x.partnerSku === "N1SACZZS001GLD");
assert(gold?.trackingNo === "79034738561875", "prefer row with tracking");
assert(gold?.supplier === "义乌厂", "prefer richer supplier");
assert(gold?.remainingQty === 300, "full remaining initially");

const partial = confirmArrival(
  dupState,
  {
    receiptKey: gold!.receiptKey,
    addQty: 100,
    updatedBy: "tester",
  },
  "2026-09-23",
);
assert(partial.cleared === false, "partial not cleared");
assert(partial.receipt.receivedQty === 100, "received 100");
const afterPartial = listArrivingToday(dupState, "2026-09-23");
assert(afterPartial.length === 2, "still 2 after partial");
const gold2 = afterPartial.find((x) => x.partnerSku === "N1SACZZS001GLD");
assert(gold2?.remainingQty === 200, "remaining 200");

const done = confirmArrival(
  dupState,
  {
    receiptKey: gold!.receiptKey,
    markComplete: true,
    updatedBy: "tester",
  },
  "2026-09-23",
);
assert(done.cleared === true, "markComplete clears");
const afterDone = listArrivingToday(dupState, "2026-09-23");
assert(afterDone.length === 1, `cleared gold → 1 row, got ${afterDone.length}`);
assert(
  afterDone[0]?.partnerSku === "N1SAGZC8001MLT",
  "only other sku remains",
);

console.log("arriving.test.ts OK");
