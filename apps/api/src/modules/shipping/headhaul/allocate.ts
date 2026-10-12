/**
 * 箱内头程双轨：大纲报价估算 + 实付分摊。
 */
import type { ShippingConfig } from "../../../common/types.js";
import type { PackingBoxRow } from "../../../platforms/feishu/normalize/forwarder-board.js";
import type { PackingLineRow } from "../../../platforms/feishu/normalize/packing-lines.js";
import type { FreightRatesPayload } from "../../../platforms/feishu/normalize/freight-rates.js";
import {
  cargoKindLabel,
  resolveCargoKind,
  type FreightCargoKind,
} from "./cargo-name-rules.js";
import { resolveForwarderRate } from "./rate-lookup.js";
import type {
  BoxHeadhaulResult,
  HeadhaulConfidence,
  LineHeadhaulResult,
} from "./types.js";

const EPS = 1e-9;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function boxVolumetricKg(
  box: PackingBoxRow,
  divisor: number,
): number | null {
  if (
    box.lengthCm != null &&
    box.widthCm != null &&
    box.heightCm != null &&
    box.lengthCm > 0 &&
    box.widthCm > 0 &&
    box.heightCm > 0 &&
    divisor > 0
  ) {
    return round2(
      (box.lengthCm * box.widthCm * box.heightCm) / divisor,
    );
  }
  return null;
}

function boxCbm(box: PackingBoxRow): number | null {
  if (box.cbm != null && box.cbm > 0) return box.cbm;
  if (
    box.lengthCm != null &&
    box.widthCm != null &&
    box.heightCm != null &&
    box.lengthCm > 0 &&
    box.widthCm > 0 &&
    box.heightCm > 0
  ) {
    return round2(
      (box.lengthCm * box.widthCm * box.heightCm) / 1_000_000,
    );
  }
  return null;
}

function lineWeightKg(line: PackingLineRow): number {
  if (line.totalWeightKg != null && line.totalWeightKg > 0) {
    return line.totalWeightKg;
  }
  if (line.unitWeightKg != null && line.unitWeightKg > 0) {
    return line.unitWeightKg * line.qty;
  }
  return 0;
}

function confidenceFor(args: {
  hasActual: boolean;
  rateSource: string;
  hasMeasure: boolean;
}): HeadhaulConfidence {
  if (args.hasActual) return "actual";
  if (args.rateSource === "exact" && args.hasMeasure) return "detailed";
  if (args.rateSource === "global_config" || !args.hasMeasure) return "fallback";
  return "approx";
}

/**
 * 计算单箱头程（含明细行）。
 * ticketActualByBox：票级实付已摊到箱后的金额（可选）。
 */
export function computeBoxHeadhaul(args: {
  box: PackingBoxRow;
  lines: PackingLineRow[];
  rates: FreightRatesPayload;
  shipping: ShippingConfig;
  /** 票级跨境实付摊到本箱（无箱级实收时） */
  ticketAllocatedRmb?: number | null;
  productCargoBySku?: ReadonlyMap<string, string>;
}): BoxHeadhaulResult {
  const { box, lines, rates, shipping } = args;
  const mode =
    box.mode === "air" || box.mode === "sea"
      ? box.mode
      : lines[0]?.mode === "sea"
        ? "sea"
        : "air";

  const volKg = boxVolumetricKg(box, shipping.volumetricDivisor);
  const weightKg = box.weightKg != null && box.weightKg > 0 ? box.weightKg : null;
  const lineWeights = lines.map((l) => lineWeightKg(l));
  const sumLineWeight = lineWeights.reduce((a, b) => a + b, 0);
  const sumQty = lines.reduce((a, l) => a + l.qty, 0);

  // 箱实重：优先箱表，否则行重合计
  const effectiveWeight =
    weightKg ?? (sumLineWeight > EPS ? round2(sumLineWeight) : null);
  const chargeableKg =
    mode === "air"
      ? effectiveWeight != null || volKg != null
        ? round2(Math.max(effectiveWeight ?? 0, volKg ?? 0))
        : null
      : null;
  const cbm = mode === "sea" ? boxCbm(box) : boxCbm(box);

  const shares = lines.map((line, i) => {
    if (sumLineWeight > EPS) return lineWeights[i]! / sumLineWeight;
    if (sumQty > EPS) return line.qty / sumQty;
    return lines.length > 0 ? 1 / lines.length : 0;
  });

  const boxActual =
    box.boxCrossFreight != null && box.boxCrossFreight > 0
      ? box.boxCrossFreight
      : args.ticketAllocatedRmb != null && args.ticketAllocatedRmb > 0
        ? args.ticketAllocatedRmb
        : null;

  const domesticTotal =
    box.domesticFreight != null && box.domesticFreight > 0
      ? box.domesticFreight
      : 0;

  const resultLines: LineHeadhaulResult[] = [];
  let quoteTotal = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const share = shares[i]!;
    const cargoKind: FreightCargoKind = resolveCargoKind({
      productName: line.name,
      productCargoLabel: args.productCargoBySku?.get(line.partnerSku) ?? null,
    });
    const rate = resolveForwarderRate({
      rates,
      forwarder: box.forwarder,
      cargoKind,
      mode,
      shipping,
    });

    const reasons: string[] = [];
    reasons.push(`货性=${cargoKindLabel(cargoKind)}`);

    let quoteRmb = 0;
    let chargeableShareKg: number | null = null;
    let cbmShare: number | null = null;

    if (rate) {
      reasons.push(`费率来源=${rate.source} mid=${rate.mid}`);
      if (mode === "air") {
        const qtyKg =
          chargeableKg != null && chargeableKg > 0
            ? chargeableKg * share
            : lineWeights[i]! > 0
              ? lineWeights[i]!
              : null;
        chargeableShareKg = qtyKg != null ? round2(qtyKg) : null;
        if (qtyKg != null && qtyKg > 0) {
          quoteRmb = round2(qtyKg * rate.mid);
        } else {
          reasons.push("缺计费重，报价粗算为0");
        }
      } else {
        const qtyCbm =
          cbm != null && cbm > 0
            ? cbm * share
            : null;
        cbmShare = qtyCbm != null ? round2(qtyCbm) : null;
        if (qtyCbm != null && qtyCbm > 0) {
          // 海运大纲多为 /KG 时仍按份额×费率；单位为 cbm 则按方
          if (rate.unit === "kg" && chargeableKg != null) {
            chargeableShareKg = round2(chargeableKg * share);
            quoteRmb = round2((chargeableKg * share) * rate.mid);
          } else {
            quoteRmb = round2(qtyCbm * rate.mid);
          }
        } else if (lineWeights[i]! > 0 && rate.unit === "kg") {
          chargeableShareKg = round2(lineWeights[i]!);
          quoteRmb = round2(lineWeights[i]! * rate.mid);
          reasons.push("无箱方数，按行重×海运KG价粗算");
        } else {
          reasons.push("缺方数，海运报价粗算为0");
        }
      }
    } else {
      reasons.push("无可用费率");
    }

    const domesticShareRmb = round2(domesticTotal * share);
    quoteRmb = round2(quoteRmb + domesticShareRmb);
    quoteTotal += quoteRmb;

    const actualRmb =
      boxActual != null
        ? round2(boxActual * share + domesticShareRmb)
        : null;

    const unitQuoteRmb = line.qty > 0 ? round2(quoteRmb / line.qty) : 0;
    const unitActualRmb =
      actualRmb != null && line.qty > 0
        ? round2(actualRmb / line.qty)
        : null;
    const unitHeadhaulRmb = unitActualRmb ?? unitQuoteRmb;

    const conf = confidenceFor({
      hasActual: actualRmb != null,
      rateSource: rate?.source ?? "global_config",
      hasMeasure:
        (mode === "air" && chargeableShareKg != null && chargeableShareKg > 0) ||
        (mode === "sea" &&
          ((cbmShare != null && cbmShare > 0) ||
            (chargeableShareKg != null && chargeableShareKg > 0))),
    });

    resultLines.push({
      boxNo: box.boxNo,
      partnerSku: line.partnerSku,
      name: line.name,
      qty: line.qty,
      cargoKind,
      cargoLabel: cargoKindLabel(cargoKind),
      mode,
      forwarder: box.forwarder,
      share: round2(share),
      chargeableShareKg,
      cbmShare,
      rateRmb: rate?.mid ?? null,
      rateSource: rate?.source ?? "global_config",
      quoteRmb,
      actualRmb,
      domesticShareRmb,
      unitQuoteRmb,
      unitActualRmb,
      unitHeadhaulRmb,
      confidence: conf,
      reasons,
    });
  }

  return {
    boxNo: box.boxNo,
    forwarder: box.forwarder,
    mode,
    weightKg: effectiveWeight,
    volumetricKg: volKg,
    chargeableKg,
    cbm,
    quoteTotalRmb: round2(quoteTotal),
    actualTotalRmb:
      boxActual != null ? round2(boxActual + domesticTotal) : null,
    domesticTotalRmb: round2(domesticTotal),
    lines: resultLines,
  };
}

/** 票级实付 → 按箱计费量份额摊到各箱 */
export function allocateTicketFreightToBoxes(
  boxes: PackingBoxRow[],
  shipping: ShippingConfig,
): Map<string, number> {
  const out = new Map<string, number>();
  const byTicket = new Map<string, PackingBoxRow[]>();
  for (const b of boxes) {
    if (!b.ticketNo) continue;
    if (b.boxCrossFreight != null && b.boxCrossFreight > 0) continue;
    if (b.ticketCrossFreight == null || b.ticketCrossFreight <= 0) continue;
    const list = byTicket.get(b.ticketNo) ?? [];
    list.push(b);
    byTicket.set(b.ticketNo, list);
  }

  for (const [, group] of byTicket) {
    const ticketFee = group[0]!.ticketCrossFreight!;
    const weights = group.map((b) => {
      if (b.mode === "sea") {
        const c = boxCbm(b);
        return c != null && c > 0 ? c : 0;
      }
      const vol = boxVolumetricKg(b, shipping.volumetricDivisor);
      const w = b.weightKg ?? 0;
      return Math.max(w, vol ?? 0);
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < group.length; i++) {
      const share = sum > EPS ? weights[i]! / sum : 1 / group.length;
      out.set(group[i]!.boxNo, round2(ticketFee * share));
    }
  }
  return out;
}
