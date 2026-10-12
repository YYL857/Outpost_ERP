/**
 * M1 自测：链接解析 + 配置校验 + 结构化错误
 * pnpm exec tsx src/platforms/feishu/config.test.ts
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadFeishuDocsConfig,
  parseFeishuDocsFile,
  summarizeConfig,
} from "./config.js";
import { FeishuError, isFeishuError } from "./errors.js";
import { parseFeishuDocUrl, resolveSpreadsheetToken } from "./link.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function assertThrows(
  fn: () => unknown,
  code: string,
  stage: string,
  msg: string,
) {
  try {
    fn();
    console.error("FAIL:", msg, "(expected throw)");
    process.exit(1);
  } catch (e) {
    assert(isFeishuError(e), `${msg}: not FeishuError`);
    const err = e as FeishuError;
    assert(err.code === code, `${msg}: code got ${err.code} expected ${code}`);
    assert(err.stage === stage, `${msg}: stage got ${err.stage} expected ${stage}`);
    assert(err.hint || err.message, `${msg}: should have message/hint`);
  }
}

// --- link ---
{
  const p = parseFeishuDocUrl(
    "https://foo.feishu.cn/sheets/shtcnABC123?from=space",
  );
  assert(p.kind === "spreadsheet", "sheets kind");
  assert(p.token === "shtcnABC123", "sheets token");
}

{
  const p = parseFeishuDocUrl("https://foo.feishu.cn/wiki/wikcnXYZ");
  assert(p.kind === "wiki", "wiki kind without table");
}

{
  const p = parseFeishuDocUrl(
    "https://foo.feishu.cn/wiki/wikcnXYZ?table=tblABC&view=vew1",
  );
  assert(p.kind === "bitable", "wiki+table => bitable");
  assert(p.token === "wikcnXYZ", "wiki token");
  assert(p.tableId === "tblABC", "table id");
}

{
  const docs = parseFeishuDocsFile(
    {
      version: 1,
      docs: [
        {
          id: "freight-rates",
          label: "货代大纲",
          kind: "bitable",
          url: "https://foo.feishu.cn/wiki/wikcn1?table=tbl1",
          targetDomain: "raw_only",
          enabled: true,
        },
      ],
    },
    "mem",
  );
  assert(docs[0]!.kind === "bitable", "bitable doc kind");
  assert(docs[0]!.bitableTableId === "tbl1", "table from url");
  assert(docs[0]!.wikiToken === "wikcn1", "wiki token from url");
}


{
  const docs = parseFeishuDocsFile(
    {
      version: 1,
      docs: [
        {
          id: "monthly-deals",
          label: "月度Deals表",
          kind: "wiki",
          url: "https://ecnpehzqqtsp.feishu.cn/wiki/R44ZwRT8oiXYvokEgIJcYUm3nQb",
          targetDomain: "raw_only",
        },
      ],
    },
    "mem-wiki-sheet",
  );
  assert(docs[0]!.kind === "wiki", "wiki spreadsheet kind");
  assert(docs[0]!.wikiToken === "R44ZwRT8oiXYvokEgIJcYUm3nQb", "wiki token");
  assert(!docs[0]!.spreadsheetToken, "token resolved at pull time");
}

assertThrows(
  () => parseFeishuDocUrl("not-a-url"),
  "LINK_PARSE_FAILED",
  "config",
  "bad url",
);

assertThrows(
  () =>
    resolveSpreadsheetToken({
      id: "product",
      url: "https://foo.feishu.cn/base/bascn1",
    }),
  "DOC_KIND_UNSUPPORTED",
  "config",
  "bitable rejected",
);

assertThrows(
  () =>
    resolveSpreadsheetToken({
      id: "product",
      url: "https://foo.feishu.cn/wiki/wikcn1",
    }),
  "DOC_KIND_UNSUPPORTED",
  "config",
  "wiki needs spreadsheet token",
);

{
  const r = resolveSpreadsheetToken({
    id: "product",
    spreadsheetToken: "TOK1",
    url: "https://foo.feishu.cn/wiki/ignored",
  });
  assert(r.token === "TOK1", "direct token wins");
}

// --- docs file parse ---
{
  const docs = parseFeishuDocsFile(
    {
      version: 1,
      docs: [
        {
          id: "product",
          label: "产品表",
          spreadsheetToken: "TOK_PRODUCT",
          targetDomain: "local_cost_dims",
        },
        {
          id: "daily",
          url: "https://x.feishu.cn/sheets/TOK_DAILY",
          targetDomain: "ops_tags",
        },
      ],
    },
    "memory://test",
  );
  assert(docs.length === 2, "two docs");
  assert(docs[0]!.spreadsheetToken === "TOK_PRODUCT", "product token");
  assert(docs[1]!.spreadsheetToken === "TOK_DAILY", "daily from url");
}

assertThrows(
  () => parseFeishuDocsFile({ version: 2, docs: [] }, "memory://v"),
  "CONFIG_INVALID",
  "config",
  "bad version",
);

assertThrows(
  () =>
    parseFeishuDocsFile(
      {
        version: 1,
        docs: [
          { id: "a", spreadsheetToken: "1", targetDomain: "raw_only" },
          { id: "a", spreadsheetToken: "2", targetDomain: "raw_only" },
        ],
      },
      "memory://dup",
    ),
  "CONFIG_INVALID",
  "config",
  "duplicate id",
);

// --- load from temp file without credentials ---
{
  const dir = join(tmpdir(), `outpost-feishu-cfg-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const docsPath = join(dir, "feishu.docs.json");
  writeFileSync(
    docsPath,
    JSON.stringify({
      version: 1,
      docs: [
        {
          id: "packing",
          label: "装箱表",
          spreadsheetToken: "TOK_PACK",
          targetDomain: "packing",
          sheetTitles: ["箱表"],
        },
      ],
    }),
    "utf8",
  );
  const prevId = process.env.OUTPOST_FEISHU_APP_ID;
  const prevSecret = process.env.OUTPOST_FEISHU_APP_SECRET;
  delete process.env.OUTPOST_FEISHU_APP_ID;
  delete process.env.OUTPOST_FEISHU_APP_SECRET;

  const cfg = loadFeishuDocsConfig({
    requireCredentials: false,
    docsFilePath: docsPath,
  });
  assert(cfg.docs[0]!.id === "packing", "load packing");
  const summary = summarizeConfig(cfg);
  assert(summary.docs[0]!.tokenMasked.includes("…"), "token masked");

  assertThrows(
    () =>
      loadFeishuDocsConfig({
        requireCredentials: true,
        docsFilePath: docsPath,
      }),
    "CREDENTIALS_MISSING",
    "config",
    "require credentials",
  );

  if (prevId !== undefined) process.env.OUTPOST_FEISHU_APP_ID = prevId;
  else delete process.env.OUTPOST_FEISHU_APP_ID;
  if (prevSecret !== undefined) process.env.OUTPOST_FEISHU_APP_SECRET = prevSecret;
  else delete process.env.OUTPOST_FEISHU_APP_SECRET;

  rmSync(dir, { recursive: true, force: true });
}

console.log("OK feishu config/link tests");
