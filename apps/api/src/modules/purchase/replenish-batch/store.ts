/**
 * 采购批次持久化：D:\outpost-data\purchase\replenish-batches\
 */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { ParsedReplenishLine, ShopRollup } from "./parse.js";
import { rollupByShop } from "./parse.js";

export type ReplenishBatchRecord = {
  id: string;
  batchDate: string;
  importedAt: string;
  importedBy: { id: string; username: string };
  sheetName: string;
  filename: string;
  warnings: string[];
  lineCount: number;
  totalQty: number;
  lines: ParsedReplenishLine[];
  byShop: ShopRollup[];
  /** 通知阿沈的任务 id */
  taskId: string | null;
};

export type ReplenishBatchBrief = {
  id: string;
  batchDate: string;
  importedAt: string;
  importedBy: string;
  lineCount: number;
  totalQty: number;
  shopLabels: string[];
  taskId: string | null;
};

type IndexFile = {
  updatedAt: string;
  batches: ReplenishBatchBrief[];
};

function outpostRoot(): string {
  return resolve(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data");
}

export function replenishBatchesDir(): string {
  return join(outpostRoot(), "purchase", "replenish-batches");
}

function indexPath(): string {
  return join(replenishBatchesDir(), "index.json");
}

function batchPath(id: string): string {
  return join(replenishBatchesDir(), `${id}.json`);
}

function ensureDir(): void {
  const dir = replenishBatchesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function loadIndex(): IndexFile {
  ensureDir();
  if (!existsSync(indexPath())) {
    return { updatedAt: nowIso(), batches: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(indexPath(), "utf8")) as IndexFile;
    return {
      updatedAt: raw.updatedAt || nowIso(),
      batches: Array.isArray(raw.batches) ? raw.batches : [],
    };
  } catch {
    return { updatedAt: nowIso(), batches: [] };
  }
}

function saveIndex(file: IndexFile): void {
  ensureDir();
  file.updatedAt = nowIso();
  writeFileSync(indexPath(), JSON.stringify(file, null, 2), "utf8");
}

export function listReplenishBatchBriefs(limit = 30): ReplenishBatchBrief[] {
  return loadIndex().batches.slice(0, limit);
}

export function getReplenishBatch(id: string): ReplenishBatchRecord | null {
  const path = batchPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ReplenishBatchRecord;
  } catch {
    return null;
  }
}

export function saveReplenishBatch(
  input: {
    batchDate: string;
    sheetName: string;
    filename: string;
    warnings: string[];
    lines: ParsedReplenishLine[];
    importedBy: { id: string; username: string };
    taskId?: string | null;
  },
): ReplenishBatchRecord {
  ensureDir();
  const id = `rb-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const byShop = rollupByShop(input.lines);
  const totalQty = input.lines.reduce((a, l) => a + l.qty, 0);
  const record: ReplenishBatchRecord = {
    id,
    batchDate: input.batchDate,
    importedAt: nowIso(),
    importedBy: input.importedBy,
    sheetName: input.sheetName,
    filename: input.filename,
    warnings: input.warnings,
    lineCount: input.lines.length,
    totalQty,
    lines: input.lines,
    byShop,
    taskId: input.taskId ?? null,
  };
  writeFileSync(batchPath(id), JSON.stringify(record, null, 2), "utf8");

  const index = loadIndex();
  const brief: ReplenishBatchBrief = {
    id,
    batchDate: record.batchDate,
    importedAt: record.importedAt,
    importedBy: record.importedBy.username,
    lineCount: record.lineCount,
    totalQty: record.totalQty,
    shopLabels: byShop.map((s) => `${s.shop}(${s.shopName})`),
    taskId: record.taskId,
  };
  index.batches = [brief, ...index.batches.filter((b) => b.id !== id)];
  saveIndex(index);
  return record;
}

export function attachBatchTaskId(
  id: string,
  taskId: string,
): ReplenishBatchRecord | null {
  const rec = getReplenishBatch(id);
  if (!rec) return null;
  rec.taskId = taskId;
  writeFileSync(batchPath(id), JSON.stringify(rec, null, 2), "utf8");
  const index = loadIndex();
  const hit = index.batches.find((b) => b.id === id);
  if (hit) hit.taskId = taskId;
  saveIndex(index);
  return rec;
}
