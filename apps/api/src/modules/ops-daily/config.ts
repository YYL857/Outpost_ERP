import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type WarehouseMap = {
  fbn_warehouses: string[];
  default_channel: string;
};

export type OpsDailySettings = {
  timezone: string;
  invalid_order_statuses: string[];
  return_statuses: string[];
  phase: number;
  output_file_prefix: string;
  ads_coverage?: "partial" | "full";
  /** Phase4：飞书产品表回写；默认 false（旁路只写 ops_daily CSV） */
  feishu_product_writeback?: boolean;
  /** Prep TV 去 VAT 用；feeSnapshots 路径不强制 */
  vat_rate?: number;
};

export type FbnFeeTiers = {
  packaging_weight_kg: number;
  weight_step: number;
  dim_limits_cm: Record<
    string,
    { longest: number; median: number; shortest: number }
  >;
  packaging_weight_by_dim_kg: Record<string, number>;
  weight_upgrade?: Record<string, { max_kg: number; next: string }>;
  fees_sar: Record<string, unknown>;
};

const HERE = dirname(fileURLToPath(import.meta.url));

function configDir(): string {
  const env = process.env.OUTPOST_OPS_DAILY_CONFIG_DIR?.trim();
  if (env) return env;
  // apps/api/src/modules/ops-daily → apps/api/config/ops-daily
  return join(HERE, "../../../config/ops-daily");
}

function readJson<T>(name: string, fallback: T): T {
  const path = join(configDir(), name);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_WAREHOUSE: WarehouseMap = {
  fbn_warehouses: ["RUH01S", "RUH07", "RUH01OS", "JED01"],
  default_channel: "supermall",
};

const DEFAULT_SETTINGS: OpsDailySettings = {
  timezone: "Asia/Shanghai",
  invalid_order_statuses: [
    "Cancelled",
    "canceled",
    "Returned",
    "returned",
    "Failed",
    "Undelivered",
    "Could Not Be Delivered",
    "could not be delivered",
  ],
  return_statuses: ["Returned", "returned", "return"],
  phase: 4,
  output_file_prefix: "运营面板_今天",
  ads_coverage: "partial",
  feishu_product_writeback: false,
  vat_rate: 1.15,
};

const DEFAULT_FBN_FEES: FbnFeeTiers = {
  packaging_weight_kg: 0.02,
  weight_step: 0.05,
  dim_limits_cm: {
    "Small envelope": { longest: 20, median: 15, shortest: 1 },
    "Standard envelope": { longest: 33, median: 23, shortest: 2.5 },
    "Large envelope": { longest: 33, median: 23, shortest: 5 },
    "Standard parcel": { longest: 50, median: 40, shortest: 30 },
    Oversize: { longest: 100, median: 80, shortest: 60 },
  },
  packaging_weight_by_dim_kg: {
    "Small envelope": 0.02,
    "Standard envelope": 0.04,
    "Large envelope": 0.04,
    "Standard parcel": 0.1,
    Oversize: 0.24,
    "Extra oversize": 0.24,
    default: 0.4,
  },
  weight_upgrade: {
    "Small envelope": { max_kg: 0.1, next: "Standard envelope" },
    "Standard envelope": { max_kg: 0.5, next: "Large envelope" },
    "Large envelope": { max_kg: 1.0, next: "Standard parcel" },
  },
  fees_sar: {},
};

export function loadWarehouseMap(): WarehouseMap {
  const raw = readJson<Partial<WarehouseMap> & { note?: string }>(
    "warehouse_map.json",
    DEFAULT_WAREHOUSE,
  );
  return {
    fbn_warehouses: raw.fbn_warehouses ?? DEFAULT_WAREHOUSE.fbn_warehouses,
    default_channel: raw.default_channel ?? DEFAULT_WAREHOUSE.default_channel,
  };
}

export function loadOpsDailySettings(): OpsDailySettings {
  const raw = readJson<Partial<OpsDailySettings>>(
    "settings.json",
    DEFAULT_SETTINGS,
  );
  return { ...DEFAULT_SETTINGS, ...raw };
}

export function loadFbnFeeTiers(): FbnFeeTiers {
  const raw = readJson<Partial<FbnFeeTiers> & { note?: string }>(
    "fbn_fee_tiers.json",
    DEFAULT_FBN_FEES,
  );
  return {
    packaging_weight_kg:
      raw.packaging_weight_kg ?? DEFAULT_FBN_FEES.packaging_weight_kg,
    weight_step: raw.weight_step ?? DEFAULT_FBN_FEES.weight_step,
    dim_limits_cm: raw.dim_limits_cm ?? DEFAULT_FBN_FEES.dim_limits_cm,
    packaging_weight_by_dim_kg:
      raw.packaging_weight_by_dim_kg ??
      DEFAULT_FBN_FEES.packaging_weight_by_dim_kg,
    weight_upgrade: raw.weight_upgrade ?? DEFAULT_FBN_FEES.weight_upgrade,
    fees_sar: raw.fees_sar ?? DEFAULT_FBN_FEES.fees_sar,
  };
}

export function channelForWarehouse(
  warehouseCode: string,
  map = loadWarehouseMap(),
): "FBN" | "supermall" {
  const code = warehouseCode.trim().toUpperCase();
  const fbn = new Set(map.fbn_warehouses.map((w) => w.toUpperCase()));
  if (fbn.has(code)) return "FBN";
  return map.default_channel === "FBN" ? "FBN" : "supermall";
}
