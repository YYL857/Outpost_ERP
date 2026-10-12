/**
 * One-shot: Impex FBN ledger detailed → PSKU × (FBN / Supermall / total) → Desktop xlsx
 * N1 = PRJ396770
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import {
  clearNoonApiGatewayCache,
  loginNoonApiGateway,
  readNoonCredentialsFile,
} from "../src/platforms/noon/http.js";
import {
  IMPEX_EXPORT_CATEGORIES,
  runImpexExportCsv,
} from "../src/platforms/noon/impex-client.js";
import { parseStockContent } from "../src/platforms/noon/portal/parsers.js";
import type { NoonConnection } from "../src/common/types.js";

function desktopDir(): string {
  if (process.env.OUTPOST_EXPORT_DIR?.trim()) {
    return process.env.OUTPOST_EXPORT_DIR.trim();
  }
  // 本机桌面常见为 D:\Desktop（非 %USERPROFILE%\Desktop）
  return "D:\\Desktop";
}

async function main() {
  clearNoonApiGatewayCache();
  const cred = readNoonCredentialsFile();
  if (!cred) throw new Error("no credentials (OUTPOST_NOON_CREDENTIALS_FILE)");
  if (String(cred.project_code) !== "PRJ396770" && String(cred.project_code) !== "396770") {
    console.warn(
      `[warn] credentials project_code=${cred.project_code} (expected PRJ396770 / N1)`,
    );
  }
  await loginNoonApiGateway(true);

  const connection = {
    mode: "live",
    partnerId: cred.project_code,
    apiKey: "",
    apiSecret: "",
    webhookSecret: "",
    baseUrl: "https://noon-api-gateway.noon.partners",
    countryCode: "sa",
    enabled: true,
    lastValidatedAt: null,
    lastError: null,
    portal: {
      portalUrl: "",
      cookie: "",
      ordersUrl: "",
      catalogUrl: "",
      stockUrl: "",
      lastFetchAt: null,
      lastImportAt: null,
      lastImportSummary: null,
    },
  } as NoonConnection;

  console.log(
    JSON.stringify({
      step: "impex_create",
      project: cred.project_code,
      category: IMPEX_EXPORT_CATEGORIES.stockFbnDetailed,
    }),
  );

  const { exportCode, csv, category } = await runImpexExportCsv(
    connection,
    IMPEX_EXPORT_CATEGORIES.stockFbnDetailed,
    {},
    { timeoutMs: 180_000, pollMs: 2500 },
  );

  const rawLines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const rows = parseStockContent(csv, "csv");

  console.log(
    JSON.stringify({
      step: "parsed",
      exportCode,
      category,
      csvLines: Math.max(0, rawLines.length - 1),
      stockRows: rows.length,
      empty: rows.length === 0,
    }),
  );

  if (!rows.length) {
    throw new Error(
      "Impex stock export empty (0 rows after parse) — same failure mode as sync alert",
    );
  }

  type Agg = { psku: string; fbn: number; supermall: number; total: number };
  const bySku = new Map<string, Agg>();
  const fulfillCounts = new Map<string, number>();

  for (const r of rows) {
    const psku = (r.partner_sku || "").trim();
    if (!psku) continue;
    const f = (r.fulfillment || "unknown").toLowerCase();
    fulfillCounts.set(f, (fulfillCounts.get(f) ?? 0) + 1);
    const qty = Math.max(0, Math.floor(Number(r.qty) || 0));
    let agg = bySku.get(psku);
    if (!agg) {
      agg = { psku, fbn: 0, supermall: 0, total: 0 };
      bySku.set(psku, agg);
    }
    if (f === "fbn") agg.fbn += qty;
    else if (f === "supermall") agg.supermall += qty;
    // total = FBN + supermall only (per user request); transit/fbp ignored in total
  }

  for (const agg of bySku.values()) {
    agg.total = agg.fbn + agg.supermall;
  }

  const table = [...bySku.values()].sort((a, b) => a.psku.localeCompare(b.psku));
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const outName = `N1_PRJ396770_库存汇总_PSKU_${stamp}.xlsx`;
  const outPath = join(desktopDir(), outName);

  const sheetRows = table.map((r) => ({
    PSKU: r.psku,
    FBN数量: r.fbn,
    Supermall数量: r.supermall,
    总库存量_FBN加Supermall: r.total,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, "库存汇总");
  XLSX.writeFile(wb, outPath);

  // also keep raw csv next to xlsx for evidence
  const rawPath = join(desktopDir(), `N1_PRJ396770_impex_stock_raw_${stamp}.csv`);
  writeFileSync(rawPath, csv, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: cred.project_code,
        exportCode,
        stockRows: rows.length,
        pskuCount: table.length,
        fulfillmentBreakdown: Object.fromEntries(fulfillCounts),
        totals: {
          fbn: table.reduce((s, r) => s + r.fbn, 0),
          supermall: table.reduce((s, r) => s + r.supermall, 0),
          grand: table.reduce((s, r) => s + r.total, 0),
        },
        outPath,
        rawPath,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
