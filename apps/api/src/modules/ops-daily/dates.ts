/** Asia/Shanghai 业务日（OUTPOST_LOCK v1） */

export function shanghaiYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** YYYY-MM-DD + delta calendar days（按 UTC 日切片，与看板一致） */
export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** 含 asOf 共 lastN 个日历日：asOf-(N-1) … asOf */
export function windowStartYmd(asOf: string, lastN: number): string {
  return addDaysYmd(asOf, -(Math.max(1, lastN) - 1));
}

/** 时间戳 → 上海日历日；失败返回 null */
export function toShanghaiYmd(ts: string): string | null {
  const t = Date.parse(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  // noon export 多为本地墙钟无 TZ；按字面日期优先
  const m = ts.trim().match(/^(20\d{2}-\d{2}-\d{2})/);
  if (m) return m[1]!;
  if (!Number.isFinite(t)) return null;
  return shanghaiYmd(new Date(t));
}

export function inInclusiveWindow(
  ymd: string | null,
  from: string,
  to: string,
): boolean {
  if (!ymd) return false;
  return ymd >= from && ymd <= to;
}
