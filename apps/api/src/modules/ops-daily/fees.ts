/**
 * Phase4 · Prep 3.0 周任务：自己出库费 + 佣金/平台出库费。
 * 只读 state（skuDims / catalog / feeSnapshots）+ fbn_fee_tiers；不写 Catalog。
 */
import type {
  AppState,
  CatalogItem,
  FeeSnapshot,
  SkuDims,
} from "../../common/types.js";
import { loadFbnFeeTiers, type FbnFeeTiers } from "./config.js";

export type SelfOutboundRow = {
  psku: string;
  自己出库费: number;
  fbn_尺寸分类: string;
  shipping_weight_kg: number;
};

export type WeeklyFeeRow = {
  psku: string;
  自己出库费: number | "";
  佣金比例: number | "";
  平台实际出库费: number | "";
  fbn_尺寸分类?: string;
  shipping_weight_kg?: number;
};

const DIM_ORDER = [
  "Small envelope",
  "Standard envelope",
  "Large envelope",
  "Standard parcel",
  "Oversize",
] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function sides(
  length: number,
  width: number,
  height: number,
): [number, number, number] {
  const s = [length, width, height].sort((a, b) => b - a);
  return [s[0]!, s[1]!, s[2]!];
}

export function dimClass(
  longest: number,
  median: number,
  shortest: number,
  tiers: FbnFeeTiers = loadFbnFeeTiers(),
): string {
  for (const name of DIM_ORDER) {
    const lim = tiers.dim_limits_cm[name];
    if (!lim) continue;
    if (
      longest <= lim.longest &&
      median <= lim.median &&
      shortest <= lim.shortest
    ) {
      return name;
    }
  }
  return "Extra oversize";
}

export function shipWeight(
  weightKg: number,
  dimClassName: string,
  tiers: FbnFeeTiers = loadFbnFeeTiers(),
): { dimClass: string; shippingWeightKg: number } {
  const packMap = tiers.packaging_weight_by_dim_kg;
  const upgrades = tiers.weight_upgrade ?? {};
  let cur = dimClassName;
  let pack = packMap[cur] ?? packMap.default ?? tiers.packaging_weight_kg;
  let pre = weightKg + pack;
  let guard = 0;
  while (upgrades[cur] && pre > upgrades[cur]!.max_kg && guard < 8) {
    cur = upgrades[cur]!.next;
    pack = packMap[cur] ?? packMap.default ?? pack;
    pre = weightKg + pack;
    guard += 1;
  }
  const step = tiers.weight_step || 0.05;
  const shipW = Math.round(pre / step) * step;
  return { dimClass: cur, shippingWeightKg: round2(shipW) };
}

function bandKey(aspLte25: boolean): string[] {
  return aspLte25 ? ["lte25", "<=25"] : ["gt25", ">25"];
}

function pickAsp(node: Record<string, unknown>, aspLte25: boolean): number {
  for (const k of bandKey(aspLte25)) {
    const v = node[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  const d = node.default;
  if (typeof d === "number" && Number.isFinite(d)) return d;
  return 0;
}

export function feeForDim(
  dimClassName: string,
  shipW: number,
  priceSar: number,
  tiers: FbnFeeTiers = loadFbnFeeTiers(),
): number {
  const aspLte25 = priceSar <= 25;
  const fees = tiers.fees_sar;
  const node = (fees[dimClassName] ??
    fees["Extra oversize"] ??
    { default: 0 }) as Record<string, unknown>;
  const bands = node.bands;
  if (Array.isArray(bands)) {
    for (const band of bands) {
      if (!band || typeof band !== "object") continue;
      const b = band as Record<string, unknown>;
      const maxKg = Number(b.max_kg);
      if (Number.isFinite(maxKg) && shipW <= maxKg) {
        return pickAsp(b, aspLte25);
      }
    }
    const last = bands[bands.length - 1] as Record<string, unknown> | undefined;
    if (last) return pickAsp(last, aspLte25);
  }
  return pickAsp(node, aspLte25);
}

function onlinePrice(c: CatalogItem | undefined): number {
  if (!c) return 0;
  if (c.activePrice != null && Number.isFinite(c.activePrice)) {
    return c.activePrice;
  }
  return Number(c.price) || 0;
}

export function computeSelfOutboundFee(
  dims: SkuDims[],
  catalogByPsku: Map<string, CatalogItem>,
  tiers: FbnFeeTiers = loadFbnFeeTiers(),
): SelfOutboundRow[] {
  const rows: SelfOutboundRow[] = [];
  for (const d of dims) {
    const psku = (d.partnerSku ?? "").trim();
    if (!psku) continue;
    const L = Number(d.lengthCm) || 0;
    const W = Number(d.widthCm) || 0;
    const H = Number(d.heightCm) || 0;
    const weight = Number(d.weightKg) || 0;
    if (L <= 0 && W <= 0 && H <= 0 && weight <= 0) continue;
    const [longest, median, shortest] = sides(L, W, H);
    const baseDim = dimClass(longest, median, shortest, tiers);
    const { dimClass: finalDim, shippingWeightKg } = shipWeight(
      weight,
      baseDim,
      tiers,
    );
    const price = onlinePrice(catalogByPsku.get(psku));
    const fee = feeForDim(finalDim, shippingWeightKg, price, tiers);
    rows.push({
      psku,
      自己出库费: fee,
      fbn_尺寸分类: finalDim,
      shipping_weight_kg: shippingWeightKg,
    });
  }
  return rows;
}

/** feeSnapshots → 佣金比例 / 平台实际出库费（v1 聚合；不对齐 TV 行级最新单） */
export function commissionFromFeeSnapshots(
  fees: FeeSnapshot[],
): Map<string, { 佣金比例: number; 平台实际出库费: number }> {
  const out = new Map<
    string,
    { 佣金比例: number; 平台实际出库费: number }
  >();
  for (const f of fees) {
    const psku = (f.partnerSku ?? "").trim();
    if (!psku) continue;
    out.set(psku, {
      佣金比例: round3(Number(f.commissionRate) || 0),
      平台实际出库费: round2(Number(f.outboundFee) || 0),
    });
  }
  return out;
}

export function buildWeeklyFeeRows(
  state: AppState,
  opts: { prefixes?: string[]; tiers?: FbnFeeTiers } = {},
): WeeklyFeeRow[] {
  const tiers = opts.tiers ?? loadFbnFeeTiers();
  const prefixes = opts.prefixes ?? [];
  const catalogByPsku = new Map<string, CatalogItem>();
  for (const c of state.catalog ?? []) {
    const psku = (c.partnerSku ?? "").trim();
    if (!psku) continue;
    const prev = catalogByPsku.get(psku);
    if (!prev || (c.isActive && !prev.isActive)) catalogByPsku.set(psku, c);
  }

  const dims = (state.skuDims ?? []).filter((d) => {
    const psku = (d.partnerSku ?? "").trim();
    if (!psku) return false;
    if (!prefixes.length) return true;
    return prefixes.some((p) => psku.startsWith(p));
  });

  const selfRows = computeSelfOutboundFee(dims, catalogByPsku, tiers);
  const selfBy = new Map(selfRows.map((r) => [r.psku, r]));
  const platBy = commissionFromFeeSnapshots(
    (state.feeSnapshots ?? []).filter((f) => {
      const psku = (f.partnerSku ?? "").trim();
      if (!prefixes.length) return true;
      return prefixes.some((p) => psku.startsWith(p));
    }),
  );

  const keys = new Set<string>([...selfBy.keys(), ...platBy.keys()]);
  const rows: WeeklyFeeRow[] = [];
  for (const psku of [...keys].sort()) {
    const self = selfBy.get(psku);
    const plat = platBy.get(psku);
    rows.push({
      psku,
      自己出库费: self ? self.自己出库费 : "",
      佣金比例: plat ? plat.佣金比例 : "",
      平台实际出库费: plat ? plat.平台实际出库费 : "",
      fbn_尺寸分类: self?.fbn_尺寸分类,
      shipping_weight_kg: self?.shipping_weight_kg,
    });
  }
  return rows;
}

export const WEEKLY_FEE_HEADER = [
  "psku",
  "自己出库费",
  "佣金比例",
  "平台实际出库费",
] as const;

export function weeklyFeeRowsToCsv(rows: WeeklyFeeRow[]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [WEEKLY_FEE_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(r.psku),
        esc(r.自己出库费),
        esc(r.佣金比例),
        esc(r.平台实际出库费),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
