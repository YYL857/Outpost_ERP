/**
 * npx tsx src/modules/purchase/accounts-ledger.test.ts
 */
import assert from "node:assert/strict";
import {
  LEDGER_SHEETS,
  getLedgerSheetDef,
  mergeRowValues,
  prepareLedgerFields,
  resolveFieldColumns,
} from "./accounts-ledger.js";

assert.equal(LEDGER_SHEETS.length, 3);
assert.ok(getLedgerSheetDef("product_purchase"));
assert.ok(getLedgerSheetDef("packaging_purchase"));
assert.ok(getLedgerSheetDef("expense_misc"));
assert.equal(getLedgerSheetDef("nope"), undefined);

const purchase = getLedgerSheetDef("product_purchase")!;
const realPurchaseHeaders = [
  "PSKU",
  "名称",
  "数量",
  "是否打印",
  "品牌",
  "采购时间",
  "订单号",
  "采购单价",
  "实付款(元)",
  "付款备注",
  "在途状态",
  "备注",
  "其他备注",
  "快递单号",
];
const cols = resolveFieldColumns(realPurchaseHeaders, purchase.fields);
assert.equal(cols.get("partnerSku"), 0);
assert.equal(cols.get("productName"), 1);
assert.equal(cols.get("qty"), 2);
assert.equal(cols.get("brand"), 4);
assert.equal(cols.get("purchasedAt"), 5);
assert.equal(cols.get("orderId"), 6);
assert.equal(cols.get("unitCost"), 7);
assert.equal(cols.get("amount"), 8);
assert.equal(cols.get("trackingNo"), 13);

const existing = realPurchaseHeaders.map((_, i) => `old${i}`);
existing[1] = "旧名";
existing[11] = "旧备注";
const merged = mergeRowValues(
  existing,
  existing.length,
  cols,
  { productName: "新名", remark: "新备注" },
  new Set(["productName", "remark"]),
);
assert.equal(merged[0], "old0");
assert.equal(merged[1], "新名");
assert.equal(merged[11], "新备注");

const prepared = prepareLedgerFields(purchase, {
  partnerSku: "ABC123",
  qty: 2,
  unitCost: 12.5,
});
assert.equal(prepared.fields.amount, 25);
assert.ok(prepared.submittedKeys.has("amount"));

const packaging = getLedgerSheetDef("packaging_purchase")!;
const packHeaders = [
  "包装名字",
  "数量",
  "日期",
  "订单号",
  "单价",
  "总价",
  "图片",
  "包装产品",
];
const packCols = resolveFieldColumns(packHeaders, packaging.fields);
assert.equal(packCols.get("packName"), 0);
assert.equal(packCols.get("amount"), 5);
assert.throws(
  () => prepareLedgerFields(packaging, { qty: 1 }),
  /缺少必填字段/,
);

const expense = getLedgerSheetDef("expense_misc")!;
const expenseHeaders = [
  "   ",
  "数量",
  "时间",
  "订单号",
  "实付款(元)",
  "付款备注",
  "备注",
];
const expenseCols = resolveFieldColumns(expenseHeaders, expense.fields, {
  fallbackCategoryCol0: true,
});
assert.equal(expenseCols.get("category"), 0);
assert.equal(expenseCols.get("qty"), 1);
assert.equal(expenseCols.get("occurredAt"), 2);
assert.equal(expenseCols.get("amount"), 4);

assert.throws(
  () => prepareLedgerFields(expense, { category: "办公" }),
  /缺少必填字段/,
);

const partial = prepareLedgerFields(
  expense,
  { remark: "补备注" },
  { partial: true },
);
assert.equal(partial.submittedKeys.size, 1);
assert.equal(partial.fields.remark, "补备注");

// 空行过滤：表尾空行不应进摘要列表（逻辑内联复现）
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
assert.equal(isEmptyDataRow([]), true);
assert.equal(isEmptyDataRow(["", null, "  "]), true);
assert.equal(isEmptyDataRow(["SKU1", "", 0]), false);

console.log("[accounts-ledger] smoke ok");
