/**
 * 广告预算权威表：与 Python ads_budget/baseline_store.py 同路径同 CSV。
 * baselineBudget = 高峰目标（仅 UI/计算/显式 refresh 可写）
 * offpeakBudget = 低峰目标（仅 UI；空则 apply 回落默认 5）
 * lastSeenBudget/mode = 观测列（仅 sync/apply）
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getShopState } from "../../shops/state-cache.js";
import { resolveOutpostDataRoot } from "./outpost-data-root.js";

/** 与 Python windows.OFFPEAK_BUDGET_FLOOR 一致 */
export const DEFAULT_OFFPEAK_BUDGET = 5;

export const BASELINE_FIELDNAMES = [
  "shopId",
  "campaignId",
  "campaignName",
  "psku",
  "baselineBudget",
  "offpeakBudget",
  "lastSeenBudget",
  "mode",
  "enabled",
  "updatedAt",
  "needsBaseline",
  "updatedBy",
] as const;

export type AdsBudgetBaselineRow = {
  shopId: string;
  campaignId: string;
  campaignName: string;
  psku: string;
  baselineBudget: number | null;
  offpeakBudget: number | null;
  lastSeenBudget: number | null;
  mode: string;
  enabled: boolean;
  updatedAt: string;
  needsBaseline: boolean;
  updatedBy: string;
};

export type AdsBudgetBaselinePatch = {
  baselineBudget?: number | null;
  offpeakBudget?: number | null;
  enabled?: boolean;
  psku?: string;
  campaignName?: string;
  /** 仅创建时需要 */
  campaignId?: string;
};

function dataRoot(): string {
  return resolveOutpostDataRoot();
}

export function baselineCsvPath(shopId: string): string {
  const sid = shopId.trim().toUpperCase();
  return join(dataRoot(), "shops", sid, "ads-budget", "baseline.csv");
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, "").replace(/[^\d.\-]/g, "");
  if (!s || s === "." || s === "-" || s === "-.") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: unknown, defaultVal: boolean): boolean {
  if (v === null || v === undefined || v === "") return defaultVal;
  if (typeof v === "boolean") return v;
  return ["1", "true", "yes", "y", "on"].includes(String(v).trim().toLowerCase());
}

/** 极简 CSV 行解析（支持引号字段） */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function escapeCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function rowFromRecord(d: Record<string, string>): AdsBudgetBaselineRow | null {
  const campaignId = String(d.campaignId || d.campaign_id || "").trim();
  const shopId = String(d.shopId || d.shop_id || "")
    .trim()
    .toUpperCase();
  if (!campaignId || !shopId) return null;
  return {
    shopId,
    campaignId,
    campaignName: String(d.campaignName || d.campaign_name || "").trim(),
    psku: String(d.psku || "").trim(),
    baselineBudget: parseNum(d.baselineBudget ?? d.baseline_budget),
    offpeakBudget: parseNum(d.offpeakBudget ?? d.offpeak_budget),
    lastSeenBudget: parseNum(d.lastSeenBudget ?? d.last_seen_budget),
    mode: String(d.mode || "unknown").trim() || "unknown",
    enabled: parseBool(d.enabled, true),
    updatedAt: String(d.updatedAt || d.updated_at || "").trim(),
    needsBaseline: parseBool(d.needsBaseline ?? d.needs_baseline, false),
    updatedBy: String(d.updatedBy || d.updated_by || "").trim(),
  };
}

export function loadBaseline(shopId: string): AdsBudgetBaselineRow[] {
  const path = baselineCsvPath(shopId);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: AdsBudgetBaselineRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = cols[idx] ?? "";
    });
    const row = rowFromRecord(rec);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => {
    const pa = a.psku || "";
    const pb = b.psku || "";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.campaignId.localeCompare(b.campaignId);
  });
  return rows;
}

export function saveBaseline(shopId: string, rows: AdsBudgetBaselineRow[]): string {
  const sid = shopId.trim().toUpperCase();
  const path = baselineCsvPath(sid);
  mkdirSync(dirname(path), { recursive: true });
  const ordered = [...rows].sort((a, b) => {
    const pa = a.psku || "";
    const pb = b.psku || "";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.campaignId.localeCompare(b.campaignId);
  });
  const lines = [BASELINE_FIELDNAMES.join(",")];
  for (const r of ordered) {
    const vals = [
      r.shopId,
      r.campaignId,
      r.campaignName,
      r.psku,
      r.baselineBudget == null ? "" : String(r.baselineBudget),
      r.offpeakBudget == null ? "" : String(r.offpeakBudget),
      r.lastSeenBudget == null ? "" : String(r.lastSeenBudget),
      r.mode || "unknown",
      r.enabled ? "1" : "0",
      r.updatedAt || "",
      r.needsBaseline ? "1" : "0",
      r.updatedBy || "",
    ].map((x) => escapeCsv(String(x)));
    lines.push(vals.join(","));
  }
  writeFileSync(path, `\uFEFF${lines.join("\n")}\n`, "utf8");
  return path;
}

export function listBaseline(shopId: string) {
  const sid = shopId.trim().toUpperCase();
  const rows = loadBaseline(sid);
  return {
    shopId: sid,
    path: baselineCsvPath(sid),
    rows,
    defaultOffpeakBudget: DEFAULT_OFFPEAK_BUDGET,
    note: "baselineBudget=高峰；offpeakBudget=低峰（空→默认5）；lastSeen/mode=页面现状",
  };
}

/** 巡检：各店 needsBaseline=1 的活动（peak 永久跳过的静默漏点） */
export function listNeedsBaseline(shopIds: string[]): {
  needsBaseline: Array<{
    shopId: string;
    count: number;
    campaigns: string[];
  }>;
} {
  const out: Array<{ shopId: string; count: number; campaigns: string[] }> = [];
  for (const raw of shopIds) {
    const sid = String(raw || "")
      .trim()
      .toUpperCase();
    if (!sid) continue;
    const rows = loadBaseline(sid).filter((r) => r.needsBaseline);
    if (!rows.length) continue;
    out.push({
      shopId: sid,
      count: rows.length,
      campaigns: rows.map((r) => r.campaignId),
    });
  }
  return { needsBaseline: out };
}

export type AdsBudgetProductMeta = {
  title: string;
  imageUrl: string;
};

/**
 * 预算表缩略图/标题：读指定店的 Catalog（不是顶栏当前店）。
 * 仅 partnerSku → title/imageUrl，给 Pw Studio 对齐用。
 */
export function listBudgetProductMeta(shopId: string): {
  shopId: string;
  byPsku: Record<string, AdsBudgetProductMeta>;
  count: number;
} {
  const sid = shopId.trim().toUpperCase();
  const byPsku: Record<string, AdsBudgetProductMeta> = {};
  try {
    const catalog = getShopState(sid).catalog ?? [];
    for (const row of catalog) {
      const sku = String(row.partnerSku || "")
        .trim()
        .toUpperCase();
      if (!sku) continue;
      byPsku[sku] = {
        title: String(row.title || "").trim(),
        imageUrl: String(row.imageUrl || "").trim(),
      };
    }
  } catch {
    /* 未知店或未加载 state：空表，前端仍可展示活动名 */
  }
  return { shopId: sid, byPsku, count: Object.keys(byPsku).length };
}

/** 用户可改：baselineBudget / offpeakBudget / enabled / psku / campaignName；不改 lastSeen/mode */
export function patchBaselineRow(
  shopId: string,
  campaignId: string,
  patch: AdsBudgetBaselinePatch,
  updatedBy = "ui",
): AdsBudgetBaselineRow {
  const sid = shopId.trim().toUpperCase();
  const cid = campaignId.trim();
  const rows = loadBaseline(sid);
  const idx = rows.findIndex((r) => r.campaignId === cid);
  if (idx < 0) {
    throw new Error(`找不到 campaignId=${cid}`);
  }
  const row = { ...rows[idx] };
  if ("baselineBudget" in patch) {
    row.baselineBudget = patch.baselineBudget ?? null;
    row.needsBaseline = row.baselineBudget == null;
  }
  if ("offpeakBudget" in patch) {
    row.offpeakBudget = patch.offpeakBudget ?? null;
  }
  if (typeof patch.enabled === "boolean") row.enabled = patch.enabled;
  if (typeof patch.psku === "string") row.psku = patch.psku.trim();
  if (typeof patch.campaignName === "string") {
    row.campaignName = patch.campaignName.trim();
  }
  row.updatedAt = nowIso();
  row.updatedBy = updatedBy;
  rows[idx] = row;
  saveBaseline(sid, rows);
  return row;
}

export function upsertBaselineRow(
  shopId: string,
  input: AdsBudgetBaselinePatch & { campaignId: string },
  updatedBy = "ui",
): AdsBudgetBaselineRow {
  const sid = shopId.trim().toUpperCase();
  const cid = String(input.campaignId || "").trim();
  if (!cid) throw new Error("campaignId 必填");
  const rows = loadBaseline(sid);
  const idx = rows.findIndex((r) => r.campaignId === cid);
  const now = nowIso();
  if (idx >= 0) {
    return patchBaselineRow(sid, cid, input, updatedBy);
  }
  const baselineBudget =
    "baselineBudget" in input ? (input.baselineBudget ?? null) : null;
  const offpeakBudget =
    "offpeakBudget" in input
      ? (input.offpeakBudget ?? null)
      : DEFAULT_OFFPEAK_BUDGET;
  const row: AdsBudgetBaselineRow = {
    shopId: sid,
    campaignId: cid,
    campaignName: String(input.campaignName || "").trim(),
    psku: String(input.psku || "").trim(),
    baselineBudget,
    offpeakBudget,
    lastSeenBudget: null,
    mode: "unknown",
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    updatedAt: now,
    needsBaseline: baselineBudget == null,
    updatedBy,
  };
  rows.push(row);
  saveBaseline(sid, rows);
  return row;
}

export function deleteBaselineRow(shopId: string, campaignId: string): boolean {
  const sid = shopId.trim().toUpperCase();
  const cid = campaignId.trim();
  const rows = loadBaseline(sid);
  const next = rows.filter((r) => r.campaignId !== cid);
  if (next.length === rows.length) return false;
  saveBaseline(sid, next);
  return true;
}

export type AdsBudgetImportItem = {
  campaignId: string;
  /** 省略则不改该字段 */
  baselineBudget?: number | null;
  offpeakBudget?: number | null;
  enabled?: boolean;
  psku?: string;
  campaignName?: string;
};

export type AdsBudgetImportResult = {
  shopId: string;
  updated: number;
  skipped: number;
  skippedIds: string[];
  total: number;
};

/**
 * 按 campaignId 批量更新高峰/低峰（导入对比表）。
 * 不认识的活动编号跳过；不改 lastSeen/mode。
 */
export function importBaselineBudgets(
  shopId: string,
  items: AdsBudgetImportItem[],
  updatedBy = "ui-import",
): AdsBudgetImportResult {
  const sid = shopId.trim().toUpperCase();
  const rows = loadBaseline(sid);
  const byId = new Map(rows.map((r) => [r.campaignId, r]));
  const now = nowIso();
  let updated = 0;
  const skippedIds: string[] = [];

  for (const raw of items) {
    const cid = String(raw.campaignId || "").trim();
    if (!cid) {
      skippedIds.push("(空活动编号)");
      continue;
    }
    const row = byId.get(cid);
    if (!row) {
      skippedIds.push(cid);
      continue;
    }
    let changed = false;
    if ("baselineBudget" in raw) {
      row.baselineBudget = raw.baselineBudget ?? null;
      row.needsBaseline = row.baselineBudget == null;
      changed = true;
    }
    if ("offpeakBudget" in raw) {
      row.offpeakBudget = raw.offpeakBudget ?? null;
      changed = true;
    }
    if (typeof raw.enabled === "boolean") {
      row.enabled = raw.enabled;
      changed = true;
    }
    if (typeof raw.psku === "string" && raw.psku.trim()) {
      row.psku = raw.psku.trim();
      changed = true;
    }
    if (typeof raw.campaignName === "string" && raw.campaignName.trim()) {
      row.campaignName = raw.campaignName.trim();
      changed = true;
    }
    if (!changed) {
      skippedIds.push(cid);
      continue;
    }
    row.updatedAt = now;
    row.updatedBy = updatedBy;
    updated += 1;
  }

  if (updated > 0) {
    saveBaseline(sid, [...byId.values()]);
  }
  return {
    shopId: sid,
    updated,
    skipped: skippedIds.length,
    skippedIds: skippedIds.slice(0, 40),
    total: items.length,
  };
}
