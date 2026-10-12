/**
 * M1：配置加载与校验
 * 边界：只读 env + docs JSON → FeishuDocsConfig；不调 API、不写业务库。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FeishuError } from "./errors.js";
import {
  parseFeishuDocUrl,
  resolveBitableRef,
  resolveSpreadsheetToken,
} from "./link.js";
import type {
  FeishuDocRef,
  FeishuDocsConfig,
  FeishuDocsFile,
  FeishuTargetDomain,
} from "./types.js";

const TARGET_DOMAINS: FeishuTargetDomain[] = [
  "local_cost_dims",
  "ops_tags",
  "packing",
  "purchase_cash",
  "raw_only",
];

function maskSecret(s: string) {
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}…${s.slice(-2)}`;
}

export function getFeishuRawDir(): string {
  const fromEnv = process.env.OUTPOST_FEISHU_RAW_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  const root =
    process.env.OUTPOST_ROOT?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  // 若给的是 .../json，升到店铺或 root 再挂 feishu-raw
  const base = resolve(root);
  if (base.replace(/\\/g, "/").endsWith("/json")) {
    return resolve(base, "..", "feishu-raw");
  }
  return resolve(base, "feishu-raw");
}

export function getFeishuDocsFilePath(): string {
  const fromEnv = process.env.OUTPOST_FEISHU_DOCS_FILE?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), "config", "feishu.docs.json");
}

export function readFeishuCredentials(): {
  appId: string;
  appSecret: string;
} {
  const appId = process.env.OUTPOST_FEISHU_APP_ID?.trim() ?? "";
  const appSecret = process.env.OUTPOST_FEISHU_APP_SECRET?.trim() ?? "";
  if (!appId || !appSecret) {
    throw new FeishuError(
      "缺少飞书应用凭证",
      "CREDENTIALS_MISSING",
      "config",
      {
        hasAppId: Boolean(appId),
        hasAppSecret: Boolean(appSecret),
        envAppId: "OUTPOST_FEISHU_APP_ID",
        envAppSecret: "OUTPOST_FEISHU_APP_SECRET",
      },
      "在开放平台创建企业自建应用，将 app_id / app_secret 写入 .env",
    );
  }
  return { appId, appSecret };
}

function normalizeDoc(raw: unknown, index: number): FeishuDocRef {
  if (!raw || typeof raw !== "object") {
    throw new FeishuError(
      `docs[${index}] 不是对象`,
      "CONFIG_INVALID",
      "config",
      { index },
    );
  }
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const label = String(o.label ?? id).trim();
  if (!id) {
    throw new FeishuError(
      `docs[${index}] 缺少 id`,
      "CONFIG_INVALID",
      "config",
      { index },
      "id 建议：product | daily | packing | accounts",
    );
  }
  const targetDomain = String(o.targetDomain ?? "raw_only").trim() as FeishuTargetDomain;
  if (!TARGET_DOMAINS.includes(targetDomain)) {
    throw new FeishuError(
      `docs[${index}] targetDomain 非法: ${targetDomain}`,
      "CONFIG_INVALID",
      "config",
      { index, id, targetDomain, allowed: TARGET_DOMAINS },
    );
  }

  const url = o.url != null ? String(o.url) : undefined;
  const spreadsheetToken =
    o.spreadsheetToken != null ? String(o.spreadsheetToken) : undefined;
  const bitableAppToken =
    o.bitableAppToken != null ? String(o.bitableAppToken).trim() : undefined;
  const bitableTableId =
    o.bitableTableId != null ? String(o.bitableTableId).trim() : undefined;
  const wikiToken =
    o.wikiToken != null ? String(o.wikiToken).trim() : undefined;

  const wantBitable =
    String(o.kind ?? "").trim() === "bitable" ||
    Boolean(bitableAppToken) ||
    Boolean(bitableTableId) ||
    (url?.includes("table=") ?? false) ||
    (url?.includes("/base/") ?? false);

  const sheetTitles = Array.isArray(o.sheetTitles)
    ? o.sheetTitles.map((x) => String(x).trim()).filter(Boolean)
    : undefined;

  if (wantBitable) {
    const bitable = resolveBitableRef({
      id,
      url,
      bitableAppToken,
      bitableTableId,
      wikiToken,
    });
    return {
      id,
      label: label || id,
      kind: "bitable",
      url: bitable.url ?? url,
      bitableAppToken: bitable.bitableAppToken,
      bitableTableId: bitable.bitableTableId,
      wikiToken: bitable.wikiToken,
      sheetTitles,
      targetDomain,
      enabled: o.enabled === false ? false : true,
    };
  }

  /** wiki 形态电子表格：拉取时用 get_node 换 spreadsheetToken */
  const kindRaw = String(o.kind ?? "").trim();
  const wikiFromUrl =
    url?.includes("/wiki/") && !url.includes("table=")
      ? parseFeishuDocUrl(url).token
      : undefined;
  const resolvedWiki = wikiToken || wikiFromUrl;
  if (
    (kindRaw === "wiki" || Boolean(resolvedWiki)) &&
    !spreadsheetToken?.trim()
  ) {
    if (!resolvedWiki) {
      throw new FeishuError(
        `文档 ${id} 缺少 wikiToken / wiki url`,
        "DOC_TOKEN_MISSING",
        "config",
        { docId: id },
        "填写 wiki 链接或 wikiToken；拉取时会解析为电子表格 token",
      );
    }
    return {
      id,
      label: label || id,
      kind: "wiki",
      url,
      wikiToken: resolvedWiki,
      sheetTitles,
      targetDomain,
      enabled: o.enabled === false ? false : true,
    };
  }

  const resolved = resolveSpreadsheetToken({ id, url, spreadsheetToken });

  return {
    id,
    label: label || id,
    kind: resolved.kind,
    url: resolved.url ?? url,
    spreadsheetToken: resolved.token,
    wikiToken: resolvedWiki,
    sheetTitles,
    targetDomain,
    enabled: o.enabled === false ? false : true,
  };
}

export function parseFeishuDocsFile(raw: unknown, filePath: string): FeishuDocRef[] {
  if (!raw || typeof raw !== "object") {
    throw new FeishuError(
      "docs 文件根节点必须是对象",
      "CONFIG_INVALID",
      "config",
      { filePath },
    );
  }
  const root = raw as FeishuDocsFile;
  if (root.version !== 1) {
    throw new FeishuError(
      `docs.version 应为 1，收到 ${String(root.version)}`,
      "CONFIG_INVALID",
      "config",
      { filePath, version: root.version },
    );
  }
  if (!Array.isArray(root.docs) || root.docs.length === 0) {
    throw new FeishuError(
      "docs.docs 必须是非空数组",
      "CONFIG_INVALID",
      "config",
      { filePath },
      "复制 feishu.docs.example.json 为 feishu.docs.json 并填入四表 token",
    );
  }
  const docs = root.docs.map((d, i) => normalizeDoc(d, i));
  const ids = new Set<string>();
  for (const d of docs) {
    if (ids.has(d.id)) {
      throw new FeishuError(
        `重复的 doc id: ${d.id}`,
        "CONFIG_INVALID",
        "config",
        { filePath, id: d.id },
      );
    }
    ids.add(d.id);
  }
  return docs;
}

export function loadFeishuDocsFile(filePath = getFeishuDocsFilePath()): FeishuDocRef[] {
  if (!existsSync(filePath)) {
    throw new FeishuError(
      "找不到飞书文档映射文件",
      "CONFIG_MISSING",
      "config",
      { filePath, env: "OUTPOST_FEISHU_DOCS_FILE" },
      "复制 apps/api/config/feishu.docs.example.json → feishu.docs.json 并填写 token",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    throw new FeishuError(
      "飞书文档映射 JSON 解析失败",
      "CONFIG_INVALID",
      "config",
      {
        filePath,
        cause: e instanceof Error ? e.message : String(e),
      },
    );
  }
  return parseFeishuDocsFile(parsed, filePath);
}

/**
 * 加载完整运行配置。
 * @param opts.requireCredentials 自测配置时可为 false
 */
export function loadFeishuDocsConfig(opts?: {
  requireCredentials?: boolean;
  docsFilePath?: string;
}): FeishuDocsConfig {
  const requireCredentials = opts?.requireCredentials !== false;
  const docsFilePath = opts?.docsFilePath ?? getFeishuDocsFilePath();
  const docs = loadFeishuDocsFile(docsFilePath);

  let credentials = { appId: "", appSecret: "" };
  if (requireCredentials) {
    credentials = readFeishuCredentials();
  } else {
    try {
      credentials = readFeishuCredentials();
    } catch {
      credentials = { appId: "", appSecret: "" };
    }
  }

  return {
    credentials,
    docs,
    rawDir: getFeishuRawDir(),
    docsFilePath,
  };
}

export function summarizeConfig(cfg: FeishuDocsConfig) {
  return {
    docsFilePath: cfg.docsFilePath,
    rawDir: cfg.rawDir,
    appIdMasked: cfg.credentials.appId
      ? maskSecret(cfg.credentials.appId)
      : "(none)",
    docs: cfg.docs.map((d) => ({
      id: d.id,
      label: d.label,
      enabled: d.enabled !== false,
      kind: d.kind,
      tokenMasked: d.spreadsheetToken
        ? maskSecret(d.spreadsheetToken)
        : d.bitableAppToken
          ? maskSecret(d.bitableAppToken)
          : d.wikiToken
            ? `wiki:${maskSecret(d.wikiToken)}`
            : "(missing)",
      tableId: d.bitableTableId ?? null,
      targetDomain: d.targetDomain,
      sheetTitles: d.sheetTitles ?? "(all)",
    })),
  };
}

export { maskSecret };
