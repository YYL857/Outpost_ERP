/** 按 PSKU 汇总单位头程（供 Catalog） */
import type {
  BoxHeadhaulResult,
  HeadhaulConfidence,
  SkuHeadhaulSummary,
} from "./types.js";
import type { FreightCargoKind } from "./cargo-name-rules.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const CONF_RANK: Record<HeadhaulConfidence, number> = {
  actual: 4,
  detailed: 3,
  approx: 2,
  fallback: 1,
};

/** 加权平均：优先实付单位，否则报价单位 */
export function summarizeSkuHeadhaul(
  boxes: BoxHeadhaulResult[],
): SkuHeadhaulSummary[] {
  type Acc = {
    partnerSku: string;
    actualCost: number;
    actualQty: number;
    quoteCost: number;
    quoteQty: number;
    boxNos: Set<string>;
    lastBoxNo: string | null;
    lastForwarder: string | null;
    cargoKind: FreightCargoKind | null;
    bestConf: HeadhaulConfidence;
  };
  const map = new Map<string, Acc>();

  for (const box of boxes) {
    for (const line of box.lines) {
      if (!line.partnerSku) continue;
      const acc =
        map.get(line.partnerSku) ??
        ({
          partnerSku: line.partnerSku,
          actualCost: 0,
          actualQty: 0,
          quoteCost: 0,
          quoteQty: 0,
          boxNos: new Set<string>(),
          lastBoxNo: null,
          lastForwarder: null,
          cargoKind: null,
          bestConf: "fallback",
        } satisfies Acc);

      acc.boxNos.add(line.boxNo);
      acc.lastBoxNo = line.boxNo;
      acc.lastForwarder = line.forwarder;
      acc.cargoKind = line.cargoKind;
      if (CONF_RANK[line.confidence] >= CONF_RANK[acc.bestConf]) {
        acc.bestConf = line.confidence;
      }

      if (line.actualRmb != null && line.qty > 0) {
        acc.actualCost += line.actualRmb;
        acc.actualQty += line.qty;
      }
      if (line.quoteRmb > 0 && line.qty > 0) {
        acc.quoteCost += line.quoteRmb;
        acc.quoteQty += line.qty;
      }
      map.set(line.partnerSku, acc);
    }
  }

  const out: SkuHeadhaulSummary[] = [];
  for (const acc of map.values()) {
    const unitActual =
      acc.actualQty > 0 ? round2(acc.actualCost / acc.actualQty) : null;
    const unitQuote =
      acc.quoteQty > 0 ? round2(acc.quoteCost / acc.quoteQty) : null;
    const basis: SkuHeadhaulSummary["basis"] =
      unitActual != null ? "actual" : unitQuote != null ? "quote" : "fallback";
    const unitHeadhaulRmb = unitActual ?? unitQuote ?? 0;
    const confidence: HeadhaulConfidence =
      basis === "actual"
        ? "actual"
        : basis === "quote"
          ? acc.bestConf === "fallback"
            ? "approx"
            : acc.bestConf
          : "fallback";

    out.push({
      partnerSku: acc.partnerSku,
      unitHeadhaulRmb,
      unitQuoteRmb: unitQuote,
      unitActualRmb: unitActual,
      sampleQty: acc.actualQty > 0 ? acc.actualQty : acc.quoteQty,
      boxCount: acc.boxNos.size,
      confidence,
      basis,
      lastBoxNo: acc.lastBoxNo,
      lastForwarder: acc.lastForwarder,
      cargoKind: acc.cargoKind,
    });
  }

  return out.sort((a, b) => a.partnerSku.localeCompare(b.partnerSku));
}

export function skuHeadhaulMap(
  summaries: SkuHeadhaulSummary[],
): Map<string, SkuHeadhaulSummary> {
  return new Map(summaries.map((s) => [s.partnerSku, s]));
}
