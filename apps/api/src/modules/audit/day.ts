const TZ = "Asia/Shanghai";

/** Asia/Shanghai 日历日 YYYY-MM-DD */
export function shanghaiDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
