/**
 * 解析采购明细 xlsx → 清洗行（店铺一律由 PSKU 推导）。
 */
import * as XLSX from "xlsx";
import {
  shopFromPartnerSku,
  type ShopCode,
} from "./shop-from-psku.js";

export type ParsedReplenishLine = {
  batchDate: string;
  partnerSku: string;
  shop: ShopCode;
  shopName: string;
  name: string;
  spec: string;
  qty: number;
  modePref: string;
  note: string;
};

export type ParseReplenishResult = {
  lines: ParsedReplenishLine[];
  warnings: string[];
  sheetName: string;
  /** 文件内最常见批次日 */
  batchDate: string;
};

function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeMode(raw: string): string {
  const s = raw.replace(/\s+/g, "");
  if (!s) return "待定";
  if (/空运|air/i.test(s)) return "空运";
  if (/海运|sea/i.test(s)) return "海运";
  if (/待定/.test(s)) return "待定";
  return s;
}

export function parseReplenishDetailSheet(
  values: unknown[][],
): Omit<ParseReplenishResult, "sheetName"> {
  const warnings: string[] = [];
  if (values.length < 2) {
    return { lines: [], warnings: ["表为空"], batchDate: "" };
  }

  let headerRow = -1;
  const col: Record<string, number> = {};
  for (let r = 0; r < Math.min(values.length, 8); r++) {
    const row = values[r] ?? [];
    const map = new Map<string, number>();
    for (let c = 0; c < row.length; c++) {
      const t = cellStr(row[c]);
      if (t) map.set(t, c);
    }
    if (map.has("PSKU") || map.has("psku")) {
      headerRow = r;
      col.batch = map.get("采购批次") ?? map.get("批次") ?? -1;
      col.psku = map.get("PSKU") ?? map.get("psku") ?? -1;
      col.name = map.get("名称") ?? map.get("货品名称") ?? map.get("品名") ?? -1;
      col.spec = map.get("规格") ?? -1;
      col.qty = map.get("采购数量") ?? map.get("数量") ?? -1;
      col.mode = map.get("建议发运") ?? map.get("发货方式") ?? -1;
      col.note = map.get("备注") ?? -1;
      break;
    }
  }
  if (headerRow < 0 || (col.psku ?? -1) < 0) {
    return {
      lines: [],
      warnings: ["未找到含 PSKU 的表头（采购明细）"],
      batchDate: "",
    };
  }

  const lines: ParsedReplenishLine[] = [];
  const batchCounts = new Map<string, number>();

  for (let r = headerRow + 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const partnerSku = cellStr(col.psku >= 0 ? row[col.psku] : "");
    if (!partnerSku) continue;

    const shopHit = shopFromPartnerSku(partnerSku);
    if (!shopHit) {
      warnings.push(`${partnerSku}：无法从 PSKU 识别店铺（需 N1～N4 前缀）`);
      continue;
    }

    const qty = cellNum(col.qty >= 0 ? row[col.qty] : null);
    if (qty == null || qty <= 0) {
      warnings.push(`${partnerSku}：采购数量无效，已跳过`);
      continue;
    }

    let batchDate = cellStr(col.batch >= 0 ? row[col.batch] : "");
    // Excel 序列日
    if (!batchDate && col.batch >= 0) {
      const raw = row[col.batch];
      if (typeof raw === "number" && raw > 20000) {
        const utc = Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000;
        const d = new Date(utc);
        batchDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      }
    }

    const line: ParsedReplenishLine = {
      batchDate,
      partnerSku,
      shop: shopHit.shop,
      shopName: shopHit.shopName,
      name: cellStr(col.name >= 0 ? row[col.name] : ""),
      spec: cellStr(col.spec >= 0 ? row[col.spec] : ""),
      qty,
      modePref: normalizeMode(cellStr(col.mode >= 0 ? row[col.mode] : "")),
      note: cellStr(col.note >= 0 ? row[col.note] : ""),
    };
    lines.push(line);
    if (batchDate) {
      batchCounts.set(batchDate, (batchCounts.get(batchDate) || 0) + 1);
    }
  }

  let batchDate = "";
  let best = 0;
  for (const [k, n] of batchCounts) {
    if (n > best) {
      best = n;
      batchDate = k;
    }
  }
  if (!batchDate && lines.length) {
    batchDate = new Date().toISOString().slice(0, 10);
    warnings.push(`未填采购批次，已用导入日 ${batchDate}`);
    for (const line of lines) {
      if (!line.batchDate) line.batchDate = batchDate;
    }
  } else {
    for (const line of lines) {
      if (!line.batchDate) line.batchDate = batchDate;
    }
  }

  return { lines, warnings, batchDate };
}

export function parseReplenishBatchXlsx(buf: Buffer): ParseReplenishResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const prefer = ["采购明细", "发货计划", "Sheet1"];
  const sheetName =
    prefer.find((n) => wb.SheetNames.includes(n)) || wb.SheetNames[0] || "";
  if (!sheetName) {
    return {
      lines: [],
      warnings: ["无工作表"],
      sheetName: "",
      batchDate: "",
    };
  }
  const sheet = wb.Sheets[sheetName]!;
  const values = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  const parsed = parseReplenishDetailSheet(values);
  return { ...parsed, sheetName };
}

export type ShopRollup = {
  shop: ShopCode;
  shopName: string;
  skuCount: number;
  totalQty: number;
  lines: ParsedReplenishLine[];
};

export function rollupByShop(lines: ParsedReplenishLine[]): ShopRollup[] {
  const map = new Map<ShopCode, ShopRollup>();
  for (const line of lines) {
    let g = map.get(line.shop);
    if (!g) {
      g = {
        shop: line.shop,
        shopName: line.shopName,
        skuCount: 0,
        totalQty: 0,
        lines: [],
      };
      map.set(line.shop, g);
    }
    g.lines.push(line);
    g.totalQty += line.qty;
  }
  for (const g of map.values()) {
    g.skuCount = new Set(g.lines.map((l) => l.partnerSku)).size;
  }
  return [...map.values()].sort((a, b) => a.shop.localeCompare(b.shop, "zh"));
}
