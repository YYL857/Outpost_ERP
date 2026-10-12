/**
 * M3：账目表 → 产品采购行 + 入账/开支
 * 列名用别名兼容；无样本时尽量宽松匹配，拒绝无效行。
 */
import { createHash } from "node:crypto";
import type { FeishuRawSheet, FeishuRawSnapshot } from "../types.js";
import { FeishuError } from "../errors.js";
import {
  cellText,
  headerIndexMap,
  isValidPartnerSku,
  parseNumber,
  pickCol,
} from "./cells.js";
import type { NormalizeReject } from "./types.js";

export type NormalizedPurchaseLine = {
  id: string;
  partnerSku: string;
  productName: string;
  qty: number;
  unitCost: number;
  amount: number;
  supplier: string;
  purchasedAt: string | null;
  status: string;
  remark: string;
  sheetTitle: string;
  updatedAt: string;
  source: string;
  orderId: string;
  trackingNo: string;
  transitStatus: string;
  etaDate: string | null;
};

export type NormalizedCashEntry = {
  id: string;
  kind: "income" | "expense" | "other";
  amount: number;
  category: string;
  occurredAt: string | null;
  remark: string;
  sheetTitle: string;
  updatedAt: string;
  source: string;
};

function sheetByTitle(
  snap: FeishuRawSnapshot,
  titles: string[],
): FeishuRawSheet | undefined {
  for (const t of titles) {
    const hit = snap.sheets.find((s) => s.title === t || s.title.includes(t));
    if (hit) return hit;
  }
  return undefined;
}

function parseDateCell(v: unknown): string | null {
  const s = cellText(v);
  if (!s) return null;
  const m = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  }
  const n = Date.parse(s);
  if (!Number.isNaN(n)) return new Date(n).toISOString().slice(0, 10);
  return s.slice(0, 32);
}

function rowId(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

function normalizePurchaseSheet(
  sheet: FeishuRawSheet,
  updatedAt: string,
): { rows: NormalizedPurchaseLine[]; rejects: NormalizeReject[] } {
  const rows: NormalizedPurchaseLine[] = [];
  const rejects: NormalizeReject[] = [];
  if (sheet.values.length < 2) return { rows, rejects };
  const headers = headerIndexMap(sheet.values[0] ?? []);

  for (let ri = 1; ri < sheet.values.length; ri++) {
    const row = sheet.values[ri] ?? [];
    const partnerSku = cellText(
      pickCol(row, headers, [
        "PSKU",
        "psku",
        "Partner SKU",
        "partner_sku",
        "产品SKU",
        "SKU",
      ]),
    );
    if (!partnerSku) {
      rejects.push({
        sheet: sheet.title,
        row: ri + 1,
        reason: "missing_psku",
      });
      continue;
    }
    if (!isValidPartnerSku(partnerSku)) {
      rejects.push({
        sheet: sheet.title,
        row: ri + 1,
        partnerSku,
        reason: "invalid_psku",
      });
      continue;
    }

    const qty =
      parseNumber(
        pickCol(row, headers, ["采购数量", "数量", "Qty", "qty", "件数"]),
      ) ?? 0;
    const unitCost =
      parseNumber(
        pickCol(row, headers, [
          "采购单价",
          "单价",
          "成本单价",
          "Unit Cost",
          "unit_cost",
        ]),
      ) ?? 0;
    const amountRaw = parseNumber(
      pickCol(row, headers, ["采购金额", "金额", "总价", "Amount", "amount"]),
    );
    const amount =
      amountRaw != null && amountRaw > 0
        ? amountRaw
        : Math.round(qty * unitCost * 100) / 100;

    if (qty <= 0 && unitCost <= 0 && amount <= 0) {
      rejects.push({
        sheet: sheet.title,
        row: ri + 1,
        partnerSku,
        reason: "empty_amounts",
      });
      continue;
    }

    const purchasedAt = parseDateCell(
      pickCol(row, headers, [
        "采购日期",
        "采购时间",
        "日期",
        "Date",
        "下单日期",
      ]),
    );
    const supplier = cellText(
      pickCol(row, headers, [
        "供应商",
        "Supplier",
        "厂家",
        "卖家",
        "渠道",
      ]),
    );
    const status = cellText(
      pickCol(row, headers, ["状态", "Status", "采购状态", "在线状态"]),
    );
    const remark = cellText(
      pickCol(row, headers, ["备注", "Remark", "说明", "Note"]),
    );
    const productName = cellText(
      pickCol(row, headers, ["产品名称", "品名", "Title", "商品名", "名称"]),
    );
    const orderId = cellText(
      pickCol(row, headers, [
        "订单号",
        "1688订单号",
        "Order ID",
        "order_id",
        "orderId",
      ]),
    ).replace(/\s+/g, "");
    const trackingNo = cellText(
      pickCol(row, headers, [
        "快递单号",
        "物流单号",
        "运单号",
        "Tracking",
        "tracking_no",
      ]),
    ).replace(/\s+/g, "");
    const transitStatus = cellText(
      pickCol(row, headers, [
        "在途状态",
        "物流状态",
        "发货状态",
        "在线状态",
        "Transit Status",
      ]),
    );

    rows.push({
      id: rowId([
        sheet.title,
        partnerSku,
        purchasedAt ?? "",
        String(qty),
        String(unitCost),
        String(ri),
      ]),
      partnerSku,
      productName,
      qty,
      unitCost,
      amount,
      supplier,
      purchasedAt,
      status,
      remark,
      sheetTitle: sheet.title,
      updatedAt,
      source: "feishu:accounts:产品采购",
      orderId,
      trackingNo,
      transitStatus,
      etaDate: null,
    });
  }
  return { rows, rejects };
}

function normalizeCashSheet(
  sheet: FeishuRawSheet,
  kind: "income" | "expense" | "other",
  updatedAt: string,
): { rows: NormalizedCashEntry[]; rejects: NormalizeReject[] } {
  const rows: NormalizedCashEntry[] = [];
  const rejects: NormalizeReject[] = [];
  if (sheet.values.length < 2) return { rows, rejects };
  const headers = headerIndexMap(sheet.values[0] ?? []);

  for (let ri = 1; ri < sheet.values.length; ri++) {
    const row = sheet.values[ri] ?? [];
    const amount =
      parseNumber(
        pickCol(row, headers, ["金额", "Amount", "入账金额", "支出金额", "实付"]),
      ) ?? 0;
    if (amount === 0) {
      rejects.push({
        sheet: sheet.title,
        row: ri + 1,
        reason: "empty_amount",
      });
      continue;
    }
    const category = cellText(
      pickCol(row, headers, ["科目", "类别", "Category", "类型", "项目"]),
    );
    const occurredAt = parseDateCell(
      pickCol(row, headers, ["日期", "Date", "入账日期", "发生日期"]),
    );
    const remark = cellText(
      pickCol(row, headers, ["备注", "Remark", "说明", "摘要"]),
    );
    rows.push({
      id: rowId([
        sheet.title,
        kind,
        occurredAt ?? "",
        String(amount),
        category,
        String(ri),
      ]),
      kind,
      amount: Math.abs(amount),
      category,
      occurredAt,
      remark,
      sheetTitle: sheet.title,
      updatedAt,
      source: `feishu:accounts:${sheet.title}`,
    });
  }
  return { rows, rejects };
}

export function normalizeAccountsSnapshot(
  snap: FeishuRawSnapshot,
  updatedAt: string,
): {
  purchases: NormalizedPurchaseLine[];
  cash: NormalizedCashEntry[];
  rejects: NormalizeReject[];
} {
  if (snap.docId !== "accounts" && snap.targetDomain !== "purchase_cash") {
    throw new FeishuError(
      `期望账目快照，收到 docId=${snap.docId} domain=${snap.targetDomain}`,
      "SNAPSHOT_INVALID",
      "normalize",
      { docId: snap.docId, targetDomain: snap.targetDomain },
    );
  }

  const purchaseSheet = sheetByTitle(snap, ["产品采购"]);
  const incomeSheet = sheetByTitle(snap, ["公司入账", "入账"]);
  const expenseSheet = sheetByTitle(snap, ["公司开支", "开支", "杂项"]);

  const purchases: NormalizedPurchaseLine[] = [];
  const cash: NormalizedCashEntry[] = [];
  const rejects: NormalizeReject[] = [];

  if (purchaseSheet) {
    const built = normalizePurchaseSheet(purchaseSheet, updatedAt);
    purchases.push(...built.rows);
    rejects.push(...built.rejects);
  } else {
    rejects.push({
      sheet: "(missing)",
      row: 0,
      reason: "missing_sheet_产品采购",
    });
  }

  if (incomeSheet) {
    const built = normalizeCashSheet(incomeSheet, "income", updatedAt);
    cash.push(...built.rows);
    rejects.push(...built.rejects);
  }
  if (expenseSheet) {
    const built = normalizeCashSheet(expenseSheet, "expense", updatedAt);
    cash.push(...built.rows);
    rejects.push(...built.rejects);
  }

  return { purchases, cash, rejects };
}
