/**
 * pnpm exec tsx src/modules/sync/gap-audit.test.ts
 */
import type { AppState } from "../../common/types.js";
import {
  addDaysYmd,
  auditShopGaps,
  eachYmd,
  resolveLagExpectedEnd,
  resolveSnapshotExpectedEnd,
} from "./gap-audit.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(addDaysYmd("2026-09-29", 1) === "2026-09-30", "addDays+1");
assert(
  eachYmd("2026-09-29", "2026-10-01").join(",") ===
    "2026-09-29,2026-09-30,2026-10-01",
  "eachYmd",
);

const lagState = {
  store: { id: "PRJ1", name: "t", account: "PRJ1", platform: "NOON" },
  noon: { mode: "live", enabled: true, countryCode: "sa" },
  cursors: {
    ordersSince: "2026-09-29T00:00:00.000Z",
    catalogSince: "2026-10-04T08:00:00.000Z",
    stockSince: "2026-10-04T08:00:00.000Z",
    salesSince: "2026-09-30T00:00:00.000Z",
    feesSince: "2026-10-04T08:00:00.000Z",
    adsSince: null,
  },
  syncJobs: [],
  syncAlerts: [],
  orders: [
    {
      orderNr: "o1",
      status: "delivered",
      currency: "SAR",
      totalAmount: 10,
      itemCount: 1,
      placedAt: "2026-09-29T12:00:00.000Z",
      updatedAt: "2026-09-29T12:00:00.000Z",
      rawVersion: "1",
    },
  ],
  catalog: [{ partnerSku: "N1A" }],
  stock: [],
  salesFacts: [
    {
      partnerSku: "N1A",
      date: "2026-09-29",
      units: 1,
      amount: 10,
      updatedAt: "2026-09-30T00:00:00.000Z",
    },
  ],
  feeSnapshots: [
    {
      partnerSku: "N1A",
      commissionRate: 0.1,
      outboundFee: 1,
      taxAmount: 0,
      updatedAt: "2026-10-04T08:00:00.000Z",
    },
  ],
  adsFacts: [
    {
      partnerSku: "N1A",
      campaign: "c",
      fromDate: "2026-09-29",
      toDate: "2026-09-29",
      spend: 1,
      revenue: 2,
      orders: 1,
      views: 10,
      clicks: 1,
      atc: 0,
      updatedAt: "2026-09-30T00:00:00.000Z",
    },
  ],
} as unknown as AppState;

{
  const report = auditShopGaps("PRJ1", "t", lagState, {
    expectedEnd: "2026-10-04",
    lookbackDays: 14,
    now: new Date("2026-10-05T01:00:00.000Z"),
    catalogStaleMs: 48 * 3600_000,
    stockStaleMs: 48 * 3600_000,
  });
  const sales = report.domains.find((d) => d.domain === "sales")!;
  assert(!sales.ok, "sales should lag");
  assert(sales.fillFrom === "2026-09-30", `sales fillFrom=${sales.fillFrom}`);
  assert(sales.fillTo === "2026-10-04", `sales fillTo=${sales.fillTo}`);
  assert(sales.missingDates.length === 5, `sales missing=${sales.missingDates.length}`);
  const ads = report.domains.find((d) => d.domain === "ads")!;
  assert(!ads.ok, "ads should lag");
  assert(ads.channel === "yingdao-ads", "ads channel");
  assert(ads.fillFrom === "2026-09-30", `ads fillFrom=${ads.fillFrom}`);
}

const okState = {
  ...lagState,
  salesFacts: [
    {
      partnerSku: "N1A",
      date: "2026-10-04",
      units: 2,
      amount: 20,
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
  ],
  orders: [
    {
      orderNr: "o2",
      status: "delivered",
      currency: "SAR",
      totalAmount: 20,
      itemCount: 2,
      placedAt: "2026-10-04T10:00:00.000Z",
      updatedAt: "2026-10-04T10:00:00.000Z",
      rawVersion: "1",
    },
  ],
  adsFacts: [
    {
      partnerSku: "N1A",
      campaign: "c",
      fromDate: "2026-10-04",
      toDate: "2026-10-04",
      spend: 1,
      revenue: 2,
      orders: 1,
      views: 10,
      clicks: 1,
      atc: 0,
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
  ],
  cursors: {
    ordersSince: "2026-10-04T12:00:00.000Z",
    catalogSince: "2026-10-05T00:00:00.000Z",
    stockSince: "2026-10-05T00:00:00.000Z",
    salesSince: "2026-10-05T00:00:00.000Z",
    feesSince: "2026-10-05T00:00:00.000Z",
    adsSince: null,
  },
} as unknown as AppState;

{
  const report = auditShopGaps("PRJ1", "t", okState, {
    expectedEnd: "2026-10-04",
    lookbackDays: 14,
    now: new Date("2026-10-05T08:00:00.000Z"),
    catalogStaleMs: 48 * 3600_000,
    stockStaleMs: 48 * 3600_000,
  });
  assert(report.domains.find((d) => d.domain === "sales")!.ok, "sales complete");
  assert(report.domains.find((d) => d.domain === "ads")!.ok, "ads complete");
}

// 2026-10-12 上海 10:00 → UTC 02:00；下午门禁前只要求到 10-10
{
  const morning = new Date("2026-10-12T02:00:00.000Z");
  assert(
    resolveLagExpectedEnd(morning, 14) === "2026-10-10",
    `morning lag end=${resolveLagExpectedEnd(morning, 14)}`,
  );
  assert(
    resolveSnapshotExpectedEnd(morning) === "2026-10-12",
    "snapshot end = today",
  );
  const afternoon = new Date("2026-10-12T07:00:00.000Z"); // 上海 15:00
  assert(
    resolveLagExpectedEnd(afternoon, 14) === "2026-10-11",
    `afternoon lag end=${resolveLagExpectedEnd(afternoon, 14)}`,
  );
}

// 上午：销量到前天即成功，不因缺昨天失败
{
  const morningState = {
    ...okState,
    salesFacts: [
      {
        partnerSku: "N1A",
        date: "2026-10-10",
        units: 1,
        amount: 10,
        updatedAt: "2026-10-11T00:00:00.000Z",
      },
    ],
    orders: [
      {
        orderNr: "o3",
        status: "delivered",
        currency: "SAR",
        totalAmount: 10,
        itemCount: 1,
        placedAt: "2026-10-10T12:00:00.000Z",
        updatedAt: "2026-10-10T12:00:00.000Z",
        rawVersion: "1",
      },
    ],
    adsFacts: [
      {
        partnerSku: "N1A",
        campaign: "c",
        fromDate: "2026-10-10",
        toDate: "2026-10-10",
        spend: 1,
        revenue: 2,
        orders: 1,
        views: 10,
        clicks: 1,
        atc: 0,
        updatedAt: "2026-10-11T00:00:00.000Z",
      },
    ],
    cursors: {
      ...okState.cursors,
      catalogSince: "2026-10-12T01:00:00.000Z",
      stockSince: "2026-10-12T01:00:00.000Z",
      feesSince: "2026-10-12T01:00:00.000Z",
    },
  } as unknown as AppState;
  const report = auditShopGaps("PRJ1", "t", morningState, {
    lookbackDays: 14,
    now: new Date("2026-10-12T02:00:00.000Z"),
    lagSyncHourShanghai: 14,
    catalogStaleMs: 48 * 3600_000,
    stockStaleMs: 48 * 3600_000,
  });
  assert(report.expectedEnd === "2026-10-10", `exp=${report.expectedEnd}`);
  assert(report.domains.find((d) => d.domain === "sales")!.ok, "morning sales ok");
  assert(report.complete, "morning complete with T-2 calendar + fresh snapshots");
}

console.log("OK gap-audit tests");
