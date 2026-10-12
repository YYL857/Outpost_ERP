/**
 * Noon FBN 单件销售毛利核算（对齐《NOON平台的成本与利润核算表》
 * 「15%普货销售利润核算」/「25%时尚用品销售利润核算」）。
 *
 * 公式（表内 R / T / S）：
 *   referralFee K = sellPrice * commissionRate
 *   vatPayable  L = (K + outboundFee J + storage M) * vatRate
 *   adCost      P = cpc * assumedClicks   （表默认按 20 次点击成交）
 *   profit      R = sellPrice − Σ(E…M) − P
 *   marginPct   T = R / sellPrice
 *   multiple    S = sellPrice / purchaseCost
 *
 * 选品阶段通常只有售价；其余为可调假设。缺货源时仍可算「平台侧扣费后剩余」，
 * 但 profitComplete=false，UI 应标「估算」。
 */

export type FbnCommissionProfile = "general_15" | "fashion_25";

export type FbnUnitAssumptions = {
  /** 采购成本 SAR（表 E）；可空=未知货源 */
  purchaseCostSar: number | null;
  /** 海外仓上架 F */
  inboundListingSar: number;
  /** 海外仓拣货 G */
  inboundPickSar: number;
  /** 海外仓操作 H */
  inboundHandleSar: number;
  /** 头程成本 I（SAR/件） */
  firstMileSar: number;
  /** 落地配 J · fbn outbound fee */
  outboundFeeSar: number;
  /** 类目佣金率（表 K = D * rate） */
  commissionRate: number;
  /** 平台服务 VAT 税率（表 L 用 15%） */
  vatRate: number;
  /** 月度仓储成本 M（未知时用 0） */
  storageSar: number;
  /** 广告单次竞价 N */
  cpcSar: number;
  /** 假设成交点击次数（表用 P=N*20） */
  assumedClicks: number;
};

export type FbnUnitBreakdown = {
  sellPriceSar: number;
  purchaseCostSar: number | null;
  inboundListingSar: number;
  inboundPickSar: number;
  inboundHandleSar: number;
  firstMileSar: number;
  outboundFeeSar: number;
  referralFeeSar: number;
  vatPayableSar: number;
  storageSar: number;
  adCostSar: number;
  /** 销售毛利 R（SAR） */
  profitSar: number;
  /** 销售利润率 T */
  marginPct: number | null;
  /** 翻倍倍数 S = D/E；无货源时 null */
  multiple: number | null;
  /** 货源已填且售价有效 → 可当完整估算 */
  profitComplete: boolean;
  /** 缺哪些关键输入 */
  missing: string[];
};

/** 表内 15% 普货样例行默认档（不含仓储引用；仓储默认 0） */
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

/** 表内 25% 时尚样例行（费用结构同普货，仅佣金率不同） */
export const DEFAULT_FBN_ASSUMPTIONS_FASHION: FbnUnitAssumptions = {
  ...DEFAULT_FBN_ASSUMPTIONS_GENERAL,
  commissionRate: 0.25,
};

export function assumptionsForProfile(
  profile: FbnCommissionProfile,
): FbnUnitAssumptions {
  return profile === "fashion_25"
    ? { ...DEFAULT_FBN_ASSUMPTIONS_FASHION }
    : { ...DEFAULT_FBN_ASSUMPTIONS_GENERAL };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nonNeg(n: number | null | undefined, fallback = 0): number {
  if (n == null || !Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/** 合并用户覆盖到默认假设 */
export function mergeFbnAssumptions(
  base: FbnUnitAssumptions,
  overrides?: Partial<FbnUnitAssumptions> | null,
): FbnUnitAssumptions {
  if (!overrides) return { ...base };
  const next = { ...base };
  for (const key of Object.keys(overrides) as (keyof FbnUnitAssumptions)[]) {
    const v = overrides[key];
    if (v === undefined) continue;
    if (key === "purchaseCostSar") {
      next.purchaseCostSar =
        v == null || !Number.isFinite(v as number) || (v as number) < 0
          ? null
          : (v as number);
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      (next as Record<string, number | null>)[key] = v;
    }
  }
  return next;
}

/**
 * 按表公式估算单件 FBN 销售毛利。
 * sellPrice 无效时返回 null。
 */
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
  const sumEM = purchase + F + G + H + I + J + K + L + M;
  const R = D - sumEM - P;

  const missing: string[] = [];
  if (E == null) missing.push("purchaseCostSar");
  if (M === 0) missing.push("storageSar"); // 明示用了默认 0，非「已测算仓储」

  const profitComplete = E != null && Number.isFinite(E) && E >= 0;

  return {
    sellPriceSar: round2(D),
    purchaseCostSar: E == null ? null : round2(E),
    inboundListingSar: round2(F),
    inboundPickSar: round2(G),
    inboundHandleSar: round2(H),
    firstMileSar: round2(I),
    outboundFeeSar: round2(J),
    referralFeeSar: round2(K),
    vatPayableSar: round2(L),
    storageSar: round2(M),
    adCostSar: round2(P),
    profitSar: round2(R),
    marginPct: D > 0 ? round2((R / D) * 10000) / 10000 : null,
    multiple: E != null && E > 0 ? round2((D / E) * 100) / 100 : null,
    profitComplete,
    missing,
  };
}

/** 从 query / body 解析假设覆盖（选品页 + CSV 共用） */
export function parseFbnAssumptionQuery(
  q: Record<string, unknown>,
): Partial<FbnUnitAssumptions> & { profile?: FbnCommissionProfile } {
  const num = (key: string): number | undefined => {
    const raw = q[key];
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const profileRaw = typeof q.profile === "string" ? q.profile.trim() : "";
  const profile: FbnCommissionProfile | undefined =
    profileRaw === "fashion_25" || profileRaw === "general_15"
      ? profileRaw
      : undefined;

  const purchase =
    num("purchaseCostSar") ?? num("costSar"); /* 兼容旧粗毛利参数 */
  const firstMile = num("firstMileSar");
  const outbound = num("outboundFeeSar") ?? num("shipSar"); /* 旧「运费」≈落地配 */
  const commissionRate = num("commissionRate");
  const vatRate = num("vatRate");
  const storageSar = num("storageSar");
  const cpcSar = num("cpcSar");
  const assumedClicks = num("assumedClicks");
  const inboundListingSar = num("inboundListingSar");
  const inboundPickSar = num("inboundPickSar");
  const inboundHandleSar = num("inboundHandleSar");

  const out: Partial<FbnUnitAssumptions> & { profile?: FbnCommissionProfile } =
    {};
  if (profile) out.profile = profile;
  if (purchase !== undefined) out.purchaseCostSar = purchase >= 0 ? purchase : null;
  if (firstMile !== undefined) out.firstMileSar = firstMile;
  if (outbound !== undefined) out.outboundFeeSar = outbound;
  if (commissionRate !== undefined) out.commissionRate = commissionRate;
  if (vatRate !== undefined) out.vatRate = vatRate;
  if (storageSar !== undefined) out.storageSar = storageSar;
  if (cpcSar !== undefined) out.cpcSar = cpcSar;
  if (assumedClicks !== undefined) out.assumedClicks = assumedClicks;
  if (inboundListingSar !== undefined) out.inboundListingSar = inboundListingSar;
  if (inboundPickSar !== undefined) out.inboundPickSar = inboundPickSar;
  if (inboundHandleSar !== undefined) out.inboundHandleSar = inboundHandleSar;
  return out;
}

export function resolveFbnAssumptionsFromQuery(
  q: Record<string, unknown>,
): FbnUnitAssumptions {
  const parsed = parseFbnAssumptionQuery(q);
  const { profile, ...overrides } = parsed;
  const base = assumptionsForProfile(profile ?? "general_15");
  return mergeFbnAssumptions(base, overrides);
}
