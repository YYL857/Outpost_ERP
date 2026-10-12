/**
 * 装箱明细：按 PSKU 汇总各运输方式的货物件数。
 * 只读最新 feishu-raw 快照，不写状态。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getFeishuRawDir } from "../config.js";
import {
  cellText,
  headerIndexMap,
  isValidPartnerSku,
  parseNumber,
  pickCol,
} from "./cells.js";

export type ShipPieceQty = {
  air: number;
  sea: number;
  single: number;
};

type Cache = { key: string; map: Map<string, ShipPieceQty> };
let cache: Cache | null = null;

function emptyQty(): ShipPieceQty {
  return { air: 0, sea: 0, single: 0 };
}

function addMode(qty: ShipPieceQty, modeRaw: unknown, pieces: number) {
  const mode = cellText(modeRaw);
  if (mode.includes("空运")) qty.air += pieces;
  else if (mode.includes("海运")) qty.sea += pieces;
  else if (mode.includes("单品")) qty.single += pieces;
}

/** 装箱明细 values（含表头）→ PSKU 件数 */
export function aggregatePackingShipQty(
  values: unknown[][],
): Map<string, ShipPieceQty> {
  const out = new Map<string, ShipPieceQty>();
  if (values.length < 2) return out;
  const headers = headerIndexMap(values[0] ?? []);
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const partnerSku = cellText(
      pickCol(row, headers, ["PSKU", "psku", "Partner SKU"]),
    );
    if (!isValidPartnerSku(partnerSku)) continue;
    const pieces = parseNumber(pickCol(row, headers, ["数量", "件数", "PCS"]));
    if (pieces == null || pieces <= 0) continue;
    const qty = out.get(partnerSku) ?? emptyQty();
    addMode(qty, pickCol(row, headers, ["运输方式"]), pieces);
    out.set(partnerSku, qty);
  }
  return out;
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

function snapshotPath(): string | null {
  for (const dir of rawDirCandidates()) {
    const lastPath = join(dir, "last-run.json");
    if (!existsSync(lastPath)) continue;
    try {
      const last = JSON.parse(readFileSync(lastPath, "utf8")) as { runId?: string };
      if (!last.runId) continue;
      const path = join(dir, "runs", last.runId, "packing", "snapshot.json");
      if (existsSync(path)) return path;
    } catch {
      /* 下一个候选目录 */
    }
  }
  return null;
}

/** 最新装箱快照的件数；没有快照时返回空 Map */
export function loadLatestPackingShipQty(): Map<string, ShipPieceQty> {
  const path = snapshotPath();
  if (!path) return new Map();
  const key = `${path}:${statSync(path).mtimeMs}`;
  if (cache?.key === key) return cache.map;
  try {
    const snap = JSON.parse(readFileSync(path, "utf8")) as {
      sheets?: Array<{ title?: string; values?: unknown[][] }>;
    };
    const sheet = snap.sheets?.find((s) => s.title === "装箱明细");
    const map = aggregatePackingShipQty(sheet?.values ?? []);
    cache = { key, map };
    return map;
  } catch {
    return new Map();
  }
}
