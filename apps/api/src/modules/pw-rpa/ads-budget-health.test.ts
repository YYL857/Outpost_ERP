/**
 * tsx src/modules/pw-rpa/ads-budget-health.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listNeedsBaseline } from "./ads-budget-baseline.js";

const root = mkdtempSync(join(tmpdir(), "ads-budget-health-"));
process.env.OUTPOST_DATA_ROOT = root;

const shop = "PRJTEST01";
const dir = join(root, "shops", shop, "ads-budget");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "baseline.csv"),
  [
    "shopId,campaignId,campaignName,psku,baselineBudget,offpeakBudget,lastSeenBudget,mode,enabled,updatedAt,needsBaseline,updatedBy",
    `${shop},C_OK,ok,SKU1,10,5,10,peak,1,2026-10-01T00:00:00Z,0,test`,
    `${shop},C_NEED,need,SKU2,,5,5,offpeak,1,2026-10-01T00:00:00Z,1,sync-offline`,
    "",
  ].join("\n"),
  "utf8",
);

const report = listNeedsBaseline([shop, "PRJEMPTY"]);
assert.equal(report.needsBaseline.length, 1);
assert.equal(report.needsBaseline[0]?.shopId, shop);
assert.equal(report.needsBaseline[0]?.count, 1);
assert.deepEqual(report.needsBaseline[0]?.campaigns, ["C_NEED"]);

rmSync(root, { recursive: true, force: true });
console.log("pw-rpa ads-budget-health ok");
