/**
 * pnpm exec tsx src/modules/shipping/channel-history.test.ts
 */
import assert from "node:assert/strict";
import type { PackingLineRow } from "../../platforms/feishu/normalize/packing-lines.js";
import {
  aggregateChannelHistory,
  querySkuChannelHistory,
} from "./channel-history.js";

function line(partial: Partial<PackingLineRow> & Pick<PackingLineRow, "boxNo" | "partnerSku" | "qty">): PackingLineRow {
  return {
    name: "",
    unitWeightKg: null,
    totalWeightKg: null,
    logisticsNo: "",
    ticketNo: "",
    mode: "air",
    modeRaw: "空运",
    arriveAt: null,
    warehouseStatus: "",
    shipAt: "2026-09-01",
    forwarder: "汉沙",
    ...partial,
  };
}

const lines: PackingLineRow[] = [
  line({
    boxNo: "2609-1-N1-K",
    partnerSku: "N1-AAA",
    name: "抹布",
    qty: 10,
    mode: "air",
    forwarder: "汉沙",
    shipAt: "2026-09-01",
    arriveAt: "2026-09-10",
  }),
  line({
    boxNo: "2609-2-N1-H",
    partnerSku: "N1-AAA",
    name: "抹布",
    qty: 20,
    mode: "sea",
    forwarder: "飞旭",
    shipAt: "2026-09-05",
    warehouseStatus: "已入库",
  }),
  line({
    boxNo: "2609-3-N1-K",
    partnerSku: "N1-BBB",
    name: "电动牙刷",
    qty: 5,
    mode: "air",
    forwarder: "汉沙",
    shipAt: "2026-09-08",
  }),
  // 无发货日：不计入渠道，但计入 missing
  line({
    boxNo: "2609-4-N1-K",
    partnerSku: "N1-CCC",
    name: "未发",
    qty: 99,
    mode: "air",
    forwarder: "越宽",
    shipAt: null,
  }),
  // 并列 pcs，更近日期应成为 preferred
  line({
    boxNo: "2609-5-N1-K",
    partnerSku: "N1-DDD",
    name: "并列品",
    qty: 8,
    mode: "air",
    forwarder: "汉沙",
    shipAt: "2026-08-01",
  }),
  line({
    boxNo: "2609-6-N1-H",
    partnerSku: "N1-DDD",
    name: "并列品",
    qty: 8,
    mode: "sea",
    forwarder: "飞旭",
    shipAt: "2026-09-20",
  }),
];

{
  const payload = aggregateChannelHistory(lines);
  assert.equal(payload.source.lineCount, 6);
  assert.equal(payload.source.shippedLineCount, 5);
  assert.equal(payload.source.missingShipAtCount, 1);
  assert.equal(payload.source.shippedPcs, 10 + 20 + 5 + 8 + 8);
  assert.equal(payload.cargoHints.length, 0);

  const hanshaAir = payload.channels.find(
    (c) => c.forwarder === "汉沙" && c.mode === "air",
  );
  assert.ok(hanshaAir);
  assert.equal(hanshaAir!.pcs, 10 + 5 + 8);
  assert.equal(hanshaAir!.boxes, 3);
  assert.equal(hanshaAir!.distinctSku, 3);
  assert.equal(hanshaAir!.deliveredPcs, 10); // 仅 N1-AAA 有 arriveAt
  assert.equal(hanshaAir!.lastShipAt, "2026-09-08");

  const feixuSea = payload.channels.find(
    (c) => c.forwarder === "飞旭" && c.mode === "sea",
  );
  assert.ok(feixuSea);
  assert.equal(feixuSea!.pcs, 20 + 8);
  assert.equal(feixuSea!.deliveredPcs, 20); // warehouseStatus 已入库

  const hanshaRoll = payload.forwarders.find((f) => f.forwarder === "汉沙");
  assert.ok(hanshaRoll);
  assert.equal(hanshaRoll!.byMode.air.pcs, 10 + 5 + 8);
  assert.equal(hanshaRoll!.byMode.sea.pcs, 0);
  assert.equal(hanshaRoll!.distinctSku, 3);
}

{
  const skus = querySkuChannelHistory(lines, "N1-AAA", {
    hints: [
      {
        forwarder: "飞旭",
        partnerSku: "N1-AAA",
        cargoKind: "sensitive",
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
    ],
  });
  assert.equal(skus.length, 1);
  const aaa = skus[0]!;
  assert.equal(aaa.totalPcs, 30);
  assert.equal(aaa.channels.length, 2);
  assert.equal(aaa.preferred?.forwarder, "飞旭");
  assert.equal(aaa.preferred?.mode, "sea");
  assert.equal(aaa.preferred?.pcs, 20);
  const seaShare = aaa.channels.find((c) => c.mode === "sea")?.share;
  assert.equal(seaShare, 0.667);
  assert.equal(
    aaa.channels.find((c) => c.forwarder === "飞旭")?.cargoKind,
    "sensitive",
  );
  assert.equal(
    aaa.channels.find((c) => c.forwarder === "汉沙")?.cargoKind,
    null,
  );
}

{
  const byName = querySkuChannelHistory(lines, "抹布");
  assert.equal(byName.length, 1);
  assert.equal(byName[0]!.partnerSku, "N1-AAA");
}

{
  const ddd = querySkuChannelHistory(lines, "N1-DDD")[0]!;
  assert.ok(ddd);
  // pcs 并列 8，取 lastShipAt 更新的飞旭海运
  assert.equal(ddd.preferred?.forwarder, "飞旭");
  assert.equal(ddd.preferred?.mode, "sea");
}

{
  assert.deepEqual(querySkuChannelHistory(lines, ""), []);
  assert.equal(querySkuChannelHistory(lines, "不存在的货").length, 0);
}

console.log("channel-history.test.ts: ok");
