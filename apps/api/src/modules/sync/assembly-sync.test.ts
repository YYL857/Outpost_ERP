/**
 * 汇总链自测：跳过外部依赖时的编排 / 互斥
 * pnpm exec tsx src/modules/sync/assembly-sync.test.ts
 */
import type { AppState } from "../../common/types.js";
import {
  getLastAssemblySync,
  isAssemblySyncRunning,
  runAssemblySync,
} from "./assembly-sync.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const root = join(tmpdir(), `outpost-asm-${Date.now()}`);
const dataDir = join(root, "json");
mkdirSync(dataDir, { recursive: true });
process.env.OUTPOST_ROOT = root;
process.env.OUTPOST_DATA_DIR = dataDir;

writeFileSync(
  join(dataDir, "state.json"),
  JSON.stringify({
    store: { id: "t", name: "t", account: "PRJ", platform: "NOON" },
    noon: {
      mode: "live",
      enabled: true,
      partnerId: "",
      apiKey: "",
      apiSecret: "",
      webhookSecret: "",
      baseUrl: "",
      countryCode: "sa",
      lastError: null,
      portal: {
        portalUrl: "",
        cookie: "",
        ordersUrl: "",
        catalogUrl: "",
        stockUrl: "",
        lastFetchAt: null,
        lastImportAt: null,
        lastImportSummary: null,
      },
    },
    cursors: {},
    shipping: {
      airFreightAedPerKg: 0,
      airLeadDays: 7,
      seaFreightAedPerCbm: 0,
      seaLeadDays: 30,
      airFreightRmbPerKg: 65,
      seaFreightRmbPerCbmPlug: 2200,
      seaFreightRmbPerCbmBuiltin: 2400,
      seaFreightRmbPerCbmGeneral: 1830,
      buybackRate: 1.9,
      volumetricDivisor: 5000,
      updatedAt: new Date().toISOString(),
    },
    review: { costPerReview: 0 },
    syncJobs: [],
    syncAlerts: [],
    inbox: [],
    orders: [],
    catalog: [],
    stock: [],
    salesFacts: [],
    feeSnapshots: [],
    feeEstimates: [],
    adsFacts: [],
    skuLocalCosts: [],
    skuDims: [],
    replenishConfigs: [],
    listings: [],
    favorites: [],
    portalCache: {
      orders: [],
      catalog: [],
      stock: [],
      sales: [],
      fees: [],
      ads: [],
    },
  }),
  "utf8",
);

const state = {
  catalog: [],
  noon: {
    enabled: true,
    mode: "live",
    portal: {
      lastFetchAt: null,
      lastImportSummary: null,
      portalUrl: "",
      cookie: "",
      ordersUrl: "",
      catalogUrl: "",
      stockUrl: "",
      lastImportAt: null,
    },
  },
  syncAlerts: [],
} as unknown as AppState;

assert(!isAssemblySyncRunning(), "not running initially");

const r = await runAssemblySync(state, {
  triggeredBy: "manual",
  skipNoon: true,
  skipAds: true,
  skipFeishu: true,
  skipOpsDaily: true,
});

assert(r.ok === true, "skip-all ok");
assert(r.stages.length === 8, `8 stages incl ops_daily got=${r.stages.length}`);
assert(r.stages.every((s) => s.skipped), "all skipped");
assert(
  r.stages.some((s) => s.name === "wiki_graph"),
  "wiki_graph stage present",
);
assert(
  r.stages.some((s) => s.name === "ops_daily"),
  "ops_daily stage present",
);
assert(getLastAssemblySync()?.runId === r.runId, "last persisted in memory");
assert(!isAssemblySyncRunning(), "not running after");

// 并发：第二个应排队，不应抛「正在进行中」（锁串行）
const p1 = runAssemblySync(state, {
  skipNoon: true,
  skipAds: true,
  skipFeishu: true,
  skipOpsDaily: true,
});
const p2 = runAssemblySync(state, {
  skipNoon: true,
  skipAds: true,
  skipFeishu: true,
  skipOpsDaily: true,
});
const [a, b] = await Promise.all([p1, p2]);
assert(a.runId !== b.runId, "queued two runs");

rmSync(root, { recursive: true, force: true });
console.log("OK assembly-sync tests");
