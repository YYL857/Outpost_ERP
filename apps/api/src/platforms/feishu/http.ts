/**
 * M2 子模块：飞书 Open API HTTP
 * 边界：只负责鉴权与 JSON 请求；不写盘、不解释业务列。
 */
import { FeishuError } from "./errors.js";
import type { FeishuCredentials } from "./types.js";

const OPEN_BASE = "https://open.feishu.cn/open-apis";

type TokenCache = {
  token: string;
  expireAtMs: number;
};

let tokenCache: TokenCache | null = null;

export type FeishuSheetMeta = {
  sheetId: string;
  title: string;
  rowCount: number;
  columnCount: number;
};

type FeishuApiEnvelope = {
  code: number;
  msg: string;
  data?: unknown;
};

export function clearFeishuTokenCache() {
  tokenCache = null;
}

export async function getTenantAccessToken(
  cred: FeishuCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expireAtMs > now + 60_000) {
    return tokenCache.token;
  }

  let res: Response;
  try {
    res = await fetchImpl(`${OPEN_BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: cred.appId,
        app_secret: cred.appSecret,
      }),
    });
  } catch (e) {
    throw new FeishuError(
      "飞书鉴权请求网络失败",
      "AUTH_FAILED",
      "auth",
      { cause: e instanceof Error ? e.message : String(e) },
      "检查本机网络 / 代理是否能访问 open.feishu.cn",
    );
  }

  const text = await res.text();
  let body: {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new FeishuError(
      "飞书鉴权响应不是 JSON",
      "AUTH_FAILED",
      "auth",
      { httpStatus: res.status, bodyPreview: text.slice(0, 300) },
    );
  }

  if (!res.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new FeishuError(
      `飞书鉴权失败: ${body.msg ?? res.statusText}`,
      "AUTH_FAILED",
      "auth",
      {
        httpStatus: res.status,
        code: body.code,
        msg: body.msg,
      },
      "核对 APP_ID/SECRET；确认应用已启用并发布可用版本",
    );
  }

  const expireSec = Number(body.expire ?? 7200);
  tokenCache = {
    token: body.tenant_access_token,
    expireAtMs: now + expireSec * 1000,
  };
  return body.tenant_access_token;
}

async function feishuGet<T>(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
  stage: "meta" | "read",
): Promise<T> {
  const url = path.startsWith("http") ? path : `${OPEN_BASE}${path}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    throw new FeishuError(
      "飞书 API 网络失败",
      "API_HTTP",
      stage,
      { path, cause: e instanceof Error ? e.message : String(e) },
    );
  }

  const text = await res.text();
  let envelope: FeishuApiEnvelope;
  try {
    envelope = JSON.parse(text) as FeishuApiEnvelope;
  } catch {
    throw new FeishuError(
      "飞书 API 响应不是 JSON",
      "API_HTTP",
      stage,
      { path, httpStatus: res.status, bodyPreview: text.slice(0, 400) },
    );
  }

  if (!res.ok) {
    throw new FeishuError(
      `飞书 HTTP ${res.status}`,
      "API_HTTP",
      stage,
      { path, httpStatus: res.status, code: envelope.code, msg: envelope.msg },
      envelope.code === 99991663
        ? "token 无效，将清缓存后重试或检查鉴权"
        : "看 detail.msg；外部文档需对应用授权或添加应用为协作者",
    );
  }

  if (envelope.code !== 0) {
    throw new FeishuError(
      `飞书业务错误 ${envelope.code}: ${envelope.msg}`,
      "API_BIZ",
      stage,
      { path, code: envelope.code, msg: envelope.msg },
      hintForBizCode(envelope.code, envelope.msg),
    );
  }

  return envelope.data as T;
}

function hintForBizCode(code: number, msg: string): string {
  if (code === 91403 || /permission|权限|forbidden/i.test(msg)) {
    return "文档带「外部」标签时，需所有者把企业自建应用加为协作者，或将文档拷贝到本企业后再授权";
  }
  if (code === 91402 || /not found|不存在/i.test(msg)) {
    return "核对 spreadsheetToken 是否来自 /sheets/ 链接（wiki 链接需先换 token）";
  }
  return "打开飞书开放平台错误码说明，对照 detail.code";
}

export async function listSpreadsheetSheets(
  token: string,
  spreadsheetToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuSheetMeta[]> {
  const data = await feishuGet<{
    sheets?: Array<{
      sheet_id?: string;
      title?: string;
      grid_properties?: { row_count?: number; column_count?: number };
    }>;
  }>(
    `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`,
    token,
    fetchImpl,
    "meta",
  );

  const sheets = data?.sheets ?? [];
  return sheets.map((s) => ({
    sheetId: String(s.sheet_id ?? ""),
    title: String(s.title ?? ""),
    rowCount: Number(s.grid_properties?.row_count ?? 0),
    columnCount: Number(s.grid_properties?.column_count ?? 0),
  })).filter((s) => s.sheetId);
}

/**
 * 读取整表（A1 到列宽/行高）。
 * 必须带 valueRenderOption=ToString，否则 ARRAYFORMULA 列只返回公式文本、其它行空值，M3 无法规范化。
 * 大表可能触达平台单次上限；超限时 API 会报错，error.detail 可定位。
 */
export async function readSheetValues(
  token: string,
  spreadsheetToken: string,
  sheet: FeishuSheetMeta,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[][]> {
  const cols = Math.max(sheet.columnCount || 50, 1);
  const rows = Math.max(sheet.rowCount || 100, 1);
  const endCol = colIndexToLetter(cols);
  const range = `${sheet.sheetId}!A1:${endCol}${rows}`;
  const qs = new URLSearchParams({
    valueRenderOption: "ToString",
    dateTimeRenderOption: "FormattedString",
  });
  const data = await feishuGet<{
    valueRange?: { values?: unknown[][] };
    values?: unknown[][];
  }>(
    `/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(range)}?${qs}`,
    token,
    fetchImpl,
    "read",
  );

  const values =
    data?.valueRange?.values ??
    data?.values ??
    [];
  return Array.isArray(values) ? values : [];
}

/** 1-based column index → A / Z / AA */
export function colIndexToLetter(index: number): string {
  let n = Math.max(1, Math.floor(index));
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

export type FeishuHttpClient = {
  getToken: () => Promise<string>;
  listSheets: (spreadsheetToken: string) => Promise<FeishuSheetMeta[]>;
  readSheet: (
    spreadsheetToken: string,
    sheet: FeishuSheetMeta,
  ) => Promise<unknown[][]>;
};

export function createFeishuHttpClient(
  cred: FeishuCredentials,
  fetchImpl: typeof fetch = fetch,
): FeishuHttpClient {
  return {
    async getToken() {
      return getTenantAccessToken(cred, fetchImpl);
    },
    async listSheets(spreadsheetToken: string) {
      const t = await getTenantAccessToken(cred, fetchImpl);
      return listSpreadsheetSheets(t, spreadsheetToken, fetchImpl);
    },
    async readSheet(spreadsheetToken: string, sheet: FeishuSheetMeta) {
      const t = await getTenantAccessToken(cred, fetchImpl);
      return readSheetValues(t, spreadsheetToken, sheet, fetchImpl);
    },
  };
}
