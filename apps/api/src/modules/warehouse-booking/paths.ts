import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** apps/api */
const API_ROOT = resolve(MODULE_DIR, "../../..");

export function outpostRoot(): string {
  return resolve(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data");
}

export function warehouseBookingRoot(): string {
  return join(outpostRoot(), "warehouse-booking");
}

export function sessionsDir(): string {
  return join(warehouseBookingRoot(), "sessions");
}

/** 按 ASN 持久记住的约仓结果（关侧栏后仍可查） */
export function capturesDir(): string {
  return join(warehouseBookingRoot(), "captures");
}

export function activeSessionPath(): string {
  return join(warehouseBookingRoot(), "active-session.json");
}

export function ensureWarehouseBookingDirs(): void {
  for (const dir of [warehouseBookingRoot(), sessionsDir(), capturesDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function shopPrefixMapPath(): string {
  return join(API_ROOT, "config", "shop-prefix-map.json");
}

export function holidaysPath(): string {
  return join(API_ROOT, "config", "sa-warehouse-holidays.json");
}
