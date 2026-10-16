/**
 * live 模式 Impex 域选择：填缺口 + 过期 Catalog/库存定期重拉。
 * 补货决策需要 FBN/Supermall 分仓库存 → 空或过期时拉 stock（Detailed ledger）。
 * 库存日更两次由 stock-scheduler 负责；此处 stale 为安全网，且订单落后时优先 orders。
 */
import type { AppState, StockItem } from "../../common/types.js";
import type { NoonStockDto } from "../../platforms/noon/types.js";
import { resolveLagExpectedEnd, shanghaiYmd } from "./gap-audit.js";

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
 * 默认 14h（配合上海 09:30/16:00 日更两次，避免 6h 插队饿死 orders）；
 * 可用 OUTPOST_LIVE_STOCK_REFRESH_MS 覆盖（毫秒，下限 1h）。
 */
export function stockRefreshStaleMs(): number {
  const raw = Number(process.env.OUTPOST_LIVE_STOCK_REFRESH_MS ?? "");
  const fallback = 14 * 60 * 60 * 1000;
  const ms = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(60 * 60 * 1000, ms);
}

/** 订单游标落后多久视为需插队补拉（默认 18h） */
export function ordersRefreshStaleMs(): number {
  const raw = Number(process.env.OUTPOST_LIVE_ORDERS_STALE_MS ?? "");
  const fallback = 18 * 60 * 60 * 1000;
  const ms = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(60 * 60 * 1000, ms);
}

function orderPlacedYmd(placedAt: string | undefined | null): string | null {
  if (!placedAt) return null;
  const t = Date.parse(placedAt);
  if (!Number.isFinite(t)) return null;
  return shanghaiYmd(new Date(t));
}

/**
 * 订单需插队：无单、最大下单日落后于期望截止、或 ordersSince 过旧。
 * 用于防止 catalog/stock 刷新长期占住 Impex 轮转。
 */
export function needsOrdersCatchUp(
  state: AppState,
  nowMs = Date.now(),
): boolean {
  if ((state.orders?.length ?? 0) === 0) return true;
  let maxDate: string | null = null;
  for (const o of state.orders ?? []) {
    const d = orderPlacedYmd(o.placedAt);
    if (d && (!maxDate || d > maxDate)) maxDate = d;
  }
  const expectedEnd = resolveLagExpectedEnd(new Date(nowMs));
  if (!maxDate || maxDate < expectedEnd) return true;
  const since = state.cursors?.ordersSince;
  // 日历已覆盖期望截止且无游标：不单凭 null 插队（避免误伤轮转）
  if (!since) return false;
  const ms = Date.parse(since);
  if (Number.isNaN(ms)) return false;
  return nowMs - ms >= ordersRefreshStaleMs();
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
 * 轮询单域：空 Catalog 优先；订单落后插队；再 Catalog/库存过期；否则 sales→fees→orders。
 */
export function pickLivePollDomain(
  state: AppState,
  rotate: number,
  nowMs = Date.now(),
): LiveImpexDomain {
  if (state.catalog.length === 0) return "catalog";
  if (needsOrdersCatchUp(state, nowMs)) return "orders";
  if (needsCatalogImpexRefresh(state, nowMs)) return "catalog";
  if (needsStockImpexRefresh(state, nowMs)) return "stock";
  if (state.salesFacts.length === 0) return "sales";
  if (state.feeSnapshots.length === 0) return "fees";
  const cycle = ["sales", "fees", "orders"] as const;
  return cycle[rotate % cycle.length]!;
}

/**
 * 汇总同步每次最多 2 域：订单落后优先；再补 stock/catalog 缺口。
 */
export function pickLiveImpexDomains(
  state: AppState,
  nowMs = Date.now(),
): LiveImpexDomain[] {
  if (state.catalog.length === 0) return ["catalog"];
  const out: LiveImpexDomain[] = [];
  if (needsOrdersCatchUp(state, nowMs)) out.push("orders");
  if (needsStockImpexRefresh(state, nowMs) && out.length < 2) out.push("stock");
  if (state.salesFacts.length === 0 && out.length < 2) out.push("sales");
  if (
    state.feeSnapshots.length === 0 &&
    out.length < 2 &&
    !out.includes("sales")
  ) {
    out.push("fees");
  }
  if (out.length === 0) {
    if (needsCatalogImpexRefresh(state, nowMs)) {
      out.push("catalog", "sales");
    } else {
      out.push("sales", "fees");
    }
  } else if (
    out.length === 1 &&
    needsCatalogImpexRefresh(state, nowMs) &&
    !out.includes("catalog")
  ) {
    out.unshift("catalog");
  } else if (out.length === 1 && state.orders.length === 0 && !out.includes("orders")) {
    out.push("orders");
  }
  return out.slice(0, 2);
}
