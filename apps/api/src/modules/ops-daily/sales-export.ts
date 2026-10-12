import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../../platforms/noon/portal/parsers.js";
import { pickLatestSalesExportFile } from "../../platforms/noon/portal/auto-ingest.js";
import {
  inInclusiveWindow,
  toShanghaiYmd,
  windowStartYmd,
} from "./dates.js";
import { loadOpsDailySettings } from "./config.js";

export type SalesExportLine = {
  partnerSku: string;
  sku: string;
  status: string;
  orderYmd: string | null;
};

export type SalesMetrics = {
  units30: number;
  returnRate30: number;
};

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

export function parseSalesExportContent(content: string): SalesExportLine[] {
  const rows = parseCsv(content);
  const out: SalesExportLine[] = [];
  for (const row of rows) {
    const partnerSku = pick(row, ["partner_sku", "partner sku", "psku"]);
    const sku = pick(row, ["sku", "sku_child", "noon_sku"]);
    if (!sku && !partnerSku) continue;
    const status = pick(row, ["status", "order_status"]);
    const orderTs = pick(row, [
      "order_timestamp",
      "order_date",
      "placed_at",
      "date",
    ]);
    out.push({
      partnerSku,
      sku,
      status,
      orderYmd: toShanghaiYmd(orderTs),
    });
  }
  return out;
}

/**
 * 为 asOf 的 30 日窗优先选覆盖该窗的 sales_export；否则回退 mtime 最新。
 */
export function pickSalesExportForAsOf(
  importDir: string,
  asOf: string,
  lastN = 30,
): { fileName: string; filePath: string } | null {
  if (!existsSync(importDir)) return null;
  const from = windowStartYmd(asOf, lastN);
  const names = readdirSync(importDir).filter(
    (n) => /^sales_export_.*\.csv$/i.test(n) && !n.startsWith("."),
  );
  type Cand = {
    fileName: string;
    filePath: string;
    mtimeMs: number;
    reportFrom: string | null;
    reportTo: string | null;
    covers: boolean;
  };
  const cands: Cand[] = [];
  for (const name of names) {
    const filePath = join(importDir, name);
    try {
      const st = statSync(filePath);
      const m = name.match(
        /sales_export_(20\d{2}-\d{2}-\d{2}).{0,3}(20\d{2}-\d{2}-\d{2})/i,
      );
      const reportFrom = m?.[1] ?? null;
      const reportTo = m?.[2] ?? null;
      const covers = Boolean(
        reportFrom &&
          reportTo &&
          reportFrom <= from &&
          reportTo >= asOf,
      );
      cands.push({
        fileName: name,
        filePath,
        mtimeMs: st.mtimeMs,
        reportFrom,
        reportTo,
        covers,
      });
    } catch {
      /* skip */
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => {
    if (a.covers !== b.covers) return a.covers ? -1 : 1;
    // 同覆盖时取跨度更大、再 mtime
    const spanA =
      a.reportFrom && a.reportTo
        ? Date.parse(a.reportTo) - Date.parse(a.reportFrom)
        : 0;
    const spanB =
      b.reportFrom && b.reportTo
        ? Date.parse(b.reportTo) - Date.parse(b.reportFrom)
        : 0;
    if (spanB !== spanA) return spanB - spanA;
    return b.mtimeMs - a.mtimeMs;
  });
  const best = cands[0]!;
  return { fileName: best.fileName, filePath: best.filePath };
}

export function loadLatestSalesExportLines(
  importDir: string,
  asOf?: string | null,
): { lines: SalesExportLine[]; fileName: string | null } {
  const picked = asOf
    ? pickSalesExportForAsOf(importDir, asOf, 30)
    : (() => {
        const p = pickLatestSalesExportFile(importDir);
        return p
          ? { fileName: p.fileName, filePath: p.filePath }
          : null;
      })();
  if (!picked || !existsSync(picked.filePath)) {
    return { lines: [], fileName: null };
  }
  const content = readFileSync(picked.filePath, "utf8");
  return {
    lines: parseSalesExportContent(content),
    fileName: picked.fileName,
  };
}

/**
 * Prep sales_metrics：按 Noon SKU 计行；
 * 有效销量排除 invalid；退货率 = Returned / 窗口内全部行。
 */
export function rollupSalesMetrics(
  lines: SalesExportLine[],
  asOf: string,
  lastN = 30,
): Map<string, SalesMetrics> {
  const settings = loadOpsDailySettings();
  const invalid = new Set(
    settings.invalid_order_statuses.map((s) => s.toLowerCase()),
  );
  const returns = new Set(
    settings.return_statuses.map((s) => s.toLowerCase()),
  );
  const from = windowStartYmd(asOf, lastN);

  type Acc = { valid: number; ret: number; all: number };
  const bySku = new Map<string, Acc>();

  for (const line of lines) {
    if (!inInclusiveWindow(line.orderYmd, from, asOf)) continue;
    const key = line.sku.trim();
    if (!key) continue;
    const acc = bySku.get(key) ?? { valid: 0, ret: 0, all: 0 };
    acc.all += 1;
    const st = line.status.trim().toLowerCase();
    if (returns.has(st)) acc.ret += 1;
    if (!invalid.has(st)) acc.valid += 1;
    bySku.set(key, acc);
  }

  const out = new Map<string, SalesMetrics>();
  for (const [sku, acc] of bySku) {
    out.set(sku, {
      units30: acc.valid,
      returnRate30: acc.all > 0 ? acc.ret / acc.all : 0,
    });
  }
  return out;
}

/** 也按 PSKU 汇总（spine 无 noonSku 时兜底） */
export function rollupSalesMetricsByPsku(
  lines: SalesExportLine[],
  asOf: string,
  lastN = 30,
): Map<string, SalesMetrics> {
  const settings = loadOpsDailySettings();
  const invalid = new Set(
    settings.invalid_order_statuses.map((s) => s.toLowerCase()),
  );
  const returns = new Set(
    settings.return_statuses.map((s) => s.toLowerCase()),
  );
  const from = windowStartYmd(asOf, lastN);
  type Acc = { valid: number; ret: number; all: number };
  const by = new Map<string, Acc>();
  for (const line of lines) {
    if (!inInclusiveWindow(line.orderYmd, from, asOf)) continue;
    const key = line.partnerSku.trim();
    if (!key) continue;
    const acc = by.get(key) ?? { valid: 0, ret: 0, all: 0 };
    acc.all += 1;
    const st = line.status.trim().toLowerCase();
    if (returns.has(st)) acc.ret += 1;
    if (!invalid.has(st)) acc.valid += 1;
    by.set(key, acc);
  }
  const out = new Map<string, SalesMetrics>();
  for (const [k, acc] of by) {
    out.set(k, {
      units30: acc.valid,
      returnRate30: acc.all > 0 ? acc.ret / acc.all : 0,
    });
  }
  return out;
}

export function shopImportDir(shopRootDir: string): string {
  return join(shopRootDir, "portal-imports");
}
