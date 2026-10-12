export type BookingStep =
  | "ticket"
  | "align"
  | "asn"
  | "schedule"
  | "notify"
  | "done";

export type BookingLineItem = {
  partnerSku: string;
  name: string;
  qty: number;
};

export type BookingBox = {
  /** 完整物流编号，如 10002160U001 */
  logisticsNo: string;
  /** 票号后后缀，如 U001 */
  suffix: string;
  items: BookingLineItem[];
  pcs: number;
  /** 箱表已有 ASN（若有） */
  asnFromSheet: string | null;
};

export type BookingShopBucket = {
  shopPrefix: string;
  /** 店1 / 店2… */
  shopLabel: string | null;
  /** Noon 项目名，如 HUI Beauty */
  shopName: string | null;
  projectCode: string | null;
  asnCreateUrl: string | null;
  asnId: string | null;
  /** ASN 来源：sheet=箱表已有 / manual=用户填 / null=尚未 */
  asnSource: "sheet" | "manual" | null;
  boxes: BookingBox[];
  items: BookingLineItem[];
  /** 用户勾选：本店物料已封装进该 ASN */
  asnPackedConfirmed: boolean;
  forwarder: string | null;
};

/** 侧栏约仓监控自动回填建议（用户可改） */
export type BookingDefaults = {
  warehouse: string;
  dates: string[];
  timeRangeStart: string;
  timeRangeEnd: string;
  preferredStart: string;
  region: string;
  /** 人类可读说明，侧栏展示 */
  hints: string[];
};

export type BookingCapture = {
  asnId: string;
  warehouse: string;
  scheduledDate: string;
  scheduleSlot: string;
  region: string | null;
  pageUrl: string | null;
  capturedAt: string;
  source: "extension" | "manual";
  flags: string[];
};

export type WarehouseBookingSession = {
  id: string;
  ticketPrefix: string;
  step: BookingStep;
  createdAt: string;
  updatedAt: string;
  shops: BookingShopBucket[];
  /** 当前操作中的店前缀 */
  activeShopPrefix: string | null;
  capture: BookingCapture | null;
  holidaysBlocked: string[];
  bookingDefaults: BookingDefaults;
  notes: string;
};
