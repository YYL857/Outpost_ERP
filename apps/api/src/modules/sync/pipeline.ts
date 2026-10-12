import type {
  AppState,
  CatalogItem,
  FeeSnapshot,
  InboxEvent,
  NoonOrder,
  SalesFact,
  StockItem,
  SyncDomain,
  AdsFact,
} from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { createNoonClient } from "../../platforms/noon/index.js";
import {
  isImpexCoolingDown,
  isImpexLimitMessage,
  markImpexExportLimitHit,
} from "../../platforms/noon/impex-client.js";
import {
  upsertDimsGapFill,
  upsertFeeEstimate,
} from "../../platforms/noon/portal/gap-fill-ingest.js";
import type {
  CatalogFeeEstimateDto,
  FbnDimsDto,
} from "../../platforms/noon/portal/parsers.js";
import type {
  NoonAdsDto,
  NoonCatalogDto,
  NoonFeeDto,
  NoonOrderDto,
  NoonSalesDto,
  NoonStockDto,
} from "../../platforms/noon/types.js";
import { enqueueInbox } from "./inbox.js";
import { pushAlert } from "./alerts.js";
import {
  applyStockLedgerSnapshot,
  hasRealStockLedger,
  stripCatalogStockHintRows,
} from "./live-impex-domains.js";

/** Webhook / poller / 手动同步共用：同一时刻只跑一路 Inbox，避免并发整表导出 */
let inboxChain: Promise<unknown> = Promise.resolve();

function withInboxLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = inboxChain.then(fn, fn);
  inboxChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

type LiveNoonClientLike = {
  drainStockHints?: () => NoonStockDto[];
  drainFeeEstimateHints?: () => CatalogFeeEstimateDto[];
  drainFbnDimsHints?: () => FbnDimsDto[];
};

function toOrder(dto: NoonOrderDto): NoonOrder {
  return {
    orderNr: dto.order_nr,
    status: dto.status,
    currency: dto.currency,
    totalAmount: dto.total_amount,
    itemCount: dto.item_count,
    placedAt: dto.placed_at,
    updatedAt: dto.updated_at,
    rawVersion: dto.updated_at,
  };
}

export function upsertOrder(state: AppState, dto: NoonOrderDto) {
  const next = toOrder(dto);
  const idx = state.orders.findIndex((o) => o.orderNr === next.orderNr);
  if (idx < 0) {
    state.orders.unshift(next);
    return { applied: true, reason: "inserted" as const };
  }
  const prev = state.orders[idx];
  if (new Date(next.updatedAt).getTime() < new Date(prev.updatedAt).getTime()) {
    return { applied: false, reason: "stale" as const };
  }
  state.orders[idx] = next;
  return { applied: true, reason: "updated" as const };
}

export function upsertCatalog(state: AppState, dto: NoonCatalogDto) {
  const idx = state.catalog.findIndex((c) => c.partnerSku === dto.partner_sku);
  const prev = idx >= 0 ? state.catalog[idx] : null;
  const nowMs = Date.now();
  const incomingUpdated = sanitizeCatalogUpdatedAt(
    String(dto.updated_at ?? "").trim(),
    nowMs,
  );
  // 库内若是促销结束日等未来时间，视为无效版本，允许官方导出覆盖
  const prevIsAbsurd = Boolean(
    prev?.updatedAt && isAbsurdFutureCatalogTs(prev.updatedAt, nowMs),
  );
  if (
    prev &&
    prev.updatedAt &&
    !prevIsAbsurd &&
    new Date(incomingUpdated).getTime() < new Date(prev.updatedAt).getTime()
  ) {
    const activePrice = positiveActivePrice(dto.active_price);
    const listPrice = positiveActivePrice(dto.list_price);
    const stockFbnNet = optionalStockFbnNet(dto.stock_fbn_net);
    let touched = false;
    if (activePrice != null && prev.activePrice !== activePrice) {
      prev.activePrice = activePrice;
      touched = true;
    }
    if (listPrice != null && prev.listPrice !== listPrice) {
      prev.listPrice = listPrice;
      touched = true;
    }
    // 库存比 catalog updated_at 更常变：即使行版本偏旧也刷新 Active Net Stock
    if (stockFbnNet != null && prev.stockFbnNet !== stockFbnNet) {
      prev.stockFbnNet = stockFbnNet;
      touched = true;
    }
    return touched
      ? { applied: true, reason: "active_price" as const }
      : { applied: false, reason: "stale" as const };
  }
  const incomingImage = (dto.image_url ?? "").trim();
  const activePrice = positiveActivePrice(dto.active_price);
  const listPrice = positiveActivePrice(dto.list_price);
  const stockFbnNet = optionalStockFbnNet(dto.stock_fbn_net);
  const next: CatalogItem = {
    partnerSku: dto.partner_sku,
    title: dto.title,
    isActive: dto.is_active,
    noonSku: dto.noon_sku ?? "",
    // 导出常缺图：空值不覆盖已有 imageUrl
    imageUrl: incomingImage || prev?.imageUrl || "",
    price: dto.price ?? 0,
    activePrice: activePrice ?? prev?.activePrice ?? null,
    listPrice: listPrice ?? prev?.listPrice ?? null,
    currency: dto.currency || "SAR",
    listingType: dto.listing_type ?? "",
    source: "NOON",
    updatedAt: incomingUpdated,
    stockFbnNet: stockFbnNet ?? prev?.stockFbnNet ?? null,
  };
  if (idx < 0) {
    state.catalog.unshift(next);
    return { applied: true, reason: "inserted" as const };
  }
  state.catalog[idx] = { ...prev!, ...next };
  return { applied: true, reason: "updated" as const };
}

function positiveActivePrice(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100) / 100;
}

/** Catalog Active Net Stock · FBN；允许 0；缺省/非法 → null（不覆盖旧值） */
function optionalStockFbnNet(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) < 0) return null;
  return Math.floor(Number(v));
}

/** sale_end_date 等未来时间不可作版本号；超过「现在+1天」钳成入库时刻 */
function sanitizeCatalogUpdatedAt(raw: string, nowMs = Date.now()): string {
  const s = raw.trim();
  if (!s) return new Date(nowMs).toISOString();
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return new Date(nowMs).toISOString();
  if (isAbsurdFutureCatalogTs(s, nowMs)) return new Date(nowMs).toISOString();
  return new Date(t).toISOString();
}

function isAbsurdFutureCatalogTs(raw: string, nowMs = Date.now()): boolean {
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return true;
  return t > nowMs + 24 * 60 * 60 * 1000;
}

export function upsertStock(state: AppState, dto: NoonStockDto) {
  const next: StockItem = {
    partnerSku: dto.partner_sku,
    warehouseCode: dto.warehouse_code,
    fulfillment: dto.fulfillment ?? "unknown",
    qty: dto.qty,
    inTransitQty: dto.in_transit_qty ?? 0,
    updatedAt: dto.updated_at,
  };
  const idx = state.stock.findIndex(
    (s) =>
      s.partnerSku === next.partnerSku &&
      s.warehouseCode === next.warehouseCode &&
      s.fulfillment === next.fulfillment,
  );
  if (idx < 0) state.stock.unshift(next);
  else state.stock[idx] = next;
}

export function upsertSalesFact(state: AppState, dto: NoonSalesDto) {
  const partnerSku = remapSkuViaCatalog(state, dto.partner_sku);
  const next: SalesFact = {
    partnerSku,
    date: dto.date,
    units: dto.units,
    amount: dto.amount,
    updatedAt: dto.updated_at,
  };
  const idx = state.salesFacts.findIndex(
    (s) => s.partnerSku === next.partnerSku && s.date === next.date,
  );
  if (idx < 0) state.salesFacts.unshift(next);
  else state.salesFacts[idx] = next;
}

export function upsertFeeSnapshot(state: AppState, dto: NoonFeeDto) {
  const partnerSku = remapSkuViaCatalog(state, dto.partner_sku);
  const next: FeeSnapshot = {
    partnerSku,
    commissionRate: dto.commission_rate,
    outboundFee: dto.outbound_fee,
    taxAmount: dto.tax_amount,
    updatedAt: dto.updated_at,
  };
  const idx = state.feeSnapshots.findIndex((f) => f.partnerSku === next.partnerSku);
  if (idx < 0) state.feeSnapshots.unshift(next);
  else state.feeSnapshots[idx] = next;
}

/** Impex/报表 SKU 列可能是 partnerSku 或 noonSku */
function remapSkuViaCatalog(state: AppState, sku: string): string {
  const raw = sku.trim();
  if (!raw) return raw;
  if (state.catalog.some((c) => c.partnerSku === raw)) return raw;
  const byNoon = state.catalog.find((c) => c.noonSku && c.noonSku === raw);
  return byNoon?.partnerSku ?? raw;
}

export function upsertAdsFact(state: AppState, dto: NoonAdsDto) {
  const next: AdsFact = {
    partnerSku: dto.partner_sku,
    campaign: dto.campaign ?? "",
    fromDate: dto.from_date,
    toDate: dto.to_date,
    spend: dto.spend,
    revenue: dto.revenue,
    orders: dto.orders,
    views: dto.views,
    clicks: dto.clicks,
    atc: dto.atc ?? 0,
    updatedAt: dto.updated_at,
  };
  const idx = state.adsFacts.findIndex(
    (a) =>
      a.partnerSku === next.partnerSku &&
      a.campaign === next.campaign &&
      a.fromDate === next.fromDate &&
      a.toDate === next.toDate,
  );
  if (idx < 0) state.adsFacts.unshift(next);
  else state.adsFacts[idx] = next;
}

export async function processPendingInbox(state: AppState, limit = 40) {
  return withInboxLock(() => processPendingInboxLocked(state, limit));
}

async function processPendingInboxLocked(state: AppState, limit = 40) {
  const pending = state.inbox.filter((e) => e.status === "pending").slice(0, limit);
  const client = createNoonClient(state);
  let stoppedForLimit = false;
  let processed = 0;
  let limitAlertPushed = false;

  for (const event of pending) {
    // 冷却期间：缺字段订单不再打 Impex，也不消耗 attempts；其它域继续处理
    if (
      event.domain === "orders" &&
      isImpexCoolingDown() &&
      orderNeedsRemoteFetch(event)
    ) {
      event.error =
        "Impex 导出冷却中，订单详情拉取已暂停；冷却结束后自动重试。";
      markJobWarning(state, event.domain, event.error);
      stoppedForLimit = true;
      continue;
    }

    event.attempts += 1;
    processed += 1;
    try {
      await processOne(state, event, client);
      event.status = "processed";
      event.processedAt = new Date().toISOString();
      event.error = null;
      // Catalog 顺带库存提示不得刷新 stock 域「上次成功」时间
      if (event.countsTowardJobSuccess !== false) {
        markJobSuccess(state, event.domain);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      event.error = message;
      if (isImpexLimitMessage(message)) {
        markImpexExportLimitHit();
        // 限额/冷却不算失败次数，保留 pending 待冷却后重试
        event.attempts = Math.max(0, event.attempts - 1);
        markJobWarning(state, event.domain, message);
        if (!limitAlertPushed) {
          pushAlert(state, {
            level: "danger",
            title: `NOON 事件处理失败 (${event.domain})`,
            detail: message,
          });
          limitAlertPushed = true;
        }
        stoppedForLimit = true;
        // 本批不再继续打缺字段订单；其它域事件仍可处理
        continue;
      }
      if (event.attempts >= 3) {
        event.status = "failed";
        markJobFailed(state, event.domain, message);
        pushAlert(state, {
          level: "danger",
          title: `NOON 事件处理失败 (${event.domain})`,
          detail: `${event.entityKey}: ${message}`,
        });
      } else {
        markJobWarning(state, event.domain, message);
      }
    }
  }

  for (const domain of [
    "orders",
    "catalog",
    "stock",
    "sales",
    "fees",
    "ads",
  ] as SyncDomain[]) {
    const job = state.syncJobs.find((j) => j.domain === domain);
    if (job) {
      job.backlog = state.inbox.filter(
        (e) => e.domain === domain && e.status === "pending",
      ).length;
    }
  }
  saveState(state);
  return { processed, stoppedForLimit };
}

/** 抽干 pending，避免大目录只处理 40 条后被后续拉取截断 */
export async function drainPendingInbox(
  state: AppState,
  opts?: { batchSize?: number; maxBatches?: number },
) {
  const batchSize = opts?.batchSize ?? 200;
  const maxBatches = opts?.maxBatches ?? 50;
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const { processed, stoppedForLimit } = await processPendingInbox(
      state,
      batchSize,
    );
    total += processed;
    if (stoppedForLimit || processed === 0) break;
  }
  return { processed: total };
}

function orderNeedsRemoteFetch(event: InboxEvent): boolean {
  if (event.domain !== "orders") return false;
  const payload = event.payload as { order_nr?: string } & Partial<NoonOrderDto>;
  const status = String(payload.status ?? "").trim();
  const updatedAt = String(payload.updated_at ?? "").trim();
  return !(status && updatedAt);
}

async function processOne(
  state: AppState,
  event: InboxEvent,
  client: ReturnType<typeof createNoonClient>,
) {
  if (event.domain === "orders") {
    const payload = event.payload as { order_nr?: string } & Partial<NoonOrderDto>;
    const orderNr = payload.order_nr ?? event.entityKey;
    const status = String(payload.status ?? "").trim();
    const updatedAt = String(payload.updated_at ?? "").trim();
    const detail =
      status && updatedAt
        ? ({
            ...payload,
            order_nr: orderNr,
            status,
            updated_at: updatedAt,
          } as NoonOrderDto)
        : await client.fetchOrder(orderNr);
    if (!detail) throw new Error(`订单不存在: ${orderNr}`);
    upsertOrder(state, detail);
    return;
  }

  if (event.domain === "catalog") {
    upsertCatalog(state, event.payload as NoonCatalogDto);
    return;
  }

  if (event.domain === "stock") {
    upsertStock(state, event.payload as NoonStockDto);
    return;
  }

  if (event.domain === "sales") {
    upsertSalesFact(state, event.payload as NoonSalesDto);
    return;
  }

  if (event.domain === "fees") {
    upsertFeeSnapshot(state, event.payload as NoonFeeDto);
    return;
  }

  if (event.domain === "ads") {
    upsertAdsFact(state, event.payload as NoonAdsDto);
    return;
  }
}

function markJobSuccess(state: AppState, domain: SyncDomain) {
  const job = state.syncJobs.find((j) => j.domain === domain);
  if (!job) return;
  job.status = "success";
  job.lastSuccessAt = new Date().toISOString();
  job.lastError = null;
  job.latencyMinutes = 1;
}

function markJobWarning(state: AppState, domain: SyncDomain, message: string) {
  const job = state.syncJobs.find((j) => j.domain === domain);
  if (!job) return;
  job.status = "warning";
  job.lastError = message;
}

function markJobFailed(state: AppState, domain: SyncDomain, message: string) {
  const job = state.syncJobs.find((j) => j.domain === domain);
  if (!job) return;
  job.status = "failed";
  job.lastError = message;
}

export async function pullDomain(
  state: AppState,
  domain: "orders" | "catalog" | "stock" | "sales" | "fees",
) {
  if (!state.noon.enabled) {
    throw new Error("NOON 接入未启用，请先在接入配置或 .env 中开启");
  }

  const job = state.syncJobs.find((j) => j.domain === domain);
  if (job) {
    job.status = "running";
    job.lastError = null;
    saveState(state);
  }

  const client = createNoonClient(state);
  try {
    if (domain === "orders") {
      const rows = await client.fetchOrdersSince(state.cursors.ordersSince);
      for (const row of rows) {
        enqueueInbox(state, {
          eventId: `poll:orders:${row.order_nr}:${row.updated_at}`,
          source: "poll",
          domain: "orders",
          entityKey: row.order_nr,
          payload: row,
        });
      }
      state.cursors.ordersSince = new Date().toISOString();
    } else if (domain === "catalog") {
      const rows = await client.fetchCatalogSince(state.cursors.catalogSince);
      for (const row of rows) {
        enqueueInbox(state, {
          eventId: `poll:catalog:${row.partner_sku}:${row.updated_at}`,
          source: "poll",
          domain: "catalog",
          entityKey: row.partner_sku,
          payload: row,
        });
      }
      // live：catalog CSV 内嵌 FBN/FBP 库存提示。已有分仓 ledger 时禁止再写，避免与 RUH01S 等真仓重复加总，并冒充 stock 同步成功。
      if (
        client instanceof Object &&
        "drainStockHints" in client &&
        typeof (client as LiveNoonClientLike).drainStockHints === "function"
      ) {
        const live = client as LiveNoonClientLike;
        const hints = live.drainStockHints!();
        if (hasRealStockLedger(state.stock)) {
          stripCatalogStockHintRows(state);
        } else {
          for (const row of hints) {
            enqueueInbox(state, {
              eventId: `poll:stock:${row.partner_sku}:${row.warehouse_code}:${row.fulfillment}:${row.updated_at}`,
              source: "poll",
              domain: "stock",
              entityKey: `${row.partner_sku}@${row.warehouse_code}@${row.fulfillment}`,
              payload: row,
              countsTowardJobSuccess: false,
            });
          }
        }
        if (typeof live.drainFeeEstimateHints === "function") {
          for (const e of live.drainFeeEstimateHints()) {
            upsertFeeEstimate(state, e, "noon:catalog_export");
          }
        }
      }
      state.cursors.catalogSince = new Date().toISOString();
    } else if (domain === "stock") {
      const rows = await client.fetchStockSince(state.cursors.stockSince);
      // 全量快照原子写入（不经 inbox）：避免先清空再 duplicate 跳过导致空仓
      applyStockLedgerSnapshot(state, rows);
      if (
        client instanceof Object &&
        "drainFbnDimsHints" in client &&
        typeof (client as LiveNoonClientLike).drainFbnDimsHints === "function"
      ) {
        for (const d of (client as LiveNoonClientLike).drainFbnDimsHints!()) {
          upsertDimsGapFill(state, d, "noon:fbn_inventory");
        }
      }
      state.cursors.stockSince = new Date().toISOString();
    } else if (domain === "sales") {
      const rows = await client.fetchSalesSince(state.cursors.salesSince);
      for (const row of rows) {
        enqueueInbox(state, {
          eventId: `poll:sales:${row.partner_sku}:${row.date}:${row.updated_at}`,
          source: "poll",
          domain: "sales",
          entityKey: `${row.partner_sku}@${row.date}`,
          payload: row,
        });
      }
      state.cursors.salesSince = new Date().toISOString();
    } else {
      const rows = await client.fetchFeesSince(state.cursors.feesSince);
      for (const row of rows) {
        enqueueInbox(state, {
          eventId: `poll:fees:${row.partner_sku}:${row.updated_at}`,
          source: "poll",
          domain: "fees",
          entityKey: row.partner_sku,
          payload: row,
        });
      }
      state.cursors.feesSince = new Date().toISOString();
    }

    await drainPendingInbox(state);
    if (job) {
      job.status = "success";
      job.lastSuccessAt = new Date().toISOString();
      job.lastError = null;
      job.latencyMinutes = 1;
    }
    saveState(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isImpexLimitMessage(message)) {
      markImpexExportLimitHit();
    }
    if (job) {
      job.status = "failed";
      job.lastError = message;
    }
    pushAlert(state, {
      level: "danger",
      title: `NOON 增量拉取失败 (${domain})`,
      detail: message,
    });
    saveState(state);
    throw err;
  }
}
