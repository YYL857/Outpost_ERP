/**
 * M2 Puller：飞书表 → raw 快照（只读远端表）
 * 边界：只写本地 feishu-raw；不 normalize、不 portal-imports、不改 AppState；
 * 绝不 create/update/delete 飞书多维表或电子表格单元格。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { maskSecret } from "./config.js";
import { FeishuError, formatFeishuError, isFeishuError } from "./errors.js";
import {
  createFeishuHttpClient,
  type FeishuHttpClient,
  type FeishuSheetMeta,
} from "./http.js";
import type {
  FeishuDocRef,
  FeishuDocsConfig,
  FeishuPullDocResult,
  FeishuPullRunManifest,
  FeishuRawSheet,
  FeishuRawSnapshot,
} from "./types.js";

export type PullRawOptions = {
  /** 只拉这些 doc id；空 = enabled 全部 */
  docIds?: string[];
  http?: FeishuHttpClient;
  /** 单 sheet 0 行是否当错误（默认 true） */
  failOnEmptySheet?: boolean;
  now?: () => Date;
};

function sha1Of(text: string) {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

function pickSheets(
  all: FeishuSheetMeta[],
  doc: FeishuDocRef,
): FeishuSheetMeta[] {
  if (!doc.sheetTitles?.length) return all;
  const want = new Set(doc.sheetTitles.map((t) => t.trim()));
  const hit = all.filter((s) => want.has(s.title));
  if (hit.length === 0) {
    throw new FeishuError(
      `文档 ${doc.id} 未找到配置的 sheetTitles`,
      "SHEET_NOT_FOUND",
      "meta",
      {
        docId: doc.id,
        want: [...want],
        available: all.map((s) => s.title),
      },
      "核对飞书里实际工作表名称是否与 feishu.docs.json 一致（含空格）",
    );
  }
  return hit;
}

function writeJson(path: string, data: unknown) {
  try {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } catch (e) {
    throw new FeishuError(
      "写入 raw 快照失败",
      "RAW_WRITE_FAILED",
      "write",
      { path, cause: e instanceof Error ? e.message : String(e) },
      "检查 OUTPOST_FEISHU_RAW_DIR 权限与磁盘空间",
    );
  }
}

async function pullOneBitableDoc(
  doc: FeishuDocRef,
  cfg: FeishuDocsConfig,
  http: FeishuHttpClient,
  runDir: string,
  opts: PullRawOptions,
): Promise<FeishuPullDocResult> {
  const started = Date.now();
  const tableId = doc.bitableTableId?.trim();
  if (!tableId) {
    throw new FeishuError(
      `文档 ${doc.id} 无 bitableTableId`,
      "DOC_TOKEN_MISSING",
      "config",
      { docId: doc.id },
    );
  }

  let appToken = doc.bitableAppToken?.trim() || "";
  if (!appToken) {
    const wiki = doc.wikiToken?.trim();
    if (!wiki) {
      throw new FeishuError(
        `文档 ${doc.id} 缺少 bitableAppToken / wikiToken`,
        "DOC_TOKEN_MISSING",
        "config",
        { docId: doc.id },
      );
    }
    appToken = await http.resolveWikiBitableAppToken(wiki);
  }

  const table = await http.readBitableTable(appToken, tableId);
  const values = table.values;
  const rowCount = values.length;
  const colCount = values.reduce(
    (m, row) => Math.max(m, Array.isArray(row) ? row.length : 0),
    0,
  );
  if (opts.failOnEmptySheet !== false && rowCount <= 1) {
    throw new FeishuError(
      `多维表 ${doc.id} 无数据行`,
      "SHEET_EMPTY",
      "read",
      { docId: doc.id, tableId, appTokenMasked: maskSecret(appToken) },
      "确认 table id 正确且应用有 bitable 阅读权限 / 已加为协作者",
    );
  }

  const rawSheets: FeishuRawSheet[] = [
    {
      sheetId: tableId,
      title: table.title || doc.label || "货代大纲",
      rowCount,
      colCount,
      values,
    },
  ];

  const snapshot: FeishuRawSnapshot = {
    version: 1,
    pulledAt: (opts.now ?? (() => new Date()))().toISOString(),
    docId: doc.id,
    docLabel: doc.label,
    targetDomain: doc.targetDomain,
    kind: "bitable",
    spreadsheetToken: appToken,
    sheets: rawSheets,
    source: {
      url: doc.url,
      appIdMasked: maskSecret(cfg.credentials.appId),
    },
  };

  const docDir = join(runDir, doc.id);
  mkdirSync(docDir, { recursive: true });
  const snapshotPath = join(docDir, "snapshot.json");
  const metaPath = join(docDir, "meta.json");
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  const digest = sha1Of(body);
  try {
    writeFileSync(snapshotPath, body, "utf8");
  } catch (e) {
    throw new FeishuError(
      "写入 raw 快照失败",
      "RAW_WRITE_FAILED",
      "write",
      { path: snapshotPath, cause: e instanceof Error ? e.message : String(e) },
      "检查 OUTPOST_FEISHU_RAW_DIR 权限与磁盘空间",
    );
  }
  writeJson(metaPath, {
    docId: doc.id,
    label: doc.label,
    targetDomain: doc.targetDomain,
    kind: "bitable",
    bitableAppTokenMasked: maskSecret(appToken),
    bitableTableId: tableId,
    sha1: digest,
    sheetCount: rawSheets.length,
    sheets: rawSheets.map((s) => ({
      title: s.title,
      sheetId: s.sheetId,
      rowCount: s.rowCount,
      colCount: s.colCount,
    })),
    snapshotPath,
    durationMs: Date.now() - started,
  });

  return {
    docId: doc.id,
    ok: true,
    snapshotPath,
    metaPath,
    sheetCount: rawSheets.length,
    totalRows: rawSheets.reduce((a, s) => a + s.rowCount, 0),
    sha1: digest,
    durationMs: Date.now() - started,
  };
}

async function pullOneDoc(
  doc: FeishuDocRef,
  cfg: FeishuDocsConfig,
  http: FeishuHttpClient,
  runDir: string,
  opts: PullRawOptions,
): Promise<FeishuPullDocResult> {
  if (doc.kind === "bitable" || doc.bitableTableId) {
    return pullOneBitableDoc(doc, cfg, http, runDir, opts);
  }

  const started = Date.now();
  let token = doc.spreadsheetToken?.trim() || "";
  if (!token && doc.wikiToken?.trim()) {
    token = await http.resolveWikiSpreadsheetToken(doc.wikiToken.trim());
  }
  if (!token) {
    throw new FeishuError(
      `文档 ${doc.id} 无 spreadsheetToken / wikiToken`,
      "DOC_TOKEN_MISSING",
      "config",
      { docId: doc.id },
      "填写 spreadsheetToken，或 wiki 链接（拉取时 get_node → sheet token）",
    );
  }

  const allSheets = await http.listSheets(token);
  if (allSheets.length === 0) {
    throw new FeishuError(
      `文档 ${doc.id} 没有任何工作表`,
      "SHEET_EMPTY",
      "meta",
      { docId: doc.id, spreadsheetTokenMasked: maskSecret(token) },
      "确认 token 正确且应用有阅读权限",
    );
  }

  const selected = pickSheets(allSheets, doc);
  const rawSheets: FeishuRawSheet[] = [];

  for (const sheet of selected) {
    const values = await http.readSheet(token, sheet);
    const rowCount = values.length;
    const colCount = values.reduce(
      (m, row) => Math.max(m, Array.isArray(row) ? row.length : 0),
      0,
    );
    if (opts.failOnEmptySheet !== false && rowCount === 0) {
      throw new FeishuError(
        `工作表「${sheet.title}」无数据`,
        "SHEET_EMPTY",
        "read",
        { docId: doc.id, sheetId: sheet.sheetId, title: sheet.title },
        "若为新建空表可暂时从 sheetTitles 去掉；或设 failOnEmptySheet=false",
      );
    }
    rawSheets.push({
      sheetId: sheet.sheetId,
      title: sheet.title,
      rowCount,
      colCount,
      values,
    });
  }

  const snapshot: FeishuRawSnapshot = {
    version: 1,
    pulledAt: (opts.now ?? (() => new Date()))().toISOString(),
    docId: doc.id,
    docLabel: doc.label,
    targetDomain: doc.targetDomain,
    kind: doc.kind,
    spreadsheetToken: token,
    sheets: rawSheets,
    source: {
      url: doc.url,
      appIdMasked: maskSecret(cfg.credentials.appId),
    },
  };

  const docDir = join(runDir, doc.id);
  mkdirSync(docDir, { recursive: true });
  const snapshotPath = join(docDir, "snapshot.json");
  const metaPath = join(docDir, "meta.json");
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  const digest = sha1Of(body);
  try {
    writeFileSync(snapshotPath, body, "utf8");
  } catch (e) {
    throw new FeishuError(
      "写入 raw 快照失败",
      "RAW_WRITE_FAILED",
      "write",
      { path: snapshotPath, cause: e instanceof Error ? e.message : String(e) },
      "检查 OUTPOST_FEISHU_RAW_DIR 权限与磁盘空间",
    );
  }
  writeJson(metaPath, {
    docId: doc.id,
    label: doc.label,
    targetDomain: doc.targetDomain,
    sha1: digest,
    sheetCount: rawSheets.length,
    sheets: rawSheets.map((s) => ({
      title: s.title,
      sheetId: s.sheetId,
      rowCount: s.rowCount,
      colCount: s.colCount,
    })),
    snapshotPath,
    durationMs: Date.now() - started,
  });

  return {
    docId: doc.id,
    ok: true,
    snapshotPath,
    metaPath,
    sheetCount: rawSheets.length,
    totalRows: rawSheets.reduce((a, s) => a + s.rowCount, 0),
    sha1: digest,
    durationMs: Date.now() - started,
  };
}

function toErrorPayload(e: unknown): FeishuPullDocResult["error"] {
  if (isFeishuError(e)) {
    const j = e.toJSON();
    return {
      code: j.code,
      stage: j.stage,
      message: j.message,
      hint: j.hint,
      detail: j.detail,
    };
  }
  return {
    code: "API_HTTP",
    stage: "read",
    message: e instanceof Error ? e.message : String(e),
    hint: "非 FeishuError，查看日志堆栈",
    detail: { formatted: formatFeishuError(e) },
  };
}

/**
 * 拉取启用中的文档到 rawDir/runs/{runId}/
 * 单文档失败不阻断其它文档；manifest 汇总 ok/error。
 */
export async function pullFeishuRaw(
  cfg: FeishuDocsConfig,
  opts: PullRawOptions = {},
): Promise<FeishuPullRunManifest> {
  if (!cfg.credentials.appId || !cfg.credentials.appSecret) {
    throw new FeishuError(
      "缺少飞书凭证，无法拉取",
      "CREDENTIALS_MISSING",
      "config",
      {},
      "设置 OUTPOST_FEISHU_APP_ID / OUTPOST_FEISHU_APP_SECRET",
    );
  }

  const http = opts.http ?? createFeishuHttpClient(cfg.credentials);
  const nowFn = opts.now ?? (() => new Date());
  const startedAt = nowFn().toISOString();
  const runId = `${startedAt.replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
  const runDir = join(cfg.rawDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });

  let docs = cfg.docs.filter((d) => d.enabled !== false);
  if (opts.docIds?.length) {
    const want = new Set(opts.docIds);
    docs = docs.filter((d) => want.has(d.id));
    if (docs.length === 0) {
      throw new FeishuError(
        "没有匹配的 doc id",
        "CONFIG_INVALID",
        "config",
        { docIds: opts.docIds, available: cfg.docs.map((d) => d.id) },
      );
    }
  }

  const results: FeishuPullDocResult[] = [];
  for (const doc of docs) {
    try {
      results.push(await pullOneDoc(doc, cfg, http, runDir, opts));
    } catch (e) {
      results.push({
        docId: doc.id,
        ok: false,
        error: toErrorPayload(e),
      });
    }
  }

  const finishedAt = nowFn().toISOString();
  const manifest: FeishuPullRunManifest = {
    version: 1,
    runId,
    startedAt,
    finishedAt,
    rawDir: cfg.rawDir,
    docsFilePath: cfg.docsFilePath,
    results,
  };
  writeJson(join(runDir, "manifest.json"), manifest);
  writeJson(join(cfg.rawDir, "last-run.json"), {
    runId,
    finishedAt,
    okCount: results.filter((r) => r.ok).length,
    failCount: results.filter((r) => !r.ok).length,
    manifestPath: join(runDir, "manifest.json"),
  });

  return manifest;
}
