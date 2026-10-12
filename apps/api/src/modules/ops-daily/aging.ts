import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../../platforms/noon/portal/parsers.js";
import { toShanghaiYmd } from "./dates.js";

export const AGE_BUCKETS = [
  "0-90天",
  "91-180天",
  "181-270天",
  "271-365天",
  "365天以上",
] as const;

export type AgeBucketName = (typeof AGE_BUCKETS)[number];

export type AgingMetrics = {
  daysInWarehouse: number | null;
  risk: string;
  buckets: Record<AgeBucketName, number>;
};

export type LedgerMove = {
  sku: string;
  partnerSku: string;
  ymd: string;
  qty: number;
};

const MISSING = "入仓天数缺失";

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

export function parseFbnLedgerContent(content: string): LedgerMove[] {
  const rows = parseCsv(content);
  const out: LedgerMove[] = [];
  for (const row of rows) {
    const sku = pick(row, ["sku", "nfsku"]);
    const partnerSku = pick(row, ["partner_sku", "partner_barcode", "pbarcode"]);
    if (!sku && !partnerSku) continue;
    const dateRaw = pick(row, [
      "posted_date",
      "transaction_date",
      "date",
    ]);
    const ymd = toShanghaiYmd(dateRaw);
    if (!ymd) continue;
    const qtyRaw = pick(row, ["quantity", "quantity_delta", "qty"]);
    const qty = Number(String(qtyRaw).replace(/,/g, ""));
    if (!Number.isFinite(qty) || qty === 0) continue;
    out.push({ sku, partnerSku, ymd, qty });
  }
  return out;
}

function isLedgerFile(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.endsWith(".csv")) return false;
  if (n.includes("summary") || n.includes("vs_supermall")) return false;
  return (
    n.includes("fbn_inventory_detailed") ||
    n.includes("inventory_ledger") ||
    n.includes("fbn_inventoryv2") ||
    n.includes("stock-detailed") ||
    n.includes("stock_detailed")
  );
}

function listCsv(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((n) => isLedgerFile(n) && !n.startsWith("."))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

export function loadFbnLedgerMoves(
  shopRootDir: string,
  partnerNumericId: string,
): { moves: LedgerMove[]; files: string[] } {
  const flowRoot =
    process.env.OUTPOST_FLOW_REPORTS_DIR?.trim() ||
    "D:\\Desktop\\FLOW\\平台后台下载数据";
  const flowDir = join(flowRoot, "库存细节报表", partnerNumericId);
  const envExtra = process.env.OUTPOST_OPS_DAILY_LEDGER_DIR?.trim();

  const tierDirs: Array<{ tier: number; dir: string }> = [
    { tier: 0, dir: join(shopRootDir, "portal-imports") },
    { tier: 0, dir: join(shopRootDir, "ops_daily", "cache") },
  ];
  if (envExtra) tierDirs.push({ tier: 0, dir: envExtra });
  if (existsSync(flowDir)) tierDirs.push({ tier: 1, dir: flowDir });

  type Cand = { path: string; tier: number; moves: LedgerMove[] };
  const cands: Cand[] = [];
  const seen = new Set<string>();
  for (const { tier, dir } of tierDirs) {
    for (const path of listCsv(dir)) {
      const key = path.replace(/\\/g, "/").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (statSync(path).size <= 0) continue;
        const content = readFileSync(path, "utf8");
        const head = content.slice(0, 500).toLowerCase();
        if (
          !head.includes("quantity") &&
          !head.includes("transaction_date") &&
          !head.includes("posted_date")
        ) {
          continue;
        }
        cands.push({ path, tier, moves: parseFbnLedgerContent(content) });
      } catch {
        /* skip */
      }
    }
  }
  if (!cands.length) return { moves: [], files: [] };
  const tiers = [...new Set(cands.map((c) => c.tier))].sort((a, b) => a - b);
  let chosen = tiers[0]!;
  for (const t of tiers) {
    if (cands.some((c) => c.tier === t && c.moves.length > 0)) {
      chosen = t;
      break;
    }
  }
  const picked = cands.filter((c) => c.tier === chosen);
  return {
    moves: picked.flatMap((c) => c.moves),
    files: picked.map((c) => c.path),
  };
}

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function ageDays(asOf: string, posted: string): number {
  return Math.floor((ymdToUtc(asOf) - ymdToUtc(posted)) / 86_400_000);
}

function bucketOf(age: number): AgeBucketName {
  if (age <= 90) return "0-90天";
  if (age <= 180) return "91-180天";
  if (age <= 270) return "181-270天";
  if (age <= 365) return "271-365天";
  return "365天以上";
}

export function riskFromBuckets(
  buckets: Record<AgeBucketName, number>,
  hasInbound: boolean,
): string {
  if (!hasInbound) return MISSING;
  if (buckets["365天以上"] > 0) return "超长期积压";
  if (buckets["271-365天"] > 0) return "重度积压";
  if (buckets["181-270天"] > 0) return "中度积压";
  if (buckets["91-180天"] > 0) return "轻度老化";
  return "库龄正常";
}

function emptyBuckets(): Record<AgeBucketName, number> {
  return {
    "0-90天": 0,
    "91-180天": 0,
    "181-270天": 0,
    "271-365天": 0,
    "365天以上": 0,
  };
}

/** Prep FIFO：先消耗最老 inbound，剩余分五桶。入仓天数=首次 inbound 至 asOf（含当天 +1）。 */
export function fifoAgeForSku(
  moves: LedgerMove[],
  asOf: string,
): AgingMetrics {
  const inWindow = moves
    .filter((m) => m.ymd <= asOf)
    .sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0));
  const inbound = inWindow.filter((m) => m.qty > 0);
  const outboundTotal = inWindow
    .filter((m) => m.qty < 0)
    .reduce((s, m) => s + -m.qty, 0);

  const buckets = emptyBuckets();
  if (!inbound.length) {
    return { daysInWarehouse: null, risk: MISSING, buckets };
  }

  let remainingOut = outboundTotal;
  const leftover: Array<{ age: number; qty: number }> = [];
  for (const r of inbound) {
    const q = r.qty;
    if (remainingOut >= q) {
      remainingOut -= q;
      continue;
    }
    const left = q - remainingOut;
    remainingOut = 0;
    leftover.push({ age: ageDays(asOf, r.ymd), qty: left });
  }
  for (const { age, qty } of leftover) {
    buckets[bucketOf(age)] += qty;
  }
  for (const k of AGE_BUCKETS) {
    buckets[k] = Math.round(buckets[k]);
  }

  const minIn = inbound[0]!.ymd;
  const daysInWarehouse = ageDays(asOf, minIn) + 1;
  return {
    daysInWarehouse,
    risk: riskFromBuckets(buckets, true),
    buckets,
  };
}

export function rollupAgingBySku(
  moves: LedgerMove[],
  asOf: string,
): Map<string, AgingMetrics> {
  const bySku = new Map<string, LedgerMove[]>();
  const byPsku = new Map<string, LedgerMove[]>();
  for (const m of moves) {
    if (m.sku) {
      const list = bySku.get(m.sku) ?? [];
      list.push(m);
      bySku.set(m.sku, list);
    }
    if (m.partnerSku) {
      const list = byPsku.get(m.partnerSku) ?? [];
      list.push(m);
      byPsku.set(m.partnerSku, list);
    }
  }
  const out = new Map<string, AgingMetrics>();
  for (const [sku, list] of bySku) out.set(sku, fifoAgeForSku(list, asOf));
  for (const [psku, list] of byPsku) {
    if (!out.has(psku)) out.set(psku, fifoAgeForSku(list, asOf));
  }
  return out;
}

export const AGING_MISSING_LABEL = MISSING;
