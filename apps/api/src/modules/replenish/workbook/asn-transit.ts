/**
 * 补货在途：箱表 ASN 为空 → 装箱明细按 PSKU 汇总；包装盒/RTV 排除。
 */
import { isPackagingOnlyRow } from "../../warehouse-booking/packing-sheet-write.js";
import {
  loadLatestPackingLines,
  shopPrefixFromPartnerSku,
  type PackingLineRow,
} from "../../../platforms/feishu/normalize/packing-lines.js";

function belongsPrefix(psku: string, prefixes: string[]): boolean {
  if (!prefixes.length) return true;
  const p = shopPrefixFromPartnerSku(psku);
  return Boolean(p && prefixes.includes(p));
}

export type AsnTransitSku = {
  partnerSku: string;
  qty: number;
  air: number;
  sea: number;
  other: number;
  modes: string[];
  shipModesLabel: string;
};

function modesLabel(air: number, sea: number, other: number): string {
  const parts: string[] = [];
  if (air > 0) parts.push("空运");
  if (sea > 0) parts.push("海运");
  if (other > 0 && !parts.length) parts.push("其他");
  else if (other > 0) parts.push("其他");
  return parts.join("+") || "";
}

/** ASN 空且非包装盒的明细行 */
export function filterAsnEmptyTransitLines(
  lines: PackingLineRow[],
): PackingLineRow[] {
  return lines.filter((l) => {
    if ((l.asn || "").trim()) return false;
    if (isPackagingOnlyRow(l.partnerSku, l.name)) return false;
    if (!(l.partnerSku || "").trim()) return false;
    return (Number(l.qty) || 0) > 0;
  });
}

export function summarizeAsnTransitBySku(
  lines: PackingLineRow[],
  prefixes: string[] = [],
): Map<string, AsnTransitSku> {
  const transit = filterAsnEmptyTransitLines(lines).filter((l) =>
    belongsPrefix(l.partnerSku, prefixes),
  );
  const map = new Map<string, AsnTransitSku>();
  for (const line of transit) {
    const psku = line.partnerSku.trim();
    const qty = Number(line.qty) || 0;
    const row = map.get(psku) ?? {
      partnerSku: psku,
      qty: 0,
      air: 0,
      sea: 0,
      other: 0,
      modes: [],
      shipModesLabel: "",
    };
    row.qty += qty;
    if (line.mode === "air") row.air += qty;
    else if (line.mode === "sea") row.sea += qty;
    else row.other += qty;
    const label =
      line.modeRaw ||
      (line.mode === "air" ? "空运" : line.mode === "sea" ? "海运" : "");
    if (label && !row.modes.includes(label)) row.modes.push(label);
    map.set(psku, row);
  }
  for (const row of map.values()) {
    row.shipModesLabel = modesLabel(row.air, row.sea, row.other);
  }
  return map;
}

export function loadAsnTransitBySku(
  prefixes: string[] = [],
): Map<string, AsnTransitSku> {
  return summarizeAsnTransitBySku(loadLatestPackingLines(), prefixes);
}
