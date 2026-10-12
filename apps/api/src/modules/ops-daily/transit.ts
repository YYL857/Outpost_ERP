import type { FeishuOpsSnapshot, PurchaseLine } from "../../common/types.js";
import {
  filterInTransitPackingLines,
  loadLatestPackingLines,
  shopPrefixFromPartnerSku,
  type PackingLineRow,
} from "../../platforms/feishu/normalize/packing-lines.js";

export type TransitMetrics = {
  airInTransit: number;
  seaInTransit: number;
  purchasedQty: number;
};

const CLOSED_RE = /已到|完成|取消|签收|入仓/;

function isOpenPurchase(line: PurchaseLine): boolean {
  const blob = `${line.transitStatus ?? ""} ${line.status ?? ""}`;
  return !CLOSED_RE.test(blob);
}

function belongsPrefix(psku: string, prefixes: string[]): boolean {
  if (!prefixes.length) return true;
  const p = shopPrefixFromPartnerSku(psku);
  return Boolean(p && prefixes.includes(p));
}

export function rollupPurchaseOpen(
  lines: PurchaseLine[],
  prefixes: string[] = [],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const psku = (line.partnerSku ?? "").trim();
    if (!psku || !belongsPrefix(psku, prefixes)) continue;
    if (!isOpenPurchase(line)) continue;
    const qty = Number(line.qty) || 0;
    out.set(psku, (out.get(psku) ?? 0) + qty);
  }
  return out;
}

export function rollupPackingAirSea(
  lines: PackingLineRow[],
  prefixes: string[] = [],
): Map<string, { air: number; sea: number }> {
  const transit = filterInTransitPackingLines(lines).filter((l) => {
    const psku = (l.partnerSku ?? "").trim();
    if (!psku) return false;
    return belongsPrefix(psku, prefixes);
  });
  const out = new Map<string, { air: number; sea: number }>();
  for (const line of transit) {
    const psku = line.partnerSku.trim();
    const acc = out.get(psku) ?? { air: 0, sea: 0 };
    const qty = Number(line.qty) || 0;
    if (line.mode === "air") acc.air += qty;
    else if (line.mode === "sea") acc.sea += qty;
    out.set(psku, acc);
  }
  return out;
}

export function rollupTransitByPsku(opts: {
  purchaseLines: PurchaseLine[];
  packingLines?: PackingLineRow[];
  opsSnapshots?: FeishuOpsSnapshot[];
  prefixes?: string[];
}): Map<string, TransitMetrics> {
  const prefixes = opts.prefixes ?? [];
  const packing =
    opts.packingLines ?? loadLatestPackingLines();
  const purchased = rollupPurchaseOpen(opts.purchaseLines ?? [], prefixes);
  const packingQty = rollupPackingAirSea(packing, prefixes);
  const out = new Map<string, TransitMetrics>();

  const ensure = (psku: string): TransitMetrics => {
    const row = out.get(psku) ?? {
      airInTransit: 0,
      seaInTransit: 0,
      purchasedQty: 0,
    };
    out.set(psku, row);
    return row;
  };

  for (const [psku, qty] of purchased) {
    ensure(psku).purchasedQty = qty;
  }
  for (const [psku, ch] of packingQty) {
    const row = ensure(psku);
    row.airInTransit = ch.air;
    row.seaInTransit = ch.sea;
  }

  // 飞书日报快照：仅补 packing/采购未给出的 PSKU
  for (const snap of opts.opsSnapshots ?? []) {
    const psku = (snap.partnerSku ?? "").trim();
    if (!psku || !belongsPrefix(psku, prefixes)) continue;
    const row = ensure(psku);
    if (row.airInTransit <= 0 && snap.airInTransit > 0) {
      row.airInTransit = snap.airInTransit;
    }
    if (row.seaInTransit <= 0 && snap.seaInTransit > 0) {
      row.seaInTransit = snap.seaInTransit;
    }
    if (row.purchasedQty <= 0 && snap.purchasedQty > 0) {
      row.purchasedQty = snap.purchasedQty;
    }
  }
  return out;
}
