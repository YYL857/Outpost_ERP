/**
 * M2 自测：Puller 用 mock HTTP 写 raw，校验 M2→M3 磁盘契约
 * pnpm exec tsx src/platforms/feishu/puller.test.ts
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFeishuDocsConfig } from "./config.js";
import { FeishuError, isFeishuError } from "./errors.js";
import type { FeishuHttpClient, FeishuSheetMeta } from "./http.js";
import { colIndexToLetter } from "./http.js";
import { pullFeishuRaw } from "./puller.js";
import type { FeishuPullRunManifest, FeishuRawSnapshot } from "./types.js";

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

assertEq(colIndexToLetter(1), "A", "col A");
assertEq(colIndexToLetter(26), "Z", "col Z");
assertEq(colIndexToLetter(27), "AA", "col AA");

const root = join(tmpdir(), `outpost-feishu-pull-${Date.now()}`);
const rawDir = join(root, "feishu-raw");
const docsPath = join(root, "feishu.docs.json");
mkdirSync(root, { recursive: true });

writeFileSync(
  docsPath,
  JSON.stringify({
    version: 1,
    docs: [
      {
        id: "product",
        label: "产品表",
        spreadsheetToken: "TOK_PRODUCT",
        targetDomain: "local_cost_dims",
        sheetTitles: ["产品"],
      },
      {
        id: "broken",
        label: "坏表",
        spreadsheetToken: "TOK_BROKEN",
        targetDomain: "raw_only",
      },
    ],
  }),
  "utf8",
);

process.env.OUTPOST_FEISHU_APP_ID = "cli_test_appid";
process.env.OUTPOST_FEISHU_APP_SECRET = "test_secret";
process.env.OUTPOST_FEISHU_RAW_DIR = rawDir;
process.env.OUTPOST_FEISHU_DOCS_FILE = docsPath;

const mockHttp: FeishuHttpClient = {
  async getToken() {
    return "mock-token";
  },
  async listSheets(spreadsheetToken: string): Promise<FeishuSheetMeta[]> {
    if (spreadsheetToken === "TOK_BROKEN") {
      throw new FeishuError(
        "无权限",
        "API_BIZ",
        "meta",
        { code: 91403 },
        "外部文档需授权",
      );
    }
    return [
      {
        sheetId: "abcSheet",
        title: "产品",
        rowCount: 3,
        columnCount: 3,
      },
      {
        sheetId: "other",
        title: "查找代码表",
        rowCount: 10,
        columnCount: 2,
      },
    ];
  },
  async readSheet(_tok, sheet) {
    assert(sheet.title === "产品", "should only read filtered sheet");
    return [
      ["PSKU", "采购单价", "长"],
      ["N1SA001", "12.5", "10"],
      ["N1SA002", "8", "20"],
    ];
  },
  async resolveWikiBitableAppToken() {
    throw new Error("unused");
  },
  async resolveWikiSpreadsheetToken() {
    throw new Error("unused");
  },
  async readBitableTable() {
    throw new Error("unused");
  },
};

const cfg = loadFeishuDocsConfig({ docsFilePath: docsPath });
assertEq(cfg.rawDir, rawDir, "rawDir from env");

const manifest = await pullFeishuRaw(cfg, { http: mockHttp });

assert(manifest.version === 1, "manifest version");
assert(manifest.results.length === 2, "two results");

const ok = manifest.results.find((r) => r.docId === "product");
const bad = manifest.results.find((r) => r.docId === "broken");
assert(ok?.ok === true, "product ok");
assert(bad?.ok === false, "broken failed");
assert(bad?.error?.code === "API_BIZ", "broken code");
assert(bad?.error?.stage === "meta", "broken stage");
assert(Boolean(bad?.error?.hint), "broken hint for定位");

const manifestPath = join(rawDir, "runs", manifest.runId, "manifest.json");
assert(existsSync(manifestPath), "manifest on disk");
assert(existsSync(join(rawDir, "last-run.json")), "last-run.json");

assert(ok?.snapshotPath && existsSync(ok.snapshotPath), "snapshot exists");
const snap = JSON.parse(
  readFileSync(ok!.snapshotPath!, "utf8"),
) as FeishuRawSnapshot;

// --- M2→M3 契约 ---
assertEq(snap.version, 1, "snapshot version");
assertEq(snap.docId, "product", "docId");
assertEq(snap.targetDomain, "local_cost_dims", "targetDomain passthrough");
assert(snap.sheets.length === 1, "only 产品 sheet");
assertEq(snap.sheets[0]!.title, "产品", "sheet title");
assertEq(snap.sheets[0]!.rowCount, 3, "rowCount");
assertEq(snap.sheets[0]!.values[0]![0], "PSKU", "header");
assert(Boolean(snap.source.appIdMasked), "appId masked");
assert(!String(snap.source.appIdMasked).includes("test_secret"), "no secret");

const diskManifest = JSON.parse(
  readFileSync(manifestPath, "utf8"),
) as FeishuPullRunManifest;
assertEq(diskManifest.runId, manifest.runId, "runId match");
assert(
  diskManifest.results.every((r) => typeof r.ok === "boolean"),
  "results have ok",
);

// sha1 对落盘字节可复现（M3 衔接契约）
const fileBody = readFileSync(ok!.snapshotPath!, "utf8");
const digest = createHash("sha1").update(fileBody, "utf8").digest("hex");
assertEq(ok?.sha1, digest, "sha1 matches on-disk snapshot");

// 凭证缺失应在 pull 入口结构化失败
{
  const cfgNoCred = {
    ...cfg,
    credentials: { appId: "", appSecret: "" },
  };
  try {
    await pullFeishuRaw(cfgNoCred, { http: mockHttp });
    console.error("FAIL: expected CREDENTIALS_MISSING");
    process.exit(1);
  } catch (e) {
    assert(isFeishuError(e), "cred error type");
    assertEq((e as FeishuError).code, "CREDENTIALS_MISSING", "cred code");
  }
}

rmSync(root, { recursive: true, force: true });
console.log("OK feishu puller tests (raw contract)");
