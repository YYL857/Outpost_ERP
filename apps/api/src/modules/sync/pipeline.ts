import type {
  AppState,
  CatalogItem,
  FeeSnapshot,
  InboxEvent,
  NoonOrder,
  SalesFact,
  StockItem,
  SyncDomain,
} from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { createNoonClient } from "../../platforms/noon/index.js";
import type {
  NoonCatalogDto,
  NoonFeeDto,
  NoonOrderDto,
  NoonSalesDto,
  NoonStockDto,
} from "../../platforms/noon/types.js";
import { enqueueInbox } from "./inbox.js";
import { pushAlert } from "./alerts.js";

type LiveNoonClientLike = {
  drainStockHints: () => NoonStockDto[];
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
  const incomingImage = (dto.image_url ?? "").trim();
  const next: CatalogItem = {
    partnerSku: dto.partner_sku,
    title: dto.title,
    isActive: dto.is_active,
    noonSku: dto.noon_sku ?? "",
    // 导出常缺图：空值不覆盖已有 imageUrl
    imageUrl: incomingImage || prev?.imageUrl || "",
    price: dto.price ?? 0,
    currency: dto.currency || "SAR",
    listingType: dto.listing_type ?? "",
    source: "NOON",
    updatedAt: dto.updated_at,
  };
  if (idx < 0) state.catalog.unshift(next);
  else state.catalog[idx] = { ...prev!, ...next };
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
  const next: SalesFact = {
    partnerSku: dto.partner_sku,
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
  const next: FeeSnapshot = {
    partnerSku: dto.partner_sku,
    commissionRate: dto.commission_rate,
    outboundFee: dto.outbound_fee,
    taxAmount: dto.tax_amount,
    updatedAt: dto.updated_at,
  };
  const idx = state.feeSnapshots.findIndex((f) => f.partnerSku === next.partnerSku);
  if (idx < 0) state.feeSnapshots.unshift(next);
  else state.feeSnapshots[idx] = next;
}

export async function processPendingInbox(state: AppState, limit = 40) {
  const pending = state.inbox.filter((e) => e.status === "pending").slice(0, limit);
  const client = createNoonClient(state);

  for (const event of pending) {
    event.attempts += 1;
    try {
      await processOne(state, event, client);
      event.status = "processed";
      event.processedAt = new Date().toISOString();
      event.error = null;
      markJobSuccess(state, event.domain);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      event.error = message;
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
  ] as SyncDomain[]) {
    const job = state.syncJobs.find((j) => j.domain === domain);
    if (job) {
      job.backlog = state.inbox.filter(
        (e) => e.domain === domain && e.status === "pending",
      ).length;
    }
  }
  saveState(state);
  return { processed: pending.length };
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
    const { processed } = await processPendingInbox(state, batchSize);
    total += processed;
    if (processed === 0) break;
  }
  return { processed: total };
}

async function processOne(
  state: AppState,
  event: InboxEvent,
  client: ReturnType<typeof createNoonClient>,
) {
  if (event.domain === "orders") {
    const payload = event.payload as { order_nr?: string } & Partial<NoonOrderDto>;
    const orderNr = payload.order_nr ?? event.entityKey;
    const detail =
      payload.status && payload.updated_at
        ? (payload as NoonOrderDto)
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
  domain: "orders" | "catalog" | "stock",
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
      // live：catalog CSV 内嵌 FBN/FBP 库存，顺带入 stock（不额外消耗 Impex 配额）
      if (
        client instanceof Object &&
        "drainStockHints" in client &&
        typeof (client as LiveNoonClientLike).drainStockHints === "function"
      ) {
        const hints = (client as LiveNoonClientLike).drainStockHints();
        for (const row of hints) {
          enqueueInbox(state, {
            eventId: `poll:stock:${row.partner_sku}:${row.warehouse_code}:${row.fulfillment}:${row.updated_at}`,
            source: "poll",
            domain: "stock",
            entityKey: `${row.partner_sku}@${row.warehouse_code}@${row.fulfillment}`,
            payload: row,
          });
        }
      }
      state.cursors.catalogSince = new Date().toISOString();
    } else {
      const rows = await client.fetchStockSince(state.cursors.stockSince);
      for (const row of rows) {
        enqueueInbox(state, {
          eventId: `poll:stock:${row.partner_sku}:${row.warehouse_code}:${row.fulfillment}:${row.updated_at}`,
          source: "poll",
          domain: "stock",
          entityKey: `${row.partner_sku}@${row.warehouse_code}@${row.fulfillment}`,
          payload: row,
        });
      }
      state.cursors.stockSince = new Date().toISOString();
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
