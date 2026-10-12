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
  assertFeishuTableReadOnly(path, "GET");
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
        : hintForBizCode(envelope.code ?? 0, envelope.msg ?? "", stage),
    );
  }

  if (envelope.code !== 0) {
    throw new FeishuError(
      `飞书业务错误 ${envelope.code}: ${envelope.msg}`,
      "API_BIZ",
      stage,
      { path, code: envelope.code, msg: envelope.msg },
      hintForBizCode(envelope.code, envelope.msg, stage),
    );
  }

  return envelope.data as T;
}

/** 账目表写权限开通指引（开放平台 + 文档协作者） */
export const FEISHU_ACCOUNTS_WRITE_PERM_HINT =
  "开通 sheets:spreadsheet（电子表格读写）并发布应用版本；把企业自建应用加为账目表「可编辑」协作者。开放平台：https://open.feishu.cn/app → 你的应用 → 权限管理";

function hintForBizCode(code: number, msg: string, stage?: "meta" | "read" | "write"): string {
  if (stage === "write") {
    if (
      code === 99991672 ||
      code === 91403 ||
      /permission|权限|forbidden|scope|scopes/i.test(msg)
    ) {
      return FEISHU_ACCOUNTS_WRITE_PERM_HINT;
    }
  }
  if (code === 99991672 || /wiki:node:read|wiki:wiki/i.test(msg)) {
    return "开放平台开通 wiki:node:read（只读即可），发布后把应用加为货代大纲知识库节点协作者；本系统只读不写飞书表";
  }
  if (/bitable:app|base:field:read|base:record:read/i.test(msg)) {
    return "开放平台开通 bitable:app:readonly（不要开可写的 bitable:app），发布后确认应用是文档协作者；本系统只拉取快照，绝不改表";
  }
  if (code === 91403 || /permission|权限|forbidden/i.test(msg)) {
    return "文档带「外部」标签时，需所有者把企业自建应用加为协作者，或将文档拷贝到本企业后再授权";
  }
  if (code === 91402 || /not found|不存在/i.test(msg)) {
    return "核对 spreadsheetToken 是否来自 /sheets/ 链接（wiki 链接需先换 token）";
  }
  return "打开飞书开放平台错误码说明，对照 detail.code";
}

/**
 * 硬边界：业务表默认只允许 GET。
 * 例外：经 appendSheetRows / updateSheetRow，且 path 含调用方传入的 spreadsheetToken
 *（当前业务：账目表记账、装箱表约仓回填 ASN/送仓时间）。
 */
function assertFeishuTableAccess(
  path: string,
  method: string,
  opts?: { accountsWriteToken?: string },
) {
  const m = method.toUpperCase();
  const p = path.toLowerCase();
  const touchesTable =
    p.includes("/bitable/") ||
    p.includes("/sheets/") ||
    p.includes("/wiki/");
  if (!touchesTable) return;
  if (m === "GET") return;

  const allowToken = opts?.accountsWriteToken?.trim();
  if (
    allowToken &&
    (m === "PUT" || m === "POST") &&
    p.includes("/sheets/") &&
    !p.includes("/bitable/") &&
    !p.includes("/wiki/")
  ) {
    const tokenLc = allowToken.toLowerCase();
    const encLc = encodeURIComponent(allowToken).toLowerCase();
    if (p.includes(tokenLc) || p.includes(encLc)) return;
  }

  throw new FeishuError(
    "拒绝写飞书业务表（只读边界）",
    "DOC_KIND_UNSUPPORTED",
    "write",
    { path, method: m },
    "仅经白名单写接口可改账目表/装箱表单元格；货代大纲等禁止 create/update/delete",
  );
}

function assertFeishuTableReadOnly(path: string, method: string) {
  assertFeishuTableAccess(path, method);
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

async function feishuWrite<T>(
  path: string,
  method: "PUT" | "POST",
  token: string,
  accountsWriteToken: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<T> {
  assertFeishuTableAccess(path, method, { accountsWriteToken });
  const url = path.startsWith("http") ? path : `${OPEN_BASE}${path}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new FeishuError(
      "飞书写 API 网络失败",
      "API_HTTP",
      "write",
      { path, cause: e instanceof Error ? e.message : String(e) },
      FEISHU_ACCOUNTS_WRITE_PERM_HINT,
    );
  }

  const text = await res.text();
  let envelope: FeishuApiEnvelope;
  try {
    envelope = JSON.parse(text) as FeishuApiEnvelope;
  } catch {
    throw new FeishuError(
      "飞书写 API 响应不是 JSON",
      "API_HTTP",
      "write",
      { path, httpStatus: res.status, bodyPreview: text.slice(0, 400) },
      FEISHU_ACCOUNTS_WRITE_PERM_HINT,
    );
  }

  if (!res.ok) {
    throw new FeishuError(
      `飞书写 HTTP ${res.status}`,
      "API_HTTP",
      "write",
      { path, httpStatus: res.status, code: envelope.code, msg: envelope.msg },
      hintForBizCode(envelope.code ?? 0, envelope.msg ?? "", "write"),
    );
  }

  if (envelope.code !== 0) {
    throw new FeishuError(
      `飞书写业务错误 ${envelope.code}: ${envelope.msg}`,
      "API_BIZ",
      "write",
      { path, code: envelope.code, msg: envelope.msg },
      hintForBizCode(envelope.code, envelope.msg, "write"),
    );
  }

  return envelope.data as T;
}

/**
 * 账目表白名单：追加行到指定 sheet（表尾）。
 * spreadsheetToken 必须与调用方传入的 accountsWriteToken 一致。
 */
export async function appendSheetRows(
  token: string,
  spreadsheetToken: string,
  sheetId: string,
  values: unknown[][],
  fetchImpl: typeof fetch = fetch,
): Promise<{ updatedRange?: string }> {
  if (!spreadsheetToken.trim()) {
    throw new FeishuError(
      "缺少 spreadsheetToken",
      "DOC_TOKEN_MISSING",
      "write",
    );
  }
  if (!sheetId.trim()) {
    throw new FeishuError("缺少 sheetId", "SHEET_NOT_FOUND", "write");
  }
  if (!values.length) {
    throw new FeishuError("append 行不能为空", "API_BIZ", "write");
  }

  const path = `/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values_append`;
  const data = await feishuWrite<{
    updates?: { updatedRange?: string };
    revision?: number;
  }>(
    path,
    "POST",
    token,
    spreadsheetToken,
    {
      valueRange: {
        range: sheetId,
        values,
      },
    },
    fetchImpl,
  );
  return { updatedRange: data?.updates?.updatedRange };
}

/**
 * 账目表白名单：整行覆盖写回（调用方负责先读后合并）。
 * range 形如 `sheetId!A5:Z5`。
 */
export async function updateSheetRow(
  token: string,
  spreadsheetToken: string,
  range: string,
  values: unknown[][],
  fetchImpl: typeof fetch = fetch,
): Promise<{ updatedRange?: string }> {
  if (!spreadsheetToken.trim()) {
    throw new FeishuError(
      "缺少 spreadsheetToken",
      "DOC_TOKEN_MISSING",
      "write",
    );
  }
  if (!range.trim()) {
    throw new FeishuError("缺少 range", "API_BIZ", "write");
  }
  if (!values.length) {
    throw new FeishuError("update 行不能为空", "API_BIZ", "write");
  }

  const path = `/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values`;
  const data = await feishuWrite<{
    updatedRange?: string;
    revision?: number;
  }>(
    path,
    "PUT",
    token,
    spreadsheetToken,
    {
      valueRange: {
        range,
        values,
      },
    },
    fetchImpl,
  );
  return { updatedRange: data?.updatedRange };
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

export type FeishuWikiNode = {
  nodeToken: string;
  objToken: string;
  objType: string;
  title: string;
};

/** 知识库节点 → 真实云文档 token（wiki 形态多维表用） */
export async function getWikiNode(
  token: string,
  nodeToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuWikiNode> {
  const data = await feishuGet<{
    node?: {
      node_token?: string;
      obj_token?: string;
      obj_type?: string;
      title?: string;
    };
  }>(
    `/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}`,
    token,
    fetchImpl,
    "meta",
  );
  const n = data?.node;
  if (!n?.obj_token || !n.obj_type) {
    throw new FeishuError(
      "知识库节点未返回 obj_token",
      "API_BIZ",
      "meta",
      { nodeToken, data },
      "确认 wiki token 正确；应用需 wiki:node:read 且已加为文档协作者",
    );
  }
  return {
    nodeToken: String(n.node_token ?? nodeToken),
    objToken: String(n.obj_token),
    objType: String(n.obj_type),
    title: String(n.title ?? ""),
  };
}

export type FeishuBitableField = {
  fieldId: string;
  fieldName: string;
  type: number;
  uiType: string;
};

export async function listBitableFields(
  token: string,
  appToken: string,
  tableId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuBitableField[]> {
  const data = await feishuGet<{
    items?: Array<{
      field_id?: string;
      field_name?: string;
      type?: number;
      ui_type?: string;
    }>;
  }>(
    `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
    token,
    fetchImpl,
    "meta",
  );
  return (data?.items ?? [])
    .map((f) => ({
      fieldId: String(f.field_id ?? ""),
      fieldName: String(f.field_name ?? ""),
      type: Number(f.type ?? 0),
      uiType: String(f.ui_type ?? ""),
    }))
    .filter((f) => f.fieldId && f.fieldName);
}

function cellToPlainText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item == null) return "";
        if (typeof item === "string" || typeof item === "number") return String(item);
        if (typeof item === "object") {
          const o = item as Record<string, unknown>;
          if (typeof o.text === "string") return o.text;
          if (typeof o.name === "string") return o.name;
          if (typeof o.email === "string") return o.email;
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.value === "string" || typeof o.value === "number") {
      return String(o.value);
    }
  }
  return "";
}

export type FeishuBitableRecordPage = {
  records: Array<Record<string, unknown>>;
  hasMore: boolean;
  pageToken: string | null;
  total: number | null;
};

export async function listBitableRecordsPage(
  token: string,
  appToken: string,
  tableId: string,
  opts: { pageSize?: number; pageToken?: string | null } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuBitableRecordPage> {
  const qs = new URLSearchParams({
    page_size: String(opts.pageSize ?? 100),
  });
  if (opts.pageToken) qs.set("page_token", opts.pageToken);
  const data = await feishuGet<{
    items?: Array<{ record_id?: string; fields?: Record<string, unknown> }>;
    has_more?: boolean;
    page_token?: string;
    total?: number;
  }>(
    `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${qs}`,
    token,
    fetchImpl,
    "read",
  );
  const records = (data?.items ?? []).map((it) => ({
    ...(it.fields ?? {}),
    __record_id: it.record_id ?? "",
  }));
  return {
    records,
    hasMore: Boolean(data?.has_more),
    pageToken: data?.page_token ?? null,
    total: data?.total ?? null,
  };
}

/** 拉全表记录并展成二维表（首行表头=字段名） */
export async function readBitableAsValues(
  token: string,
  appToken: string,
  tableId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ title: string; fieldNames: string[]; values: unknown[][] }> {
  const fields = await listBitableFields(token, appToken, tableId, fetchImpl);
  const fieldNames = fields.map((f) => f.fieldName);
  const all: Array<Record<string, unknown>> = [];
  let pageToken: string | null = null;
  let guard = 0;
  do {
    const page = await listBitableRecordsPage(
      token,
      appToken,
      tableId,
      { pageSize: 100, pageToken },
      fetchImpl,
    );
    all.push(...page.records);
    pageToken = page.hasMore ? page.pageToken : null;
    guard += 1;
  } while (pageToken && guard < 50);

  const values: unknown[][] = [fieldNames];
  for (const rec of all) {
    values.push(fieldNames.map((name) => cellToPlainText(rec[name])));
  }
  return { title: "货代大纲", fieldNames, values };
}

export type FeishuHttpClient = {
  getToken: () => Promise<string>;
  listSheets: (spreadsheetToken: string) => Promise<FeishuSheetMeta[]>;
  readSheet: (
    spreadsheetToken: string,
    sheet: FeishuSheetMeta,
  ) => Promise<unknown[][]>;
  resolveWikiBitableAppToken: (wikiToken: string) => Promise<string>;
  /** 知识库节点 → 电子表格 spreadsheetToken（obj_type=sheet） */
  resolveWikiSpreadsheetToken: (wikiToken: string) => Promise<string>;
  readBitableTable: (
    appToken: string,
    tableId: string,
  ) => Promise<{ title: string; values: unknown[][] }>;
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
    async resolveWikiBitableAppToken(wikiToken: string) {
      const t = await getTenantAccessToken(cred, fetchImpl);
      const node = await getWikiNode(t, wikiToken, fetchImpl);
      if (node.objType !== "bitable") {
        throw new FeishuError(
          `知识库节点不是多维表（obj_type=${node.objType}）`,
          "DOC_KIND_UNSUPPORTED",
          "meta",
          { wikiToken, objType: node.objType, objToken: node.objToken },
          "确认链接指向货代大纲多维表；若是电子表格请用 kind=wiki + wikiToken（无 table=）",
        );
      }
      return node.objToken;
    },
    async resolveWikiSpreadsheetToken(wikiToken: string) {
      const t = await getTenantAccessToken(cred, fetchImpl);
      const node = await getWikiNode(t, wikiToken, fetchImpl);
      const sheetTypes = new Set(["sheet", "spreadsheet", "sheets"]);
      if (sheetTypes.has(node.objType)) {
        return node.objToken;
      }
      if (node.objType === "bitable") {
        throw new FeishuError(
          `知识库节点是多维表，需配置 bitableTableId（URL ?table=）`,
          "DOC_TOKEN_MISSING",
          "meta",
          { wikiToken, objType: node.objType, objToken: node.objToken },
          "在 feishu.docs.json 填 bitableTableId，或改用带 table=tbl… 的 wiki/base 链接",
        );
      }
      throw new FeishuError(
        `知识库节点不是电子表格（obj_type=${node.objType}）`,
        "DOC_KIND_UNSUPPORTED",
        "meta",
        { wikiToken, objType: node.objType, objToken: node.objToken },
        "确认 wiki 链接指向电子表格（飞书 obj_type=sheet）",
      );
    },
    async readBitableTable(appToken: string, tableId: string) {
      const t = await getTenantAccessToken(cred, fetchImpl);
      const got = await readBitableAsValues(t, appToken, tableId, fetchImpl);
      return { title: got.title, values: got.values };
    },
  };
}
