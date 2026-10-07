/**
 * M3 单元格清洗工具（不依赖飞书 API）
 */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    // 图片/嵌入对象等
    return "";
  }
  return String(v).trim();
}

export function isFormulaText(v: unknown): boolean {
  const s = cellText(v);
  if (!s) return false;
  return s.startsWith("=") || s.includes("ARRAYFORMULA");
}

/** 合法 PSKU：字母数字开头，无公式 */
export function isValidPartnerSku(v: unknown): boolean {
  const s = cellText(v);
  if (!s || isFormulaText(s)) return false;
  if (s === "未上架" || s === "null" || s === "#N/A") return false;
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(s);
}

export function parseNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  const s = cellText(v)
    .replace(/,/g, "")
    .replace(/%$/, "")
    .replace(/^[^\d.-]+/, "")
    .replace(/[^\d.-]+$/, "");
  if (!s || isFormulaText(v)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function headerIndexMap(headerRow: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const key = cellText(cell);
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

export function pickCol(
  row: unknown[],
  headers: Map<string, number>,
  names: string[],
): unknown {
  for (const name of names) {
    const i = headers.get(name);
    if (i != null) return row[i];
  }
  return undefined;
}

export function csvEscape(v: string | number | boolean): string {
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(
  headers: string[],
  rows: Array<Record<string, string | number | boolean>>,
): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}
