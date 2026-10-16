/**
 * tsx src/modules/pw-rpa/ads-budget-baseline.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteBaselineRow,
  importBaselineBudgets,
  listBaseline,
  loadBaseline,
  patchBaselineRow,
  saveBaseline,
  upsertBaselineRow,
  type AdsBudgetBaselineRow,
} from "./ads-budget-baseline.js";

const root = mkdtempSync(join(tmpdir(), "ads-budget-bl-"));
process.env.OUTPOST_DATA_DIR = root;

const shop = "PRJ488078";
const seed: AdsBudgetBaselineRow[] = [
  {
    shopId: shop,
    campaignId: "C_A",
    campaignName: "N3SADD001WHT-test",
    psku: "N3SADD001WHT",
    baselineBudget: 10,
    offpeakBudget: 5,
    lastSeenBudget: 5,
    mode: "offpeak",
    enabled: true,
    updatedAt: "2026-10-13T00:00:00Z",
    needsBaseline: false,
    updatedBy: "sync-refresh",
  },
];
saveBaseline(shop, seed);

const listed = listBaseline(shop);
assert.equal(listed.rows.length, 1);
assert.equal(listed.rows[0].baselineBudget, 10);
assert.equal(listed.rows[0].offpeakBudget, 5);
assert.equal(listed.rows[0].lastSeenBudget, 5);

const patched = patchBaselineRow(
  shop,
  "C_A",
  { baselineBudget: 12, offpeakBudget: 8 },
  "ui",
);
assert.equal(patched.baselineBudget, 12);
assert.equal(patched.offpeakBudget, 8);
assert.equal(patched.updatedBy, "ui");
assert.equal(patched.needsBaseline, false);
// 观测列不可被 patch 逻辑改掉
assert.equal(loadBaseline(shop)[0].lastSeenBudget, 5);

upsertBaselineRow(
  shop,
  {
    campaignId: "C_B",
    psku: "N3SADD002WHT",
    baselineBudget: 8,
    campaignName: "N3SADD002WHT-x",
  },
  "ui",
);
assert.equal(loadBaseline(shop).length, 2);
assert.equal(loadBaseline(shop).find((r) => r.campaignId === "C_B")?.offpeakBudget, 5);

assert.equal(deleteBaselineRow(shop, "C_B"), true);
assert.equal(loadBaseline(shop).length, 1);

const imported = importBaselineBudgets(
  shop,
  [
    { campaignId: "C_A", baselineBudget: 20, offpeakBudget: 6 },
    { campaignId: "C_NOPE", baselineBudget: 1 },
  ],
  "ui-import",
);
assert.equal(imported.updated, 1);
assert.equal(imported.skipped, 1);
assert.equal(loadBaseline(shop)[0].baselineBudget, 20);
assert.equal(loadBaseline(shop)[0].offpeakBudget, 6);
assert.equal(loadBaseline(shop)[0].lastSeenBudget, 5);

rmSync(root, { recursive: true, force: true });
console.log("ads-budget-baseline ok");
