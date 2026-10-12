/**
 * pnpm exec tsx src/modules/catalog/list-items.test.ts
 */
import { listCatalogItemsForAssembly } from "./list-items.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) {
    console.error("FAIL:", msg, "got", a, "expected", b);
    process.exit(1);
  }
}

const items = listCatalogItemsForAssembly({
  catalog: [
    {
      partnerSku: "N1LIVE001",
      title: "Live",
      isActive: true,
      noonSku: "Z1",
      imageUrl: "",
      price: 10,
      currency: "SAR",
      listingType: "noon",
      source: "NOON",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  salesFacts: [
    {
      partnerSku: "N1SATP001BLK",
      date: "2026-08-27",
      units: 1,
      amount: 39.9,
      updatedAt: "2026-09-16T00:00:00.000Z",
    },
  ],
  feeSnapshots: [
    {
      partnerSku: "N1SATP001BLK",
      commissionRate: 0.13,
      outboundFee: 9,
      taxAmount: 0,
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
  ],
  skuLocalCosts: [
    {
      partnerSku: "N1SATP001BLK",
      purchaseCost: 16,
      headhaul: 7,
      preferAir: false,
      updatedAt: "2026-09-18T00:00:00.000Z",
    },
  ],
  skuDims: [],
});

assertEq(items.length, 2, "live + orphan");
const orphan = items.find((i) => i.partnerSku === "N1SATP001BLK")!;
assert(orphan, "orphan present");
assertEq(orphan.isActive, false, "orphan inactive");
assertEq(orphan.listingType, "orphan", "orphan type");
assertEq(orphan.price, 39.9, "price from sales");
assert(orphan.title.includes("未在线"), "title marker when no feishu name");

const named = listCatalogItemsForAssembly({
  catalog: [],
  salesFacts: [
    {
      partnerSku: "N1SAQBJ002MLT",
      date: "2026-09-20",
      units: 1,
      amount: 20,
      updatedAt: "2026-09-20T00:00:00.000Z",
    },
  ],
  feeSnapshots: [],
  skuLocalCosts: [],
  skuDims: [],
  feishuOpsSnapshots: [
    {
      partnerSku: "N1SAQBJ002MLT",
      sheetTitle: "9.21",
      reportDate: "2026-09-20",
      productName: "恐龙新生儿襁褓巾-彩色",
      airInTransit: 0,
      seaInTransit: 0,
      purchasedQty: 0,
      airReplenishPlan: 0,
      seaReplenishPlan: 0,
      fbn: null,
      updatedAt: "2026-09-29T00:00:00.000Z",
      source: "feishu:daily",
    },
  ],
});
const namedOrphan = named.find((i) => i.partnerSku === "N1SAQBJ002MLT")!;
assertEq(namedOrphan.title, "恐龙新生儿襁褓巾-彩色", "feishu productName as title");
assertEq(namedOrphan.listingType, "orphan", "still orphan type");

console.log("OK list-items");
