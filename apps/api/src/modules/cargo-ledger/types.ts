export type FreightBasis = "ticket" | "box_sum" | "missing";

export type LedgerIssue = {
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
  ticketKey?: string;
  boxNo?: string;
  partnerSku?: string;
};

export type LedgerSourceMeta = {
  path: string | null;
  pulledAt: string | null;
};

export type CargoLedgerBox = {
  boxNo: string;
  shopCode: string;
  pcs: number;
  weightKg: number | null;
  boxCrossFreight: number | null;
  warehouseStatus: string;
  arriveAt: string | null;
};

export type CargoLedgerSkuLine = {
  partnerSku: string;
  name: string;
  qty: number;
  weightKg: number;
  boxNos: string[];
  /** 本票头程分摊（人民币口径，与装箱表一致） */
  allocatedCrossFreight: number | null;
  /** 最近一笔采购单价，不是本票锁定批次 */
  purchaseUnitHint: number | null;
  purchaseLotCount: number;
  inProductMaster: boolean;
  shopMismatch: boolean;
};

export type CargoLedgerTicket = {
  ticketKey: string;
  ticketNo: string;
  logisticsNo: string;
  shopCode: string;
  forwarder: string;
  mode: string;
  modeRaw: string;
  shipAt: string | null;
  arriveAt: string | null;
  inTransit: boolean;
  settled: string;
  boxCount: number;
  skuCount: number;
  pcs: number;
  weightKg: number;
  crossFreight: number | null;
  freightBasis: FreightBasis;
  domesticFreight: number | null;
  boxes: CargoLedgerBox[];
  skuLines: CargoLedgerSkuLine[];
};

export type CargoLedgerShopRollup = {
  shopCode: string;
  tickets: number;
  boxes: number;
  pcs: number;
  skuCount: number;
  inTransitTickets: number;
};

export type CargoLedgerSide = {
  purchaseLots: number;
  purchasePskus: number;
  cashEntries: number;
  packagingRows: number;
  productMaster: number;
  dailyLatestSheet: string | null;
  dailyPskus: number;
};

export type CargoLedger = {
  version: 1;
  builtAt: string;
  sources: {
    packing: LedgerSourceMeta;
    product: LedgerSourceMeta;
    accounts: LedgerSourceMeta;
    daily: LedgerSourceMeta;
  };
  side: CargoLedgerSide;
  shops: CargoLedgerShopRollup[];
  issues: LedgerIssue[];
  tickets: CargoLedgerTicket[];
};

export type CargoLedgerTicketSummary = Omit<
  CargoLedgerTicket,
  "boxes" | "skuLines"
>;
