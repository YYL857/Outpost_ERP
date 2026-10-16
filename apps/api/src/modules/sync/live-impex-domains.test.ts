import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppState } from "../../common/types.js";
import {
  applyStockLedgerSnapshot,
  needsCatalogImpexRefresh,
  needsOrdersCatchUp,
  needsStockImpexRefresh,
  pickLiveImpexDomains,
  pickLivePollDomain,
  prepareStockLedgerSnapshot,
  stockLastImpexAt,
  stockRefreshStaleMs,
} from "./live-impex-domains.js";
import { resolveLagExpectedEnd } from "./gap-audit.js";

function freshStockJobs() {
  const now = new Date().toISOString();
  return [
    {
      id: "job-catalog",
      domain: "catalog" as const,
      status: "success" as const,
      lastSuccessAt: now,
      lastError: null,
      backlog: 0,
      latencyMinutes: 1,
    },
    {
      id: "job-stock",
      domain: "stock" as const,
      status: "success" as const,
      lastSuccessAt: now,
      lastError: null,
      backlog: 0,
      latencyMinutes: 1,
    },
  ];
}

function baseState(partial: Partial<AppState> & { catalogLen?: number }): AppState {
  const catalogLen = partial.catalogLen ?? 10;
  const catalog = Array.from({ length: catalogLen }, (_, i) => ({
    partnerSku: `SKU${i}`,
    updatedAt: "2026-09-19T06:42:24.000Z",
  })) as AppState["catalog"];
  const nowIso = new Date().toISOString();
  const lagEnd = resolveLagExpectedEnd(new Date());
  return {
    catalog,
    stock: [
      {
        partnerSku: "SKU0",
        warehouseCode: "RUH01S",
        fulfillment: "fbn",
        qty: 1,
        inTransitQty: 0,
        updatedAt: nowIso,
      },
    ] as AppState["stock"],
    salesFacts: [{ partnerSku: "x" }] as AppState["salesFacts"],
    feeSnapshots: [{ partnerSku: "x" }] as AppState["feeSnapshots"],
    orders: [
      {
        orderNr: "1",
        placedAt: `${lagEnd}T12:00:00.000Z`,
        status: "delivered",
      },
    ] as AppState["orders"],
    cursors: {
      ordersSince: nowIso,
      catalogSince: null,
      stockSince: nowIso,
      salesSince: null,
      feesSince: null,
      adsSince: null,
    },
    syncJobs: [
      {
        id: "job-catalog",
        domain: "catalog",
        status: "success",
        lastSuccessAt: "2026-09-19T06:42:24.533Z",
        lastError: null,
        backlog: 0,
        latencyMinutes: 1,
      },
      {
        id: "job-stock",
        domain: "stock",
        status: "success",
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        backlog: 0,
        latencyMinutes: 1,
      },
    ],
    noon: {
      portal: { lastImportAt: "2026-09-19T06:42:24.000Z" },
    },
    ...partial,
  } as AppState;
}

describe("live-impex-domains", () => {
  it("stale catalog needs refresh", () => {
    const state = baseState({});
    const now = Date.parse("2026-09-20T05:00:00.000Z");
    assert.equal(needsCatalogImpexRefresh(state, now), true);
  });

  it("fresh catalog does not need refresh", () => {
    const state = baseState({
      syncJobs: freshStockJobs(),
    } as Partial<AppState>);
    const now = Date.parse("2026-09-20T05:00:00.000Z");
    state.syncJobs = [
      {
        id: "job-catalog",
        domain: "catalog",
        status: "success",
        lastSuccessAt: "2026-09-20T04:00:00.000Z",
        lastError: null,
        backlog: 0,
        latencyMinutes: 1,
      },
      {
        id: "job-stock",
        domain: "stock",
        status: "success",
        lastSuccessAt: "2026-09-20T04:00:00.000Z",
        lastError: null,
        backlog: 0,
        latencyMinutes: 1,
      },
    ];
    assert.equal(needsCatalogImpexRefresh(state, now), false);
  });

  it("poller inserts catalog when stale", () => {
    const state = baseState({});
    assert.equal(pickLivePollDomain(state, 0), "catalog");
  });

  it("poller rotates sales/fees/orders when fresh", () => {
    const state = baseState({
      syncJobs: [
        {
          id: "job-catalog",
          domain: "catalog",
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          backlog: 0,
          latencyMinutes: 1,
        },
        {
          id: "job-stock",
          domain: "stock",
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          backlog: 0,
          latencyMinutes: 1,
        },
      ],
      cursors: {
        ordersSince: null,
        catalogSince: null,
        stockSince: new Date().toISOString(),
        salesSince: null,
        feesSince: null,
        adsSince: null,
      },
    } as Partial<AppState>);
    assert.equal(pickLivePollDomain(state, 0), "sales");
    assert.equal(pickLivePollDomain(state, 1), "fees");
    assert.equal(pickLivePollDomain(state, 2), "orders");
  });

  it("poller inserts stock when catalog fresh but stock empty", () => {
    const state = baseState({
      stock: [],
      syncJobs: [
        {
          id: "job-catalog",
          domain: "catalog",
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          backlog: 0,
          latencyMinutes: 1,
        },
      ],
    } as Partial<AppState>);
    assert.equal(pickLivePollDomain(state, 0), "stock");
    assert.deepEqual(pickLiveImpexDomains(state), ["stock"]);
  });

  it("assembly picks catalog+sales when stale and filled", () => {
    const state = baseState({});
    assert.deepEqual(pickLiveImpexDomains(state), ["catalog", "sales"]);
  });

  it("assembly picks sales+fees when fresh", () => {
    const state = baseState({
      syncJobs: [
        {
          id: "job-catalog",
          domain: "catalog",
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          backlog: 0,
          latencyMinutes: 1,
        },
        {
          id: "job-stock",
          domain: "stock",
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          backlog: 0,
          latencyMinutes: 1,
        },
      ],
      cursors: {
        ordersSince: null,
        catalogSince: null,
        stockSince: new Date().toISOString(),
        salesSince: null,
        feesSince: null,
        adsSince: null,
      },
    } as Partial<AppState>);
    assert.deepEqual(pickLiveImpexDomains(state), ["sales", "fees"]);
  });

  it("empty catalog always catalog", () => {
    const state = baseState({ catalog: [], catalogLen: 0 } as Partial<AppState>);
    state.catalog = [];
    assert.deepEqual(pickLiveImpexDomains(state), ["catalog"]);
    assert.equal(pickLivePollDomain(state, 9), "catalog");
  });

  it("catalog hint job success does not count as stock ledger pull", () => {
    const state = baseState({
      syncJobs: [
        {
          id: "job-catalog",
          domain: "catalog",
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          backlog: 0,
          latencyMinutes: 1,
        },
        {
          id: "job-stock",
          domain: "stock",
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          backlog: 0,
          latencyMinutes: 1,
        },
      ],
      cursors: {
        ordersSince: null,
        catalogSince: null,
        stockSince: null,
        salesSince: null,
        feesSince: null,
        adsSince: null,
      },
    } as Partial<AppState>);
    assert.equal(stockLastImpexAt(state), null);
    assert.equal(needsStockImpexRefresh(state), true);
    assert.equal(pickLivePollDomain(state, 0), "stock");
  });

  it("only FBN hint warehouse is not real ledger", () => {
    const state = baseState({
      stock: [
        {
          partnerSku: "SKU0",
          warehouseCode: "FBN",
          fulfillment: "fbn",
          qty: 5,
          inTransitQty: 0,
          updatedAt: new Date().toISOString(),
        },
      ],
      syncJobs: [
        {
          id: "job-catalog",
          domain: "catalog",
          status: "success",
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          backlog: 0,
          latencyMinutes: 1,
        },
      ],
      cursors: {
        ordersSince: null,
        catalogSince: null,
        stockSince: null,
        salesSince: null,
        feesSince: null,
        adsSince: null,
      },
    } as Partial<AppState>);
    assert.equal(needsStockImpexRefresh(state), true);
  });

  it("prepareStockLedgerSnapshot drops hints and old fbn rows", () => {
    const state = baseState({
      stock: [
        {
          partnerSku: "SKU0",
          warehouseCode: "FBN",
          fulfillment: "fbn",
          qty: 5,
          inTransitQty: 0,
          updatedAt: new Date().toISOString(),
        },
        {
          partnerSku: "SKU0",
          warehouseCode: "RUH01S",
          fulfillment: "fbn",
          qty: 1,
          inTransitQty: 0,
          updatedAt: new Date().toISOString(),
        },
        {
          partnerSku: "SKU0",
          warehouseCode: "WH-FBP",
          fulfillment: "fbp",
          qty: 3,
          inTransitQty: 0,
          updatedAt: new Date().toISOString(),
        },
      ],
    } as Partial<AppState>);
    prepareStockLedgerSnapshot(state);
    assert.equal(state.stock.length, 1);
    assert.equal(state.stock[0]!.warehouseCode, "WH-FBP");
    assert.equal(state.stock[0]!.qty, 3);
  });

  it("applyStockLedgerSnapshot keeps FBP, replaces FBN, drops catalog hints", () => {
    const state = baseState({
      stock: [
        {
          partnerSku: "SKU0",
          warehouseCode: "FBN",
          fulfillment: "fbn",
          qty: 99,
          inTransitQty: 0,
          updatedAt: "2026-10-01",
        },
        {
          partnerSku: "SKU0",
          warehouseCode: "RUH01S",
          fulfillment: "fbn",
          qty: 1,
          inTransitQty: 0,
          updatedAt: "2026-10-01",
        },
        {
          partnerSku: "SKU0",
          warehouseCode: "WH-FBP",
          fulfillment: "fbp",
          qty: 3,
          inTransitQty: 0,
          updatedAt: "2026-10-01",
        },
      ],
      portalCache: {
        orders: [],
        catalog: [],
        stock: [],
        sales: [],
        fees: [],
        ads: [],
        updatedAt: null,
      },
    } as Partial<AppState>);
    const n = applyStockLedgerSnapshot(state, [
      {
        partner_sku: "SKU0",
        warehouse_code: "RUH01S",
        fulfillment: "fbn",
        qty: 40,
        in_transit_qty: 2,
        updated_at: "2026-10-08",
      },
      {
        partner_sku: "SKU1",
        warehouse_code: "RUHMS01",
        fulfillment: "supermall",
        qty: 7,
        in_transit_qty: 0,
        updated_at: "2026-10-08",
      },
    ]);
    assert.equal(n, 2);
    assert.equal(state.stock.length, 3);
    const fbp = state.stock.find((s) => s.fulfillment === "fbp");
    assert.equal(fbp?.qty, 3);
    const fbn = state.stock.find((s) => s.warehouseCode === "RUH01S");
    assert.equal(fbn?.qty, 40);
    assert.equal(fbn?.inTransitQty, 2);
    assert.ok(!state.stock.some((s) => s.warehouseCode === "FBN"));
    assert.equal(state.portalCache.stock.length, 2);
  });

  it("applyStockLedgerSnapshot empty rows leave stock untouched", () => {
    const state = baseState({
      stock: [
        {
          partnerSku: "SKU0",
          warehouseCode: "RUH01S",
          fulfillment: "fbn",
          qty: 12,
          inTransitQty: 0,
          updatedAt: "2026-10-01",
        },
      ],
    } as Partial<AppState>);
    assert.throws(
      () => applyStockLedgerSnapshot(state, []),
      /为空|无行/,
    );
    assert.equal(state.stock.length, 1);
    assert.equal(state.stock[0]!.qty, 12);
  });

  it("applyStockLedgerSnapshot rewrites after wipe with same updated_at payload", () => {
    const state = baseState({
      stock: [],
      portalCache: {
        orders: [],
        catalog: [],
        stock: [],
        sales: [],
        fees: [],
        ads: [],
        updatedAt: null,
      },
    } as Partial<AppState>);
    const row = {
      partner_sku: "SKU0",
      warehouse_code: "RUH01S",
      fulfillment: "fbn" as const,
      qty: 5,
      in_transit_qty: 0,
      updated_at: "2026-10-08",
    };
    applyStockLedgerSnapshot(state, [row]);
    assert.equal(state.stock[0]!.qty, 5);
    // 模拟旧路径：prepare 清空后 inbox duplicate 跳过 → stock 空
    state.stock = [];
    applyStockLedgerSnapshot(state, [{ ...row, qty: 99 }]);
    assert.equal(state.stock.length, 1);
    assert.equal(state.stock[0]!.qty, 99);
    assert.equal(state.stock[0]!.warehouseCode, "RUH01S");
  });

  it("stockRefreshStaleMs defaults to 14h", () => {
    const prev = process.env.OUTPOST_LIVE_STOCK_REFRESH_MS;
    delete process.env.OUTPOST_LIVE_STOCK_REFRESH_MS;
    try {
      assert.equal(stockRefreshStaleMs(), 14 * 60 * 60 * 1000);
    } finally {
      if (prev === undefined) delete process.env.OUTPOST_LIVE_STOCK_REFRESH_MS;
      else process.env.OUTPOST_LIVE_STOCK_REFRESH_MS = prev;
    }
  });

  it("orders catch-up when max placedAt behind expectedEnd", () => {
    const now = new Date();
    const expected = resolveLagExpectedEnd(now);
    const state = baseState({
      orders: [
        {
          orderNr: "old",
          placedAt: "2026-01-01T00:00:00.000Z",
          status: "delivered",
        },
      ],
      cursors: {
        ordersSince: now.toISOString(),
        catalogSince: null,
        stockSince: now.toISOString(),
        salesSince: null,
        feesSince: null,
        adsSince: null,
      },
      syncJobs: freshStockJobs(),
    } as Partial<AppState>);
    assert.ok(expected > "2026-01-01");
    assert.equal(needsOrdersCatchUp(state, now.getTime()), true);
    assert.equal(pickLivePollDomain(state, 0, now.getTime()), "orders");
  });

  it("stale stock does not preempt orders catch-up", () => {
    const now = new Date();
    const state = baseState({
      orders: [],
      syncJobs: freshStockJobs(),
      cursors: {
        ordersSince: "2026-01-01T00:00:00.000Z",
        catalogSince: null,
        stockSince: "2026-01-01T00:00:00.000Z",
        salesSince: null,
        feesSince: null,
        adsSince: null,
      },
    } as Partial<AppState>);
    assert.equal(needsStockImpexRefresh(state, now.getTime()), true);
    assert.equal(needsOrdersCatchUp(state, now.getTime()), true);
    assert.equal(pickLivePollDomain(state, 0, now.getTime()), "orders");
    assert.equal(pickLiveImpexDomains(state, now.getTime())[0], "orders");
  });
});
