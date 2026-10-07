/**
 * M3：装箱表 → dims 补缺（不写采购成本，避免抢产品表）
 * 主读「SKU信息」；兼容「装箱明细」上的尺寸列。
 */
import type { FeishuRawSheet, FeishuRawSnapshot } from "../types.js";
import {
  cellText,
  headerIndexMap,
  isValidPartnerSku,
  parseNumber,
  pickCol,
} from "./cells.js";
import type { NormalizeReject, NormalizedDimsRow } from "./types.js";

function findSheet(
  snap: FeishuRawSnapshot,
  titles: string[],
): FeishuRawSheet | undefined {
  for (const t of titles) {
    const hit = snap.sheets.find((s) => s.title === t);
    if (hit) return hit;
  }
  return undefined;
}

function extractDimsFromSheet(
  sheet: FeishuRawSheet | undefined,
  updatedAt: string,
  sheetLabel: string,
  seen: Set<string>,
  dims: NormalizedDimsRow[],
  rejects: NormalizeReject[],
): void {
  if (!sheet || sheet.values.length < 2) return;
  const headers = headerIndexMap(sheet.values[0] ?? []);
  const pskuI =
    headers.get("PSKU") ??
    headers.get("psku") ??
    headers.get("Partner SKU") ??
    headers.get("partner_sku");
  if (pskuI == null) {
    rejects.push({
      sheet: sheetLabel,
      row: 0,
      partnerSku: "",
      reason: "no_psku_col",
    });
    return;
  }

  for (let r = 1; r < sheet.values.length; r++) {
    const row = sheet.values[r] ?? [];
    const partnerSku = cellText(row[pskuI]);
    if (!isValidPartnerSku(partnerSku)) {
      if (partnerSku) {
        rejects.push({
          sheet: sheetLabel,
          row: r + 1,
          partnerSku,
          reason: "invalid_psku",
        });
      }
      continue;
    }
    if (seen.has(partnerSku)) continue;

    const lengthCm =
      parseNumber(
        pickCol(row, headers, ["长", "长度", "Length", "length", "length_cm", "L"]),
      ) ?? 0;
    const widthCm =
      parseNumber(
        pickCol(row, headers, ["宽", "宽度", "Width", "width", "width_cm", "W"]),
      ) ?? 0;
    const heightCm =
      parseNumber(
        pickCol(row, headers, ["高", "高度", "Height", "height", "height_cm", "H"]),
      ) ?? 0;
    const weightKg =
      parseNumber(
        pickCol(row, headers, [
          "重量",
          "实重",
          "Weight",
          "weight",
          "weight_kg",
          "净重",
        ]),
      ) ?? 0;

    if (lengthCm <= 0 && widthCm <= 0 && heightCm <= 0 && weightKg <= 0) {
      rejects.push({
        sheet: sheetLabel,
        row: r + 1,
        partnerSku,
        reason: "no_dims",
      });
      continue;
    }

    seen.add(partnerSku);
    dims.push({
      partnerSku,
      lengthCm,
      widthCm,
      heightCm,
      weightKg,
      updatedAt,
      source: "feishu:packing",
    });
  }
}

export function normalizePackingSnapshot(
  snap: FeishuRawSnapshot,
  updatedAt: string,
): {
  dims: NormalizedDimsRow[];
  rejects: NormalizeReject[];
} {
  const dims: NormalizedDimsRow[] = [];
  const rejects: NormalizeReject[] = [];
  const seen = new Set<string>();

  // SKU信息优先；装箱明细仅补 SKU信息未覆盖的
  extractDimsFromSheet(
    findSheet(snap, ["SKU信息", "SKU 信息", "sku信息"]),
    updatedAt,
    "SKU信息",
    seen,
    dims,
    rejects,
  );
  extractDimsFromSheet(
    findSheet(snap, ["装箱明细", "箱明细"]),
    updatedAt,
    "装箱明细",
    seen,
    dims,
    rejects,
  );

  dims.sort((a, b) => a.partnerSku.localeCompare(b.partnerSku));
  return { dims, rejects };
}
