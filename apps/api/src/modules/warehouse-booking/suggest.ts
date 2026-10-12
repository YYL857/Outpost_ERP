import { loadHolidayDates } from "./holidays.js";
import type { BookingDefaults } from "./types.js";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 从「明天」起，跳过节假日，取 count 个可约日期（沙特周末周五常见闭仓可后续加强） */
export function suggestBookingDates(
  count = 2,
  holidays?: string[],
  from: Date = new Date(),
): string[] {
  const blocked = new Set(holidays ?? loadHolidayDates());
  const out: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  cursor.setDate(cursor.getDate() + 1);
  let guard = 0;
  while (out.length < count && guard < 60) {
    guard += 1;
    const key = ymd(cursor);
    // 沙特：周五(5) 常难约，默认跳过；周六日可约
    const dow = cursor.getDay();
    if (!blocked.has(key) && dow !== 5) {
      out.push(key);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function buildBookingDefaults(opts?: {
  region?: string;
  warehouse?: string | null;
}): BookingDefaults {
  const region = opts?.region === "ae" ? "ae" : "sa";
  const holidays = loadHolidayDates();
  const dates = suggestBookingDates(2, holidays);
  const warehouse =
    (opts?.warehouse || "").trim() ||
    (region === "ae" ? "AUH01S" : "RUH01S");
  const hints: string[] = [
    "装箱明细已自动对齐分箱/分店/SKU",
    `仓库默认 ${warehouse}（可改）`,
    dates.length
      ? `目标日期已避开节假日：${dates.join("、")}`
      : "未能生成目标日期，请手填",
  ];
  if (holidays.length) {
    hints.push(`已加载 ${holidays.length} 个闭仓日`);
  }
  return {
    warehouse,
    dates,
    timeRangeStart: "2pm",
    timeRangeEnd: "4pm",
    preferredStart: "",
    region,
    hints,
  };
}
