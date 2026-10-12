import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StockItem } from "../../common/types.js";
import { parseCsv } from "../../platforms/noon/portal/parsers.js";
import { channelForWarehouse, loadWarehouseMap } from "./config.js";

export type StockChannels = { fbn: number; supermall: number };

/** 按 PSKU 汇总 FBN / supermall 可售 qty（state.stock） */
export function rollupStockByPsku(
  stock: StockItem[],
): Map<string, StockChannels> {
  const map = loadWarehouseMap();
  const out = new Map<string, StockChannels>();
  for (const s of stock) {
    const psku = s.partnerSku?.trim();
    if (!psku) continue;
    // fulfillment 优先；否则仓码映射
    let ch: "FBN" | "supermall";
    if (s.fulfillment === "fbn") ch = "FBN";
    else if (s.fulfillment === "supermall" || s.fulfillment === "fbp") {
      ch = "supermall";
    } else {
      ch = channelForWarehouse(s.warehouseCode ?? "", map);
    }
    const acc = out.get(psku) ?? { fbn: 0, supermall: 0 };
    const qty = Number(s.qty) || 0;
    if (ch === "FBN") acc.fbn += qty;
    else acc.supermall += qty;
    out.set(psku, acc);
  }
  return out;
}

/**
 * Prep 同源旁路：portal-imports/fbn_vs_supermall_YYYY-MM-DD.csv
 * 优先精确 asOf，否则取 ≤asOf 最新一日。
 */
export function loadFbnVsSupermall(
  importDir: string,
  asOf: string,
): { byPsku: Map<string, StockChannels>; fileName: string | null } {
  const empty = {
    byPsku: new Map<string, StockChannels>(),
    fileName: null as string | null,
  };
  if (!existsSync(importDir)) return empty;

  const names = readdirSync(importDir).filter(
    (n) =>
      /^fbn_vs_supermall_20\d{2}-\d{2}-\d{2}\.csv$/i.test(n) &&
      !n.startsWith("."),
  );
  if (!names.length) return empty;

  type Cand = { fileName: string; filePath: string; day: string; mtimeMs: number };
  const cands: Cand[] = [];
  for (const name of names) {
    const m = name.match(/(20\d{2}-\d{2}-\d{2})/i);
    if (!m) continue;
    const day = m[1]!;
    if (day > asOf) continue;
    const filePath = join(importDir, name);
    try {
      cands.push({
        fileName: name,
        filePath,
        day,
        mtimeMs: statSync(filePath).mtimeMs,
      });
    } catch {
      /* skip */
    }
  }
  if (!cands.length) return empty;
  cands.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1;
    return b.mtimeMs - a.mtimeMs;
  });
  const best = cands[0]!;
  const rows = parseCsv(readFileSync(best.filePath, "utf8"));
  const byPsku = new Map<string, StockChannels>();
  for (const row of rows) {
    const psku = (row.partner_sku || row.psku || "").trim();
    if (!psku) continue;
    byPsku.set(psku, {
      fbn: Number(row.fbn_qty ?? row.fbn ?? 0) || 0,
      supermall: Number(row.supermall_qty ?? row.supermall ?? 0) || 0,
    });
  }
  return { byPsku, fileName: best.fileName };
}

/** portal fbn_vs_supermall 优先，缺的 PSKU 用 state.stock 补 */
export function resolveStockChannels(
  stock: StockItem[],
  importDir: string,
  asOf: string,
): {
  byPsku: Map<string, StockChannels>;
  sourceFile: string | null;
  usedStateFallback: boolean;
} {
  const portal = loadFbnVsSupermall(importDir, asOf);
  const stateMap = rollupStockByPsku(stock);
  if (!portal.byPsku.size) {
    return {
      byPsku: stateMap,
      sourceFile: null,
      usedStateFallback: true,
    };
  }
  for (const [psku, ch] of stateMap) {
    if (!portal.byPsku.has(psku)) portal.byPsku.set(psku, ch);
  }
  return {
    byPsku: portal.byPsku,
    sourceFile: portal.fileName,
    usedStateFallback: false,
  };
}
