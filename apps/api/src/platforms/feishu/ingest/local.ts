/**
 * M4：飞书规范化 CSV → AppState.skuLocalCosts / skuDims
 * 边界：只读 feishu-normalized 契约；按 partnerSku upsert；不覆盖 Noon 域；不删未出现在 CSV 的旧本地行（不丢）。
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type {
  AppState,
  CargoType,
  CashLedgerEntry,
  CatalogItem,
  PurchaseLine,
  SkuDims,
  SkuLocalCost,
} from "../../../common/types.js";
import { getFeishuNormalizedDir } from "../normalize/index.js";
import { FeishuError, isFeishuError } from "../errors.js";

function parseCargoTypeCsv(raw: string | undefined): CargoType {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "plug" || s.includes("插电")) return "plug";
  if (s === "builtin" || s.includes("内置")) return "builtin";
  return "general";
}

export type LocalAlignReport = {
  version: 1;
  joinKey: "partnerSku";
  ingestedAt: string;
  normalizeRunId: string;
  sourceRawRunId?: string;
  costFile?: string;
  dimsFile?: string;
  purchaseFile?: string;
  cashFile?: string;
  catalogCount: number;
  storePrefixes: string[];
  cost: {
    csvRows: number;
    upserted: number;
    skippedStale: number;
    skippedOtherShop: number;
    matchedCatalog: number;
    orphanLocal: number;
    catalogMissing: number;
  };
  dims: {
    csvRows: number;
    upserted: number;
    skippedStale: number;
    skippedOtherShop: number;
    matchedCatalog: number;
    orphanLocal: number;
    catalogMissing: number;
  };
  purchase: {
    csvRows: number;
    upserted: number;
    skippedOtherShop: number;
  };
  cash: {
    csvRows: number;
    upserted: number;
  };
  /** 当前店 Catalog 有、但无本地成本（需补数） */
  catalogMissingCost: string[];
  catalogMissingDims: string[];
  /** 飞书有、当前 Catalog 无（保留入库但不进主视图拼装） */
  orphanCostSample: string[];
  orphanDimsSample: string[];
  contentSha1: {
    cost?: string;
    dims?: string;
    purchase?: string;
    cash?: string;
  };
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    if (!cols.some((c) => c.trim())) continue;
    const o: Record<string, string> = {};
    headers.forEach((h, j) => {
      o[h] = cols[j] ?? "";
    });
    rows.push(o);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function inferStorePrefixes(catalog: CatalogItem[]): string[] {
  const set = new Set<string>();
  for (const c of catalog) {
    const m = c.partnerSku.match(/^(N\d+)/i);
    if (m?.[1]) set.add(m[1].toUpperCase());
  }
  return [...set].sort();
}

function belongsToShop(partnerSku: string, prefixes: string[]): boolean {
  if (!prefixes.length) return true;
  const upper = partnerSku.toUpperCase();
  return prefixes.some((p) => upper.startsWith(p.toUpperCase()));
}

function sha1File(path: string): string {
  return createHash("sha1").update(readFileSync(path)).digest("hex");
}

function isNewerOrEqual(incoming: string, existing: string): boolean {
  const a = Date.parse(incoming);
  const b = Date.parse(existing);
  if (Number.isNaN(a)) return true;
  if (Number.isNaN(b)) return true;
  return a >= b;
}

export function readLastNormalizePaths(normalizedRoot = getFeishuNormalizedDir()): {
  normalizeRunId: string;
  sourceRawRunId?: string;
  costFile?: string;
  dimsFile?: string;
  purchaseFile?: string;
  cashFile?: string;
  lastPath: string;
} {
  const lastPath = join(normalizedRoot, "last-normalize.json");
  if (!existsSync(lastPath)) {
    throw new FeishuError(
      "找不到 last-normalize.json",
      "SNAPSHOT_MISSING",
      "normalize",
      { lastPath },
      "先运行 feishu-normalize.ts",
    );
  }
  const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
    runId?: string;
    sourceRawRunId?: string;
    files?: {
      localCost?: string;
      dims?: string;
      purchase?: string;
      cash?: string;
    };
  };
  if (!last.runId) {
    throw new FeishuError(
      "last-normalize.json 缺少 runId",
      "SNAPSHOT_INVALID",
      "normalize",
      { lastPath },
    );
  }
  return {
    normalizeRunId: last.runId,
    sourceRawRunId: last.sourceRawRunId,
    costFile: last.files?.localCost,
    dimsFile: last.files?.dims,
    purchaseFile: last.files?.purchase,
    cashFile: last.files?.cash,
    lastPath,
  };
}

function upsertCost(
  state: AppState,
  row: SkuLocalCost,
): "inserted" | "updated" | "stale" {
  const idx = state.skuLocalCosts.findIndex((c) => c.partnerSku === row.partnerSku);
  if (idx < 0) {
    state.skuLocalCosts.push(row);
    return "inserted";
  }
  const prev = state.skuLocalCosts[idx]!;
  if (!isNewerOrEqual(row.updatedAt, prev.updatedAt)) return "stale";
  state.skuLocalCosts[idx] = { ...prev, ...row };
  return "updated";
}

function hasAnyDim(d: {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}): boolean {
  return d.lengthCm > 0 || d.widthCm > 0 || d.heightCm > 0 || d.weightKg > 0;
}

function isGapFillDimsSource(source?: string): boolean {
  if (!source) return false;
  return (
    source === "feishu:packing" ||
    source.startsWith("noon:fbn") ||
    source === "noon:fbn_inventory"
  );
}

function upsertDims(
  state: AppState,
  row: SkuDims,
): "inserted" | "updated" | "stale" | "kept" {
  const idx = state.skuDims.findIndex((d) => d.partnerSku === row.partnerSku);
  if (idx < 0) {
    state.skuDims.push(row);
    return "inserted";
  }
  const prev = state.skuDims[idx]!;
  if (!isNewerOrEqual(row.updatedAt, prev.updatedAt) && hasAnyDim(prev)) {
    return "stale";
  }

  // 补缺源：已有非空尺寸时只填 0 字段，不覆盖产品表主源
  if (isGapFillDimsSource(row.source) && hasAnyDim(prev)) {
    const merged: SkuDims = {
      ...prev,
      lengthCm: prev.lengthCm > 0 ? prev.lengthCm : row.lengthCm,
      widthCm: prev.widthCm > 0 ? prev.widthCm : row.widthCm,
      heightCm: prev.heightCm > 0 ? prev.heightCm : row.heightCm,
      weightKg: prev.weightKg > 0 ? prev.weightKg : row.weightKg,
      updatedAt: prev.updatedAt,
      source: prev.source ?? row.source,
      normalizeRunId: prev.normalizeRunId ?? row.normalizeRunId,
    };
    const changed =
      merged.lengthCm !== prev.lengthCm ||
      merged.widthCm !== prev.widthCm ||
      merged.heightCm !== prev.heightCm ||
      merged.weightKg !== prev.weightKg;
    if (!changed) return "kept";
    state.skuDims[idx] = merged;
    return "updated";
  }

  state.skuDims[idx] = { ...prev, ...row };
  return "updated";
}

export type IngestLocalOptions = {
  /** 默认当前店 Catalog 推断的 N1/N2…；空数组=不过滤 */
  storePrefixes?: string[];
  dryRun?: boolean;
  normalizedRoot?: string;
};

/**
 * 将最近一次 M3 产出写入 AppState（按 partnerSku 对齐）。
 */
export function ingestFeishuLocalIntoState(
  state: AppState,
  opts: IngestLocalOptions = {},
): LocalAlignReport {
  const normalizedRoot = opts.normalizedRoot ?? getFeishuNormalizedDir();
  const paths = readLastNormalizePaths(normalizedRoot);
  const prefixes =
    opts.storePrefixes ?? inferStorePrefixes(state.catalog);
  const catalogSet = new Set(state.catalog.map((c) => c.partnerSku));
  const ingestedAt = new Date().toISOString();

  const report: LocalAlignReport = {
    version: 1,
    joinKey: "partnerSku",
    ingestedAt,
    normalizeRunId: paths.normalizeRunId,
    sourceRawRunId: paths.sourceRawRunId,
    costFile: paths.costFile,
    dimsFile: paths.dimsFile,
    purchaseFile: paths.purchaseFile,
    cashFile: paths.cashFile,
    catalogCount: state.catalog.length,
    storePrefixes: prefixes,
    cost: {
      csvRows: 0,
      upserted: 0,
      skippedStale: 0,
      skippedOtherShop: 0,
      matchedCatalog: 0,
      orphanLocal: 0,
      catalogMissing: 0,
    },
    dims: {
      csvRows: 0,
      upserted: 0,
      skippedStale: 0,
      skippedOtherShop: 0,
      matchedCatalog: 0,
      orphanLocal: 0,
      catalogMissing: 0,
    },
    purchase: { csvRows: 0, upserted: 0, skippedOtherShop: 0 },
    cash: { csvRows: 0, upserted: 0 },
    catalogMissingCost: [],
    catalogMissingDims: [],
    orphanCostSample: [],
    orphanDimsSample: [],
    contentSha1: {},
  };

  const costSkus = new Set<string>();
  const dimSkus = new Set<string>();

  if (paths.costFile && existsSync(paths.costFile)) {
    report.contentSha1.cost = sha1File(paths.costFile);
    const rows = parseCsv(readFileSync(paths.costFile, "utf8"));
    report.cost.csvRows = rows.length;
    for (const r of rows) {
      const partnerSku = (r.partnerSku || "").trim();
      if (!partnerSku) continue;
      if (!belongsToShop(partnerSku, prefixes)) {
        report.cost.skippedOtherShop++;
        continue;
      }
      costSkus.add(partnerSku);
      const next: SkuLocalCost = {
        partnerSku,
        purchaseCost: Number(r.purchaseCost) || 0,
        headhaul: Number(r.headhaul) || 0,
        preferAir: String(r.preferAir).toLowerCase() === "true",
        cargoType: parseCargoTypeCsv(r.cargoType),
        updatedAt: r.updatedAt || ingestedAt,
        source: r.source || "feishu",
        normalizeRunId: paths.normalizeRunId,
      };
      if (opts.dryRun) {
        report.cost.upserted++;
        continue;
      }
      const result = upsertCost(state, next);
      if (result === "stale") report.cost.skippedStale++;
      else report.cost.upserted++;
    }
  }

  if (paths.dimsFile && existsSync(paths.dimsFile)) {
    report.contentSha1.dims = sha1File(paths.dimsFile);
    const rows = parseCsv(readFileSync(paths.dimsFile, "utf8"));
    report.dims.csvRows = rows.length;
    for (const r of rows) {
      const partnerSku = (r.partnerSku || "").trim();
      if (!partnerSku) continue;
      if (!belongsToShop(partnerSku, prefixes)) {
        report.dims.skippedOtherShop++;
        continue;
      }
      dimSkus.add(partnerSku);
      const next: SkuDims = {
        partnerSku,
        lengthCm: Number(r.lengthCm) || 0,
        widthCm: Number(r.widthCm) || 0,
        heightCm: Number(r.heightCm) || 0,
        weightKg: Number(r.weightKg) || 0,
        updatedAt: r.updatedAt || ingestedAt,
        source: r.source || "feishu",
        normalizeRunId: paths.normalizeRunId,
      };
      if (opts.dryRun) {
        report.dims.upserted++;
        continue;
      }
      const result = upsertDims(state, next);
      if (result === "stale" || result === "kept") report.dims.skippedStale++;
      else report.dims.upserted++;
    }
  }

  if (paths.purchaseFile && existsSync(paths.purchaseFile)) {
    report.contentSha1.purchase = sha1File(paths.purchaseFile);
    const rows = parseCsv(readFileSync(paths.purchaseFile, "utf8"));
    report.purchase.csvRows = rows.length;
    if (!opts.dryRun) {
      const map = new Map(
        (state.purchaseLines ?? []).map((x) => [x.id, x] as const),
      );
      for (const r of rows) {
        const partnerSku = (r.partnerSku || "").trim();
        if (!partnerSku) continue;
        if (!belongsToShop(partnerSku, prefixes)) {
          report.purchase.skippedOtherShop++;
          continue;
        }
        const id = (r.id || "").trim() || `${partnerSku}:${r.purchasedAt}:${r.qty}`;
        const prev = map.get(id);
        const csvOrderId = (r.orderId || "").trim();
        const csvTracking = (r.trackingNo || "").trim();
        const csvTransit = (r.transitStatus || "").trim();
        const csvEta = (r.etaDate || "").trim() || null;
        // 飞书同步：订单号以表为准；物流字段无新值时保留 1688 回填
        const next: PurchaseLine = {
          id,
          partnerSku,
          productName: r.productName || "",
          qty: Number(r.qty) || 0,
          unitCost: Number(r.unitCost) || 0,
          amount: Number(r.amount) || 0,
          supplier: r.supplier || "",
          purchasedAt: r.purchasedAt || null,
          status: r.status || "",
          remark: r.remark || "",
          sheetTitle: r.sheetTitle || "",
          updatedAt: r.updatedAt || ingestedAt,
          source: r.source || "feishu:accounts",
          orderId: csvOrderId || prev?.orderId || "",
          trackingNo: csvTracking || prev?.trackingNo || "",
          transitStatus: csvTransit || prev?.transitStatus || "",
          etaDate: csvEta || prev?.etaDate || null,
          logisticsUpdatedAt: prev?.logisticsUpdatedAt ?? null,
        };
        map.set(id, next);
        report.purchase.upserted++;
      }
      state.purchaseLines = [...map.values()];
    } else {
      report.purchase.upserted = rows.length;
    }
  }

  if (paths.cashFile && existsSync(paths.cashFile)) {
    report.contentSha1.cash = sha1File(paths.cashFile);
    const rows = parseCsv(readFileSync(paths.cashFile, "utf8"));
    report.cash.csvRows = rows.length;
    if (!opts.dryRun) {
      const map = new Map(
        (state.cashLedger ?? []).map((x) => [x.id, x] as const),
      );
      for (const r of rows) {
        const id = (r.id || "").trim();
        if (!id) continue;
        const kindRaw = String(r.kind || "other");
        const kind: CashLedgerEntry["kind"] =
          kindRaw === "income" || kindRaw === "expense" ? kindRaw : "other";
        const next: CashLedgerEntry = {
          id,
          kind,
          amount: Number(r.amount) || 0,
          category: r.category || "",
          occurredAt: r.occurredAt || null,
          remark: r.remark || "",
          sheetTitle: r.sheetTitle || "",
          updatedAt: r.updatedAt || ingestedAt,
          source: r.source || "feishu:accounts",
        };
        map.set(id, next);
        report.cash.upserted++;
      }
      state.cashLedger = [...map.values()];
    } else {
      report.cash.upserted = rows.length;
    }
  }

  if (
    !paths.costFile &&
    !paths.dimsFile &&
    !paths.purchaseFile &&
    !paths.cashFile
  ) {
    throw new FeishuError(
      "normalize 产物中没有 localCost/dims/purchase/cash CSV",
      "NORMALIZE_EMPTY",
      "normalize",
      { normalizeRunId: paths.normalizeRunId },
    );
  }

  for (const sku of catalogSet) {
    if (costSkus.has(sku)) report.cost.matchedCatalog++;
    else {
      report.cost.catalogMissing++;
      if (report.catalogMissingCost.length < 50) report.catalogMissingCost.push(sku);
    }
    if (dimSkus.has(sku)) report.dims.matchedCatalog++;
    else {
      report.dims.catalogMissing++;
      if (report.catalogMissingDims.length < 50) report.catalogMissingDims.push(sku);
    }
  }
  for (const sku of costSkus) {
    if (!catalogSet.has(sku)) {
      report.cost.orphanLocal++;
      if (report.orphanCostSample.length < 30) report.orphanCostSample.push(sku);
    }
  }
  for (const sku of dimSkus) {
    if (!catalogSet.has(sku)) {
      report.dims.orphanLocal++;
      if (report.orphanDimsSample.length < 30) report.orphanDimsSample.push(sku);
    }
  }

  if (!opts.dryRun) {
    const outDir = join(normalizedRoot, "align-reports");
    mkdirSync(outDir, { recursive: true });
    const reportPath = join(
      outDir,
      `align_${paths.normalizeRunId.replace(/[:]/g, "_")}.json`,
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    writeFileSync(
      join(normalizedRoot, "last-align.json"),
      JSON.stringify({ ...report, reportPath }, null, 2) + "\n",
      "utf8",
    );
  }

  return report;
}

export function formatIngestError(e: unknown) {
  if (isFeishuError(e)) return e.toJSON();
  return { message: e instanceof Error ? e.message : String(e) };
}

export { resolve };
