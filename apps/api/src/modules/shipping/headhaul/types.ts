/** 头程双轨核算类型 */
import type { FreightCargoKind } from "./cargo-name-rules.js";
import type { ShipMode } from "../../../platforms/feishu/normalize/forwarder-board.js";

export type HeadhaulConfidence =
  | "detailed"
  | "approx"
  | "actual"
  | "fallback";

export type RateSource =
  | "exact"
  | "general_fallback"
  | "inferred"
  | "global_config";

export type LineHeadhaulResult = {
  boxNo: string;
  partnerSku: string;
  name: string;
  qty: number;
  cargoKind: FreightCargoKind;
  cargoLabel: string;
  mode: ShipMode;
  forwarder: string;
  share: number;
  chargeableShareKg: number | null;
  cbmShare: number | null;
  rateRmb: number | null;
  rateSource: RateSource;
  quoteRmb: number;
  actualRmb: number | null;
  domesticShareRmb: number;
  unitQuoteRmb: number;
  unitActualRmb: number | null;
  /** Catalog 优先用：有实付取实付单位，否则报价单位 */
  unitHeadhaulRmb: number;
  confidence: HeadhaulConfidence;
  reasons: string[];
};

export type BoxHeadhaulResult = {
  boxNo: string;
  forwarder: string;
  mode: ShipMode;
  weightKg: number | null;
  volumetricKg: number | null;
  chargeableKg: number | null;
  cbm: number | null;
  quoteTotalRmb: number;
  actualTotalRmb: number | null;
  domesticTotalRmb: number;
  lines: LineHeadhaulResult[];
};

export type SkuHeadhaulSummary = {
  partnerSku: string;
  unitHeadhaulRmb: number;
  unitQuoteRmb: number | null;
  unitActualRmb: number | null;
  sampleQty: number;
  boxCount: number;
  confidence: HeadhaulConfidence;
  basis: "actual" | "quote" | "fallback";
  lastBoxNo: string | null;
  lastForwarder: string | null;
  cargoKind: FreightCargoKind | null;
};

export type HeadhaulPayload = {
  source: {
    packingSnapshot: string | null;
    ratesSnapshot: string | null;
    pulledAt: string | null;
  };
  boxes: BoxHeadhaulResult[];
  bySku: SkuHeadhaulSummary[];
};
