/**
 * 采购账目记账：仅向飞书 accounts 表追加/按行合并更新。
 * 不写产品/装箱/日报等其它飞书业务表。
 */
import {
  FEISHU_ACCOUNTS_WRITE_PERM_HINT,
  appendSheetRows,
  colIndexToLetter,
  createFeishuHttpClient,
  listSpreadsheetSheets,
  readSheetValues,
  updateSheetRow,
  type FeishuSheetMeta,
} from "../../platforms/feishu/http.js";
import { FeishuError } from "../../platforms/feishu/errors.js";
import {
  loadFeishuDocsConfig,
  readFeishuCredentials,
} from "../../platforms/feishu/config.js";
import {
  cellText,
  headerIndexMap,
  parseNumber,
} from "../../platforms/feishu/normalize/cells.js";
import type { FeishuDocRef } from "../../platforms/feishu/types.js";

export type LedgerSheetKey =
  | "product_purchase"
  | "packaging_purchase"
  | "expense_misc";

export type LedgerFieldType = "text" | "number" | "date";

export type LedgerFieldDef = {
  key: string;
  label: string;
  type: LedgerFieldType;
  required?: boolean;
  /** 匹配飞书表头的别名（按顺序优先） */
  headerAliases: string[];
};

export type LedgerSheetDef = {
  key: LedgerSheetKey;
  title: string;
  kind: "purchase" | "expense";
  fields: LedgerFieldDef[];
};

const PURCHASE_FIELDS: LedgerFieldDef[] = [
  {
    key: "partnerSku",
    label: "PSKU",
    type: "text",
    required: true,
    headerAliases: ["PSKU", "psku", "Partner SKU", "partner_sku", "产品SKU", "SKU"],
  },
  {
    key: "productName",
    label: "名称",
    type: "text",
    headerAliases: ["名称", "产品名称", "品名", "Title", "商品名"],
  },
  {
    key: "qty",
    label: "数量",
    type: "number",
    headerAliases: ["数量", "采购数量", "Qty", "qty", "件数"],
  },
  {
    key: "unitCost",
    label: "采购单价",
    type: "number",
    headerAliases: ["采购单价", "单价", "成本单价", "Unit Cost", "unit_cost"],
  },
  {
    key: "amount",
    label: "实付款(元)",
    type: "number",
    headerAliases: [
      "实付款(元)",
      "实付款",
      "采购金额",
      "金额",
      "总价",
      "Amount",
      "amount",
      "实付",
    ],
  },
  {
    key: "brand",
    label: "品牌",
    type: "text",
    headerAliases: ["品牌", "Brand"],
  },
  {
    key: "purchasedAt",
    label: "采购时间",
    type: "date",
    headerAliases: ["采购时间", "采购日期", "日期", "Date", "下单日期"],
  },
  {
    key: "orderId",
    label: "订单号",
    type: "text",
    headerAliases: ["订单号", "1688订单号", "Order ID", "order_id", "orderId"],
  },
  {
    key: "payRemark",
    label: "付款备注",
    type: "text",
    headerAliases: ["付款备注"],
  },
  {
    key: "trackingNo",
    label: "快递单号",
    type: "text",
    headerAliases: ["快递单号", "物流单号", "运单号", "Tracking", "tracking_no"],
  },
  {
    key: "transitStatus",
    label: "在途状态",
    type: "text",
    headerAliases: ["在途状态", "物流状态", "发货状态", "Transit Status"],
  },
  {
    key: "remark",
    label: "备注",
    type: "text",
    headerAliases: ["备注", "Remark", "说明", "Note"],
  },
  {
    key: "otherRemark",
    label: "其他备注",
    type: "text",
    headerAliases: ["其他备注"],
  },
];

/** 产品包装采购：无 PSKU，列名与产品采购不同 */
const PACKAGING_FIELDS: LedgerFieldDef[] = [
  {
    key: "packName",
    label: "包装名字",
    type: "text",
    required: true,
    headerAliases: ["包装名字", "包装名称", "名称", "品名"],
  },
  {
    key: "qty",
    label: "数量",
    type: "number",
    headerAliases: ["数量", "Qty", "qty", "件数"],
  },
  {
    key: "purchasedAt",
    label: "日期",
    type: "date",
    headerAliases: ["日期", "采购日期", "Date", "时间"],
  },
  {
    key: "orderId",
    label: "订单号",
    type: "text",
    headerAliases: ["订单号", "Order ID", "order_id"],
  },
  {
    key: "unitCost",
    label: "单价",
    type: "number",
    headerAliases: ["单价", "采购单价", "Unit Cost"],
  },
  {
    key: "amount",
    label: "总价",
    type: "number",
    headerAliases: ["总价", "实付款(元)", "实付款", "金额", "Amount"],
  },
  {
    key: "packProduct",
    label: "包装产品",
    type: "text",
    headerAliases: ["包装产品", "适用产品", "产品"],
  },
  {
    key: "remark",
    label: "备注",
    type: "text",
    headerAliases: ["备注", "Remark", "说明"],
  },
];

const EXPENSE_FIELDS: LedgerFieldDef[] = [
  {
    key: "category",
    label: "项目",
    type: "text",
    required: true,
    headerAliases: ["项目", "科目", "类别", "Category", "类型", "名称"],
  },
  {
    key: "qty",
    label: "数量",
    type: "number",
    headerAliases: ["数量", "Qty", "qty"],
  },
  {
    key: "occurredAt",
    label: "时间",
    type: "date",
    headerAliases: ["时间", "日期", "Date", "入账日期", "发生日期"],
  },
  {
    key: "orderId",
    label: "订单号",
    type: "text",
    headerAliases: ["订单号", "Order ID"],
  },
  {
    key: "amount",
    label: "实付款(元)",
    type: "number",
    required: true,
    headerAliases: [
      "实付款(元)",
      "实付款",
      "金额",
      "Amount",
      "入账金额",
      "支出金额",
      "实付",
    ],
  },
  {
    key: "payRemark",
    label: "付款备注",
    type: "text",
    headerAliases: ["付款备注"],
  },
  {
    key: "remark",
    label: "备注",
    type: "text",
    headerAliases: ["备注", "Remark", "说明", "摘要"],
  },
];

export const LEDGER_SHEETS: LedgerSheetDef[] = [
  {
    key: "product_purchase",
    title: "产品采购",
    kind: "purchase",
    fields: PURCHASE_FIELDS,
  },
  {
    key: "packaging_purchase",
    title: "产品包装采购",
    kind: "purchase",
    fields: PACKAGING_FIELDS,
  },
  {
    key: "expense_misc",
    title: "公司开支-杂项",
    kind: "expense",
    fields: EXPENSE_FIELDS,
  },
];

export function getLedgerSheetDef(key: string): LedgerSheetDef | undefined {
  return LEDGER_SHEETS.find((s) => s.key === key);
}

export function resolveAccountsDoc(): FeishuDocRef {
  const cfg = loadFeishuDocsConfig();
  const doc = cfg.docs.find((d) => d.id === "accounts" && d.enabled !== false);
  if (!doc?.spreadsheetToken) {
    throw new FeishuError(
      "未配置账目表 accounts（spreadsheetToken）",
      "CONFIG_MISSING",
      "config",
      { docsPath: "feishu.docs.json id=accounts" },
      "在 feishu.docs.json 配置 accounts，spreadsheetToken=DQNCsZKPQh6J4qtphMLcMDhinxc",
    );
  }
  return doc;
}

function findSheetMeta(
  sheets: FeishuSheetMeta[],
  title: string,
): FeishuSheetMeta | undefined {
  const exact = sheets.find((s) => s.title === title);
  if (exact) return exact;
  return sheets.find((s) => s.title.includes(title));
}

/** 表头别名 → 列下标（0-based）；只映射表中真实存在的列 */
export function resolveFieldColumns(
  headerRow: unknown[],
  fields: LedgerFieldDef[],
  opts?: { fallbackCategoryCol0?: boolean },
): Map<string, number> {
  const headers = headerIndexMap(headerRow);
  const out = new Map<string, number>();
  for (const f of fields) {
    for (const alias of f.headerAliases) {
      const idx = headers.get(alias);
      if (idx != null) {
        out.set(f.key, idx);
        break;
      }
    }
  }
  // 公司开支-杂项：A 列表头经常是空白，项目名落在第 0 列
  if (
    opts?.fallbackCategoryCol0 &&
    !out.has("category") &&
    fields.some((f) => f.key === "category")
  ) {
    out.set("category", 0);
  }
  // 表头单元格偶发带换行（如「名称\n」）
  if (!out.has("productName")) {
    for (let i = 0; i < headerRow.length; i++) {
      const h = cellText(headerRow[i]).replace(/\s+/g, "");
      if (h === "名称" || h === "产品名称") {
        out.set("productName", i);
        break;
      }
    }
  }
  return out;
}

/** 读整行 → 合并已提交字段 → 写回用值数组（未提交列保留原值） */
export function mergeRowValues(
  existing: unknown[],
  colCount: number,
  fieldCols: Map<string, number>,
  fields: Record<string, string | number | null | undefined>,
  submittedKeys: Set<string>,
): unknown[] {
  const width = Math.max(colCount, existing.length, 1);
  const next: unknown[] = Array.from({ length: width }, (_, i) =>
    i < existing.length ? existing[i] : "",
  );
  for (const [key, col] of fieldCols) {
    if (!submittedKeys.has(key)) continue;
    if (col < 0 || col >= width) continue;
    const v = fields[key];
    if (v == null) {
      next[col] = "";
    } else {
      next[col] = v;
    }
  }
  return next;
}

function normalizeFieldValue(
  def: LedgerFieldDef,
  raw: unknown,
): string | number | null {
  if (raw == null || raw === "") return null;
  if (def.type === "number") {
    const n = typeof raw === "number" ? raw : parseNumber(raw);
    return n;
  }
  const s = cellText(raw);
  return s || null;
}

export function prepareLedgerFields(
  sheet: LedgerSheetDef,
  input: Record<string, unknown>,
  opts?: { partial?: boolean },
): {
  fields: Record<string, string | number | null>;
  submittedKeys: Set<string>;
} {
  const partial = Boolean(opts?.partial);
  const fields: Record<string, string | number | null> = {};
  const submittedKeys = new Set<string>();

  for (const def of sheet.fields) {
    if (!(def.key in input)) {
      if (!partial && def.required) {
        throw new FeishuError(
          `缺少必填字段：${def.label}`,
          "API_BIZ",
          "write",
          { field: def.key },
        );
      }
      continue;
    }
    submittedKeys.add(def.key);
    fields[def.key] = normalizeFieldValue(def, input[def.key]);
  }

  if (!partial) {
    for (const def of sheet.fields) {
      if (def.required && (fields[def.key] == null || fields[def.key] === "")) {
        throw new FeishuError(
          `缺少必填字段：${def.label}`,
          "API_BIZ",
          "write",
          { field: def.key },
        );
      }
    }
  }

  // 采购：金额为空时用 qty×unitCost
  if (sheet.kind === "purchase") {
    const qty = typeof fields.qty === "number" ? fields.qty : null;
    const unit =
      typeof fields.unitCost === "number" ? fields.unitCost : null;
    const amountEmpty =
      fields.amount == null ||
      fields.amount === "" ||
      (typeof fields.amount === "number" && fields.amount === 0);
    if (
      amountEmpty &&
      qty != null &&
      unit != null &&
      (submittedKeys.has("qty") ||
        submittedKeys.has("unitCost") ||
        submittedKeys.has("amount") ||
        !partial)
    ) {
      fields.amount = Math.round(qty * unit * 100) / 100;
      submittedKeys.add("amount");
    }
  }

  return { fields, submittedKeys };
}

export type LedgerRowView = {
  sheetRow: number;
  fields: Record<string, string | number | null>;
  preview: string;
};

function rowPreview(
  sheet: LedgerSheetDef,
  fields: Record<string, string | number | null>,
): string {
  if (sheet.key === "packaging_purchase") {
    return [fields.packName, fields.packProduct, fields.orderId, fields.amount]
      .filter((x) => x != null && x !== "")
      .join(" · ");
  }
  if (sheet.kind === "purchase") {
    return [fields.partnerSku, fields.productName, fields.orderId, fields.amount]
      .filter((x) => x != null && x !== "")
      .join(" · ");
  }
  return [fields.category, fields.occurredAt, fields.amount, fields.remark]
    .filter((x) => x != null && x !== "")
    .join(" · ");
}

function extractFieldsFromRow(
  row: unknown[],
  fieldCols: Map<string, number>,
  defs: LedgerFieldDef[],
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const def of defs) {
    const col = fieldCols.get(def.key);
    if (col == null) {
      out[def.key] = null;
      continue;
    }
    out[def.key] = normalizeFieldValue(def, row[col]);
  }
  return out;
}

async function loadSheetContext(sheetKey: LedgerSheetKey) {
  const doc = resolveAccountsDoc();
  const def = getLedgerSheetDef(sheetKey);
  if (!def) {
    throw new FeishuError(
      `未知子表：${sheetKey}`,
      "SHEET_NOT_FOUND",
      "write",
      { sheetKey },
    );
  }
  const cred = readFeishuCredentials();
  const client = createFeishuHttpClient(cred);
  const token = await client.getToken();
  const spreadsheetToken = doc.spreadsheetToken!;
  const sheets = await listSpreadsheetSheets(token, spreadsheetToken);
  const meta = findSheetMeta(sheets, def.title);
  if (!meta) {
    throw new FeishuError(
      `账目表中找不到子表「${def.title}」`,
      "SHEET_NOT_FOUND",
      "meta",
      { title: def.title, available: sheets.map((s) => s.title) },
    );
  }
  const values = await readSheetValues(token, spreadsheetToken, meta);
  const headerRow = values[0] ?? [];
  const fieldCols = resolveFieldColumns(headerRow, def.fields, {
    fallbackCategoryCol0: def.key === "expense_misc",
  });
  if (fieldCols.size === 0) {
    throw new FeishuError(
      `子表「${def.title}」表头无法匹配记账字段`,
      "NORMALIZE_HEADER",
      "read",
      { title: def.title, header: headerRow.map((c) => cellText(c)) },
    );
  }
  return {
    doc,
    def,
    token,
    spreadsheetToken,
    meta,
    values,
    headerRow,
    fieldCols,
  };
}

export function listLedgerSheetMeta() {
  return LEDGER_SHEETS.map((s) => ({
    key: s.key,
    title: s.title,
    kind: s.kind,
    fields: s.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: Boolean(f.required),
    })),
  }));
}

function isEmptyDataRow(row: unknown[]): boolean {
  if (!row?.length) return true;
  return !row.some((c) => {
    if (c == null) return false;
    if (typeof c === "string") return c.trim() !== "";
    if (typeof c === "number" || typeof c === "boolean") return true;
    if (Array.isArray(c)) return c.length > 0;
    if (typeof c === "object") return true;
    return String(c).trim() !== "";
  });
}

export async function listLedgerRows(
  sheetKey: LedgerSheetKey,
  opts?: { limit?: number },
): Promise<{
  sheetKey: LedgerSheetKey;
  title: string;
  spreadsheetToken: string;
  sheetId: string;
  headers: string[];
  rows: LedgerRowView[];
  totalDataRows: number;
}> {
  const ctx = await loadSheetContext(sheetKey);
  const limit = Math.min(Math.max(opts?.limit ?? 80, 1), 200);
  const dataRows = ctx.values.slice(1);
  // 飞书 grid 常在表尾留大量空行；只统计/展示有内容的行
  const filled = dataRows
    .map((row, i) => ({ row, sheetRow: i + 2 }))
    .filter((x) => !isEmptyDataRow(x.row));
  const totalDataRows = filled.length;
  const slice = filled.slice(Math.max(0, filled.length - limit));
  const rows: LedgerRowView[] = slice.map(({ row, sheetRow }) => {
    const fields = extractFieldsFromRow(row, ctx.fieldCols, ctx.def.fields);
    return {
      sheetRow,
      fields,
      preview: rowPreview(ctx.def, fields),
    };
  });
  // 最新在上
  rows.reverse();
  return {
    sheetKey,
    title: ctx.def.title,
    spreadsheetToken: ctx.spreadsheetToken,
    sheetId: ctx.meta.sheetId,
    headers: ctx.headerRow.map((c) => cellText(c)),
    rows,
    totalDataRows,
  };
}

function buildValuesArray(
  fieldCols: Map<string, number>,
  colCount: number,
  fields: Record<string, string | number | null>,
  submittedKeys: Set<string>,
  existing?: unknown[],
): unknown[] {
  if (existing) {
    return mergeRowValues(
      existing,
      colCount,
      fieldCols,
      fields,
      submittedKeys,
    );
  }
  const width = Math.max(colCount, ...[...fieldCols.values()].map((c) => c + 1), 1);
  const next: unknown[] = Array.from({ length: width }, () => "");
  for (const [key, col] of fieldCols) {
    if (!submittedKeys.has(key)) continue;
    const v = fields[key];
    next[col] = v == null ? "" : v;
  }
  return next;
}

export async function appendLedgerRow(
  sheetKey: LedgerSheetKey,
  input: Record<string, unknown>,
): Promise<{ sheetRow: number | null; updatedRange?: string; title: string }> {
  const ctx = await loadSheetContext(sheetKey);
  const prepared = prepareLedgerFields(ctx.def, input, { partial: false });
  const colCount = Math.max(
    ctx.meta.columnCount,
    ctx.headerRow.length,
    ...[...ctx.fieldCols.values()].map((c) => c + 1),
  );
  const rowValues = buildValuesArray(
    ctx.fieldCols,
    colCount,
    prepared.fields,
    prepared.submittedKeys,
  );
  try {
    const result = await appendSheetRows(
      ctx.token,
      ctx.spreadsheetToken,
      ctx.meta.sheetId,
      [rowValues],
    );
    // 追加后大致行号 = 当前数据行数 + 2（表头+新行）；飞书可能中间有空行，仅作提示
    const sheetRow = ctx.values.length + 1;
    return {
      sheetRow,
      updatedRange: result.updatedRange,
      title: ctx.def.title,
    };
  } catch (e) {
    if (e instanceof FeishuError && !e.hint) {
      throw new FeishuError(
        e.message,
        e.code,
        e.stage,
        e.detail,
        FEISHU_ACCOUNTS_WRITE_PERM_HINT,
      );
    }
    throw e;
  }
}

export async function updateLedgerRow(
  sheetKey: LedgerSheetKey,
  sheetRow: number,
  input: Record<string, unknown>,
): Promise<{ sheetRow: number; updatedRange?: string; title: string }> {
  if (!Number.isFinite(sheetRow) || sheetRow < 2) {
    throw new FeishuError(
      "sheetRow 必须 ≥ 2（第 1 行为表头）",
      "API_BIZ",
      "write",
      { sheetRow },
    );
  }
  const ctx = await loadSheetContext(sheetKey);
  const prepared = prepareLedgerFields(ctx.def, input, { partial: true });
  if (prepared.submittedKeys.size === 0) {
    throw new FeishuError("未提交任何可更新字段", "API_BIZ", "write");
  }
  const colCount = Math.max(
    ctx.meta.columnCount,
    ctx.headerRow.length,
    ...[...ctx.fieldCols.values()].map((c) => c + 1),
  );
  const existing = ctx.values[sheetRow - 1] ?? [];
  const rowValues = buildValuesArray(
    ctx.fieldCols,
    colCount,
    prepared.fields,
    prepared.submittedKeys,
    existing,
  );
  const endCol = colIndexToLetter(rowValues.length);
  const range = `${ctx.meta.sheetId}!A${sheetRow}:${endCol}${sheetRow}`;
  try {
    const result = await updateSheetRow(
      ctx.token,
      ctx.spreadsheetToken,
      range,
      [rowValues],
    );
    return {
      sheetRow,
      updatedRange: result.updatedRange,
      title: ctx.def.title,
    };
  } catch (e) {
    if (e instanceof FeishuError && !e.hint) {
      throw new FeishuError(
        e.message,
        e.code,
        e.stage,
        e.detail,
        FEISHU_ACCOUNTS_WRITE_PERM_HINT,
      );
    }
    throw e;
  }
}
