/**
 * npx tsx --test src/modules/sync/stock-scheduler.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeStockWindow } from "./stock-scheduler.js";

describe("stock-scheduler windows", () => {
  it("detects Shanghai 09:30 am window", () => {
    // 2026-10-13 09:35 Asia/Shanghai = 01:35 UTC
    const now = new Date("2026-10-13T01:35:00.000Z");
    const w = activeStockWindow(now);
    assert.deepEqual(w, { ymd: "2026-10-13", window: "am" });
  });

  it("detects Shanghai 16:00 pm window", () => {
    // 2026-10-13 16:05 Asia/Shanghai = 08:05 UTC
    const now = new Date("2026-10-13T08:05:00.000Z");
    const w = activeStockWindow(now);
    assert.deepEqual(w, { ymd: "2026-10-13", window: "pm" });
  });

  it("outside grace is null", () => {
    // 2026-10-13 10:00 Asia/Shanghai = 02:00 UTC（过了 am 窗）
    const now = new Date("2026-10-13T02:00:00.000Z");
    assert.equal(activeStockWindow(now), null);
  });
});
