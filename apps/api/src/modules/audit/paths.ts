import { join, resolve } from "node:path";
import { OUTPOST_ROOT } from "../../shops/registry.js";

/** 审计根目录：OUTPOST_AUDIT_DIR 或 {OUTPOST_ROOT}/audit */
export function auditRootDir() {
  const override = process.env.OUTPOST_AUDIT_DIR?.trim();
  return resolve(override || join(OUTPOST_ROOT, "audit"));
}

export function eventsDir() {
  return join(auditRootDir(), "events");
}

export function dailyDir() {
  return join(auditRootDir(), "daily");
}

/** events/yyyy/mm/yyyy-mm-dd.jsonl */
export function eventsFileForDay(day: string) {
  const [y, m] = day.split("-");
  return join(eventsDir(), y || "0000", m || "00", `${day}.jsonl`);
}

/** daily/yyyy/mm/yyyy-mm-dd.json */
export function dailyFileForDay(day: string) {
  const [y, m] = day.split("-");
  return join(dailyDir(), y || "0000", m || "00", `${day}.json`);
}
