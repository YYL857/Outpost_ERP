/**
 * npx tsx --test src/modules/replenish/after-stock-sync.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import {
  clearReplenishRebuildDebounceForTests,
  notifyStockOrCatalogSynced,
  replenishRebuildDebounceMs,
  scheduleReplenishRebuildDebounced,
} from "./after-stock-sync.js";

afterEach(() => {
  clearReplenishRebuildDebounceForTests();
  delete process.env.OUTPOST_REPLENISH_REBUILD_DEBOUNCE_MS;
});

describe("replenish rebuild debounce", () => {
  it("default debounce is 3 minutes", () => {
    assert.equal(replenishRebuildDebounceMs(), 180_000);
  });

  it("env override respects 30s floor", () => {
    process.env.OUTPOST_REPLENISH_REBUILD_DEBOUNCE_MS = "5000";
    assert.equal(replenishRebuildDebounceMs(), 30_000);
    process.env.OUTPOST_REPLENISH_REBUILD_DEBOUNCE_MS = "120000";
    assert.equal(replenishRebuildDebounceMs(), 120_000);
  });

  it("notify ignores non stock/catalog domains", () => {
    // 不应抛错；不挂定时器到未知店也无所谓
    notifyStockOrCatalogSynced("shop-test", "orders");
    notifyStockOrCatalogSynced("shop-test", "sales");
    scheduleReplenishRebuildDebounced("");
  });
});
