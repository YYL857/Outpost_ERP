/**
 * 补货表：按店装配 → 写本地 xlsx → 供前端读取。
 */
import { loadShopPrefixMap } from "../../warehouse-booking/pack-ticket.js";
import { getShopState } from "../../../shops/state-cache.js";
import { loadRegistry } from "../../../shops/registry.js";
import {
  buildWorkbookRows,
  clampCoverMonths,
  DEFAULT_COVER_MONTHS,
} from "./build.js";

export { clampCoverMonths, DEFAULT_COVER_MONTHS };
import { loadAsnTransitBySku } from "./asn-transit.js";
import {
  listWorkbookFiles,
  readManualOverrides,
  replenishWorkbookDir,
  workbookPathForPrefix,
  writeWorkbookFile,
} from "./xlsx.js";
import {
  MANUAL_TAG_OPTIONS,
  workbookFormulaNote,
  WORKBOOK_SHEET_TITLE,
  type ReplenishWorkbookDoc,
  type ReplenishWorkbookRow,
} from "./types.js";
import type { ManualOverride } from "./build.js";

export type RebuildResult = {
  docs: ReplenishWorkbookDoc[];
  dir: string;
  generatedAt: string;
};

function shopByProject(projectCode: string) {
  const reg = loadRegistry();
  return (
    reg.shops.find(
      (s) => s.projectCode.toUpperCase() === projectCode.toUpperCase(),
    ) ?? null
  );
}

/** 默认重建 N1/N2；可传 prefixes=["N1"]；coverMonths 默认 3 */
export function rebuildWorkbooks(opts?: {
  prefixes?: string[];
  coverMonths?: number;
}): RebuildResult {
  const prefixMap = loadShopPrefixMap();
  const allPrefixes = Object.keys(prefixMap).sort();
  const want = (opts?.prefixes?.length
    ? opts.prefixes
    : allPrefixes.filter((p) => p === "N1" || p === "N2")
  ).map((p) => p.toUpperCase());
  const coverMonths = clampCoverMonths(
    opts?.coverMonths ?? DEFAULT_COVER_MONTHS,
  );

  const generatedAt = new Date().toISOString();
  const docs: ReplenishWorkbookDoc[] = [];

  for (const prefix of want) {
    const projectCode = prefixMap[prefix];
    if (!projectCode) continue;
    const shop = shopByProject(projectCode);
    if (!shop) continue;

    const state = getShopState(shop.id);
    const filePath = workbookPathForPrefix(prefix);
    const manualBySku = readManualOverrides(filePath);
    const transitBySku = loadAsnTransitBySku([prefix]);
    const rows = buildWorkbookRows({
      state,
      shopPrefix: prefix,
      coverMonths,
      manualBySku,
      transitBySku,
    });
    const { meta } = writeWorkbookFile({
      shopPrefix: prefix,
      rows,
      meta: {
        shopPrefix: prefix,
        shopId: shop.id,
        shopName: shop.name,
        projectCode: shop.projectCode,
        sheetTitle: WORKBOOK_SHEET_TITLE,
        generatedAt,
        formulaNote: workbookFormulaNote(coverMonths),
      },
    });
    docs.push({ meta, rows });
  }

  return { docs, dir: replenishWorkbookDir(), generatedAt };
}

/** 读已落盘表并按备货月数重算；无文件则现场 rebuild 该前缀 */
export function loadWorkbookDoc(
  shopPrefix: string,
  opts?: { rebuildIfMissing?: boolean; coverMonths?: number },
): ReplenishWorkbookDoc | null {
  const prefix = shopPrefix.trim().toUpperCase();
  const coverMonths = clampCoverMonths(
    opts?.coverMonths ?? DEFAULT_COVER_MONTHS,
  );
  const filePath = workbookPathForPrefix(prefix);
  const listed = listWorkbookFiles().find((f) => f.shopPrefix === prefix);

  if (!listed && opts?.rebuildIfMissing !== false) {
    const rebuilt = rebuildWorkbooks({ prefixes: [prefix], coverMonths });
    return rebuilt.docs.find((d) => d.meta.shopPrefix === prefix) ?? null;
  }
  if (!listed) return null;

  // 用内存重算保证与库存/销量一致；人工列从磁盘合并
  const prefixMap = loadShopPrefixMap();
  const projectCode = prefixMap[prefix];
  if (!projectCode) return null;
  const shop = shopByProject(projectCode);
  if (!shop) return null;
  const state = getShopState(shop.id);
  const manualBySku = readManualOverrides(filePath);
  const rows = buildWorkbookRows({
    state,
    shopPrefix: prefix,
    coverMonths,
    manualBySku,
    transitBySku: loadAsnTransitBySku([prefix]),
  });
  return {
    meta: {
      shopPrefix: prefix,
      shopId: shop.id,
      shopName: shop.name,
      projectCode: shop.projectCode,
      filePath,
      sheetTitle: WORKBOOK_SHEET_TITLE,
      generatedAt: new Date(listed.mtimeMs).toISOString(),
      rowCount: rows.length,
      needCount: rows.filter((r) => r.needReplenish).length,
      formulaNote: workbookFormulaNote(coverMonths),
    },
    rows,
  };
}

export function filterWorkbookRows(
  rows: ReplenishWorkbookRow[],
  opts: {
    q?: string;
    onlyNeed?: boolean;
    /** 仅排名前 pct%（有销量的池子）；0/空=不过滤 */
    topPct?: number;
  },
): ReplenishWorkbookRow[] {
  let out = rows;
  if (opts.onlyNeed) {
    out = out.filter((r) => r.needReplenish);
  }
  const topPct = opts.topPct;
  if (topPct != null && topPct > 0 && topPct < 100) {
    const ranked = out.filter((r) => r.salesRank != null);
    const maxRank = ranked.length
      ? Math.max(...ranked.map((r) => r.salesRank!))
      : 0;
    const cutoff = Math.max(1, Math.ceil((maxRank * topPct) / 100));
    out = out.filter(
      (r) => r.salesRank != null && r.salesRank <= cutoff,
    );
  }
  const needle = (opts.q ?? "").trim().toLowerCase();
  if (needle) {
    out = out.filter((r) => {
      const blob = `${r.partnerSku} ${r.title} ${r.note} ${r.manualTag}`.toLowerCase();
      return blob.includes(needle);
    });
  }
  return out;
}

export function listWorkbookBrief() {
  return {
    dir: replenishWorkbookDir(),
    files: listWorkbookFiles(),
  };
}

export function manualTagOptions() {
  return MANUAL_TAG_OPTIONS.map((o) => ({ ...o }));
}

/**
 * 更新单 SKU 人工标记/备注并回写本地 xlsx（计算列同步重算）。
 */
export function patchWorkbookManual(opts: {
  shopPrefix: string;
  partnerSku: string;
  manualTag?: string;
  note?: string;
  coverMonths?: number;
}): ReplenishWorkbookDoc {
  const prefix = opts.shopPrefix.trim().toUpperCase();
  const psku = opts.partnerSku.trim();
  if (!psku) throw new Error("缺少 partnerSku");
  const coverMonths = clampCoverMonths(
    opts.coverMonths ?? DEFAULT_COVER_MONTHS,
  );

  const prefixMap = loadShopPrefixMap();
  const projectCode = prefixMap[prefix];
  if (!projectCode) throw new Error(`未知店前缀 ${prefix}`);
  const shop = shopByProject(projectCode);
  if (!shop) throw new Error(`未注册店铺 ${projectCode}`);

  const filePath = workbookPathForPrefix(prefix);
  const manualBySku = readManualOverrides(filePath);
  const prev = manualBySku.get(psku) ?? { manualTag: "", note: "" };
  const next: ManualOverride = {
    manualTag:
      opts.manualTag !== undefined ? String(opts.manualTag).trim() : prev.manualTag,
    note: opts.note !== undefined ? String(opts.note).trim() : prev.note,
  };
  if (!next.manualTag && !next.note) manualBySku.delete(psku);
  else manualBySku.set(psku, next);

  const state = getShopState(shop.id);
  const generatedAt = new Date().toISOString();
  const rows = buildWorkbookRows({
    state,
    shopPrefix: prefix,
    coverMonths,
    manualBySku,
    transitBySku: loadAsnTransitBySku([prefix]),
  });
  const { meta } = writeWorkbookFile({
    shopPrefix: prefix,
    rows,
    meta: {
      shopPrefix: prefix,
      shopId: shop.id,
      shopName: shop.name,
      projectCode: shop.projectCode,
      sheetTitle: WORKBOOK_SHEET_TITLE,
      generatedAt,
      formulaNote: workbookFormulaNote(coverMonths),
    },
  });
  return { meta, rows };
}
