/**
 * 发货待发池：到货登记行（可从「每日到货」表导入）。
 * L 列货物类型仅作仓管粗分，最终货性以 cargo-hints 为准。
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as XLSX from "xlsx";
import {
  findCargoHint,
  listCargoHints,
  type ManualCargoKind,
} from "./cargo-hints.js";
import { loadRouteRules, suggestForwarder } from "./route-rules.js";

export type OutboundPoolLine = {
  id: string;
  partnerSku: string;
  name: string;
  shop: string;
  /** 空运 | 海运 */
  modePref: string;
  qty: number;
  unitKg: number | null;
  weightKg: number | null;
  note: string;
  /** 仓管粗分 普货/敏货/带电；非最终货性 */
  warehouseType: string;
  createdAt: string;
  updatedAt: string;
};

export type OutboundPoolFile = {
  updatedAt: string;
  lines: OutboundPoolLine[];
};

export type OutboundPoolLineView = OutboundPoolLine & {
  suggestForwarder: string;
  suggestReason: string;
  hintCargoKind: ManualCargoKind | null;
  cargoGap: boolean;
};

export type OutboundCargoGap = {
  partnerSku: string;
  name: string;
  shop: string;
  suggestForwarder: string;
  warehouseType: string;
  qty: number;
};

function outpostRoot(): string {
  return resolve(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data");
}

export function outboundPoolPath(): string {
  return join(outpostRoot(), "shipping", "outbound-pool.json");
}

function ensureDir(): void {
  const dir = join(outpostRoot(), "shipping");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

export function loadOutboundPool(): OutboundPoolFile {
  const path = outboundPoolPath();
  if (!existsSync(path)) {
    return { updatedAt: nowIso(), lines: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as OutboundPoolFile;
    return {
      updatedAt: raw.updatedAt || nowIso(),
      lines: Array.isArray(raw.lines) ? raw.lines : [],
    };
  } catch {
    return { updatedAt: nowIso(), lines: [] };
  }
}

function savePool(file: OutboundPoolFile): void {
  ensureDir();
  file.updatedAt = nowIso();
  writeFileSync(outboundPoolPath(), JSON.stringify(file, null, 2), "utf8");
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function shopFromSku(sku: string): string {
  const m = sku.trim().match(/^(N\d+)/i);
  return m?.[1]?.toUpperCase() || "";
}

/** 解析「每日到货/发货计划」sheet：表头含 PSKU */
export function parseArrivalPlanSheet(
  values: unknown[][],
): { lines: Omit<OutboundPoolLine, "id" | "createdAt" | "updatedAt">[]; warnings: string[] } {
  const warnings: string[] = [];
  if (values.length < 2) return { lines: [], warnings: ["表为空"] };

  let headerRow = -1;
  let col: Record<string, number> = {};
  for (let r = 0; r < Math.min(values.length, 10); r++) {
    const row = values[r] ?? [];
    const map = new Map<string, number>();
    for (let c = 0; c < row.length; c++) {
      const t = cellStr(row[c]);
      if (t) map.set(t, c);
    }
    if (map.has("PSKU") || map.has("psku")) {
      headerRow = r;
      col = {
        name: map.get("货品名称") ?? map.get("名称") ?? map.get("品名") ?? -1,
        psku: map.get("PSKU") ?? map.get("psku") ?? -1,
        shop: map.get("所属店铺") ?? map.get("店铺") ?? -1,
        mode: map.get("发货方式") ?? map.get("运输方式") ?? -1,
        qty: map.get("到货数量") ?? map.get("数量") ?? -1,
        unitKg: map.get("单重(kg)") ?? map.get("单重") ?? -1,
        weightKg: map.get("重量(kg)") ?? map.get("重量") ?? -1,
        note: map.get("备注") ?? -1,
        warehouseType: map.get("货物类型") ?? -1,
      };
      break;
    }
  }
  if (headerRow < 0 || col.psku < 0) {
    return { lines: [], warnings: ["未找到含 PSKU 的表头（发货计划格式）"] };
  }

  const lines: Omit<OutboundPoolLine, "id" | "createdAt" | "updatedAt">[] = [];
  for (let r = headerRow + 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const partnerSku = cellStr(col.psku >= 0 ? row[col.psku] : "");
    if (!partnerSku) continue;
    const name = cellStr(col.name >= 0 ? row[col.name] : "");
    const shop =
      cellStr(col.shop >= 0 ? row[col.shop] : "") || shopFromSku(partnerSku);
    const modePref = cellStr(col.mode >= 0 ? row[col.mode] : "");
    const qty = cellNum(col.qty >= 0 ? row[col.qty] : null) ?? 0;
    if (qty <= 0) {
      warnings.push(`${partnerSku} 数量无效，已跳过`);
      continue;
    }
    const unitKg = cellNum(col.unitKg >= 0 ? row[col.unitKg] : null);
    let weightKg = cellNum(col.weightKg >= 0 ? row[col.weightKg] : null);
    if (weightKg == null && unitKg != null) weightKg = unitKg * qty;
    const note = cellStr(col.note >= 0 ? row[col.note] : "");
    const warehouseType = cellStr(
      col.warehouseType >= 0 ? row[col.warehouseType] : "",
    );
    lines.push({
      partnerSku,
      name,
      shop,
      modePref,
      qty,
      unitKg,
      weightKg,
      note,
      warehouseType,
    });
  }
  return { lines, warnings };
}

export function parseArrivalPlanXlsx(buf: Buffer): {
  lines: Omit<OutboundPoolLine, "id" | "createdAt" | "updatedAt">[];
  warnings: string[];
  sheetName: string;
} {
  const wb = XLSX.read(buf, { type: "buffer" });
  const prefer = ["发货计划", "Sheet1"];
  let sheetName =
    prefer.find((n) => wb.SheetNames.includes(n)) || wb.SheetNames[0] || "";
  if (!sheetName) return { lines: [], warnings: ["无工作表"], sheetName: "" };
  const sheet = wb.Sheets[sheetName]!;
  const values = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  const parsed = parseArrivalPlanSheet(values);
  return { ...parsed, sheetName };
}

export function replaceOutboundPool(
  rows: Omit<OutboundPoolLine, "id" | "createdAt" | "updatedAt">[],
): OutboundPoolFile {
  const now = nowIso();
  const file: OutboundPoolFile = {
    updatedAt: now,
    lines: rows.map((r) => ({
      ...r,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    })),
  };
  savePool(file);
  return file;
}

export function clearOutboundPool(): OutboundPoolFile {
  const file: OutboundPoolFile = { updatedAt: nowIso(), lines: [] };
  savePool(file);
  return file;
}

export function enrichPoolLines(
  lines: OutboundPoolLine[],
): OutboundPoolLineView[] {
  const hints = listCargoHints();
  const rules = loadRouteRules();
  return lines.map((line) => {
    const sug = suggestForwarder(
      {
        partnerSku: line.partnerSku,
        name: line.name,
        warehouseType: line.warehouseType,
      },
      rules,
    );
    const hit = findCargoHint(hints, line.partnerSku, sug.forwarder);
    return {
      ...line,
      suggestForwarder: sug.forwarder,
      suggestReason: sug.reason,
      hintCargoKind: hit?.cargoKind ?? null,
      cargoGap: !hit,
    };
  });
}

export function listOutboundPoolView(): {
  updatedAt: string;
  lines: OutboundPoolLineView[];
  gapCount: number;
} {
  const file = loadOutboundPool();
  const lines = enrichPoolLines(file.lines);
  return {
    updatedAt: file.updatedAt,
    lines,
    gapCount: lines.filter((l) => l.cargoGap).length,
  };
}

export function listOutboundCargoGaps(): OutboundCargoGap[] {
  const { lines } = listOutboundPoolView();
  const byKey = new Map<string, OutboundCargoGap>();
  for (const line of lines) {
    if (!line.cargoGap) continue;
    const key = `${line.partnerSku}\0${line.suggestForwarder}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.qty += line.qty;
    } else {
      byKey.set(key, {
        partnerSku: line.partnerSku,
        name: line.name,
        shop: line.shop,
        suggestForwarder: line.suggestForwarder,
        warehouseType: line.warehouseType,
        qty: line.qty,
      });
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.partnerSku.localeCompare(b.partnerSku),
  );
}
