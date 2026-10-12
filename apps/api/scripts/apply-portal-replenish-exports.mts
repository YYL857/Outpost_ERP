/**
 * 用 portal-imports 里已有的影刀导表，覆盖写入两店 salesFacts + 合并 FBN 库存。
 *   npx tsx scripts/apply-portal-replenish-exports.mts
 *
 * 销量只计 Delivered / Processing / Shipped（影刀不点 Status，导全量后此处再筛；
 * 影刀 deliver 落盘时也会先清洗一遍）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadState, saveState } from "../src/data/store.js";
import { parseStockContent } from "../src/platforms/noon/portal/parsers.js";
import type { SalesFact, StockItem } from "../src/common/types.js";

const SHOPS = ["PRJ396770", "PRJ482387"] as const;
const KEEP_STATUS = new Set(["delivered", "processing", "shipped"]);

function latest(dir: string, prefix: string): string | null {
  const files = readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".csv"))
    .sort();
  return files.length ? files[files.length - 1]! : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** 门户 Sales 行 → 只保留三态，再聚成 SKU×日 */
function portalSalesToFacts(csv: string): {
  facts: SalesFact[];
  kept: number;
  dropped: number;
} {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return { facts: [], kept: 0, dropped: 0 };
  const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const iSku = headers.indexOf("partner_sku");
  const iStatus = headers.indexOf("status");
  const iTs = headers.indexOf("order_timestamp");
  const iGmv = headers.indexOf("gmv_lcy");
  if (iSku < 0 || iTs < 0) {
    throw new Error("sales csv missing partner_sku / order_timestamp");
  }
  const map = new Map<string, SalesFact>();
  let kept = 0;
  let dropped = 0;
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const status = (iStatus >= 0 ? cols[iStatus] ?? "" : "").trim().toLowerCase();
    if (iStatus >= 0 && status && !KEEP_STATUS.has(status)) {
      dropped += 1;
      continue;
    }
    const sku = (cols[iSku] ?? "").trim();
    const date = ((cols[iTs] ?? "").trim().slice(0, 10) || "").slice(0, 10);
    if (!sku || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      dropped += 1;
      continue;
    }
    const amount = Math.max(0, Number(cols[iGmv] ?? 0) || 0);
    kept += 1;
    const key = `${sku}|${date}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        partnerSku: sku,
        date,
        units: 1,
        amount,
        updatedAt: new Date().toISOString(),
      });
    } else {
      prev.units += 1;
      prev.amount += amount;
    }
  }
  return { facts: [...map.values()], kept, dropped };
}

for (const sid of SHOPS) {
  const dataDir = join("D:/outpost-data/shops", sid, "json");
  const imports = join("D:/outpost-data/shops", sid, "portal-imports");
  const state = loadState(dataDir);

  const salesName = latest(imports, "sales_export_");
  if (!salesName) {
    console.log(sid, "skip: no sales_export");
    continue;
  }
  const { facts, kept, dropped } = portalSalesToFacts(
    readFileSync(join(imports, salesName), "utf8"),
  );
  const beforeSales = state.salesFacts.length;
  state.salesFacts = facts;

  const stockName = latest(imports, "fbn_inventory_ledger_summary_");
  let stockUpserts = 0;
  if (stockName) {
    const stocks = parseStockContent(
      readFileSync(join(imports, stockName), "utf8"),
      "csv",
    );
    // 全量快照：去掉 Catalog 假仓 + 旧分仓，只保留真 FBP，再写入导表结存
    const keepFbp = state.stock.filter(
      (s) =>
        s.fulfillment === "fbp" &&
        String(s.warehouseCode ?? "").toUpperCase() !== "FBP",
    );
    const ts = new Date().toISOString();
    const nextRows: StockItem[] = [...keepFbp];
    for (const s of stocks) {
      if ((s.qty ?? 0) <= 0 && (s.in_transit_qty ?? 0) <= 0) continue;
      nextRows.push({
        partnerSku: s.partner_sku,
        warehouseCode: s.warehouse_code,
        fulfillment: s.fulfillment ?? "unknown",
        qty: s.qty,
        inTransitQty: s.in_transit_qty ?? 0,
        updatedAt: s.updated_at || ts,
      });
      stockUpserts += 1;
    }
    state.stock = nextRows;
  }

  saveState(state, dataDir);
  console.log(
    JSON.stringify({
      sid,
      salesFile: salesName,
      lineKept: kept,
      lineDropped: dropped,
      salesFacts: `${beforeSales} -> ${state.salesFacts.length}`,
      stockFile: stockName,
      stockUpserts,
      stockTotal: state.stock.length,
    }),
  );
}

console.log("done — 请在慧运营切店后点补货页「刷新」（或重启 API）");
