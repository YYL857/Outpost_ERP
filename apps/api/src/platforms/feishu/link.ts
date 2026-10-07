/**
 * M1 子模块：飞书链接 → token
 * 不访问网络；解析失败抛 FeishuError。
 */
import { FeishuError } from "./errors.js";
import type { FeishuDocKind } from "./types.js";

export type ParsedFeishuLink = {
  kind: FeishuDocKind;
  token: string;
  rawUrl: string;
};

/**
 * 支持：
 * - https://xxx.feishu.cn/sheets/{token}
 * - https://xxx.feishu.cn/wiki/{token}   （需后续 API 解析成 spreadsheet，P0 仅识别）
 * - https://xxx.feishu.cn/base/{token}   （多维表，P0 不拉）
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
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    throw new FeishuError(
      "飞书链接不是合法 URL",
      "LINK_PARSE_FAILED",
      "config",
      { url: trimmed },
      "示例：https://xxx.feishu.cn/sheets/XXXXXXXX",
    );
  }

  const sheets = pathname.match(/\/sheets\/([A-Za-z0-9_-]+)/);
  if (sheets?.[1]) {
    return { kind: "spreadsheet", token: sheets[1], rawUrl: trimmed };
  }

  const wiki = pathname.match(/\/wiki\/([A-Za-z0-9_-]+)/);
  if (wiki?.[1]) {
    return { kind: "wiki", token: wiki[1], rawUrl: trimmed };
  }

  const base = pathname.match(/\/base\/([A-Za-z0-9_-]+)/);
  if (base?.[1]) {
    return { kind: "bitable", token: base[1], rawUrl: trimmed };
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
      `文档 ${input.id} 是多维表，P0 Puller 仅支持电子表格`,
      "DOC_KIND_UNSUPPORTED",
      "config",
      { docId: input.id, kind: parsed.kind, token: parsed.token },
      "请改用电子表格链接，或等后续 bitable 模块",
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
