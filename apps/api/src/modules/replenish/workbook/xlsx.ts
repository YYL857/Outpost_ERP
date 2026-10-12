/**
 * 补货表本地 xlsx 读写（D:\outpost-data\replenish\）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import * as XLSX from "xlsx";
import type { ManualOverride } from "./build.js";
import {
  WORKBOOK_FORMULA_NOTE,
  WORKBOOK_HEADERS,
  WORKBOOK_SHEET_TITLE,
  type ReplenishWorkbookMeta,
  type ReplenishWorkbookRow,
} from "./types.js";

function outpostRoot(): string {
  return resolve(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data");
}

export function replenishWorkbookDir(): string {
  return join(outpostRoot(), "replenish");
}

export function workbookPathForPrefix(shopPrefix: string): string {
  const p = shopPrefix.trim().toUpperCase() || "NX";
  return join(replenishWorkbookDir(), `${p}-补货表.xlsx`);
}

function ensureDir(): void {
  const dir = replenishWorkbookDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function headerIndex(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => String(h ?? "").trim());
  for (const a of aliases) {
    const i = norm.findIndex((h) => h === a || h.includes(a));
    if (i >= 0) return i;
  }
  return -1;
}

/** 从已有 xlsx 读人工标记 / 备注 */
export function readManualOverrides(
  filePath: string,
): Map<string, ManualOverride> {
  const map = new Map<string, ManualOverride>();
  if (!existsSync(filePath)) return map;
  try {
    const buf = readFileSync(filePath);
    const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
    const sheetName =
      wb.SheetNames.find((n) => n.includes("补货")) ?? wb.SheetNames[0];
    if (!sheetName) return map;
    const ws = wb.Sheets[sheetName];
    if (!ws) return map;
    const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown as unknown[][];
    if (grid.length < 2) return map;
    const headers = (grid[0] ?? []).map((c) => String(c ?? "").trim());
    const iSku = headerIndex(headers, ["PSKU"]);
    const iTag = headerIndex(headers, ["人工标记", "标记"]);
    const iNote = headerIndex(headers, ["备注"]);
    if (iSku < 0) return map;
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const psku = String(row[iSku] ?? "").trim();
      if (!psku || psku === "PSKU") continue;
      const manualTag = iTag >= 0 ? String(row[iTag] ?? "").trim() : "";
      const note = iNote >= 0 ? String(row[iNote] ?? "").trim() : "";
      if (!manualTag && !note) continue;
      map.set(psku, { manualTag, note });
    }
  } catch {
    /* 损坏则当无人工列 */
  }
  return map;
}

function rowToAoA(row: ReplenishWorkbookRow): (string | number)[] {
  return [
    row.partnerSku,
    row.title,
    row.monthlyAvg,
    row.salesRank ?? "",
    row.salesWeight,
    row.demandQty,
    row.fbn,
    row.fbnWh,
    row.supermall,
    row.inTransit,
    row.inTransitAir,
    row.inTransitSea,
    row.shipModesLabel,
    row.suggestQty,
    row.needReplenishLabel,
    row.manualTag,
    row.note,
  ];
}

export function writeWorkbookFile(opts: {
  shopPrefix: string;
  rows: ReplenishWorkbookRow[];
  meta: Omit<ReplenishWorkbookMeta, "filePath" | "rowCount" | "needCount">;
}): { filePath: string; meta: ReplenishWorkbookMeta } {
  ensureDir();
  const filePath = workbookPathForPrefix(opts.shopPrefix);
  const aoa: (string | number)[][] = [
    [...WORKBOOK_HEADERS],
    ...opts.rows.map(rowToAoA),
    [],
    ["说明", WORKBOOK_FORMULA_NOTE],
    ["生成时间", opts.meta.generatedAt],
    ["店铺", `${opts.meta.shopName} (${opts.meta.projectCode})`],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 18 },
    { wch: 28 },
    { wch: 12 },
    { wch: 8 },
    { wch: 8 },
    { wch: 10 },
    { wch: 10 },
    { wch: 8 },
    { wch: 10 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, WORKBOOK_SHEET_TITLE);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(filePath, buf);
  const needCount = opts.rows.filter((r) => r.needReplenish).length;
  const meta: ReplenishWorkbookMeta = {
    ...opts.meta,
    filePath,
    rowCount: opts.rows.length,
    needCount,
  };
  return { filePath, meta };
}

export function listWorkbookFiles(): Array<{
  shopPrefix: string;
  filePath: string;
  mtimeMs: number;
}> {
  ensureDir();
  const dir = replenishWorkbookDir();
  const out: Array<{ shopPrefix: string; filePath: string; mtimeMs: number }> =
    [];
  for (const name of readdirSync(dir)) {
    const m = name.match(/^(N\d+)-补货表\.xlsx$/i);
    if (!m) continue;
    const filePath = join(dir, name);
    out.push({
      shopPrefix: m[1]!.toUpperCase(),
      filePath,
      mtimeMs: statSync(filePath).mtimeMs,
    });
  }
  return out.sort((a, b) => a.shopPrefix.localeCompare(b.shopPrefix));
}
