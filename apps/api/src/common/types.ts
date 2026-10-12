/** 海运货物类型：插电 / 内置电 / 普货 */
export type CargoType = "plug" | "builtin" | "general";

export type ShippingConfig = {
  /** @deprecated 财务页遗留；Catalog 头程用 airFreightRmbPerKg */
  airFreightAedPerKg: number;
  airLeadDays: number;
  /** @deprecated 财务页遗留；Catalog 海运用 seaFreightRmbPerCbm* */
  seaFreightAedPerCbm: number;
  seaLeadDays: number;
  /** 空运头程 RMB/kg；计费重 = MAX(实重, 体积重) */
  airFreightRmbPerKg: number;
  /** 海运插电 RMB/cbm */
  seaFreightRmbPerCbmPlug: number;
  /** 海运内置电 RMB/cbm */
  seaFreightRmbPerCbmBuiltin: number;
  /** 海运普货 RMB/cbm */
  seaFreightRmbPerCbmGeneral: number;
  buybackRate: number;
  volumetricDivisor: number;
  updatedAt: string;
};

export type ReviewConfig = {
  commissionRmb: number;
  exchangeRate: number;
  expressFeeRmb: number;
  balanceRmb: number;
  updatedAt: string;
};

export type StoreInfo = {
  id: string;
  name: string;
  account: string;
  site: string;
  platform: "NOON";
  expiresAt: string | null;
  listingUsed: number;
  listingQuota: number;
};

export type NoonConnection = {
  /** mock=模拟；live=官方API(若有)；portal=网页/导出采集（当前主路径） */
  mode: "mock" | "live" | "portal";
  partnerId: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  baseUrl: string;
  countryCode: "sa" | "ae" | "eg";
  enabled: boolean;
  lastValidatedAt: string | null;
  lastError: string | null;
  /** 卖家后台门户采集配置 */
  portal: PortalConfig;
};

/** 无官方 API 时：从网页会话或导出文件取数 */
export type PortalConfig = {
  portalUrl: string;
  /** 浏览器登录脚本写入的 Cookie（也可手工维护） */
  cookie: string;
  /** 可选：后台里抓到的订单/商品/库存接口或页面 URL */
  ordersUrl: string;
  catalogUrl: string;
  stockUrl: string;
  /** 最近一次门户采集时间 */
  lastFetchAt: string | null;
  lastImportAt: string | null;
  lastImportSummary: string | null;
};

/** 门户采集缓冲：导入或抓取后暂存，供 PortalNoonClient 读取 */
export type PortalCache = {
  orders: Array<{
    order_nr: string;
    status: string;
    currency: string;
    total_amount: number;
    item_count: number;
    placed_at: string;
    updated_at: string;
  }>;
  catalog: Array<{
    partner_sku: string;
    title: string;
    is_active: boolean;
    noon_sku?: string;
    image_url?: string;
    price?: number;
    currency?: string;
    listing_type?: string;
    updated_at: string;
  }>;
  stock: Array<{
    partner_sku: string;
    warehouse_code: string;
    qty: number;
    fulfillment?: "fbn" | "fbp" | "supermall" | "transit" | "unknown";
    in_transit_qty?: number;
    updated_at: string;
  }>;
  sales: Array<{
    partner_sku: string;
    date: string;
    units: number;
    amount: number;
    updated_at: string;
  }>;
  fees: Array<{
    partner_sku: string;
    commission_rate: number;
    outbound_fee: number;
    tax_amount: number;
    updated_at: string;
  }>;
  /** Noon Ads Campaign Overview SKU 页 */
  ads: Array<{
    partner_sku: string;
    campaign: string;
    from_date: string;
    to_date: string;
    spend: number;
    revenue: number;
    orders: number;
    views: number;
    clicks: number;
    atc?: number;
    updated_at: string;
  }>;
  updatedAt: string | null;
};

export type SyncCursor = {
  ordersSince: string | null;
  catalogSince: string | null;
  stockSince: string | null;
  salesSince: string | null;
  feesSince: string | null;
  adsSince: string | null;
};

export type SyncJobStatus = "idle" | "running" | "success" | "warning" | "failed";

export type SyncDomain =
  | "orders"
  | "catalog"
  | "stock"
  | "sales"
  | "fees"
  | "ads"
  | "pricing"
  | "store"
  | "reconcile";

export type SyncJob = {
  id: string;
  domain: SyncDomain;
  status: SyncJobStatus;
  lastSuccessAt: string | null;
  lastError: string | null;
  backlog: number;
  latencyMinutes: number;
};

export type SyncAlert = {
  id: string;
  level: "info" | "warning" | "danger";
  title: string;
  detail: string;
  createdAt: string;
  acknowledged: boolean;
};

export type InboxSource = "webhook" | "poll" | "reconcile" | "manual";
export type InboxStatus = "pending" | "processed" | "failed" | "duplicate";

export type InboxEvent = {
  id: string;
  eventId: string;
  source: InboxSource;
  domain: SyncDomain;
  entityKey: string;
  payload: unknown;
  status: InboxStatus;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
  attempts: number;
  /**
   * false = 旁路写入，不刷新该域 syncJobs.lastSuccessAt。
   * Catalog 顺带的 FBN/FBP 库存提示必须为 false，否则会冒充「库存已同步」。
   */
  countsTowardJobSuccess?: boolean;
};

export type NoonOrder = {
  orderNr: string;
  status: string;
  currency: string;
  totalAmount: number;
  itemCount: number;
  partnerSku?: string;
  placedAt: string;
  updatedAt: string;
  rawVersion: string;
};

/** 本地 Catalog（由 NOON 同步写入）— SOP 在线/不在线商品 */
export type CatalogItem = {
  partnerSku: string;
  title: string;
  isActive: boolean;
  noonSku: string;
  imageUrl: string;
  price: number;
  /** Noon Catalog Export 的 active_price；无活动价则为 null */
  activePrice?: number | null;
  /** Noon Catalog Export 的 price 底价；用来判断是否真有活动价 */
  listPrice?: number | null;
  currency: string;
  /** 自建 / 目录等 */
  listingType: string;
  source: "NOON";
  updatedAt: string;
  /**
   * Catalog Export `stock_fbn_net`＝门户 Active Net Stock · FBN。
   * 与 Impex 分仓 ledger 分开存；补货/可卖天优先用此值。
   */
  stockFbnNet?: number | null;
};

export type FulfillmentType =
  | "fbn"
  | "fbp"
  | "supermall"
  | "transit"
  | "unknown";

export type StockItem = {
  partnerSku: string;
  warehouseCode: string;
  fulfillment: FulfillmentType;
  qty: number;
  inTransitQty: number;
  updatedAt: string;
};

/** SOP Sales：按 SKU+日 的销量事实 */
export type SalesFact = {
  partnerSku: string;
  /** YYYY-MM-DD */
  date: string;
  units: number;
  amount: number;
  updatedAt: string;
};

/** SOP Transaction：佣金/出库费等平台侧费用快照 */
export type FeeSnapshot = {
  partnerSku: string;
  /** 0–1，如 0.15 = 15% */
  commissionRate: number;
  outboundFee: number;
  taxAmount: number;
  updatedAt: string;
};

/**
 * My Catalog Estimated Fees（FBN/FBP）估费补缺。
 * 仅供 Catalog assemble 在 feeSnapshots 缺数时使用；财务报表不读此表。
 */
export type FeeEstimate = {
  partnerSku: string;
  /** 0–1；仅总额时可为 0 */
  commissionRate: number;
  outboundFee: number;
  /** 估费合计（FBN 优先）；无法拆分时写入此项 */
  estimatedFeeTotal: number;
  fulfillment: "fbn" | "fbp" | "unknown";
  updatedAt: string;
  source?: string;
};

/**
 * Noon Ads Campaign Overview（SKU sheet）事实。
 * 主键：partnerSku + campaign + fromDate + toDate（幂等 upsert，跨活动汇总时再 Σ）。
 */
export type AdsFact = {
  partnerSku: string;
  /** 活动名；空表示未拆活动 */
  campaign: string;
  /** YYYY-MM-DD 报表区间起 */
  fromDate: string;
  /** YYYY-MM-DD 报表区间止 */
  toDate: string;
  spend: number;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
  /** Add to Cart；旧数据缺省 0 */
  atc: number;
  updatedAt: string;
};

/** 本地费用配置（头程/采购等，对应竞品「费用配置」） */
export type SkuLocalCost = {
  partnerSku: string;
  /** 飞书 landed−采购差；Catalog 毛利改用费率表头程，此字段仅追溯 */
  headhaul: number;
  purchaseCost: number;
  preferAir: boolean;
  /** 海运分档；缺省 general */
  cargoType?: CargoType;
  updatedAt: string;
  /** 来源追溯，如 feishu:product_daily+landed */
  source?: string;
  /** 规范化 runId，便于对回 feishu-normalized */
  normalizeRunId?: string;
};

/** 本地尺寸重量（对应竞品「导入尺寸重量」） */
export type SkuDims = {
  partnerSku: string;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  updatedAt: string;
  source?: string;
  normalizeRunId?: string;
};

/** 补货参数 */
export type ReplenishConfig = {
  partnerSku: string;
  safetyDays: number;
  urgentDays: number;
  skip: boolean;
  updatedAt: string;
};

/**
 * 飞书日报运营快照（补货计划 / 空海在途 / 已采购）。
 * 主键 partnerSku；同 SKU 以最新日报 sheet 覆盖。
 */
export type FeishuOpsSnapshot = {
  partnerSku: string;
  sheetTitle: string;
  reportDate: string | null;
  productName: string;
  airInTransit: number;
  seaInTransit: number;
  purchasedQty: number;
  airReplenishPlan: number;
  seaReplenishPlan: number;
  fbn: number | null;
  updatedAt: string;
  source: string;
};

/** 飞书账目表「产品采购」行 */
export type PurchaseLine = {
  id: string;
  partnerSku: string;
  productName: string;
  qty: number;
  unitCost: number;
  amount: number;
  supplier: string;
  purchasedAt: string | null;
  status: string;
  remark: string;
  sheetTitle: string;
  updatedAt: string;
  source: string;
  /** 1688 订单号（飞书「订单号」列） */
  orderId?: string;
  /** 快递单号（飞书初值或 1688 回填） */
  trackingNo?: string;
  /** 物流/在途状态 */
  transitStatus?: string;
  /** 预计送达 YYYY-MM-DD */
  etaDate?: string | null;
  logisticsUpdatedAt?: string | null;
};

/**
 * 采购到货确认（分批到仓）：按「订单+SKU」记累计已收，不随飞书同步覆盖。
 * 到齐后从「今日要处理」清出。
 */
export type PurchaseArrivalReceipt = {
  key: string;
  partnerSku: string;
  orderId: string;
  lineId: string;
  qtyOrdered: number;
  receivedQty: number;
  updatedAt: string;
  updatedBy: string;
};

/** 飞书账目表入账/开支行 */
export type CashLedgerEntry = {
  id: string;
  kind: "income" | "expense" | "other";
  amount: number;
  category: string;
  occurredAt: string | null;
  remark: string;
  sheetTitle: string;
  updatedAt: string;
  source: string;
};

/** Noon Impex invoicesandcreditnotes */
export type InvoiceDoc = {
  id: string;
  invoiceNr: string;
  invoiceType: string;
  status: string;
  currency: string;
  amount: number;
  issuedAt: string | null;
  dueAt: string | null;
  partnerSku: string;
  updatedAt: string;
};

/**
 * Noon Statement of Account 按自然月聚合（账单口径，≠ Transaction View）。
 * 金额单位 SAR；平台费/VAT 存正数便于展示。
 */
export type SettlementMonth = {
  month: string;
  netProceedsSar: number;
  vatSar: number;
  platformFeesSar: number;
  feeBreakdown: {
    advertising: number;
    referral: number;
    fbnOutbound: number;
    returnAdmin: number;
  };
  otherFeesSar: number;
  minDate: string;
  maxDate: string;
  rowCount: number;
  /** Details EN = Net Proceeds 行数（约等于周结段数） */
  statementCount: number;
  /** 是否存在月末日的 Net Proceeds 段 */
  hasMonthEndStatement: boolean;
  sourceFile: string;
  importedAt: string;
};

export type GpCloseGateCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

/** 月度毛利关账快照（终稿）。导入 CSV 只更新草稿，不覆盖本记录。 */
export type GpMonthClose = {
  month: string;
  status: "closed" | "superseded";
  closedAt: string;
  closedBy: "schedule" | "manual";
  fx: number;
  sourceFile: string;
  gate: GpCloseGateCheck[];
  caveats: string[];
  missingSkus: string[];
  netProceedsSar: number;
  platformFeesSar: number;
  vatSar: number;
  purchaseCny: number;
  headhaulCny: number;
  packagingCny: number;
  pureProfitCny: number;
  coverage: {
    minDate: string;
    maxDate: string;
    statementCount: number;
  };
};

/** 上架任务（本地业务，额度扣减） */
export type ListingTask = {
  id: string;
  partnerSku: string;
  title: string;
  status: "draft" | "queued" | "success" | "failed";
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type FavoriteItem = {
  id: string;
  partnerSku: string;
  note: string;
  createdAt: string;
};

export type AppState = {
  store: StoreInfo;
  noon: NoonConnection;
  cursors: SyncCursor;
  shipping: ShippingConfig;
  review: ReviewConfig;
  syncJobs: SyncJob[];
  syncAlerts: SyncAlert[];
  inbox: InboxEvent[];
  orders: NoonOrder[];
  catalog: CatalogItem[];
  stock: StockItem[];
  salesFacts: SalesFact[];
  feeSnapshots: FeeSnapshot[];
  /** Catalog 估费补缺；不参与财务汇总 */
  feeEstimates: FeeEstimate[];
  adsFacts: AdsFact[];
  skuLocalCosts: SkuLocalCost[];
  skuDims: SkuDims[];
  replenishConfigs: ReplenishConfig[];
  /** 飞书日报补货/在途 */
  feishuOpsSnapshots: FeishuOpsSnapshot[];
  /** 飞书产品采购明细 */
  purchaseLines: PurchaseLine[];
  /** 采购分批到货确认（本地，不写飞书） */
  purchaseArrivalReceipts: PurchaseArrivalReceipt[];
  /** 飞书入账/开支 */
  cashLedger: CashLedgerEntry[];
  /** Noon 发票/贷记单 */
  invoiceDocs: InvoiceDoc[];
  /** Noon Statement of Account 月结算（账单口径） */
  settlementMonths: SettlementMonth[];
  /** 月度毛利关账终稿；每店独立 */
  gpMonthCloses: GpMonthClose[];
  listings: ListingTask[];
  favorites: FavoriteItem[];
  /** 网页/导出采集缓冲 */
  portalCache: PortalCache;
};
