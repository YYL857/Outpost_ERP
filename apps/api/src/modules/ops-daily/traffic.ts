import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../../platforms/noon/portal/parsers.js";
import {
  inInclusiveWindow,
  toShanghaiYmd,
  windowStartYmd,
} from "./dates.js";

export type TrafficMetrics = {
  visitors30: number;
  conversion30: number;
  unitsShipped30: number;
};

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

export type TrafficLine = {
  sku: string;
  partnerSku: string;
  visitYmd: string | null;
  visitors: number;
  shippedUnits: number;
};

export function parseProductViewsContent(content: string): TrafficLine[] {
  const rows = parseCsv(content);
  const out: TrafficLine[] = [];
  for (const row of rows) {
    const sku = pick(row, ["sku", "sku_child", "noon_sku"]);
    const partnerSku = pick(row, [
      "partner_sku",
      "partner sku",
      "psku",
    ]);
    if (!sku && !partnerSku) continue;
    const visitRaw = pick(row, ["visit_date", "date", "report_date"]);
    const visitors = Number(
      pick(row, ["your_visitors", "visitors", "total_visitors"]) || 0,
    );
    const shipped = Number(
      pick(row, ["shipped_units", "gross_units", "units"]) || 0,
    );
    out.push({
      sku,
      partnerSku,
      visitYmd: toShanghaiYmd(visitRaw),
      visitors: Number.isFinite(visitors) ? visitors : 0,
      shippedUnits: Number.isFinite(shipped) ? shipped : 0,
    });
  }
  return out;
}

function listCsvFiles(dir: string, pred: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((n) => pred(n) && !n.startsWith("."))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/**
 * 搜索 productviews raw：
 * portal-imports / ops_daily/cache / OUTPOST_OPS_DAILY_TRAFFIC_DIR /
 * FLOW 浏览转化报表/{partnerId}
 */
export function resolveTrafficSearchDirs(
  shopRootDir: string,
  partnerNumericId: string,
): string[] {
  const dirs: string[] = [
    join(shopRootDir, "portal-imports"),
    join(shopRootDir, "ops_daily", "cache"),
  ];
  const env = process.env.OUTPOST_OPS_DAILY_TRAFFIC_DIR?.trim();
  if (env) dirs.push(env);

  const flowRoot =
    process.env.OUTPOST_FLOW_REPORTS_DIR?.trim() ||
    "D:\\Desktop\\FLOW\\平台后台下载数据";
  const flowTraffic = join(flowRoot, "浏览转化报表", partnerNumericId);
  if (existsSync(flowTraffic)) dirs.push(flowTraffic);

  // GP 归档旁路
  const gp = join(
    process.cwd(),
    "scripts",
    "_out",
    "gp-sources",
    `PRJ${partnerNumericId}`,
  );
  if (existsSync(gp)) dirs.push(gp);

  return dirs;
}

function isTrafficFile(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.endsWith(".csv") &&
    (n.includes("productview") ||
      n.includes("product_view") ||
      n.includes("viewsandsales") ||
      /^sales_20\d{2}/.test(n))
  );
}

type TrafficCand = { path: string; tier: number; lines: TrafficLine[] };

/**
 * 分层取源，避免 FLOW 月报 + gp-sources 双计：
 * 0 = portal-imports / ops_daily/cache
 * 1 = FLOW 浏览转化报表
 * 2 = gp-sources 旁路
 * 取到的最高优先级层（数字更小）独占。
 */
export function loadTrafficLines(
  shopRootDir: string,
  partnerNumericId: string,
): { lines: TrafficLine[]; files: string[] } {
  const flowRoot =
    process.env.OUTPOST_FLOW_REPORTS_DIR?.trim() ||
    "D:\\Desktop\\FLOW\\平台后台下载数据";
  const flowTraffic = join(flowRoot, "浏览转化报表", partnerNumericId);
  const envExtra = process.env.OUTPOST_OPS_DAILY_TRAFFIC_DIR?.trim();
  const gp = join(
    process.cwd(),
    "scripts",
    "_out",
    "gp-sources",
    `PRJ${partnerNumericId}`,
  );

  const tierDirs: Array<{ tier: number; dir: string }> = [
    { tier: 0, dir: join(shopRootDir, "portal-imports") },
    { tier: 0, dir: join(shopRootDir, "ops_daily", "cache") },
  ];
  if (envExtra) tierDirs.push({ tier: 0, dir: envExtra });
  if (existsSync(flowTraffic)) tierDirs.push({ tier: 1, dir: flowTraffic });
  if (existsSync(gp)) tierDirs.push({ tier: 2, dir: gp });

  const cands: TrafficCand[] = [];
  const seenPath = new Set<string>();

  for (const { tier, dir } of tierDirs) {
    for (const path of listCsvFiles(dir, isTrafficFile)) {
      const key = path.replace(/\\/g, "/").toLowerCase();
      if (seenPath.has(key)) continue;
      seenPath.add(key);
      try {
        const st = statSync(path);
        if (st.size <= 0) continue;
        const content = readFileSync(path, "utf8");
        const head = content.slice(0, 400).toLowerCase();
        if (
          !head.includes("visit_date") &&
          !head.includes("your_visitors")
        ) {
          continue;
        }
        cands.push({
          path,
          tier,
          lines: parseProductViewsContent(content),
        });
      } catch {
        /* skip */
      }
    }
  }

  if (!cands.length) return { lines: [], files: [] };

  // portal/cache 优先；若无则 FLOW；再 gp
  const bestTier = [...new Set(cands.map((c) => c.tier))].sort(
    (a, b) => a - b,
  );
  let chosenTier = [bestTier[0]!];
  // 若最高优先层是 portal 但行数为 0 有效，降级
  const tierHasRows = (t: number) =>
    cands.some((c) => c.tier === t && c.lines.length > 0);
  for (const t of bestTier) {
    if (tierHasRows(t)) {
      chosenTier = [t];
      break;
    }
  }

  const picked = cands.filter((c) => chosenTier.includes(c.tier));
  return {
    lines: picked.flatMap((c) => c.lines),
    files: picked.map((c) => c.path),
  };
}

/** Prep traffic_metrics：按 Noon SKU 汇总 30 访客；转化=Shipped_Units/访客 */
export function rollupTrafficMetrics(
  lines: TrafficLine[],
  asOf: string,
  lastN = 30,
): Map<string, TrafficMetrics> {
  const from = windowStartYmd(asOf, lastN);
  type Acc = { visitors: number; shipped: number };
  const bySku = new Map<string, Acc>();
  const byPsku = new Map<string, Acc>();

  for (const line of lines) {
    if (!inInclusiveWindow(line.visitYmd, from, asOf)) continue;
    if (line.sku) {
      const a = bySku.get(line.sku) ?? { visitors: 0, shipped: 0 };
      a.visitors += line.visitors;
      a.shipped += line.shippedUnits;
      bySku.set(line.sku, a);
    }
    if (line.partnerSku) {
      const a = byPsku.get(line.partnerSku) ?? { visitors: 0, shipped: 0 };
      a.visitors += line.visitors;
      a.shipped += line.shippedUnits;
      byPsku.set(line.partnerSku, a);
    }
  }

  const out = new Map<string, TrafficMetrics>();
  const finish = (key: string, a: Acc) => {
    out.set(key, {
      visitors30: a.visitors,
      unitsShipped30: a.shipped,
      conversion30: a.visitors > 0 ? a.shipped / a.visitors : 0,
    });
  };
  for (const [k, a] of bySku) finish(k, a);
  // PSKU 键也放入，供 spine 兜底（不覆盖已有 SKU 键）
  for (const [k, a] of byPsku) {
    if (!out.has(k)) finish(k, a);
  }
  return out;
}
