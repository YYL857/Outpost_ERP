/**
 * 人工导入补货计划 → 发货工作台。
 * 表格式固定：PSKU / 名称 / 库存 / 在途 / 月销 / 建议空运 / 建议海运 / 勾选 / 备注；
 * 中间可插「计划发货日」分隔行。
 */
import type { ManualCargoKind } from "../../shipping/cargo-hints.js";

export type ShipModeLite = "air" | "sea";

export type ShipPlanLegStatus = "pending" | "partial" | "done" | "cancelled";

export type ShipPlanLineStatus =
  | "skip"
  | "pending"
  | "partial"
  | "done"
  | "unassigned";

/** 一条可独立发货的腿（可拆多货代 / 先发一部分） */
export type ShipPlanLeg = {
  id: string;
  forwarder: string;
  mode: ShipModeLite;
  /** 本腿计划件数 */
  qty: number;
  /** 已发出件数（可累加，支持分批） */
  shippedQty: number;
  /** 该货代对此品的货性；空=待补 */
  cargoKind: ManualCargoKind | "";
  note: string;
  status: ShipPlanLegStatus;
  updatedAt: string;
};

export type ShipPlanLine = {
  id: string;
  partnerSku: string;
  productName: string;
  stock: number | null;
  inTransit: number | null;
  monthlySales: number | null;
  suggestAir: number | null;
  suggestSea: number | null;
  /** 表内「√」为 true；「不补货」为 false */
  include: boolean;
  note: string;
  /** 上方日期分隔行推下来的计划日 YYYY-MM-DD */
  planDate: string | null;
  /** 表内行号（1-based，便于对照） */
  sourceRow: number;
  legs: ShipPlanLeg[];
  updatedAt: string;
};

export type ShipPlanSummary = {
  lineCount: number;
  includeCount: number;
  skipCount: number;
  pendingCount: number;
  partialCount: number;
  doneCount: number;
  unassignedCount: number;
  /** 已填货代但缺货性的 (sku×货代) 数 */
  cargoGapCount: number;
  planDates: string[];
  totalSuggestAir: number;
  totalSuggestSea: number;
  totalShipped: number;
  totalPlanned: number;
};

export type ShipPlanDoc = {
  id: string;
  name: string;
  sourceFile: string;
  importedAt: string;
  updatedAt: string;
  lines: ShipPlanLine[];
};

export type ForwarderCargoGap = {
  partnerSku: string;
  productName: string;
  forwarder: string;
  modes: ShipModeLite[];
  plannedQty: number;
  cargoKind: ManualCargoKind | null;
};

export type ForwarderRollup = {
  forwarder: string;
  airQty: number;
  seaQty: number;
  shippedQty: number;
  skuCount: number;
  /** 该货代下已标货性的品数 */
  withCargoKind: number;
  /** 该货代下待标货性的品数 */
  missingCargoKind: number;
  byCargoKind: Record<string, number>;
};
