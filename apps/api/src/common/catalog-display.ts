import type { AppState } from "./types.js";

export type CatalogDisplay = {
  title: string;
  imageUrl: string;
  /** Catalog 侧 Partner SKU（若有） */
  partnerSku?: string;
  /** Noon SKU，便于对照货架 */
  noonSku?: string;
};

/**
 * 展示索引：同时按 partnerSku 与 noonSku 挂载。
 * 广告 CSV 常把 Noon SKU 写进 partnerSku 列，需靠 noonSku 反查图/名。
 */
export function buildCatalogDisplayMap(
  state: AppState,
): Map<string, CatalogDisplay> {
  const map = new Map<string, CatalogDisplay>();
  for (const c of state.catalog) {
    const display: CatalogDisplay = {
      title: c.title || "",
      imageUrl: c.imageUrl || "",
      partnerSku: c.partnerSku,
      noonSku: (c.noonSku || "").trim() || undefined,
    };
    if (c.partnerSku) map.set(c.partnerSku, display);
    const noon = (c.noonSku || "").trim();
    if (noon && noon !== c.partnerSku) {
      // 已有 partner 命中时不覆盖；广告键多为 noonSku
      if (!map.has(noon)) map.set(noon, display);
    }
  }
  return map;
}

export function catalogDisplayOf(
  map: Map<string, CatalogDisplay>,
  partnerSku: string,
  fallbackTitle = "",
): CatalogDisplay {
  const key = (partnerSku || "").trim();
  const hit = key ? map.get(key) : undefined;
  return {
    title: hit?.title || fallbackTitle || "",
    imageUrl: hit?.imageUrl || "",
    partnerSku: hit?.partnerSku,
    noonSku: hit?.noonSku,
  };
}

export function hasHan(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/**
 * 运营展示品名：优先含汉字的候选（装箱表/飞书/采购），否则取第一个非空。
 * Catalog 站内标题多为英文，不宜压过中文采购名。
 */
export function preferChineseTitle(
  ...candidates: Array<string | null | undefined>
): string {
  const cleaned = candidates
    .map((c) => (c ?? "").trim())
    .filter(Boolean);
  return cleaned.find(hasHan) ?? cleaned[0] ?? "";
}
