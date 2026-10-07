import type { NoonConnection, SyncDomain } from "../../common/types.js";

export type NoonOrderDto = {
  order_nr: string;
  status: string;
  currency: string;
  total_amount: number;
  item_count: number;
  placed_at: string;
  updated_at: string;
};

export type NoonStockDto = {
  partner_sku: string;
  warehouse_code: string;
  qty: number;
  /** SOP Inventory：履约类型 */
  fulfillment: "fbn" | "fbp" | "unknown";
  in_transit_qty: number;
  updated_at: string;
};

/** SOP Catalog Exports：在线/不在线商品 */
export type NoonCatalogDto = {
  partner_sku: string;
  title: string;
  is_active: boolean;
  noon_sku: string;
  image_url: string;
  price: number;
  currency: string;
  listing_type: string;
  updated_at: string;
};

/** SOP Sales：日销量事实 */
export type NoonSalesDto = {
  partner_sku: string;
  date: string;
  units: number;
  amount: number;
  updated_at: string;
};

/** SOP Transaction View：佣金/出库费 */
export type NoonFeeDto = {
  partner_sku: string;
  /** 0–1 */
  commission_rate: number;
  outbound_fee: number;
  tax_amount: number;
  updated_at: string;
};

export type NoonWebhookEnvelope = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  payload: {
    order_nr?: string;
    partner_sku?: string;
    [key: string]: unknown;
  };
};

/**
 * NOON 平台客户端契约。
 * live 实现替换 MockNoonClient 即可，上层 Inbox/同步管道不用改。
 */
export interface NoonClient {
  readonly mode: NoonConnection["mode"];
  validateCredentials(): Promise<{ ok: boolean; message: string }>;
  fetchOrdersSince(since: string | null): Promise<NoonOrderDto[]>;
  fetchOrder(orderNr: string): Promise<NoonOrderDto | null>;
  fetchStockSince(since: string | null): Promise<NoonStockDto[]>;
  fetchCatalogSince(since: string | null): Promise<NoonCatalogDto[]>;
}

export type PullDomain = Extract<SyncDomain, "orders" | "catalog" | "stock">;
