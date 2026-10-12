/**
 * 固定格式补货计划表解析（Sheet1）。
 * 列：A PSKU | B 名称 | C 库存 | D 在途 | E 月销 | F 建议空运 | G 建议海运 | H √/不补货 | I 备注
 * 日期独占 A 列 → 后续行归属该计划发货日。
 */
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import type {
  ShipPlanLeg,
  ShipPlanLine,
  ShipModeLite,
} from "./types.js";

export type ParsedShipPlan = {
  lines: ShipPlanLine[];
  warnings: string[];
  sheetName: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return ""; // 日期单元格单独走 asPlanDate
  return String(v).trim();
}

function cellEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (v instanceof Date) return false;
  return cellStr(v) === "";
}

function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function excelSerialToIso(n: number): string | null {
  // Excel 序列日（1900 体系）→ 日历日；只接受合理业务区间
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const whole = Math.floor(n);
  // 与 SheetJS SSF 一致：epoch 1899-12-30
  const utc = Date.UTC(1899, 11, 30) + whole * 86400 * 1000;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function asPlanDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // 国内表序列日通常落到本地 00:00（UTC 常为前一日 16:00）
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") return excelSerialToIso(v);
  const s = String(v ?? "").trim();
  if (!s) return null;
  // 2026-09-28 / 2026/9/28 / 2026-09-28 00:00:00
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  }
  return null;
}

function looksLikeSku(raw: string): boolean {
  if (!raw) return false;
  // N1SA… / N2… / 常规 partnerSku
  if (/^N\d[A-Z0-9]{4,}$/i.test(raw)) return true;
  if (/^[A-Z][A-Z0-9_-]{5,}$/i.test(raw) && !asPlanDate(raw)) return true;
  return false;
}

function noteForcesAirOnly(note: string): boolean {
  const n = note.replace(/\s+/g, "");
  return /全部走空运|全部空运|全走空运|只走空运|仅空运/.test(n);
}

function parseBoxSplitNote(
  note: string,
): { air: number; sea: number } | null {
  // 「3箱，空运1箱，海运2 箱」——按箱比拆建议量时用比例，这里只解析箱数供备注展示
  const airM = note.match(/空运\s*(\d+)\s*箱/);
  const seaM = note.match(/海运\s*(\d+)\s*箱/);
  if (!airM && !seaM) return null;
  return {
    air: airM ? Number(airM[1]) : 0,
    sea: seaM ? Number(seaM[1]) : 0,
  };
}

function newLeg(
  mode: ShipModeLite,
  qty: number,
  note = "",
): ShipPlanLeg {
  const q = Math.max(0, Math.round(qty));
  return {
    id: `leg-${randomUUID().slice(0, 8)}`,
    forwarder: "",
    mode,
    qty: q,
    shippedQty: 0,
    cargoKind: "",
    note,
    status: q > 0 ? "pending" : "done",
    updatedAt: nowIso(),
  };
}

function buildDefaultLegs(
  suggestAir: number | null,
  suggestSea: number | null,
  note: string,
): ShipPlanLeg[] {
  const air = suggestAir ?? 0;
  const sea = suggestSea ?? 0;
  const legs: ShipPlanLeg[] = [];

  if (noteForcesAirOnly(note)) {
    const total = air + sea || air || sea;
    if (total > 0) legs.push(newLeg("air", total, "备注：全部走空运"));
    return legs;
  }

  const boxSplit = parseBoxSplitNote(note);
  if (boxSplit && (air > 0 || sea > 0)) {
    const boxTotal = boxSplit.air + boxSplit.sea;
    const pcsTotal = air + sea;
    if (boxTotal > 0 && pcsTotal > 0) {
      // 按箱比例拆件数（四舍五入，差额补到数量较大的一侧）
      let airQty = Math.round((pcsTotal * boxSplit.air) / boxTotal);
      let seaQty = pcsTotal - airQty;
      if (boxSplit.air > 0 && airQty === 0 && pcsTotal > 0) {
        airQty = Math.min(pcsTotal, 1);
        seaQty = pcsTotal - airQty;
      }
      if (boxSplit.sea > 0 && seaQty === 0 && pcsTotal > airQty) {
        seaQty = Math.min(pcsTotal - airQty, 1);
        airQty = pcsTotal - seaQty;
      }
      if (airQty > 0) legs.push(newLeg("air", airQty, note));
      if (seaQty > 0) legs.push(newLeg("sea", seaQty, note));
      return legs;
    }
  }

  if (air > 0) legs.push(newLeg("air", air));
  if (sea > 0) legs.push(newLeg("sea", sea));
  return legs;
}

function parseIncludeFlag(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  if (/不补|跳过|skip|否|×|x/i.test(s)) return false;
  if (s === "√" || s === "✓" || s === "✔" || s === "是" || s === "Y" || s === "y") {
    return true;
  }
  // 其它非空值：仍当作要补（兼容误填）
  return true;
}

export function parseShipPlanWorkbook(
  buf: Buffer,
  opts?: { sheetName?: string },
): ParsedShipPlan {
  // cellDates:false — 用 Excel 序列日自转，避免 SheetJS 时区把 9/28 收成 9/27
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheetName =
    opts?.sheetName && wb.SheetNames.includes(opts.sheetName)
      ? opts.sheetName
      : wb.SheetNames[0]!;
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`工作表不存在：${sheetName}`);
  }

  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];

  const warnings: string[] = [];
  if (rows.length === 0) {
    throw new Error("表格为空");
  }

  const header = (rows[0] ?? []).map((c) => cellStr(c).toLowerCase());
  const pskuIdx = header.findIndex((h) => h === "psku" || h === "partner sku");
  if (pskuIdx !== 0 && pskuIdx !== -1) {
    warnings.push(`表头 PSKU 不在 A 列（实际列 ${pskuIdx + 1}），仍按固定列位解析`);
  }
  if (!header.some((h) => h.includes("psku"))) {
    warnings.push("首行未识别到 PSKU 表头，仍按固定列位尝试解析");
  }

  let planDate: string | null = null;
  const lines: ShipPlanLine[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const a = row[0];
    const sourceRow = i + 1;

    // 空行（日期单元格不算空）
    if (row.every((c) => cellEmpty(c))) continue;

    const dateOnly = asPlanDate(a);
    const restEmpty = row.slice(1).every((c) => cellEmpty(c));
    if (dateOnly && restEmpty) {
      planDate = dateOnly;
      continue;
    }

    const partnerSku = cellStr(a);
    if (!looksLikeSku(partnerSku)) {
      if (dateOnly) {
        planDate = dateOnly;
        continue;
      }
      warnings.push(`第 ${sourceRow} 行跳过：无法识别 PSKU「${partnerSku || "(空)"}」`);
      continue;
    }

    const productName = cellStr(row[1]);
    const stock = cellNum(row[2]);
    const inTransit = cellNum(row[3]);
    const monthlySales = cellNum(row[4]);
    const suggestAir = cellNum(row[5]);
    const suggestSea = cellNum(row[6]);
    const flagRaw = cellStr(row[7]);
    const note = cellStr(row[8]);
    const include = parseIncludeFlag(flagRaw);

    const key = `${partnerSku}\0${planDate ?? ""}`;
    if (seen.has(key)) {
      warnings.push(
        `第 ${sourceRow} 行 ${partnerSku}（计划日 ${planDate ?? "未定"}）重复，保留首条`,
      );
      continue;
    }
    seen.add(key);

    const legs = include
      ? buildDefaultLegs(suggestAir, suggestSea, note)
      : [];

    lines.push({
      id: `line-${randomUUID().slice(0, 8)}`,
      partnerSku,
      productName,
      stock,
      inTransit,
      monthlySales,
      suggestAir,
      suggestSea,
      include,
      note,
      planDate,
      sourceRow,
      legs,
      updatedAt: nowIso(),
    });
  }

  if (lines.length === 0) {
    throw new Error("未解析到任何 SKU 行，请确认表格式（首行表头 + PSKU 列）");
  }

  return { lines, warnings, sheetName };
}
