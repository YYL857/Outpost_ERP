/**
 * 将指定日 sales_export 合并 upsert 进两店 salesFacts（不整表覆盖）。
 *   npx tsx scripts/merge-sales-export-day.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadState, saveState } from "../src/data/store.js";
import type { SalesFact } from "../src/common/types.js";

const KEEP = new Set(["delivered", "processing", "shipped"]);

const JOBS = [
  {
    sid: "PRJ396770",
    file: "D:/outpost-data/shops/PRJ396770/portal-imports/sales_export_2026-09-29_2026-09-29.csv",
  },
  {
    sid: "PRJ482387",
    file: "D:/outpost-data/shops/PRJ482387/portal-imports/sales_export_2026-09-29_2026-09-29.csv",
  },
] as const;

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

function portalSalesToFacts(csv: string): {
  facts: SalesFact[];
  kept: number;
  dropped: number;
  byDate: Record<string, { u: number; a: number }>;
} {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) {
    return { facts: [], kept: 0, dropped: 0, byDate: {} };
  }
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
  const byDate: Record<string, { u: number; a: number }> = {};
  const ts = new Date().toISOString();
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const status = (iStatus >= 0 ? cols[iStatus] ?? "" : "").trim().toLowerCase();
    if (iStatus >= 0 && status && !KEEP.has(status)) {
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
        updatedAt: ts,
      });
    } else {
      prev.units += 1;
      prev.amount += amount;
    }
    const d = byDate[date] ?? { u: 0, a: 0 };
    d.u += 1;
    d.a += amount;
    byDate[date] = d;
  }
  return { facts: [...map.values()], kept, dropped, byDate };
}

for (const { sid, file } of JOBS) {
  if (!existsSync(file)) {
    console.log(JSON.stringify({ sid, error: "file missing", file }));
    continue;
  }
  const dataDir = join("D:/outpost-data/shops", sid, "json");
  const state = loadState(dataDir);
  const { facts, kept, dropped, byDate } = portalSalesToFacts(
    readFileSync(file, "utf8"),
  );
  let upserted = 0;
  let inserted = 0;
  for (const f of facts) {
    const idx = state.salesFacts.findIndex(
      (x) => x.partnerSku === f.partnerSku && x.date === f.date,
    );
    if (idx < 0) {
      state.salesFacts.unshift(f);
      inserted += 1;
    } else {
      state.salesFacts[idx] = f;
      upserted += 1;
    }
  }
  saveState(state, dataDir);
  let yAmt = 0;
  let yUnits = 0;
  for (const f of state.salesFacts) {
    if (f.date === "2026-09-29") {
      yAmt += f.amount;
      yUnits += f.units;
    }
  }
  console.log(
    JSON.stringify(
      {
        sid,
        file,
        kept,
        dropped,
        facts: facts.length,
        inserted,
        upserted,
        salesFactsTotal: state.salesFacts.length,
        byDate,
        y20260929: { yUnits, yAmt: Math.round(yAmt * 100) / 100 },
      },
      null,
      2,
    ),
  );
}

console.log("done — restart API / refresh dashboard");
