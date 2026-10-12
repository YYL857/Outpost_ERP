import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { AppState } from "../../../common/types.js";
import { getContextShopId } from "../../../auth/context.js";
import { loadRegistry } from "../../../shops/registry.js";
import { processPendingInbox } from "../../../modules/sync/pipeline.js";
import { pushAlert } from "../../../modules/sync/alerts.js";
import { saveState } from "../../../data/store.js";
import { detectDomainFromFilename } from "./parsers.js";
import { importPortalFileByName } from "./import-service.js";

export type IngestRecord = {
  key: string;
  filename: string;
  domain: string;
  mtimeMs: number;
  size: number;
  hash: string;
  ingestedAt: string;
  count: number;
};

export type IngestIndex = {
  updatedAt: string;
  files: Record<string, IngestRecord>;
};

export type AutoIngestResult = {
  importDir: string;
  scanned: number;
  imported: number;
  skipped: number;
  failed: Array<{ file: string; error: string }>;
  details: Array<{ file: string; domain: string; count: number }>;
};

function dataRoot() {
  const root =
    process.env.OUTPOST_BROWSER_DIR?.trim() ||
    process.env.OUTPOST_DATA_DIR?.trim() ||
    "D:\\outpost-data";
  return resolve(root.includes("json") ? join(root, "..") : root);
}

export function getImportDir(): string {
  const shopId = getContextShopId();
  if (shopId) {
    const shop = loadRegistry().shops.find((s) => s.id === shopId);
    if (shop?.rootDir) return resolve(join(shop.rootDir, "portal-imports"));
  }
  const fromEnv = process.env.OUTPOST_IMPORT_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(dataRoot(), "portal-imports");
}

function indexPath(dir: string) {
  return join(dir, ".ingested.json");
}

function loadIndex(dir: string): IngestIndex {
  const p = indexPath(dir);
  if (!existsSync(p)) return { updatedAt: new Date().toISOString(), files: {} };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as IngestIndex;
  } catch {
    return { updatedAt: new Date().toISOString(), files: {} };
  }
}

function saveIndex(dir: string, index: IngestIndex) {
  index.updatedAt = new Date().toISOString();
  writeFileSync(indexPath(dir), JSON.stringify(index, null, 2), "utf8");
}

function fileHash(content: string) {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

function listCandidateFiles(dir: string): string[] {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .filter((n) => /\.(csv|json|txt)$/i.test(n))
    .map((n) => join(dir, n));
}

/**
 * 扫描 portal-imports，按文件名识域自动入库（去重：mtime+size+hash）
 */
export async function runAutoIngest(
  state: AppState,
  opts?: { force?: boolean },
): Promise<AutoIngestResult> {
  const importDir = getImportDir();
  if (!existsSync(importDir)) mkdirSync(importDir, { recursive: true });

  const index = loadIndex(importDir);
  const files = listCandidateFiles(importDir);
  const result: AutoIngestResult = {
    importDir,
    scanned: files.length,
    imported: 0,
    skipped: 0,
    failed: [],
    details: [],
  };

  for (const full of files) {
    const filename = full.split(/[/\\]/).pop() ?? full;
    const domain = detectDomainFromFilename(filename);
    if (!domain) {
      result.skipped += 1;
      continue;
    }

    let content: string;
    let st: { mtimeMs: number; size: number };
    try {
      st = statSync(full);
      content = readFileSync(full, "utf8");
    } catch (err) {
      result.failed.push({
        file: filename,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const hash = fileHash(content);
    const key = filename.toLowerCase();
    const prev = index.files[key];
    if (
      !opts?.force &&
      prev &&
      prev.hash === hash &&
      prev.mtimeMs === st.mtimeMs &&
      prev.size === st.size
    ) {
      result.skipped += 1;
      continue;
    }

    try {
      const imported = importPortalFileByName(state, filename, content);
      // 大报表可能一次 Inbox 很多，循环直到处理完
      for (let i = 0; i < 50; i++) {
        const { processed } = await processPendingInbox(state, 200);
        if (!processed) break;
      }
      index.files[key] = {
        key,
        filename,
        domain: imported.domain,
        mtimeMs: st.mtimeMs,
        size: st.size,
        hash,
        ingestedAt: new Date().toISOString(),
        count: imported.count,
      };
      result.imported += 1;
      result.details.push({
        file: filename,
        domain: imported.domain,
        count: imported.count,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed.push({ file: filename, error: message });
      pushAlert(state, {
        level: "warning",
        title: "自动入库失败",
        detail: `${filename}: ${message}`,
      });
    }
  }

  saveIndex(importDir, index);
  state.noon.portal.lastImportAt = new Date().toISOString();
  state.noon.portal.lastImportSummary = `自动入库 扫描${result.scanned} 新导入${result.imported} 跳过${result.skipped} 失败${result.failed.length}`;
  saveState(state);

  return result;
}

export type LatestAdsIngestResult = {
  importDir: string;
  ok: boolean;
  skipped: boolean;
  reason?: string;
  fileName?: string;
  filePath?: string;
  fileMtime?: string;
  reportFrom?: string | null;
  reportTo?: string | null;
  count?: number;
};

/**
 * 汇总专用：只强制入库「最新」ads_sku_*.csv（mtime 优先，文件名 toDate 打破平局）。
 * 避免目录里多份历史报表时，6h 汇总仍沿用旧文件语义。
 */
export async function ingestLatestAdsFile(
  state: AppState,
  opts?: { notBeforeMs?: number },
): Promise<LatestAdsIngestResult> {
  const importDir = getImportDir();
  if (!existsSync(importDir)) mkdirSync(importDir, { recursive: true });

  const picked = pickLatestAdsSkuFile(importDir);
  if (!picked) {
    return {
      importDir,
      ok: true,
      skipped: true,
      reason: "portal-imports 无 ads_sku_*.csv",
    };
  }
  if (
    opts?.notBeforeMs != null &&
    picked.mtimeMs < opts.notBeforeMs
  ) {
    return {
      importDir,
      ok: true,
      skipped: true,
      reason: "最新 ads 文件早于本次导出，未入库旧表",
      fileName: picked.fileName,
      fileMtime: new Date(picked.mtimeMs).toISOString(),
    };
  }

  const content = readFileSync(picked.filePath, "utf8");
  const st = statSync(picked.filePath);
  const hash = fileHash(content);
  const imported = importPortalFileByName(state, picked.fileName, content);
  for (let i = 0; i < 50; i++) {
    const { processed } = await processPendingInbox(state, 200);
    if (!processed) break;
  }

  const index = loadIndex(importDir);
  const key = picked.fileName.toLowerCase();
  index.files[key] = {
    key,
    filename: picked.fileName,
    domain: "ads",
    mtimeMs: st.mtimeMs,
    size: st.size,
    hash,
    ingestedAt: new Date().toISOString(),
    count: imported.count,
  };
  saveIndex(importDir, index);
  state.noon.portal.lastImportAt = new Date().toISOString();
  state.noon.portal.lastImportSummary =
    `广告权威源 ${picked.fileName} · 行${imported.count} · 报表${picked.reportFrom ?? "?"}→${picked.reportTo ?? "?"}`;
  saveState(state);

  return {
    importDir,
    ok: true,
    skipped: false,
    fileName: picked.fileName,
    filePath: picked.filePath,
    fileMtime: new Date(st.mtimeMs).toISOString(),
    reportFrom: picked.reportFrom,
    reportTo: picked.reportTo,
    count: imported.count,
  };
}

export type LatestSalesIngestResult = {
  importDir: string;
  ok: boolean;
  skipped: boolean;
  reason?: string;
  fileName?: string;
  count?: number;
  reportFrom?: string | null;
  reportTo?: string | null;
};

/**
 * 补货/销量权威源：只强制入库最新 sales_export_*.csv。
 * live 店不走 force 全目录，避免把旧 FBN 影刀表盖进库存。
 */
export async function ingestLatestSalesFile(
  state: AppState,
  opts?: { notBeforeMs?: number },
): Promise<LatestSalesIngestResult> {
  const importDir = getImportDir();
  if (!existsSync(importDir)) mkdirSync(importDir, { recursive: true });

  const picked = pickLatestSalesExportFile(importDir);
  if (!picked) {
    return {
      importDir,
      ok: true,
      skipped: true,
      reason: "portal-imports 无 sales_export_*.csv",
    };
  }
  if (
    opts?.notBeforeMs != null &&
    picked.mtimeMs < opts.notBeforeMs
  ) {
    return {
      importDir,
      ok: true,
      skipped: true,
      reason: "最新 sales 文件早于本次导出，未入库旧表",
      fileName: picked.fileName,
    };
  }

  const content = readFileSync(picked.filePath, "utf8");
  const st = statSync(picked.filePath);
  const hash = fileHash(content);
  const imported = importPortalFileByName(state, picked.fileName, content);
  for (let i = 0; i < 50; i++) {
    const { processed } = await processPendingInbox(state, 200);
    if (!processed) break;
  }

  const index = loadIndex(importDir);
  const key = picked.fileName.toLowerCase();
  index.files[key] = {
    key,
    filename: picked.fileName,
    domain: "sales",
    mtimeMs: st.mtimeMs,
    size: st.size,
    hash,
    ingestedAt: new Date().toISOString(),
    count: imported.count,
  };
  saveIndex(importDir, index);
  state.noon.portal.lastImportAt = new Date().toISOString();
  state.noon.portal.lastImportSummary =
    `销量权威源 ${picked.fileName} · 行${imported.count} · 报表${picked.reportFrom ?? "?"}→${picked.reportTo ?? "?"}`;
  saveState(state);

  return {
    importDir,
    ok: true,
    skipped: false,
    fileName: picked.fileName,
    count: imported.count,
    reportFrom: picked.reportFrom,
    reportTo: picked.reportTo,
  };
}

/** mtime 最新；同秒则取文件名 toDate、再 fromDate 更大者 */
export function pickLatestSalesExportFile(importDir?: string): {
  fileName: string;
  filePath: string;
  mtimeMs: number;
  reportFrom: string | null;
  reportTo: string | null;
} | null {
  const dir = importDir ?? getImportDir();
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter(
    (n) => /^sales_export_.*\.csv$/i.test(n) && !n.startsWith("."),
  );
  if (!names.length) return null;

  type Cand = {
    fileName: string;
    filePath: string;
    mtimeMs: number;
    reportFrom: string | null;
    reportTo: string | null;
  };
  const cands: Cand[] = [];
  for (const name of names) {
    const filePath = join(dir, name);
    try {
      const st = statSync(filePath);
      const m = name.match(
        /sales_export_(20\d{2}-\d{2}-\d{2}).{0,3}(20\d{2}-\d{2}-\d{2})/i,
      );
      cands.push({
        fileName: name,
        filePath,
        mtimeMs: st.mtimeMs,
        reportFrom: m?.[1] ?? null,
        reportTo: m?.[2] ?? null,
      });
    } catch {
      // skip
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    const bt = b.reportTo ?? "";
    const at = a.reportTo ?? "";
    if (bt !== at) return bt > at ? 1 : -1;
    const bf = b.reportFrom ?? "";
    const af = a.reportFrom ?? "";
    if (bf !== af) return bf > af ? 1 : -1;
    return b.fileName.localeCompare(a.fileName);
  });
  return cands[0]!;
}

/** mtime 最新；同秒则取文件名 toDate、再 fromDate 更大者 */
export function pickLatestAdsSkuFile(importDir?: string): {
  fileName: string;
  filePath: string;
  mtimeMs: number;
  reportFrom: string | null;
  reportTo: string | null;
} | null {
  const dir = importDir ?? getImportDir();
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter(
    (n) => /^ads_sku_.*\.csv$/i.test(n) && !n.startsWith("."),
  );
  if (!names.length) return null;

  type Cand = {
    fileName: string;
    filePath: string;
    mtimeMs: number;
    reportFrom: string | null;
    reportTo: string | null;
  };
  const cands: Cand[] = [];
  for (const name of names) {
    const filePath = join(dir, name);
    try {
      const st = statSync(filePath);
      const m = name.match(
        /ads_sku_(20\d{2}-\d{2}-\d{2}).{0,3}(20\d{2}-\d{2}-\d{2})/i,
      );
      cands.push({
        fileName: name,
        filePath,
        mtimeMs: st.mtimeMs,
        reportFrom: m?.[1] ?? null,
        reportTo: m?.[2] ?? null,
      });
    } catch {
      // skip
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    const bt = b.reportTo ?? "";
    const at = a.reportTo ?? "";
    if (bt !== at) return bt > at ? 1 : -1;
    const bf = b.reportFrom ?? "";
    const af = a.reportFrom ?? "";
    if (bf !== af) return bf > af ? 1 : -1;
    return b.fileName.localeCompare(a.fileName);
  });
  return cands[0]!;
}

/** 启动时 + 定时扫目录 */
export function startImportDirWatcher(
  getState: () => AppState,
  intervalMs = 60_000,
) {
  const tick = () => {
    void runAutoIngest(getState()).catch((err) => {
      console.error("[auto-ingest]", err);
    });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log(
    `[auto-ingest] watching ${getImportDir()} every ${intervalMs}ms`,
  );
  return () => clearInterval(timer);
}
