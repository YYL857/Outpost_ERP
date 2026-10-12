/**
 * M3：产品表 → local_cost + dims
 * 边界：只读 FeishuRawSnapshot；只写 normalized CSV + rejects；不入库、不调 API。
 *
 * 防脏：丢弃在线价/佣金/出库费/VAT/利润等平台列。
 * 衔接：主表 PSKU 多为 ARRAYFORMULA，API 无计算值 → 用「查找代码表」拼 PSKU；
 *       成本主源为「产品表每日信息」+「到仓成本」，主表作尺寸与补货方式。
 */
import type { FeishuRawSheet, FeishuRawSnapshot } from "../types.js";
import { FeishuError } from "../errors.js";
import {
  cellText,
  headerIndexMap,
  isFormulaText,
  isValidPartnerSku,
  parseNumber,
  pickCol,
} from "./cells.js";
import type {
  NormalizeReject,
  NormalizedDimsRow,
  NormalizedLocalCostRow,
} from "./types.js";

function findSheet(snap: FeishuRawSnapshot, title: string): FeishuRawSheet | undefined {
  return snap.sheets.find((s) => s.title === title);
}

function shipMode(raw: unknown): "air" | "sea" | "single" | "unknown" {
  const s = cellText(raw);
  if (s.includes("空运")) return "air";
  if (s.includes("海运")) return "sea";
  if (s.includes("单品")) return "single";
  return "unknown";
}

/** 插电 / 内置电 / 普货 → 海运分档；无法识别则 general */
function parseCargoType(raw: unknown): "plug" | "builtin" | "general" {
  const s = cellText(raw);
  if (!s) return "general";
  if (s.includes("插电")) return "plug";
  if (s.includes("内置")) return "builtin";
  if (s.includes("普货") || s.includes("普通")) return "general";
  return "general";
}

function padStyle(raw: unknown): string {
  const s = cellText(raw);
  if (!s) return "";
  if (/^\d+$/.test(s)) return s.padStart(3, "0");
  return s;
}

/** 查找代码表 → 颜色代码 / 店铺→站点 */
export function buildLookupMaps(sheet: FeishuRawSheet | undefined): {
  colorCode: Map<string, string>;
  storeSite: Map<string, string>;
} {
  const colorCode = new Map<string, string>();
  const storeSite = new Map<string, string>();
  if (!sheet || sheet.values.length < 2) return { colorCode, storeSite };
  const headers = headerIndexMap(sheet.values[0] ?? []);
  const colorI = headers.get("颜色");
  const codeI = headers.get("代码");
  const storeI = headers.get("StoreCode") ?? headers.get("店铺代码");
  const siteI = headers.get("Site") ?? headers.get("站点");

  for (let r = 1; r < sheet.values.length; r++) {
    const row = sheet.values[r] ?? [];
    if (colorI != null && codeI != null) {
      const color = cellText(row[colorI]);
      const code = cellText(row[codeI]);
      if (color && code) colorCode.set(color, code);
    }
    if (storeI != null && siteI != null) {
      const store = cellText(row[storeI]);
      const site = cellText(row[siteI]);
      if (store && site) storeSite.set(store, site);
    }
  }
  return { colorCode, storeSite };
}

function buildLandedMap(sheet: FeishuRawSheet | undefined): Map<
  string,
  { air?: number; sea?: number; single?: number }
> {
  const map = new Map<string, { air?: number; sea?: number; single?: number }>();
  if (!sheet || sheet.values.length < 2) return map;
  const headers = headerIndexMap(sheet.values[0] ?? []);
  const pskuI = headers.get("PSKU") ?? headers.get("psku");
  const modeI = headers.get("运输方式");
  const costI =
    headers.get("最终单件SKU成本") ??
    headers.get("到仓成本") ??
    headers.get("成本");
  if (pskuI == null || modeI == null || costI == null) return map;

  for (let r = 1; r < sheet.values.length; r++) {
    const row = sheet.values[r] ?? [];
    const psku = cellText(row[pskuI]);
    if (!isValidPartnerSku(psku)) continue;
    const mode = shipMode(row[modeI]);
    const cost = parseNumber(row[costI]);
    if (cost == null) continue;
    const cur = map.get(psku) ?? {};
    if (mode === "air") cur.air = cost;
    else if (mode === "sea") cur.sea = cost;
    else if (mode === "single") cur.single = cost;
    map.set(psku, cur);
  }
  return map;
}

function buildDailyPurchaseMap(
  sheet: FeishuRawSheet | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!sheet || sheet.values.length < 2) return map;
  const headers = headerIndexMap(sheet.values[0] ?? []);
  const pskuI = headers.get("psku") ?? headers.get("PSKU");
  const costI = headers.get("采购单价");
  if (pskuI == null || costI == null) return map;
  for (let r = 1; r < sheet.values.length; r++) {
    const row = sheet.values[r] ?? [];
    const psku = cellText(row[pskuI]);
    if (!isValidPartnerSku(psku)) continue;
    const cost = parseNumber(row[costI]);
    if (cost == null) continue;
    map.set(psku, cost);
  }
  return map;
}

function resolveHeadhaul(
  prefer: "air" | "sea" | "single" | "unknown",
  purchase: number | null,
  landed: { air?: number; sea?: number; single?: number } | undefined,
): number {
  let landedPick: number | null = null;
  if (prefer === "air") landedPick = landed?.air ?? null;
  else if (prefer === "sea") landedPick = landed?.sea ?? null;
  else if (prefer === "single") landedPick = landed?.single ?? null;
  else {
    landedPick = landed?.sea ?? landed?.air ?? landed?.single ?? null;
  }
  if (landedPick == null) return 0;
  if (purchase != null && landedPick >= purchase) {
    return Math.round((landedPick - purchase) * 10000) / 10000;
  }
  return landedPick;
}

export function reconstructPsku(
  row: unknown[],
  headers: Map<string, number>,
  colorCode: Map<string, string>,
  storeSite: Map<string, string>,
): string | null {
  const direct = pickCol(row, headers, ["PSKU", "psku"]);
  if (isValidPartnerSku(direct)) return cellText(direct);

  const store = cellText(pickCol(row, headers, ["店铺代码", "StoreCode"]));
  const cat = cellText(pickCol(row, headers, ["类目代码"]));
  const style = padStyle(pickCol(row, headers, ["款式代码"]));
  const colorName = cellText(pickCol(row, headers, ["颜色"]));
  if (!store || !cat || !style) return null;

  const site = storeSite.get(store) || "SA";
  const color = colorCode.get(colorName) || "";
  // 无颜色码时仍可拼出前缀；缺色码则无法与运营 PSKU 对齐
  if (!color) return null;
  const built = `${store}${site}${cat}${style}${color}`;
  return isValidPartnerSku(built) ? built : null;
}

export function normalizeProductSnapshot(
  snap: FeishuRawSnapshot,
  updatedAt = new Date().toISOString(),
): {
  costs: NormalizedLocalCostRow[];
  dims: NormalizedDimsRow[];
  rejects: NormalizeReject[];
} {
  if (snap.version !== 1) {
    throw new FeishuError(
      "snapshot.version 非 1",
      "SNAPSHOT_INVALID",
      "normalize",
      { version: snap.version },
    );
  }

  const product = findSheet(snap, "产品");
  if (!product) {
    throw new FeishuError(
      "产品快照缺少「产品」工作表",
      "SHEET_NOT_FOUND",
      "normalize",
      { available: snap.sheets.map((s) => s.title) },
      "Puller 的 sheetTitles 需包含「产品」",
    );
  }

  const headers = headerIndexMap(product.values[0] ?? []);
  if (!headers.has("PSKU") && !headers.has("店铺代码")) {
    throw new FeishuError(
      "产品表缺少 PSKU/店铺代码 表头",
      "NORMALIZE_HEADER",
      "normalize",
      { available: [...headers.keys()].slice(0, 40) },
    );
  }

  const { colorCode, storeSite } = buildLookupMaps(findSheet(snap, "查找代码表"));
  const dailyMap = buildDailyPurchaseMap(findSheet(snap, "产品表每日信息"));
  const landedMap = buildLandedMap(findSheet(snap, "到仓成本"));

  const preferBySku = new Map<string, "air" | "sea" | "single" | "unknown">();
  const cargoBySku = new Map<string, "plug" | "builtin" | "general">();
  const dims: NormalizedDimsRow[] = [];
  const rejects: NormalizeReject[] = [];
  const dimSeen = new Set<string>();

  for (let r = 1; r < product.values.length; r++) {
    const row = product.values[r] ?? [];
    const rowNum = r + 1;

    const name = cellText(pickCol(row, headers, ["名称"]));
    const store = cellText(pickCol(row, headers, ["店铺代码"]));
    const hasSignal =
      name ||
      store ||
      parseNumber(pickCol(row, headers, ["长"])) != null ||
      parseNumber(pickCol(row, headers, ["重量"])) != null;
    if (!hasSignal) continue;

    const partnerSku = reconstructPsku(row, headers, colorCode, storeSite);
    if (!partnerSku) {
      const rawPsku = cellText(pickCol(row, headers, ["PSKU", "psku"]));
      if (rawPsku && isFormulaText(rawPsku)) {
        rejects.push({
          sheet: "产品",
          row: rowNum,
          reason: "formula_psku",
          detail: "ARRAYFORMULA 无计算值且无法由店铺/类目/款式/颜色拼出",
        });
      } else {
        rejects.push({
          sheet: "产品",
          row: rowNum,
          reason: "missing_psku",
          detail: `store=${store} color=${cellText(pickCol(row, headers, ["颜色"]))}`,
        });
      }
      continue;
    }

    preferBySku.set(
      partnerSku,
      shipMode(pickCol(row, headers, ["默认补货方式"])),
    );
    cargoBySku.set(
      partnerSku,
      parseCargoType(
        pickCol(row, headers, ["货物类型", "电池类型", "品类", "货物属性"]),
      ),
    );

    if (dimSeen.has(partnerSku)) continue;
    dimSeen.add(partnerSku);

    const lengthCm = parseNumber(pickCol(row, headers, ["长"])) ?? 0;
    const widthCm = parseNumber(pickCol(row, headers, ["宽"])) ?? 0;
    const heightCm = parseNumber(pickCol(row, headers, ["高"])) ?? 0;
    const weightKg = parseNumber(pickCol(row, headers, ["重量"])) ?? 0;
    if (lengthCm > 0 || widthCm > 0 || heightCm > 0 || weightKg > 0) {
      dims.push({
        partnerSku,
        lengthCm,
        widthCm,
        heightCm,
        weightKg,
        updatedAt,
        source: "feishu:product",
      });
    }
  }

  // 成本主源：每日采购 ∪ 到仓成本
  const costSkus = new Set<string>([...dailyMap.keys(), ...landedMap.keys()]);
  const costs: NormalizedLocalCostRow[] = [];
  for (const partnerSku of costSkus) {
    const purchase = dailyMap.get(partnerSku) ?? null;
    const prefer = preferBySku.get(partnerSku) ?? "unknown";
    const headhaul = resolveHeadhaul(prefer, purchase, landedMap.get(partnerSku));
    if (purchase == null && headhaul <= 0) {
      rejects.push({
        sheet: "产品表每日信息|到仓成本",
        row: 0,
        partnerSku,
        reason: "no_cost",
      });
      continue;
    }
    costs.push({
      partnerSku,
      purchaseCost: purchase ?? 0,
      headhaul,
      preferAir: prefer === "air",
      cargoType: cargoBySku.get(partnerSku) ?? "general",
      updatedAt,
      source: dailyMap.has(partnerSku)
        ? "feishu:product_daily+landed"
        : "feishu:landed",
    });
  }

  costs.sort((a, b) => a.partnerSku.localeCompare(b.partnerSku));
  dims.sort((a, b) => a.partnerSku.localeCompare(b.partnerSku));

  if (costs.length === 0 && dims.length === 0) {
    throw new FeishuError(
      "产品表规范化结果为空",
      "NORMALIZE_EMPTY",
      "normalize",
      {
        rejects: rejects.length,
        dailyMapSize: dailyMap.size,
        landedMapSize: landedMap.size,
        colorCodes: colorCode.size,
        storeSites: storeSite.size,
        hintRows: rejects.slice(0, 5),
      },
      "确认 Puller 含「产品表每日信息」「到仓成本」「查找代码表」，且 valueRenderOption=ToString",
    );
  }

  return { costs, dims, rejects };
}
