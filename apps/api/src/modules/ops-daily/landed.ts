/**
 * Phase4 · Prep 3.0 到仓成本：装箱重量占比分摊国内/跨境运费 + 采购单价。
 * 只读飞书 packing 快照 + skuLocalCosts；不写 Catalog / 不飞书回写。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppState, SkuLocalCost } from "../../common/types.js";
import { getFeishuRawDir } from "../../platforms/feishu/config.js";
import {
  extractPackingBoxRows,
  type PackingBoxRow,
} from "../../platforms/feishu/normalize/forwarder-board.js";
import {
  loadLatestPackingLines,
  shopPrefixFromPartnerSku,
  type PackingLineRow,
} from "../../platforms/feishu/normalize/packing-lines.js";

export type LandedCostRow = {
  PSKU: string;
  运输方式: string;
  最终单件SKU成本: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function belongsPrefix(psku: string, prefixes: string[]): boolean {
  if (!prefixes.length) return true;
  const p = shopPrefixFromPartnerSku(psku);
  return Boolean(p && prefixes.includes(p));
}

function lineWeightInBox(line: PackingLineRow): number {
  if (line.totalWeightKg != null && line.totalWeightKg > 0) {
    return line.totalWeightKg;
  }
  if (line.unitWeightKg != null && line.unitWeightKg > 0) {
    return line.unitWeightKg * (Number(line.qty) || 0);
  }
  return 0;
}

function modeLabel(box: PackingBoxRow | undefined, line: PackingLineRow): string {
  const raw = (box?.modeRaw || line.modeRaw || "").trim();
  if (raw) return raw;
  const m = box?.mode || line.mode;
  if (m === "air") return "空运";
  if (m === "sea") return "海运";
  if (m === "single") return "单品";
  return "";
}

function rawDirCandidates(): string[] {
  const primary = getFeishuRawDir();
  const shared = resolve(
    process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
    "feishu-raw",
  );
  const fromShop = resolve(primary, "..", "..", "..", "feishu-raw");
  return [...new Set([primary, shared, fromShop])];
}

/** 最新装箱「箱表」行（含整票运费 / 实重） */
export function loadLatestPackingBoxRows(): {
  boxes: PackingBoxRow[];
  path: string | null;
} {
  for (const dir of rawDirCandidates()) {
    const runsDir = join(dir, "runs");
    const candidates: Array<{ path: string; mtime: number }> = [];
    const lastPath = join(dir, "last-run.json");
    if (existsSync(lastPath)) {
      try {
        const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
          runId?: string;
        };
        if (last.runId) {
          const path = join(
            dir,
            "runs",
            last.runId,
            "packing",
            "snapshot.json",
          );
          if (existsSync(path)) {
            candidates.push({ path, mtime: statSync(path).mtimeMs });
          }
        }
      } catch {
        /* fall through */
      }
    }
    if (existsSync(runsDir)) {
      try {
        for (const name of readdirSync(runsDir)) {
          const path = join(runsDir, name, "packing", "snapshot.json");
          if (!existsSync(path)) continue;
          candidates.push({ path, mtime: statSync(path).mtimeMs });
        }
      } catch {
        /* next dir */
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    for (const c of candidates) {
      try {
        const snap = JSON.parse(readFileSync(c.path, "utf8")) as {
          sheets?: Array<{ title?: string; values?: unknown[][] }>;
        };
        const sheet =
          snap.sheets?.find((s) => s.title === "箱表") ??
          snap.sheets?.find((s) => (s.title ?? "").includes("箱"));
        if (!sheet?.values?.length) continue;
        return {
          boxes: extractPackingBoxRows(sheet.values),
          path: c.path,
        };
      } catch {
        /* try next */
      }
    }
  }
  return { boxes: [], path: null };
}

/**
 * Prep landed_cost_from_packing：
 * 头程单件 = (整票国内+跨境) × 本箱重量占比 × 箱内重量占比 / 数量
 * 最终单件 = 采购单价 + 头程单件；按 PSKU×运输方式 mean。
 */
export function landedCostFromPacking(
  packingLines: PackingLineRow[],
  packingBoxes: PackingBoxRow[],
  purchaseByPsku: Map<string, number>,
  prefixes: string[] = [],
): LandedCostRow[] {
  if (!packingLines.length || !packingBoxes.length) return [];

  const boxByNo = new Map<string, PackingBoxRow>();
  for (const b of packingBoxes) {
    if (b.boxNo) boxByNo.set(b.boxNo, b);
  }

  type LineAlloc = {
    psku: string;
    domesticShare: number;
    crossShare: number;
    qty: number;
    mode: string;
  };
  const lineAcc: LineAlloc[] = [];

  // 票号 → 箱子实重合计（Prep: groupby 票号 箱子实重）
  const ticketBoxWeight = new Map<string, number>();
  for (const b of packingBoxes) {
    const ticket = (b.ticketNo || b.logisticsNo || b.boxNo || "").trim();
    if (!ticket) continue;
    const w = Number(b.weightKg) || 0;
    ticketBoxWeight.set(ticket, (ticketBoxWeight.get(ticket) ?? 0) + w);
  }

  // 箱内 SKU 重量合计
  const boxSkuWeight = new Map<string, number>();
  for (const line of packingLines) {
    const psku = (line.partnerSku ?? "").trim();
    if (!psku || !belongsPrefix(psku, prefixes)) continue;
    const boxNo = (line.boxNo ?? "").trim();
    if (!boxNo) continue;
    boxSkuWeight.set(
      boxNo,
      (boxSkuWeight.get(boxNo) ?? 0) + lineWeightInBox(line),
    );
  }

  for (const line of packingLines) {
    const psku = (line.partnerSku ?? "").trim();
    if (!psku || !belongsPrefix(psku, prefixes)) continue;
    const boxNo = (line.boxNo ?? "").trim();
    if (!boxNo) continue;
    const box = boxByNo.get(boxNo);
    const qty = Number(line.qty) || 0;
    const skuW = lineWeightInBox(line);
    const boxWSum = boxSkuWeight.get(boxNo) ?? 0;
    const inBoxShare = boxWSum > 0 ? skuW / boxWSum : 0;

    const ticket = (
      box?.ticketNo ||
      line.ticketNo ||
      box?.logisticsNo ||
      line.logisticsNo ||
      boxNo
    ).trim();
    const boxActualW = Number(box?.weightKg) || 0;
    const ticketW = ticketBoxWeight.get(ticket) ?? 0;
    const boxShare = ticketW > 0 ? boxActualW / ticketW : 1;

    const domestic = Number(box?.domesticFreight) || 0;
    const cross = Number(box?.ticketCrossFreight) || 0;
    lineAcc.push({
      psku,
      domesticShare: domestic * boxShare * inBoxShare,
      crossShare: cross * boxShare * inBoxShare,
      qty,
      mode: modeLabel(box, line),
    });
  }

  type RowAcc = { sum: number; n: number };
  const byKey = new Map<string, RowAcc>();
  for (const row of lineAcc) {
    const purchase = purchaseByPsku.get(row.psku) ?? 0;
    const headhaulUnit =
      row.qty > 0 ? (row.domesticShare + row.crossShare) / row.qty : 0;
    const unit = round2(purchase + headhaulUnit);
    const key = `${row.psku}\0${row.mode}`;
    const acc = byKey.get(key) ?? { sum: 0, n: 0 };
    acc.sum += unit;
    acc.n += 1;
    byKey.set(key, acc);
  }

  const out: LandedCostRow[] = [];
  for (const [key, acc] of byKey) {
    const [PSKU, mode] = key.split("\0");
    if (!PSKU || acc.n <= 0) continue;
    out.push({
      PSKU,
      运输方式: mode ?? "",
      最终单件SKU成本: round2(acc.sum / acc.n),
    });
  }
  out.sort(
    (a, b) =>
      a.PSKU.localeCompare(b.PSKU) ||
      a.运输方式.localeCompare(b.运输方式),
  );
  return out;
}

export function buildLandedCostRows(
  state: AppState,
  opts: {
    prefixes?: string[];
    packingLines?: PackingLineRow[];
    packingBoxes?: PackingBoxRow[];
  } = {},
): { rows: LandedCostRow[]; packingPath: string | null; lineCount: number } {
  const prefixes = opts.prefixes ?? [];
  const lines = opts.packingLines ?? loadLatestPackingLines();
  const boxHit =
    opts.packingBoxes != null
      ? { boxes: opts.packingBoxes, path: null as string | null }
      : loadLatestPackingBoxRows();

  const purchaseByPsku = new Map<string, number>();
  for (const c of state.skuLocalCosts ?? ([] as SkuLocalCost[])) {
    const psku = (c.partnerSku ?? "").trim();
    if (!psku) continue;
    if (prefixes.length && !belongsPrefix(psku, prefixes)) continue;
    purchaseByPsku.set(psku, Number(c.purchaseCost) || 0);
  }

  const rows = landedCostFromPacking(
    lines,
    boxHit.boxes,
    purchaseByPsku,
    prefixes,
  );
  return {
    rows,
    packingPath: boxHit.path,
    lineCount: lines.length,
  };
}

export const LANDED_COST_HEADER = [
  "PSKU",
  "运输方式",
  "最终单件SKU成本",
] as const;

export function landedCostRowsToCsv(rows: LandedCostRow[]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [LANDED_COST_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [esc(r.PSKU), esc(r.运输方式), esc(r.最终单件SKU成本)].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
