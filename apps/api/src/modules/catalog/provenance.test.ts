/**
 * pnpm exec tsx src/modules/catalog/provenance.test.ts
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAdsProvenance, buildCatalogProvenance, findLatestAdsImportFile } from "./provenance.js";
import { pickLatestAdsSkuFile } from "../../platforms/noon/portal/auto-ingest.js";
import type { AppState } from "../../common/types.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const root = join(tmpdir(), `outpost-prov-${Date.now()}`);
const importDir = join(root, "portal-imports");
mkdirSync(importDir, { recursive: true });
process.env.OUTPOST_IMPORT_DIR = importDir;

writeFileSync(
  join(importDir, "ads_sku_2026-08-17_2026-09-16.csv"),
  "sku,campaign_name,from_date,to_date,spend,revenue,orders,views,clicks\nOLD,c,2026-08-17,2026-09-16,1,2,0,0,0\n",
  "utf8",
);
writeFileSync(
  join(importDir, "ads_sku_2026-09-16_2026-09-16.csv"),
  "sku,campaign_name,from_date,to_date,spend,revenue,orders,views,clicks\nNEW,c,2026-09-16,2026-09-16,9,9,0,0,0\n",
  "utf8",
);

const picked = pickLatestAdsSkuFile(importDir);
assert(
  picked?.fileName === "ads_sku_2026-09-16_2026-09-16.csv",
  `pick latest got ${picked?.fileName}`,
);

const found = findLatestAdsImportFile();
assert(found?.fileName === "ads_sku_2026-09-16_2026-09-16.csv", "latest file");

const state = {
  adsFacts: [
    {
      partnerSku: "NEW",
      campaign: "c",
      fromDate: "2026-09-16",
      toDate: "2026-09-16",
      spend: 9,
      revenue: 9,
      orders: 0,
      views: 0,
      clicks: 0,
      atc: 0,
      updatedAt: "2026-09-17T03:00:00.000Z",
    },
  ],
  noon: { portal: { lastImportAt: null, lastFetchAt: null } },
} as unknown as AppState;

const ads = buildAdsProvenance(state);
assert(ads.source === "yingdao-ads", "source");
assert(ads.fileName?.includes("2026-09-16_2026-09-16"), "fileName newest");

const now = new Date().toISOString();
const full = buildCatalogProvenance({
  noon: { portal: { lastFetchAt: now, lastImportAt: null, lastImportSummary: null } },
  catalog: [{ updatedAt: now }],
  stock: [{ updatedAt: "2020-01-02T00:00:00.000Z" }],
  salesFacts: [
    { date: "2026-09-01", updatedAt: now },
    { date: "2026-09-18", updatedAt: now },
  ],
  feeSnapshots: [],
  feeEstimates: [{ updatedAt: "2026-09-01T00:00:00.000Z" }],
  skuLocalCosts: [{ updatedAt: "2020-06-01T00:00:00.000Z", source: "feishu:cost" }],
  skuDims: [],
  adsFacts: state.adsFacts,
  shipping: { updatedAt: "2020-03-01T00:00:00.000Z" },
  syncJobs: [],
} as unknown as AppState);
assert(full.today.length === 10, `today ${full.today}`);
assert(full.slices.length === 8, `slices ${full.slices.length}`);
const salesSlice = full.slices.find((s) => s.key === "sales");
assert(
  salesSlice?.dataNode === "成交日 2026-09-01 → 2026-09-18",
  `sales node ${salesSlice?.dataNode}`,
);
assert(salesSlice?.syncedToday === true, "sales ingested today");
const stockSlice = full.slices.find((s) => s.key === "stock");
assert(stockSlice?.syncedToday === false, "old stock is not today");
const feeSlice = full.slices.find((s) => s.key === "fees");
assert(feeSlice?.source === "Noon 估费", `fee source ${feeSlice?.source}`);
const costSlice = full.slices.find((s) => s.key === "cost");
assert(costSlice?.source.includes("飞书"), `cost source ${costSlice?.source}`);

rmSync(root, { recursive: true, force: true });
console.log("OK provenance tests");
