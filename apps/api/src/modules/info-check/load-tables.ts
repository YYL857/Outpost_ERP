/**
 * 信息检查：从飞书 raw 最新快照按 PSKU 建索引（只读）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getFeishuRawDir } from "../../platforms/feishu/config.js";
import {
  cellText,
  headerIndexMap,
  isValidPartnerSku,
} from "../../platforms/feishu/normalize/cells.js";
import {
  buildLookupMaps,
  reconstructPsku,
} from "../../platforms/feishu/normalize/product.js";
import type {
  FeishuRawSheet,
  FeishuRawSnapshot,
} from "../../platforms/feishu/types.js";
import type {
  InfoCheckBundle,
  InfoCheckDocId,
  InfoCheckTableIndex,
} from "./types.js";
import { INFO_CHECK_DOC_IDS } from "./types.js";
import { buildCommonFields } from "./field-aliases.js";

/** 对齐键列名（优先级从上到下） */
const JOIN_KEY_PREFERRED = [
  "PSKU",
  "psku",
  "Psku",
  "partner_sku",
  "partnerSku",
  "Partner SKU",
  "PartnerSKU",
] as const;
const JOIN_KEY_FALLBACK = ["SKU", "sku"] as const;
const JOIN_KEY_ALL = new Set<string>([...JOIN_KEY_PREFERRED, ...JOIN_KEY_FALLBACK]);

function findJoinCol(
  headers: Map<string, number>,
): { index: number; name: string } | null {
  for (const name of JOIN_KEY_PREFERRED) {
    const i = headers.get(name);
    if (i != null) return { index: i, name };
  }
  for (const name of JOIN_KEY_FALLBACK) {
    const i = headers.get(name);
    if (i != null) return { index: i, name };
  }
  return null;
}

function rawDirCandidates(): string[] {
  const primary = getFeishuRawDir();
  const shared = resolve(
    process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data",
    "feishu-raw",
  );
  const fromShop = resolve(primary, "..", "..", "..", "feishu-raw");
  return [...new Set([primary, shared, fromShop])];
}

/** 某 docId 最新 snapshot.json 路径 */
export function findLatestSnapshotPath(docId: string): string | null {
  for (const dir of rawDirCandidates()) {
    const lastPath = join(dir, "last-run.json");
    if (existsSync(lastPath)) {
      try {
        const last = JSON.parse(readFileSync(lastPath, "utf8")) as {
          runId?: string;
        };
        if (last.runId) {
          const path = join(dir, "runs", last.runId, docId, "snapshot.json");
          if (existsSync(path)) return path;
        }
      } catch {
        /* next */
      }
    }
    const runsDir = join(dir, "runs");
    if (!existsSync(runsDir)) continue;
    try {
      const runs = readdirSync(runsDir)
        .map((name) => {
          const path = join(runsDir, name, docId, "snapshot.json");
          if (!existsSync(path)) return null;
          return { path, mtime: statSync(path).mtimeMs };
        })
        .filter(Boolean) as Array<{ path: string; mtime: number }>;
      runs.sort((a, b) => b.mtime - a.mtime);
      if (runs[0]) return runs[0].path;
    } catch {
      /* next */
    }
  }
  return null;
}

export function loadSnapshotFile(path: string): FeishuRawSnapshot | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FeishuRawSnapshot;
  } catch {
    return null;
  }
}

function findSheet(
  snap: FeishuRawSnapshot,
  title: string,
): FeishuRawSheet | undefined {
  return snap.sheets.find((s) => s.title === title);
}

function rowToRecord(
  row: unknown[],
  headers: Map<string, number>,
  fieldNames: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of fieldNames) {
    const i = headers.get(name);
    if (i == null) continue;
    out[name] = cellText(row[i]);
  }
  return out;
}

/** 产品表字段：去掉 PSKU 公式列，保留 SKU 等业务列 */
function productFieldNames(headers: Map<string, number>): string[] {
  return [...headers.keys()].filter(
    (h) => h && h !== "PSKU" && h !== "psku" && h !== "Psku",
  );
}

function genericFieldNames(headers: Map<string, number>): string[] {
  return [...headers.keys()].filter((h) => h && !JOIN_KEY_ALL.has(h));
}

/** 产品表：以「产品」为主表，PSKU 走 reconstruct */
export function indexProductSnapshot(
  snap: FeishuRawSnapshot,
): Omit<InfoCheckTableIndex, "docId" | "label" | "snapshotPath"> {
  const product = findSheet(snap, "产品") ?? snap.sheets[0];
  if (!product || product.values.length < 2) {
    return { pulledAt: snap.pulledAt, headers: [], byPsku: new Map() };
  }

  const headers = headerIndexMap(product.values[0] ?? []);
  const { colorCode, storeSite } = buildLookupMaps(findSheet(snap, "查找代码表"));
  const fieldNames = productFieldNames(headers);
  const byPsku = new Map<string, Record<string, string>>();

  for (let r = 1; r < product.values.length; r++) {
    const row = product.values[r] ?? [];
    const psku = reconstructPsku(row, headers, colorCode, storeSite);
    if (!psku || !isValidPartnerSku(psku)) continue;
    if (byPsku.has(psku)) continue;
    byPsku.set(psku, rowToRecord(row, headers, fieldNames));
  }

  return {
    pulledAt: snap.pulledAt,
    headers: fieldNames,
    byPsku,
  };
}

function sameHeaderSchema(sheets: FeishuRawSheet[]): boolean {
  if (sheets.length <= 1) return true;
  const sig = (s: FeishuRawSheet) =>
    genericFieldNames(headerIndexMap(s.values[0] ?? []))
      .slice()
      .sort()
      .join("\0");
  const first = sig(sheets[0]!);
  return sheets.every((s) => sig(s) === first);
}

/**
 * 通用表：识别 PSKU / partner_sku / SKU；
 * 多 sheet 且表头一致时按 PSKU 合并（不前缀）；表头不一致时加 sheet. 前缀
 */
export function indexGenericSnapshot(
  snap: FeishuRawSnapshot,
  sheetTitles?: string[],
): Omit<InfoCheckTableIndex, "docId" | "label" | "snapshotPath"> {
  const want = sheetTitles?.length
    ? new Set(sheetTitles.map((t) => t.trim()))
    : null;
  const sheets = snap.sheets.filter((s) => {
    if (want && !want.has(s.title)) return false;
    if (!s.values?.length) return false;
    return findJoinCol(headerIndexMap(s.values[0] ?? [])) != null;
  });

  const byPsku = new Map<string, Record<string, string>>();
  const headerSet = new Set<string>();
  const prefixFields = sheets.length > 1 && !sameHeaderSchema(sheets);

  for (const sheet of sheets) {
    const headers = headerIndexMap(sheet.values[0] ?? []);
    const join = findJoinCol(headers);
    if (!join) continue;
    const rawNames = genericFieldNames(headers);

    for (let r = 1; r < sheet.values.length; r++) {
      const row = sheet.values[r] ?? [];
      const psku = cellText(row[join.index]);
      if (!isValidPartnerSku(psku)) continue;
      const prev = byPsku.get(psku) ?? {};
      for (const name of rawNames) {
        const i = headers.get(name);
        if (i == null) continue;
        const key = prefixFields ? `${sheet.title}.${name}` : name;
        const val = cellText(row[i]);
        // 同 schema 多店表：后写覆盖前写；空值不覆盖已有
        if (val === "" && prev[key]) continue;
        prev[key] = val;
        headerSet.add(key);
      }
      byPsku.set(psku, prev);
    }
  }

  return {
    pulledAt: snap.pulledAt,
    headers: [...headerSet],
    byPsku,
  };
}

function emptyTable(
  docId: InfoCheckDocId,
  label: string,
): InfoCheckTableIndex {
  return {
    docId,
    label,
    pulledAt: null,
    snapshotPath: null,
    headers: [],
    byPsku: new Map(),
  };
}

const DOC_LABELS: Record<InfoCheckDocId, string> = {
  product: "产品表",
  "monthly-deals": "月度Deals表",
  "info-check": "信息检查表",
};

function loadOneTable(docId: InfoCheckDocId): InfoCheckTableIndex {
  const path = findLatestSnapshotPath(docId);
  if (!path) return emptyTable(docId, DOC_LABELS[docId]);
  const snap = loadSnapshotFile(path);
  if (!snap) return emptyTable(docId, DOC_LABELS[docId]);

  const indexed =
    docId === "product"
      ? indexProductSnapshot(snap)
      : indexGenericSnapshot(snap);

  return {
    docId,
    label: snap.docLabel || DOC_LABELS[docId],
    snapshotPath: path,
    pulledAt: indexed.pulledAt,
    headers: indexed.headers,
    byPsku: indexed.byPsku,
  };
}

/** 加载三表索引；缺快照时为空表 */
export function loadInfoCheckBundle(): InfoCheckBundle {
  const product = loadOneTable("product");
  const monthlyDeals = loadOneTable("monthly-deals");
  const infoCheck = loadOneTable("info-check");

  const commonFields = buildCommonFields([
    product.headers,
    monthlyDeals.headers,
    infoCheck.headers,
  ]);

  return { product, monthlyDeals, infoCheck, commonFields };
}

export function sourceKeyOf(docId: InfoCheckDocId) {
  if (docId === "product") return "product" as const;
  if (docId === "monthly-deals") return "monthlyDeals" as const;
  return "infoCheck" as const;
}

export { INFO_CHECK_DOC_IDS };
