/**
 * Catalog 估费 / FBN 尺寸补缺写入（不进 feeSnapshots / 不改库存数量主语义）
 */
import type { AppState, FeeEstimate, SkuDims } from "../../../common/types.js";
import type {
  CatalogFeeEstimateDto,
  FbnDimsDto,
} from "./parsers.js";

function hasAnyDim(d: {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}): boolean {
  return d.lengthCm > 0 || d.widthCm > 0 || d.heightCm > 0 || d.weightKg > 0;
}

export function upsertFeeEstimate(
  state: AppState,
  dto: CatalogFeeEstimateDto,
  source = "noon:estimated_fees",
): void {
  // FBP 估费无参考价值，不入库
  if (dto.fulfillment === "fbp") return;
  if (!state.feeEstimates) state.feeEstimates = [];
  const next: FeeEstimate = {
    partnerSku: dto.partner_sku,
    commissionRate: dto.commission_rate,
    outboundFee: dto.outbound_fee,
    estimatedFeeTotal: dto.estimated_fee_total,
    fulfillment: dto.fulfillment,
    updatedAt: dto.updated_at,
    source,
  };
  const idx = state.feeEstimates.findIndex(
    (f) => f.partnerSku === next.partnerSku,
  );
  // FBN 优先：已有 fbn 不被非 fbn 覆盖
  if (idx >= 0) {
    const prev = state.feeEstimates[idx]!;
    if (prev.fulfillment === "fbn" && next.fulfillment !== "fbn") return;
    state.feeEstimates[idx] = next;
  } else {
    state.feeEstimates.unshift(next);
  }
}

/** 仅补空：不覆盖飞书产品表等已有非空尺寸 */
export function upsertDimsGapFill(
  state: AppState,
  dto: FbnDimsDto,
  source = "noon:fbn_inventory",
): "inserted" | "updated" | "kept" {
  const row: SkuDims = {
    partnerSku: dto.partner_sku,
    lengthCm: dto.length_cm,
    widthCm: dto.width_cm,
    heightCm: dto.height_cm,
    weightKg: dto.weight_kg,
    updatedAt: dto.updated_at,
    source,
  };
  const idx = state.skuDims.findIndex((d) => d.partnerSku === row.partnerSku);
  if (idx < 0) {
    state.skuDims.push(row);
    return "inserted";
  }
  const prev = state.skuDims[idx]!;
  if (hasAnyDim(prev)) {
    const merged: SkuDims = {
      ...prev,
      lengthCm: prev.lengthCm > 0 ? prev.lengthCm : row.lengthCm,
      widthCm: prev.widthCm > 0 ? prev.widthCm : row.widthCm,
      heightCm: prev.heightCm > 0 ? prev.heightCm : row.heightCm,
      weightKg: prev.weightKg > 0 ? prev.weightKg : row.weightKg,
    };
    const changed =
      merged.lengthCm !== prev.lengthCm ||
      merged.widthCm !== prev.widthCm ||
      merged.heightCm !== prev.heightCm ||
      merged.weightKg !== prev.weightKg;
    if (!changed) return "kept";
    state.skuDims[idx] = merged;
    return "updated";
  }
  state.skuDims[idx] = { ...prev, ...row };
  return "updated";
}
