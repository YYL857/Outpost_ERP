/**
 * pnpm exec tsx src/modules/purchase/replenish-batch/replenish-batch.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { shopFromPartnerSku } from "./shop-from-psku.js";
import {
  parseReplenishBatchXlsx,
  parseReplenishDetailSheet,
  rollupByShop,
} from "./parse.js";
import {
  buildReplenishBatchTemplateBuffer,
  todayBatchDate,
} from "./template.js";
import { listReplenishBatchBriefs, saveReplenishBatch } from "./store.js";

const root = mkdtempSync(join(tmpdir(), "outpost-replenish-batch-"));
process.env.OUTPOST_ROOT = root;

try {
  assert.deepEqual(shopFromPartnerSku("N1SAETWJ001MLT"), {
    shop: "店1",
    shopName: "HUI Beauty",
  });
  assert.equal(shopFromPartnerSku("XX"), null);

  const values = [
    ["采购批次", "PSKU", "店铺", "名称", "规格", "采购数量", "建议发运", "备注"],
    ["2026-10-15", "N1SAETWJ001MLT", "手改店9", "玩具", "彩色", 50, "海运", ""],
    ["2026-10-15", "N2SAJCSH002BLK", "", "手环", "H59", 30, "空运", ""],
  ];
  const parsed = parseReplenishDetailSheet(values);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0]!.shop, "店1"); // 忽略手改
  assert.equal(parsed.lines[1]!.shop, "店2");
  const rollup = rollupByShop(parsed.lines);
  assert.equal(rollup.length, 2);

  const buf = buildReplenishBatchTemplateBuffer("2026-10-15");
  assert.ok(buf.length > 100);
  const fromTpl = parseReplenishBatchXlsx(buf);
  assert.equal(fromTpl.lines.length, 0); // 空模板无数据行

  // 带数据的 workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(values),
    "采购明细",
  );
  const dataBuf = Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
  const imported = parseReplenishBatchXlsx(dataBuf);
  assert.equal(imported.lines.length, 2);

  const saved = saveReplenishBatch({
    batchDate: imported.batchDate,
    sheetName: imported.sheetName,
    filename: "t.xlsx",
    warnings: imported.warnings,
    lines: imported.lines,
    importedBy: { id: "u1", username: "乐东" },
  });
  assert.equal(saved.lineCount, 2);
  assert.equal(listReplenishBatchBriefs()[0]!.id, saved.id);
  assert.equal(todayBatchDate().length, 10);

  console.log("replenish-batch.test.ts: ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
