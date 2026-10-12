/**
 * npx tsx src/modules/cargo-ledger/cargo-ledger.test.ts
 */
import assert from "node:assert/strict";
import { buildCargoLedger } from "./build.js";
import { filterTickets, findTicket } from "./query.js";
import type { FeishuRawSnapshot } from "../../platforms/feishu/types.js";

function snap(
  docId: string,
  domain: FeishuRawSnapshot["targetDomain"],
  sheets: Array<{ title: string; values: unknown[][] }>,
): FeishuRawSnapshot {
  return {
    version: 1,
    pulledAt: "2026-10-06T00:00:00.000Z",
    docId,
    docLabel: docId,
    targetDomain: domain,
    kind: "spreadsheet",
    spreadsheetToken: "tok",
    sheets: sheets.map((s, i) => ({
      sheetId: `s${i}`,
      title: s.title,
      rowCount: s.values.length,
      colCount: s.values[0]?.length ?? 0,
      values: s.values,
    })),
    source: { appIdMasked: "cli…" },
  };
}

const packing = snap("packing", "packing", [
  {
    title: "箱表",
    values: [
      [
        "箱号",
        "票号",
        "物流编号",
        "货代名称",
        "运输方式",
        "产品PCS-箱级",
        "店铺Code",
        "整票国内运费",
        "整票跨境实付",
        "实收跨境费",
        "到仓情况",
        "发货时间",
        "送仓时间",
        "货物重量",
      ],
      [
        "2605-001-N1-H",
        "T100",
        "LG1",
        "汉沙",
        "海运",
        10,
        "N1",
        80,
        400,
        200,
        "在途",
        "2026-09-01",
        "",
        4,
      ],
      [
        "2605-002-N1-H",
        "T100",
        "LG1",
        "汉沙",
        "海运",
        6,
        "N1",
        80,
        400,
        200,
        "在途",
        "2026-09-01",
        "",
        2,
      ],
    ],
  },
  {
    title: "装箱明细",
    values: [
      ["PSKU", "名称", "数量", "箱号", "产品单重", "产品重量合计"],
      ["N1SACAT001RD", "杯子A", 2, "2605-001-N1-H", 1, 2],
      ["N1SACAT002BL", "杯子B", 6, "2605-002-N1-H", 1, 6],
    ],
  },
]);

const product = snap("product", "local_cost_dims", [
  {
    title: "查找代码表",
    values: [
      ["颜色", "代码", "StoreCode", "Site"],
      ["红", "RD", "N1", "SA"],
      ["蓝", "BL", "N1", "SA"],
    ],
  },
  {
    title: "产品",
    values: [
      [
        "PSKU",
        "店铺代码",
        "类目代码",
        "款式代码",
        "颜色",
        "名称",
        "长",
        "宽",
        "高",
        "重量",
        "默认补货方式",
      ],
      ["=ARRAYFORMULA", "N1", "CAT", "1", "红", "杯子A", 10, 10, 10, 1, "海运"],
      ["N1SACAT002BL", "N1", "CAT", "2", "蓝", "杯子B", 10, 10, 10, 1, "海运"],
    ],
  },
  {
    title: "产品表每日信息",
    values: [
      ["psku", "采购单价"],
      ["N1SACAT001RD", 12],
    ],
  },
  {
    title: "到仓成本",
    values: [
      ["PSKU", "运输方式", "最终单件SKU成本"],
      ["N1SACAT001RD", "海运", 20],
    ],
  },
]);

const accounts = snap("accounts", "purchase_cash", [
  {
    title: "产品采购",
    values: [
      ["PSKU", "名称", "数量", "采购单价", "实付款(元)", "订单号", "采购时间"],
      ["N1SACAT001RD", "杯子A", 10, 12, 120, "OD1", "2026-08-01"],
    ],
  },
  {
    title: "产品包装采购",
    values: [
      ["包装名字", "数量"],
      ["纸箱", 5],
    ],
  },
  {
    title: "公司入账",
    values: [
      ["名称", "金额", "日期"],
      ["回款", 100, "2026-09-01"],
    ],
  },
]);

{
  const ledger = buildCargoLedger({
    packing: { path: "/tmp/packing.json", snap: packing },
    product: { path: "/tmp/product.json", snap: product },
    accounts: { path: "/tmp/accounts.json", snap: accounts },
    now: "2026-10-06T12:00:00.000Z",
  });

  assert.equal(ledger.tickets.length, 1, "one ticket");
  const t = ledger.tickets[0]!;
  assert.equal(t.ticketKey, "T100");
  assert.equal(t.shopCode, "N1");
  assert.equal(t.boxCount, 2);
  assert.equal(t.skuCount, 2);
  assert.equal(t.pcs, 8);
  assert.equal(t.crossFreight, 400);
  assert.equal(t.freightBasis, "ticket");
  assert.equal(t.inTransit, true);

  const a = t.skuLines.find((s) => s.partnerSku === "N1SACAT001RD");
  const b = t.skuLines.find((s) => s.partnerSku === "N1SACAT002BL");
  assert.ok(a && b);
  assert.equal(a.allocatedCrossFreight, 100);
  assert.equal(b.allocatedCrossFreight, 300);
  assert.equal(a.purchaseUnitHint, 12);
  assert.equal(a.purchaseLotCount, 1);
  assert.equal(b.purchaseLotCount, 0);

  const listed = filterTickets(ledger, { shop: "N1", q: "杯子B" });
  assert.equal(listed.total, 1);
  assert.equal(findTicket(ledger, "T100")?.skuLines.length, 2);
  assert.ok(ledger.side.purchaseLots >= 1);
  console.log("cargo-ledger fixture ok", {
    shops: ledger.shops,
    freight: t.skuLines.map((s) => [s.partnerSku, s.allocatedCrossFreight]),
  });
}

console.log("cargo-ledger tests passed");
