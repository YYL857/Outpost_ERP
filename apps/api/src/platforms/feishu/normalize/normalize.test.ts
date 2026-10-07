/**
 * M3 自测：单元格清洗 + 产品规范化（拼 PSKU / 每日成本主源）
 * pnpm exec tsx src/platforms/feishu/normalize/normalize.test.ts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidPartnerSku, parseNumber } from "./cells.js";
import { normalizePackingSnapshot } from "./packing.js";
import { normalizeProductSnapshot } from "./product.js";
import { normalizeFeishuRun } from "./index.js";
import type { FeishuRawSnapshot } from "../types.js";
import { isFeishuError } from "../errors.js";

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

assert(isValidPartnerSku("N1SAAFWO001WHT"), "valid psku");
assert(!isValidPartnerSku("ARRAYFORMULA(IF("), "reject formula");
assertEq(parseNumber("12.5"), 12.5, "parse num");

const snap: FeishuRawSnapshot = {
  version: 1,
  pulledAt: "2026-09-17T00:00:00.000Z",
  docId: "product",
  docLabel: "产品表",
  targetDomain: "local_cost_dims",
  kind: "spreadsheet",
  spreadsheetToken: "TOK",
  source: { appIdMasked: "cli…" },
  sheets: [
    {
      sheetId: "s1",
      title: "产品",
      rowCount: 3,
      colCount: 12,
      values: [
        [
          "PSKU",
          "原价",
          "佣金",
          "名称",
          "默认补货方式",
          "店铺代码",
          "类目代码",
          "款式代码",
          "颜色",
          "长",
          "宽",
          "高",
          "重量",
        ],
        [
          "",
          99,
          5,
          "玩偶",
          "空运",
          "N1",
          "AFWO",
          1,
          "白色",
          10,
          20,
          30,
          0.5,
        ],
        ["N1SA002", 40, 3, "别的", "海运", "N1", "XXXX", 2, "黑色", 5, 5, 5, 0.2],
      ],
    },
    {
      sheetId: "lookup",
      title: "查找代码表",
      rowCount: 3,
      colCount: 6,
      values: [
        ["颜色", "代码", "英文名", "StoreCode", "StoreName", "Site"],
        ["白色", "WHT", "White", "N1", "Shop", "SA"],
        ["黑色", "BLK", "Black", "", "", ""],
      ],
    },
    {
      sheetId: "s2",
      title: "产品表每日信息",
      rowCount: 3,
      colCount: 3,
      values: [
        ["psku", "sku_child", "采购单价"],
        ["N1SAAFWO001WHT", "Z1", 8],
        ["N1SA002", "Z2", 7.5],
      ],
    },
    {
      sheetId: "s3",
      title: "到仓成本",
      rowCount: 3,
      colCount: 3,
      values: [
        ["PSKU", "运输方式", "最终单件SKU成本"],
        ["N1SAAFWO001WHT", "空运", 18],
        ["N1SA002", "海运", 10],
      ],
    },
  ],
};

const built = normalizeProductSnapshot(snap, "2026-09-17T12:00:00.000Z");
assertEq(built.costs.length, 2, "two cost rows from daily+landed");
const c1 = built.costs.find((c) => c.partnerSku === "N1SAAFWO001WHT")!;
assert(c1, "reconstructed psku cost");
assertEq(c1.purchaseCost, 8, "purchase");
assertEq(c1.preferAir, true, "prefer air from product row");
assertEq(c1.headhaul, 10, "headhaul 18-8");
assertEq(c1.cargoType, "general", "default cargoType general");
const c2 = built.costs.find((c) => c.partnerSku === "N1SA002")!;
assertEq(c2.headhaul, 2.5, "landed-purchase");
assertEq(c2.cargoType, "general", "c2 cargoType default");
assert(
  built.dims.some((d) => d.partnerSku === "N1SAAFWO001WHT" && d.lengthCm === 10),
  "dims via reconstructed psku",
);

const packingSnap: FeishuRawSnapshot = {
  version: 1,
  pulledAt: "2026-09-17T00:00:00.000Z",
  docId: "packing",
  docLabel: "装箱表",
  targetDomain: "packing",
  kind: "spreadsheet",
  spreadsheetToken: "TOK2",
  source: { appIdMasked: "cli…" },
  sheets: [
    {
      sheetId: "sku",
      title: "SKU信息",
      rowCount: 3,
      colCount: 6,
      values: [
        ["PSKU", "长", "宽", "高", "重量"],
        ["N1PACK001", 12, 8, 3, 0.04],
        ["N1SAAFWO001WHT", 99, 99, 99, 9],
      ],
    },
  ],
};
const packBuilt = normalizePackingSnapshot(packingSnap, "2026-09-17T12:00:00.000Z");
assertEq(packBuilt.dims.length, 2, "packing dims");
assertEq(packBuilt.dims[0]!.source, "feishu:packing", "packing source");
assert(
  packBuilt.dims.some((d) => d.partnerSku === "N1PACK001" && d.weightKg === 0.04),
  "packing weight",
);

// --- disk orchestrator ---
const root = join(tmpdir(), `outpost-feishu-norm-${Date.now()}`);
const rawDir = join(root, "feishu-raw");
const normDir = join(root, "feishu-normalized");
const runId = "test-raw-run";
mkdirSync(join(rawDir, "runs", runId, "product"), { recursive: true });
writeFileSync(
  join(rawDir, "runs", runId, "product", "snapshot.json"),
  JSON.stringify(snap),
  "utf8",
);
writeFileSync(
  join(rawDir, "runs", runId, "manifest.json"),
  JSON.stringify({
    version: 1,
    runId,
    startedAt: snap.pulledAt,
    finishedAt: snap.pulledAt,
    rawDir,
    docsFilePath: "x",
    results: [{ docId: "product", ok: true }],
  }),
  "utf8",
);
writeFileSync(join(rawDir, "last-run.json"), JSON.stringify({ runId }), "utf8");

process.env.OUTPOST_FEISHU_RAW_DIR = rawDir;
process.env.OUTPOST_FEISHU_NORMALIZED_DIR = normDir;

const manifest = normalizeFeishuRun({ rawRunId: runId });
assert(manifest.results[0]?.ok === true, "normalize ok");
assert(manifest.files.localCost && manifest.files.dims, "csv paths");
const costCsv = readFileSync(manifest.files.localCost!, "utf8");
assert(costCsv.includes("N1SAAFWO001WHT"), "cost row");
assert(!costCsv.includes("ARRAYFORMULA"), "no formula in csv");

try {
  normalizeProductSnapshot({
    ...snap,
    sheets: [
      {
        sheetId: "s1",
        title: "产品",
        rowCount: 1,
        colCount: 1,
        values: [["PSKU"]],
      },
    ],
  });
  console.error("FAIL: expected NORMALIZE_EMPTY");
  process.exit(1);
} catch (e) {
  assert(isFeishuError(e), "empty error type");
  assertEq((e as { code: string }).code, "NORMALIZE_EMPTY", "empty code");
}

rmSync(root, { recursive: true, force: true });
console.log("OK feishu normalize tests");
