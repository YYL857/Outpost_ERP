/**
 * pnpm exec tsx src/modules/info-check/info-check.test.ts
 */
import assert from "node:assert/strict";
import {
  indexGenericSnapshot,
  indexProductSnapshot,
} from "./load-tables.js";
import { queryInfoCheck } from "./query.js";
import type { InfoCheckBundle, InfoCheckTableIndex } from "./types.js";
import type { FeishuRawSnapshot } from "../../platforms/feishu/types.js";

function snap(
  docId: string,
  sheets: Array<{ title: string; values: unknown[][] }>,
): FeishuRawSnapshot {
  return {
    version: 1,
    pulledAt: "2026-09-30T00:00:00.000Z",
    docId,
    docLabel: docId,
    targetDomain: "raw_only",
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

function asTable(
  docId: InfoCheckTableIndex["docId"],
  label: string,
  indexed: ReturnType<typeof indexProductSnapshot>,
): InfoCheckTableIndex {
  return {
    docId,
    label,
    pulledAt: indexed.pulledAt,
    snapshotPath: "/tmp/x",
    headers: indexed.headers,
    byPsku: indexed.byPsku,
  };
}

{
  const productSnap = snap("product", [
    {
      title: "查找代码表",
      values: [
        ["颜色", "代码", "StoreCode", "Site"],
        ["红", "RD", "N1", "SA"],
      ],
    },
    {
      title: "产品",
      values: [
        ["PSKU", "店铺代码", "类目代码", "款式代码", "颜色", "名称", "活动价格"],
        ["=ARRAYFORMULA(...)", "N1", "01", "1", "红", "咖啡机A", "199"],
        ["N1SA02X", "N1", "02", "2", "红", "磨豆机B", "89"],
      ],
    },
  ]);

  const product = indexProductSnapshot(productSnap);
  assert.ok(product.byPsku.has("N1SA01001RD"), "reconstruct PSKU from parts");
  assert.equal(product.byPsku.get("N1SA01001RD")?.["名称"], "咖啡机A");
  assert.ok(product.byPsku.has("N1SA02X"), "direct PSKU");
  assert.equal(product.byPsku.get("N1SA02X")?.["活动价格"], "89");
}

{
  const deals = indexGenericSnapshot(
    snap("monthly-deals", [
      {
        title: "N1",
        values: [
          ["deal_code", "partner_sku", "deal_price"],
          ["oct-26-sa", "N1SA02X", "79"],
          ["oct-26-sa", "未上架", "1"],
        ],
      },
      {
        title: "N2",
        values: [
          ["deal_code", "partner_sku", "deal_price"],
          ["oct-26-sa", "N2SA01Y", "56"],
        ],
      },
    ]),
  );
  assert.equal(deals.byPsku.get("N1SA02X")?.["deal_price"], "79");
  assert.equal(deals.byPsku.get("N2SA01Y")?.["deal_price"], "56");
  assert.ok(!deals.byPsku.has("未上架"), "invalid psku dropped");
  assert.equal(deals.byPsku.size, 2, "two shops merged without prefix");
}

{
  const check = indexGenericSnapshot(
    snap("info-check", [
      {
        title: "Sheet1",
        values: [
          ["SKU", "名称", "价格", "Deals"],
          ["N1SA02X", "磨豆机", "89", "1"],
        ],
      },
    ]),
  );
  assert.equal(check.byPsku.get("N1SA02X")?.["名称"], "磨豆机");
  assert.equal(check.byPsku.get("N1SA02X")?.["价格"], "89");
}

{
  const product = asTable(
    "product",
    "产品表",
    indexProductSnapshot(
      snap("product", [
        {
          title: "产品",
          values: [
            ["PSKU", "名称", "活动价"],
            ["AAA01", "Alpha 机", "100"],
            ["BBB02", "Beta 杯", "50"],
          ],
        },
      ]),
    ),
  );
  const monthlyDeals = asTable(
    "monthly-deals",
    "月度Deals",
    indexGenericSnapshot(
      snap("monthly-deals", [
        {
          title: "D",
          values: [
            ["partner_sku", "deal_price", "名称"],
            ["AAA01", "90", "Alpha 机"],
            ["BBB02", "50", "Beta 杯"],
          ],
        },
      ]),
    ),
  );
  const infoCheck = asTable(
    "info-check",
    "信息检查",
    indexGenericSnapshot(
      snap("info-check", [
        {
          title: "I",
          values: [
            ["SKU", "价格", "名称"],
            ["AAA01", "100", "Alpha"],
          ],
        },
      ]),
    ),
  );

  const bundle: InfoCheckBundle = {
    product,
    monthlyDeals,
    infoCheck,
    commonFields: ["活动价", "名称"],
  };

  const exact = queryInfoCheck(bundle, {
    q: "AAA01",
    mode: "exact",
    fields: ["活动价"],
  });
  assert.equal(exact.totalMatched, 1);
  assert.equal(exact.rows[0]!.psku, "AAA01");
  assert.equal(exact.rows[0]!.compare?.[0]?.product, "100");
  assert.equal(exact.rows[0]!.compare?.[0]?.monthlyDeals, "90");
  assert.equal(exact.rows[0]!.compare?.[0]?.infoCheck, "100");
  assert.equal(exact.rows[0]!.compare?.[0]?.mismatch, true);
  assert.equal(exact.rows[0]!.compare?.[0]?.sources?.product, "活动价");
  assert.equal(exact.rows[0]!.compare?.[0]?.sources?.monthlyDeals, "deal_price");
  assert.equal(exact.rows[0]!.compare?.[0]?.sources?.infoCheck, "价格");

  const fuzzy = queryInfoCheck(bundle, {
    q: "beta",
    mode: "fuzzy",
    fields: [],
  });
  assert.equal(fuzzy.totalMatched, 1);
  assert.equal(fuzzy.rows[0]!.psku, "BBB02");
  assert.equal(fuzzy.rows[0]!.sources.monthlyDeals?.["deal_price"], "50");
  assert.equal(fuzzy.rows[0]!.sources.infoCheck, null);

  const miss = queryInfoCheck(bundle, {
    q: "NOPE",
    mode: "exact",
    fields: [],
  });
  assert.equal(miss.totalMatched, 0);
}

console.log("info-check tests OK");
