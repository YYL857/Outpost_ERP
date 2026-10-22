/**
 * 广告预算运行历史：读 Python record_run 写入的全局 jsonl。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOutpostDataRoot } from "./outpost-data-root.js";

export type AdsBudgetRunRow = {
  finishedAt?: string;
  finishedAtCst?: string;
  startedAt?: string;
  durationMs?: number;
  needsBaselineCount?: number;
  ok?: boolean;
  cmd?: string;
  mode?: string;
  shops?: string[];
  trigger?: string;
  message?: string;
  applyOk?: number;
  applyFailed?: number;
  error?: string | null;
  dryRun?: boolean;
  [key: string]: unknown;
};

function globalRunsPath(): string {
  return join(resolveOutpostDataRoot(), "pw-rpa", "ads-budget-runs.jsonl");
}

function normalizeShops(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim().toUpperCase()];
  }
  return [];
}

export function listAdsBudgetRuns(opts?: {
  limit?: number;
  shopId?: string;
}): { items: AdsBudgetRunRow[]; total: number; path: string } {
  const path = globalRunsPath();
  const limit = Math.max(1, Math.min(200, Number(opts?.limit) || 50));
  const shopFilter = opts?.shopId?.trim().toUpperCase() || "";

  if (!existsSync(path)) {
    return { items: [], total: 0, path };
  }

  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const parsed: AdsBudgetRunRow[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as AdsBudgetRunRow;
      const shops = normalizeShops(row.shops);
      row.shops = shops;
      if (shopFilter && !shops.includes(shopFilter)) continue;
      parsed.push(row);
    } catch {
      /* skip bad line */
    }
  }

  // 文件是追加序；倒序取最近
  parsed.reverse();
  return {
    items: parsed.slice(0, limit),
    total: parsed.length,
    path,
  };
}
