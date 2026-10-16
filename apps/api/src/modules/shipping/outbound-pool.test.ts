/**
 * pnpm exec tsx src/modules/shipping/outbound-pool.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enrichPoolLines,
  parseArrivalPlanSheet,
  replaceOutboundPool,
} from "./outbound-pool.js";
import { upsertCargoHint } from "./cargo-hints.js";

const root = mkdtempSync(join(tmpdir(), "outpost-outbound-pool-"));
process.env.OUTPOST_ROOT = root;

try {
  const values = [
    ["发货计划"],
    ["说明"],
    [
      "货品名称",
      "PSKU",
      "所属店铺",
      "发货方式",
      "到货数量",
      "单重(kg)",
      "重量(kg)",
      "备注",
      "分组键",
      "海运序号",
      "空运序号",
      "货物类型",
    ],
    [
      "儿童益智玩具-彩色",
      "N1SAETWJ001MLT",
      "N1",
      "海运",
      6,
      0.31,
      1.86,
      "",
      "",
      "",
      "",
      "普货",
    ],
    [
      "电池充电器-黑色",
      "N1SACDQ001BLK",
      "N1",
      "空运",
      10,
      0.2,
      2,
      "",
      "",
      "",
      "",
      "带电",
    ],
  ];
  const parsed = parseArrivalPlanSheet(values);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0]!.warehouseType, "普货");

  const file = replaceOutboundPool(parsed.lines);
  assert.equal(file.lines.length, 2);

  upsertCargoHint({
    partnerSku: "N1SAETWJ001MLT",
    forwarder: "汉沙",
    cargoKind: "general",
  });

  const views = enrichPoolLines(file.lines);
  const toy = views.find((v) => v.partnerSku === "N1SAETWJ001MLT");
  const charger = views.find((v) => v.partnerSku === "N1SACDQ001BLK");
  assert.ok(toy);
  assert.equal(toy!.suggestForwarder, "汉沙");
  assert.equal(toy!.cargoGap, false);
  assert.ok(charger);
  assert.equal(charger!.suggestForwarder, "飞坦");
  assert.equal(charger!.cargoGap, true);

  console.log("outbound-pool.test.ts: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
