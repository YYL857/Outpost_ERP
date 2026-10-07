/**
 * M4 自测：partnerSku upsert + 店铺前缀过滤 + 不删旧行
 * pnpm exec tsx src/platforms/feishu/ingest/ingest.test.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppState } from "../../../common/types.js";
import {
  inferStorePrefixes,
  ingestFeishuLocalIntoState,
} from "./local.js";

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

const root = join(tmpdir(), `outpost-feishu-ingest-${Date.now()}`);
const norm = join(root, "feishu-normalized");
const runId = "norm_test";
mkdirSync(join(norm, "runs", runId), { recursive: true });

const costPath = join(norm, "runs", runId, "feishu_local_cost_2026-09-17.csv");
const dimsPath = join(norm, "runs", runId, "feishu_dims_2026-09-17.csv");
writeFileSync(
  costPath,
  [
    "partnerSku,purchaseCost,headhaul,preferAir,updatedAt,source",
    "N1SA001,8,2,false,2026-09-17T00:00:00.000Z,feishu:test",
    "N2SA999,9,1,true,2026-09-17T00:00:00.000Z,feishu:test",
  ].join("\n") + "\n",
);
writeFileSync(
  dimsPath,
  [
    "partnerSku,lengthCm,widthCm,heightCm,weightKg,updatedAt,source",
    "N1SA001,10,20,30,0.5,2026-09-17T00:00:00.000Z,feishu:test",
  ].join("\n") + "\n",
);
writeFileSync(
  join(norm, "last-normalize.json"),
  JSON.stringify({
    runId,
    sourceRawRunId: "raw1",
    files: { localCost: costPath, dims: dimsPath },
  }),
  "utf8",
);

process.env.OUTPOST_FEISHU_NORMALIZED_DIR = norm;

const state = {
  catalog: [
    {
      partnerSku: "N1SA001",
      title: "A",
      isActive: true,
      noonSku: "Z1",
      imageUrl: "",
      price: 10,
      currency: "SAR",
      listingType: "",
      source: "NOON",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  skuLocalCosts: [
    {
      partnerSku: "N1SA001",
      purchaseCost: 1,
      headhaul: 1,
      preferAir: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "old",
    },
    {
      partnerSku: "N1KEEP",
      purchaseCost: 99,
      headhaul: 0,
      preferAir: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "manual",
    },
  ],
  skuDims: [],
  store: { id: "t", name: "t", account: "PRJ", platform: "NOON" },
} as unknown as AppState;

assertEq(inferStorePrefixes(state.catalog).join(","), "N1", "prefix N1");

const report = ingestFeishuLocalIntoState(state, {
  dryRun: false,
  normalizedRoot: norm,
});

assertEq(report.cost.matchedCatalog, 1, "matched catalog cost");
assertEq(report.cost.catalogMissing, 0, "no missing");
assert(report.cost.skippedOtherShop >= 1, "N2 filtered");
assertEq(state.skuLocalCosts.find((c) => c.partnerSku === "N1SA001")?.purchaseCost, 8, "upserted");
assertEq(state.skuLocalCosts.find((c) => c.partnerSku === "N1SA001")?.normalizeRunId, runId, "trace run");
assert(
  state.skuLocalCosts.some((c) => c.partnerSku === "N1KEEP" && c.purchaseCost === 99),
  "未在 CSV 的旧行保留（不丢）",
);
assert(!state.skuLocalCosts.some((c) => c.partnerSku === "N2SA999"), "other shop not ingested");
assertEq(state.skuDims.length, 1, "dims upserted");

rmSync(root, { recursive: true, force: true });
console.log("OK feishu ingest tests");
