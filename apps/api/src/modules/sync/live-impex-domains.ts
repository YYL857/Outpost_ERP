/**
 * live 模式 Impex 域选择：填缺口 + 过期 Catalog/库存定期重拉。
 * 补货决策需要 FBN/Supermall 分仓库存 → 空或过期时拉 stock（Detailed ledger）。
 */
import type { AppState, StockItem } from "../../common/types.js";
import type { NoonStockDto } from "../../platforms/noon/types.js";

export type LiveImpexDomain =
  | "catalog"
  | "orders"
  | "sales"
  | "fees"
  | "stock";

/** Catalog 导出塞进的汇总假仓位（非 Impex 分仓 ledger） */
export function isCatalogStockHintWarehouse(warehouseCode: string | undefined | null): boolean {
  const w = String(warehouseCode ?? "").trim().toUpperCase();
  return w === "FBN" || w === "FBP";
}

/** 是否已有真·分仓 ledger（排除 Catalog 假仓 FBN/FBP） */
export function hasRealStockLedger(stock: StockItem[] | undefined): boolean {
  return (stock ?? []).some(
    (s) =>
      !isCatalogStockHintWarehouse(s.warehouseCode) &&
      (s.fulfillment === "fbn" ||
        s.fulfillment === "supermall" ||
        s.fulfillment === "transit"),
  );
}

/** 清掉 Catalog 顺带写入的假仓行，避免与 RUH01S 等真仓重复加总 */
export function stripCatalogStockHintRows(state: AppState): number {
  const before = state.stock.length;
  state.stock = state.stock.filter(
    (s) => !isCatalogStockHintWarehouse(s.warehouseCode),
  );
  return before - state.stock.length;
}

/**
 * 全量 ledger 快照入库前：去掉 Catalog 假仓，并清掉旧 FBN/supermall/transit，
 * 只保留真 FBP 卖家仓（避免已清零仓位残留、假仓与真仓双计）。
 * @deprecated 快照请用 applyStockLedgerSnapshot（原子替换，避免清空后 inbox duplicate 写不回）
 */
export function prepareStockLedgerSnapshot(state: AppState): number {
  const before = state.stock.length;
  stripCatalogStockHintRows(state);
  state.stock = state.stock.filter((s) => s.fulfillment === "fbp");
  return before - state.stock.length;
}

function mapStockDto(dto: NoonStockDto): StockItem {
  return {
    partnerSku: dto.partner_sku,
    warehouseCode: dto.warehouse_code,
    fulfillment: dto.fulfillment ?? "unknown",
    qty: dto.qty,
    inTransitQty: dto.in_transit_qty ?? 0,
    updatedAt: dto.updated_at,
  };
}

/**
 * 全量 FBN ledger 原子写入：保留真 FBP，用本次 rows 替换其余仓存。
 * 不经 inbox 去重——库存是快照域，先清空再 enqueue 同 eventId 会标 duplicate 导致空仓。
 */
export function applyStockLedgerSnapshot(
  state: AppState,
  rows: NoonStockDto[],
): number {
  if (!rows.length) {
    throw new Error(
      "FBN 库存导出为空（Impex 失败或无行）：已保留现有 state.stock，未做快照覆盖",
    );
  }
  const fbpKept = (state.stock ?? []).filter(
    (s) =>
      s.fulfillment === "fbp" &&
      !isCatalogStockHintWarehouse(s.warehouseCode),
  );
  const byKey = new Map<string, StockItem>();
  for (const dto of rows) {
    const next = mapStockDto(dto);
    const key = `${next.partnerSku}\0${next.warehouseCode}\0${next.fulfillment}`;
    byKey.set(key, next);
  }
  const ledgerRows = [...byKey.values()];
  state.stock = [...fbpKept, ...ledgerRows];
  if (!state.portalCache) {
    state.portalCache = {
      orders: [],
      catalog: [],
      stock: [],
      sales: [],
      fees: [],
      ads: [],
      updatedAt: null,
    };
  }
  state.portalCache.stock = rows.map((r) => ({
    partner_sku: r.partner_sku,
    warehouse_code: r.warehouse_code,
    qty: r.qty,
    fulfillment: r.fulfillment,
    in_transit_qty: r.in_transit_qty,
    updated_at: r.updated_at,
  }));
  return ledgerRows.length;
}

/** 默认 12h；可用 OUTPOST_LIVE_CATALOG_REFRESH_MS 覆盖（毫秒，下限 1h） */
export function catalogRefreshStaleMs(): number {
  const raw = Number(process.env.OUTPOST_LIVE_CATALOG_REFRESH_MS ?? "");
  const fallback = 12 * 60 * 60 * 1000;
  const ms = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(60 * 60 * 1000, ms);
}

/**
 * 默认 6h（补货要新库存）；可用 OUTPOST_LIVE_STOCK_REFRESH_MS 覆盖（毫秒，下限 1h）。
 * 以前 24h 偏松，且曾被 Catalog 提示冒充「刚同步」。
 */
export function stockRefreshStaleMs(): number {
  const raw = Number(process.env.OUTPOST_LIVE_STOCK_REFRESH_MS ?? "");
  const fallback = 6 * 60 * 60 * 1000;
  const ms = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(60 * 60 * 1000, ms);
}

export function catalogLastImpexAt(state: AppState): string | null {
  const job = state.syncJobs.find((j) => j.domain === "catalog");
  return job?.lastSuccessAt ?? state.noon?.portal?.lastImportAt ?? null;
}

/**
 * 真·分仓库存上次 Impex 成功时间。
 * 只信 cursors.stockSince（仅 pullDomain("stock") 写入）；
 * 不信 syncJobs.stock.lastSuccessAt（曾被 Catalog 顺带提示刷新）。
 */
export function stockLastImpexAt(state: AppState): string | null {
  return state.cursors?.stockSince ?? null;
}

/** 当前仓存行里「真 ledger」最新业务时间（排除假仓 FBN/FBP） */
export function stockLedgerRowMaxAt(state: AppState): string | null {
  let best: string | null = null;
  for (const s of state.stock ?? []) {
    if (isCatalogStockHintWarehouse(s.warehouseCode)) continue;
    if (!s.updatedAt) continue;
    if (!best || s.updatedAt > best) best = s.updatedAt;
  }
  return best;
}

/** Catalog 为空或距上次 Impex 入库已超过阈值 → 需要重拉 */
export function needsCatalogImpexRefresh(
  state: AppState,
  nowMs = Date.now(),
): boolean {
  if (state.catalog.length === 0) return true;
  const at = catalogLastImpexAt(state);
  if (!at) return true;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return true;
  return nowMs - ms >= catalogRefreshStaleMs();
}

/**
 * 无仓存、缺少真分仓、或距上次 Detailed ledger 过久
 * → 拉 Detailed ledger（可还原 FBN vs Supermall）。
 */
export function needsStockImpexRefresh(
  state: AppState,
  nowMs = Date.now(),
): boolean {
  if (state.stock.length === 0) return true;
  if (!hasRealStockLedger(state.stock)) return true;
  const at = stockLastImpexAt(state);
  if (!at) return true;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return true;
  return nowMs - ms >= stockRefreshStaleMs();
}

/**
 * 轮询单域：空表优先填缺口；库存过期插队；否则 sales→fees→orders。
 */
export function pickLivePollDomain(
  state: AppState,
  rotate: number,
): LiveImpexDomain {
  if (state.catalog.length === 0) return "catalog";
  if (needsCatalogImpexRefresh(state)) return "catalog";
  if (needsStockImpexRefresh(state)) return "stock";
  if (state.salesFacts.length === 0) return "sales";
  if (state.feeSnapshots.length === 0) return "fees";
  const cycle = ["sales", "fees", "orders"] as const;
  return cycle[rotate % cycle.length]!;
}

/**
 * 汇总同步每次最多 2 域：先补缺口（含 stock）。
 */
export function pickLiveImpexDomains(state: AppState): LiveImpexDomain[] {
  if (state.catalog.length === 0) return ["catalog"];
  const out: LiveImpexDomain[] = [];
  if (needsStockImpexRefresh(state)) out.push("stock");
  if (state.salesFacts.length === 0 && out.length < 2) out.push("sales");
  if (
    state.feeSnapshots.length === 0 &&
    out.length < 2 &&
    !out.includes("sales")
  ) {
    out.push("fees");
  }
  if (out.length === 0) {
    if (needsCatalogImpexRefresh(state)) {
      out.push("catalog", "sales");
    } else {
      out.push("sales", "fees");
    }
  } else if (out.length === 1 && state.orders.length === 0) {
    out.push("orders");
  } else if (
    out.length === 1 &&
    needsCatalogImpexRefresh(state) &&
    !out.includes("catalog")
  ) {
    out.unshift("catalog");
  }
  return out.slice(0, 2);
}
