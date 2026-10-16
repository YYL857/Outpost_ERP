/**
 * Outpost 数据根：预算表 / pw-rpa 调度落在 D:\outpost-data\shops\…、pw-rpa\…
 * 注意：OUTPOST_DATA_DIR 常被设成「某店 json」目录，不能直接当根用。
 */
export function resolveOutpostDataRoot(): string {
  const explicit =
    process.env.OUTPOST_DATA_ROOT?.trim() ||
    process.env.OUTPOST_ADS_BUDGET_DATA_ROOT?.trim();
  if (explicit) return explicit;

  const dir = (
    process.env.OUTPOST_DATA_DIR ||
    process.env.DATA_DIR ||
    ""
  ).trim();
  if (!dir) return "D:\\outpost-data";

  const norm = dir.replace(/\//g, "\\").replace(/\\+$/, "");
  // D:\outpost-data\shops\PRJ396770\json → D:\outpost-data
  const m = norm.match(/^(.*)\\shops\\[^\\]+\\json$/i);
  if (m?.[1]) return m[1];
  const idx = norm.toLowerCase().indexOf("\\shops\\");
  if (idx > 0) return norm.slice(0, idx);
  return norm;
}
