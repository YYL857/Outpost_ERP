/** Catalog 图/名是否足以当「有展示数据」 */
export type ProductDisplayFields = {
  partnerSku: string;
  title?: string | null;
  imageUrl?: string | null;
};

export function hasProductDisplay(r: ProductDisplayFields): boolean {
  const title = (r.title || "").trim();
  const sku = (r.partnerSku || "").trim();
  if ((r.imageUrl || "").trim()) return true;
  if (title && title !== "—" && title.toLowerCase() !== sku.toLowerCase()) {
    return true;
  }
  return false;
}

export function defaultProductMatch(
  r: ProductDisplayFields,
  needle: string,
): boolean {
  const n = needle.toLowerCase();
  return (
    r.partnerSku.toLowerCase().includes(n) ||
    (r.title || "").toLowerCase().includes(n)
  );
}

/**
 * 默认只留有图/有标题的行；有搜索词时按匹配召回（含无展示数据）。
 * 结果始终：有展示数据的在前。
 */
export function filterProductDisplayRows<T extends ProductDisplayFields>(
  rows: T[],
  query: string,
  opts?: {
    match?: (r: T, needle: string) => boolean;
    compare?: (a: T, b: T) => number;
  },
): { visible: T[]; hiddenCount: number; searching: boolean } {
  const needle = query.trim();
  const searching = Boolean(needle);
  const hiddenCount = rows.filter((r) => !hasProductDisplay(r)).length;
  const match = opts?.match ?? defaultProductMatch;
  const list = rows.filter((r) => {
    if (searching) return match(r, needle);
    return hasProductDisplay(r);
  });
  list.sort((a, b) => {
    const d = Number(hasProductDisplay(b)) - Number(hasProductDisplay(a));
    if (d !== 0) return d;
    return opts?.compare?.(a, b) ?? 0;
  });
  return { visible: list, hiddenCount, searching };
}
