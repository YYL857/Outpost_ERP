/**
 * 与 apps/api/src/modules/market-intel/fbn-profit.ts 保持同步。
 * 选品页本地即时估算用（避免每行打 API）。
 */

export type FbnCommissionProfile = "general_15" | "fashion_25";

export type FbnUnitAssumptions = {
  purchaseCostSar: number | null;
  inboundListingSar: number;
  inboundPickSar: number;
  inboundHandleSar: number;
  firstMileSar: number;
  outboundFeeSar: number;
  commissionRate: number;
  vatRate: number;
  storageSar: number;
  cpcSar: number;
  assumedClicks: number;
};

export type FbnUnitBreakdown = {
  sellPriceSar: number;
  purchaseCostSar: number | null;
  referralFeeSar: number;
  vatPayableSar: number;
  adCostSar: number;
  profitSar: number;
  marginPct: number | null;
  multiple: number | null;
  profitComplete: boolean;
  missing: string[];
};

export const DEFAULT_FBN_ASSUMPTIONS_GENERAL: FbnUnitAssumptions = {
  purchaseCostSar: null,
  inboundListingSar: 0.5,
  inboundPickSar: 0.5,
  inboundHandleSar: 0.8,
  firstMileSar: 2.5,
  outboundFeeSar: 10.5,
  commissionRate: 0.15,
  vatRate: 0.15,
  storageSar: 0,
  cpcSar: 0.5,
  assumedClicks: 20,
};

export function assumptionsForProfile(
  profile: FbnCommissionProfile,
): FbnUnitAssumptions {
  if (profile === "fashion_25") {
    return { ...DEFAULT_FBN_ASSUMPTIONS_GENERAL, commissionRate: 0.25 };
  }
  return { ...DEFAULT_FBN_ASSUMPTIONS_GENERAL };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nonNeg(n: number | null | undefined, fallback = 0): number {
  if (n == null || !Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function mergeFbnAssumptions(
  base: FbnUnitAssumptions,
  overrides?: Partial<FbnUnitAssumptions> | null,
): FbnUnitAssumptions {
  if (!overrides) return { ...base };
  return {
    ...base,
    ...overrides,
    purchaseCostSar:
      overrides.purchaseCostSar === undefined
        ? base.purchaseCostSar
        : overrides.purchaseCostSar == null ||
            !Number.isFinite(overrides.purchaseCostSar) ||
            overrides.purchaseCostSar < 0
          ? null
          : overrides.purchaseCostSar,
  };
}

export function estimateFbnUnitProfit(
  sellPriceSar: number | null | undefined,
  assumptions: FbnUnitAssumptions,
): FbnUnitBreakdown | null {
  if (sellPriceSar == null || !Number.isFinite(sellPriceSar) || sellPriceSar <= 0) {
    return null;
  }
  const D = sellPriceSar;
  const E = assumptions.purchaseCostSar;
  const F = nonNeg(assumptions.inboundListingSar);
  const G = nonNeg(assumptions.inboundPickSar);
  const H = nonNeg(assumptions.inboundHandleSar);
  const I = nonNeg(assumptions.firstMileSar);
  const J = nonNeg(assumptions.outboundFeeSar);
  const rate = nonNeg(assumptions.commissionRate);
  const vatRate = nonNeg(assumptions.vatRate, 0.15);
  const M = nonNeg(assumptions.storageSar);
  const N = nonNeg(assumptions.cpcSar);
  const clicks = nonNeg(assumptions.assumedClicks, 20);

  const K = D * rate;
  const L = (K + J + M) * vatRate;
  const P = N * clicks;
  const purchase = E == null ? 0 : nonNeg(E);
  const R = D - (purchase + F + G + H + I + J + K + L + M) - P;

  const missing: string[] = [];
  if (E == null) missing.push("purchaseCostSar");
  if (M === 0) missing.push("storageSar");

  return {
    sellPriceSar: round2(D),
    purchaseCostSar: E == null ? null : round2(E),
    referralFeeSar: round2(K),
    vatPayableSar: round2(L),
    adCostSar: round2(P),
    profitSar: round2(R),
    marginPct: D > 0 ? round2((R / D) * 10000) / 10000 : null,
    multiple: E != null && E > 0 ? round2((D / E) * 100) / 100 : null,
    profitComplete: E != null && Number.isFinite(E) && E >= 0,
    missing,
  };
}
