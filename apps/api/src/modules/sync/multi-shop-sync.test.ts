/**
 * pnpm exec tsx --test src/modules/sync/multi-shop-sync.test.ts
 * 或: node --import tsx --test src/modules/sync/multi-shop-sync.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { join, resolve } from "node:path";
import type { AppState } from "../../common/types.js";
import { runWithContext, SYSTEM_SYNC_USER } from "../../auth/context.js";
import {
  impexCooldownKey,
  isImpexCoolingDown,
  markImpexExportLimitHit,
  resetImpexCooldownsForTests,
} from "../../platforms/noon/impex-client.js";
import { getImportDir } from "../../platforms/noon/portal/auto-ingest.js";
import { loadRegistry } from "../../shops/registry.js";
import { shopNoonHungerScore } from "./multi-shop-sync.js";

function baseState(partial: Partial<AppState> & { catalogLen?: number }): AppState {
  const catalogLen = partial.catalogLen ?? 10;
  const catalog = Array.from({ length: catalogLen }, (_, i) => ({
    partnerSku: `SKU${i}`,
  })) as AppState["catalog"];
  return {
    catalog,
    stock: [],
    salesFacts: [{ partnerSku: "x" }] as AppState["salesFacts"],
    feeSnapshots: [{ partnerSku: "x" }] as AppState["feeSnapshots"],
    orders: [{ orderNr: "1" }] as AppState["orders"],
    syncJobs: [],
    noon: {
      portal: { lastFetchAt: "2026-09-20T00:00:00.000Z", lastImportAt: null },
    },
    ...partial,
  } as AppState;
}

describe("shopNoonHungerScore", () => {
  it("empty catalog scores highest", () => {
    const empty = shopNoonHungerScore(baseState({ catalogLen: 0 }));
    const filled = shopNoonHungerScore(baseState({ catalogLen: 5 }));
    assert.ok(empty > filled);
    assert.ok(empty >= 1000);
  });

  it("missing sales/fees increases score", () => {
    const full = shopNoonHungerScore(baseState({}));
    const noSales = shopNoonHungerScore(
      baseState({ salesFacts: [] as AppState["salesFacts"] }),
    );
    assert.ok(noSales > full);
  });
});

describe("impex cooldown per shop", () => {
  beforeEach(() => {
    resetImpexCooldownsForTests();
  });

  it("A 店冷却不堵 B 店", () => {
    markImpexExportLimitHit(60_000, "SHOP_A");
    assert.equal(isImpexCoolingDown("SHOP_A"), true);
    assert.equal(isImpexCoolingDown("SHOP_B"), false);
  });

  it("context shopId 分桶", () => {
    runWithContext({ shopId: "CTX_A", user: SYSTEM_SYNC_USER }, () => {
      markImpexExportLimitHit(60_000);
      assert.equal(impexCooldownKey(), "shop:CTX_A");
      assert.equal(isImpexCoolingDown(), true);
    });
    runWithContext({ shopId: "CTX_B", user: SYSTEM_SYNC_USER }, () => {
      assert.equal(isImpexCoolingDown(), false);
    });
  });
});

describe("getImportDir by shop context", () => {
  it("resolves shops/{id}/portal-imports under ALS", () => {
    const shop = loadRegistry().shops[0];
    assert.ok(shop);
    const dir = runWithContext({ shopId: shop.id, user: SYSTEM_SYNC_USER }, () =>
      getImportDir(),
    );
    const expected = resolve(join(shop.rootDir, "portal-imports"));
    assert.equal(dir, expected);
  });
});
