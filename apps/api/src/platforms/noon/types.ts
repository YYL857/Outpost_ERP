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
  /** SOP / FBN Ledger：履约类型（含 supermall / transit） */
  fulfillment: "fbn" | "fbp" | "supermall" | "transit" | "unknown";
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
  /** Catalog Export 列 active_price；没有活动价时为 null */
  active_price?: number | null;
  /** Catalog Export 列 price（底价/标价，非 active_price） */
  list_price?: number | null;
  currency: string;
  listing_type: string;
  updated_at: string;
  /**
   * Catalog Export `stock_fbn_net`（门户 Active Net Stock · FBN）。
   * null/缺省=本次未带该列；0=门户显示 0。
   */
  stock_fbn_net?: number | null;
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

/** Impex invoicesandcreditnotes */
export type NoonInvoiceDto = {
  invoice_nr: string;
  invoice_type: string;
  status: string;
  currency: string;
  amount: number;
  issued_at: string | null;
  due_at: string | null;
  partner_sku: string;
  updated_at: string;
};

/** Noon Ads Campaign Overview → SKU sheet */
export type NoonAdsDto = {
  partner_sku: string;
  campaign: string;
  from_date: string;
  to_date: string;
  spend: number;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
  /** Add to Cart；旧导出缺省 0 */
  atc: number;
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
 * sales/fees：live 走 Impex；portal/mock 读 cache 或样例；ads 无官方 API（影刀 CSV）。
 */
export interface NoonClient {
  readonly mode: NoonConnection["mode"];
  validateCredentials(): Promise<{ ok: boolean; message: string }>;
  fetchOrdersSince(since: string | null): Promise<NoonOrderDto[]>;
  fetchOrder(orderNr: string): Promise<NoonOrderDto | null>;
  fetchStockSince(since: string | null): Promise<NoonStockDto[]>;
  fetchCatalogSince(since: string | null): Promise<NoonCatalogDto[]>;
  fetchSalesSince(since: string | null): Promise<NoonSalesDto[]>;
  fetchFeesSince(since: string | null): Promise<NoonFeeDto[]>;
}

export type PullDomain = Extract<
  SyncDomain,
  "orders" | "catalog" | "stock" | "sales" | "fees"
>;
