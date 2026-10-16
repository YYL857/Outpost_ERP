/**
 * 补货采购标准模板：采购批次预填「导出当日」；店铺列公式由 PSKU 自动识别。
 */
import * as XLSX from "xlsx";
import { shopFormulaForRow } from "./shop-from-psku.js";

const HEADERS = [
  "采购批次",
  "PSKU",
  "店铺",
  "名称",
  "规格",
  "采购数量",
  "建议发运",
  "备注",
] as const;

const DATA_ROWS = 80;

export function todayBatchDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildReplenishBatchTemplateBuffer(
  batchDate = todayBatchDate(),
): Buffer {
  const wb = XLSX.utils.book_new();

  const detailAoa: unknown[][] = [HEADERS.slice()];
  for (let i = 0; i < DATA_ROWS; i++) {
    detailAoa.push([
      i === 0 ? batchDate : "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(detailAoa);
  for (let r = 2; r <= DATA_ROWS + 1; r++) {
    ws[`C${r}`] = { t: "str", f: shopFormulaForRow(r) };
  }
  ws["!cols"] = [
    { wch: 12 },
    { wch: 18 },
    { wch: 8 },
    { wch: 28 },
    { wch: 16 },
    { wch: 10 },
    { wch: 10 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "采购明细");

  const help = XLSX.utils.aoa_to_sheet([
    ["补货采购表 · 标准模板（系统导出）"],
    [""],
    ["用途：记录已经下单采购的货物。每采购一次从 Outpost 导出一份新表。"],
    ["采购批次：导出当日自动预填，可改；同一文件内建议保持相同。"],
    ["PSKU：必填。店铺列（绿色公式）根据 N1/N2/N3/N4 自动识别，勿手改。"],
    ["名称/规格：建议填。采购数量：本批实采件数。建议发运：空运/海运/待定。"],
    ["导入后系统按店归类，并通知发货人阿沈在任务收件箱查看。"],
    [""],
    ["店1=HUI Beauty N1 · 店2=HFY-KSA N2 · 店3=Glam Bag N3 · 店4=mmm N4"],
  ]);
  help["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, help, "填写说明");

  const shops = XLSX.utils.aoa_to_sheet([
    ["店铺", "店名", "Project ID", "PSKU前缀"],
    ["店1", "HUI Beauty", "PRJ396770", "N1"],
    ["店2", "HFY-KSA", "PRJ482387", "N2"],
    ["店3", "Glam Bag Collection", "PRJ488078", "N3"],
    ["店4", "mmm", "PRJ595165", "N4"],
  ]);
  XLSX.utils.book_append_sheet(wb, shops, "店铺对照");

  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
}

export function templateDownloadFilename(batchDate = todayBatchDate()): string {
  return `补货采购_${batchDate}.xlsx`;
}
