/**
 * pnpm exec tsx src/platforms/feishu/normalize/packing-lines.test.ts
 */
import assert from "node:assert/strict";
import { isPackingInTransit } from "./forwarder-board.js";
import {
  buildInTransitTicketTree,
  extractPackingLines,
  groupPackingLinesByBox,
  modeFromBoxNo,
  shopPrefixFromBoxNo,
  summarizePackingInTransit,
} from "./packing-lines.js";

assert.equal(modeFromBoxNo("2609-477-N3-K"), "air");
assert.equal(modeFromBoxNo("2511-01-N1-H"), "sea");
assert.equal(modeFromBoxNo("no-suffix"), null);
assert.equal(shopPrefixFromBoxNo("2605-207-N1-H"), "N1");

assert.equal(isPackingInTransit(null), true, "empty arrive = transit");
assert.equal(isPackingInTransit(""), true);
assert.equal(isPackingInTransit("2026-06-06"), false);
assert.equal(isPackingInTransit("2026-06-06", "在途中"), true);

{
  const values = [
    [
      "PSKU",
      "名称",
      "数量",
      "箱号",
      "票号",
      "物流编号",
      "产品单重",
      "产品重量合计",
      "运输方式",
      "送仓时间",
      "到仓情况",
      "货代名称",
    ],
    ["N1A", "货A", 5, "BOX-N1-1", "TICKET-1", "L1", 0.15, 0.75, "空运", "", "在途中", "亚优汇"],
    ["N1B", "货B", 10, "BOX-N1-1", "TICKET-1", "L1", 0.2, 2, "空运", "", "", "亚优汇"],
    ["N1C", "货C", 3, "BOX-N1-2", "TICKET-1", "L1", 0.1, 0.3, "空运", "", "在途中", "亚优汇"],
    ["N1D", "货D", 8, "BOX-N1-3", "TICKET-2", "L2", 0.5, 4, "海运", "", "在途中", "汉沙"],
    ["N2X", "别店", 8, "BOX-N2-1", "TICKET-9", "L9", 0.5, 4, "海运", "", "在途中", "汉沙"],
    ["N1DONE", "已到", 3, "BOX-N1-9", "TICKET-3", "L3", 0.1, 0.3, "海运", "2026/6/1", "已入库", "汉沙"],
  ];
  const lines = extractPackingLines(values);
  assert.equal(lines.length, 6);
  assert.equal(lines[0]!.ticketNo, "TICKET-1");

  const n1 = summarizePackingInTransit(lines, ["N1"]);
  assert.equal(n1.qty, 26, "5+10+3+8");
  assert.equal(n1.ticketCount, 2);
  assert.equal(n1.boxCount, 3);

  const tree = buildInTransitTicketTree(
    lines.filter((l) => !l.arriveAt && l.partnerSku.startsWith("N1")),
  );
  const t1 = tree.find((t) => t.ticketNo === "TICKET-1")!;
  assert.ok(t1);
  assert.equal(t1.boxCount, 2);
  assert.equal(t1.pcs, 18);
  const box1 = t1.boxes.find((b) => b.boxNo === "BOX-N1-1")!;
  assert.equal(box1.pcs, 15);
  assert.equal(box1.items.length, 2);

  const byBox = groupPackingLinesByBox(lines);
  assert.equal(byBox.get("BOX-N1-1")!.length, 2);
}

console.log("packing-lines.test.ts OK");
