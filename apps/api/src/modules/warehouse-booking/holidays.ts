import { existsSync, readFileSync } from "node:fs";
import { holidaysPath } from "./paths.js";

export function loadHolidayDates(): string[] {
  const path = holidaysPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { dates?: string[] };
    return (raw.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch {
    return [];
  }
}

export function holidaysInList(dates: string[], holidays: string[]): string[] {
  const set = new Set(holidays);
  return dates.filter((d) => set.has(d));
}
