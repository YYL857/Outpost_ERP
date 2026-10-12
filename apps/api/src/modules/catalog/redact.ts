/**
 * 对无 catalog.cost 能力的角色脱敏：去掉采购成本与利润测算。
 * 保留售价、库存、尺寸等运营可见字段。
 */
export function redactCatalogRowsForRole<T>(
  rows: T[],
  canSeeCost: boolean,
): T[] {
  if (canSeeCost) return rows;
  return rows.map((row) => redactOne(row));
}

function redactOne<T>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const r = row as Record<string, unknown>;
  const next: Record<string, unknown> = { ...r };

  if (r.specs && typeof r.specs === "object") {
    next.specs = { ...(r.specs as object), purchaseCost: null };
  }
  if (r.profit && typeof r.profit === "object") {
    next.profit = {
      margin: null,
      sar: null,
      rmb: null,
      afterPurchase: null,
      adsNet7d: (r.profit as { adsNet7d?: unknown }).adsNet7d ?? null,
    };
  }
  if (r.local && typeof r.local === "object") {
    const local = r.local as Record<string, unknown>;
    next.local = {
      ...local,
      hasCost: false,
      costSource: null,
      costUpdatedAt: null,
      align:
        local.hasDims || local.dimsSource
          ? local.align === "matched"
            ? "partial"
            : local.align
          : "missing",
    };
  }
  next.costRedacted = true;
  return next as T;
}
