/**
 * BOM 报价：物料行汇总后调用现有 FBN 单件公式，不在这里重写毛利算法。
 */
import {
  assumptionsForProfile,
  estimateFbnUnitProfit,
  mergeFbnAssumptions,
  type FbnCommissionProfile,
  type FbnUnitAssumptions,
  type FbnUnitBreakdown,
} from "../market-intel/fbn-profit.js";

export type BomLineCategory = "purchase" | "first_mile" | "warehouse";

export type BomLineInput = {
  name: string;
  category: BomLineCategory;
  unitCostSar: number;
  qty: number;
};

export type BomMaterial = {
  name: string;
  category: BomLineCategory;
  extendedSar: number;
};

export type BomQuote = {
  profile: FbnCommissionProfile;
  sellPriceSar: number;
  breakdown: FbnUnitBreakdown;
  usedDefaults: string[];
  materials: BomMaterial[];
};

const CATEGORIES = new Set<BomLineCategory>([
  "purchase",
  "first_mile",
  "warehouse",
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumExtended(lines: BomLineInput[], category: BomLineCategory): number {
  let total = 0;
  for (const line of lines) {
    if (line.category !== category) continue;
    total += line.unitCostSar * line.qty;
  }
  return round2(total);
}

export function parseBomRequest(body: unknown): BomQuote | { error: string } {
  const o = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const sellPriceSar = Number(o.sellPriceSar);
  if (!Number.isFinite(sellPriceSar) || sellPriceSar <= 0) {
    return { error: "目标售价必须大于 0（SAR）" };
  }
  const profile: FbnCommissionProfile =
    o.profile === "fashion_25" ? "fashion_25" : "general_15";

  const rawLines = Array.isArray(o.lines) ? o.lines : [];
  if (rawLines.length > 40) return { error: "物料行最多 40 条" };

  const lines: BomLineInput[] = [];
  for (const row of rawLines) {
    if (!row || typeof row !== "object") continue;
    const line = row as Record<string, unknown>;
    const name = String(line.name ?? "").trim().slice(0, 80);
    const category = String(line.category ?? "") as BomLineCategory;
    if (!name || !CATEGORIES.has(category)) continue;
    const unitCostSar = Number(line.unitCostSar);
    const qty = Number(line.qty);
    if (!Number.isFinite(unitCostSar) || unitCostSar < 0) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    lines.push({ name, category, unitCostSar, qty });
  }

  return quoteBom({ sellPriceSar, profile, lines });
}

export function quoteBom(input: {
  sellPriceSar: number;
  profile: FbnCommissionProfile;
  lines: BomLineInput[];
}): BomQuote | { error: string } {
  const purchaseLines = input.lines.filter((l) => l.category === "purchase");
  const firstMileLines = input.lines.filter((l) => l.category === "first_mile");
  const warehouseLines = input.lines.filter((l) => l.category === "warehouse");

  const overrides: Partial<FbnUnitAssumptions> = {};
  const usedDefaults: string[] = [];

  if (purchaseLines.length) {
    overrides.purchaseCostSar = sumExtended(input.lines, "purchase");
  }
  if (firstMileLines.length) {
    overrides.firstMileSar = sumExtended(input.lines, "first_mile");
  } else {
    usedDefaults.push("头程使用成本表默认档");
  }
  if (warehouseLines.length) {
    overrides.inboundListingSar = 0;
    overrides.inboundPickSar = 0;
    overrides.inboundHandleSar = sumExtended(input.lines, "warehouse");
  } else {
    usedDefaults.push("海外仓上架、拣货、操作使用成本表默认档");
  }
  usedDefaults.push("落地配、佣金、VAT、仓储和广告点击使用成本表默认档");

  const assumptions = mergeFbnAssumptions(
    assumptionsForProfile(input.profile),
    overrides,
  );
  const breakdown = estimateFbnUnitProfit(input.sellPriceSar, assumptions);
  if (!breakdown) return { error: "目标售价必须大于 0（SAR）" };

  return {
    profile: input.profile,
    sellPriceSar: breakdown.sellPriceSar,
    breakdown,
    usedDefaults,
    materials: input.lines.map((line) => ({
      name: line.name,
      category: line.category,
      extendedSar: round2(line.unitCostSar * line.qty),
    })),
  };
}
