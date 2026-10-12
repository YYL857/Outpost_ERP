/**
 * 链接解析：sheets / wiki / base(+table query)
 */
import { FeishuError } from "./errors.js";
import type { FeishuDocKind } from "./types.js";

export type ParsedFeishuLink = {
  kind: FeishuDocKind;
  token: string;
  rawUrl: string;
  /** 多维表 table id（URL ?table=） */
  tableId?: string;
  viewId?: string;
};

/**
 * 支持：
 * - https://xxx.feishu.cn/sheets/{token}
 * - https://xxx.feishu.cn/wiki/{token}?table=tbl…
 * - https://xxx.feishu.cn/base/{token}?table=tbl…
 */
export function parseFeishuDocUrl(url: string): ParsedFeishuLink {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new FeishuError(
      "飞书链接为空",
      "LINK_PARSE_FAILED",
      "config",
      { url },
      "在 feishu.docs.json 填写 url 或 spreadsheetToken",
    );
  }

  let pathname: string;
  let searchParams: URLSearchParams;
  try {
    const u = new URL(trimmed);
    pathname = u.pathname;
    searchParams = u.searchParams;
  } catch {
    throw new FeishuError(
      "飞书链接不是合法 URL",
      "LINK_PARSE_FAILED",
      "config",
      { url: trimmed },
      "示例：https://xxx.feishu.cn/sheets/XXXXXXXX",
    );
  }

  const tableId = searchParams.get("table")?.trim() || undefined;
  const viewId = searchParams.get("view")?.trim() || undefined;

  const sheets = pathname.match(/\/sheets\/([A-Za-z0-9_-]+)/);
  if (sheets?.[1]) {
    return {
      kind: "spreadsheet",
      token: sheets[1],
      rawUrl: trimmed,
      tableId,
      viewId,
    };
  }

  const wiki = pathname.match(/\/wiki\/([A-Za-z0-9_-]+)/);
  if (wiki?.[1]) {
    return {
      kind: tableId ? "bitable" : "wiki",
      token: wiki[1],
      rawUrl: trimmed,
      tableId,
      viewId,
    };
  }

  const base = pathname.match(/\/base\/([A-Za-z0-9_-]+)/);
  if (base?.[1]) {
    return {
      kind: "bitable",
      token: base[1],
      rawUrl: trimmed,
      tableId,
      viewId,
    };
  }

  throw new FeishuError(
    "无法从链接识别 sheets/wiki/base token",
    "LINK_PARSE_FAILED",
    "config",
    { url: trimmed, pathname },
    "打开飞书文档 → 分享 → 复制链接；或直接填 spreadsheetToken",
  );
}

/** 配置项：优先 spreadsheetToken，否则从 url 解析（仅 spreadsheet） */
export function resolveSpreadsheetToken(input: {
  spreadsheetToken?: string;
  url?: string;
  id: string;
}): { token: string; kind: FeishuDocKind; url?: string } {
  const direct = input.spreadsheetToken?.trim();
  if (direct) {
    return { token: direct, kind: "spreadsheet", url: input.url };
  }
  if (!input.url?.trim()) {
    throw new FeishuError(
      `文档 ${input.id} 缺少 spreadsheetToken 与 url`,
      "DOC_TOKEN_MISSING",
      "config",
      { docId: input.id },
      "在 feishu.docs.json 为该文档填写 spreadsheetToken 或 /sheets/ 链接",
    );
  }
  const parsed = parseFeishuDocUrl(input.url);
  if (parsed.kind === "bitable") {
    throw new FeishuError(
      `文档 ${input.id} 是多维表，请用 resolveBitableRef / bitable 配置`,
      "DOC_KIND_UNSUPPORTED",
      "config",
      { docId: input.id, kind: parsed.kind, token: parsed.token },
      "为货代价目填 bitableAppToken+bitableTableId，或带 ?table= 的 wiki/base 链接",
    );
  }
  if (parsed.kind === "wiki") {
    throw new FeishuError(
      `文档 ${input.id} 是知识库 wiki 链接，P0 需 spreadsheet token`,
      "DOC_KIND_UNSUPPORTED",
      "config",
      { docId: input.id, kind: parsed.kind, token: parsed.token },
      "在浏览器打开该表 → 地址栏若变为 /sheets/xxx 则用该链接；或从 API/控制台抄 spreadsheet_token",
    );
  }
  return { token: parsed.token, kind: "spreadsheet", url: parsed.rawUrl };
}

export type ResolvedBitableRef = {
  kind: "bitable";
  /** wiki 节点 token；拉取时用 get_node 换 app_token */
  wikiToken?: string;
  /** 已知的多维表 app_token（/base/ 链接或配置直填） */
  bitableAppToken?: string;
  bitableTableId: string;
  url?: string;
};

/** 多维表配置解析：url(?table=) 或 bitableAppToken+bitableTableId */
export function resolveBitableRef(input: {
  id: string;
  url?: string;
  bitableAppToken?: string;
  bitableTableId?: string;
  wikiToken?: string;
}): ResolvedBitableRef {
  const fromUrl = input.url?.trim()
    ? parseFeishuDocUrl(input.url.trim())
    : null;

  const tableId =
    input.bitableTableId?.trim() ||
    fromUrl?.tableId?.trim() ||
    "";
  if (!tableId) {
    throw new FeishuError(
      `文档 ${input.id} 缺少 bitableTableId（URL ?table=）`,
      "DOC_TOKEN_MISSING",
      "config",
      { docId: input.id },
      "货代大纲链接需带 table=tbl…，或在配置里填 bitableTableId",
    );
  }

  const appToken =
    input.bitableAppToken?.trim() ||
    (fromUrl?.kind === "bitable" && fromUrl.rawUrl.includes("/base/")
      ? fromUrl.token
      : undefined);

  const wikiToken =
    input.wikiToken?.trim() ||
    (fromUrl && fromUrl.rawUrl.includes("/wiki/")
      ? fromUrl.token
      : undefined);

  if (!appToken && !wikiToken) {
    throw new FeishuError(
      `文档 ${input.id} 缺少 bitableAppToken 与 wiki 链接`,
      "DOC_TOKEN_MISSING",
      "config",
      { docId: input.id },
      "填写 wiki 链接（含 table=）或 bitableAppToken + bitableTableId",
    );
  }

  return {
    kind: "bitable",
    wikiToken,
    bitableAppToken: appToken,
    bitableTableId: tableId,
    url: input.url,
  };
}
