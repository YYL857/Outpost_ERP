import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppState } from "../../common/types.js";
import { inferStorePrefixes } from "../../platforms/feishu/ingest/local.js";
import { loadRegistry } from "../../shops/registry.js";
import { getShopState } from "../../shops/state-cache.js";
import { loadOpsDailySettings } from "./config.js";
import {
  buildPhase1Panel,
  panelRowsToCsv,
  type BuildPanelResult,
} from "./build-panel.js";
import { buildWeeklyFeeRows, weeklyFeeRowsToCsv } from "./fees.js";
import { buildLandedCostRows, landedCostRowsToCsv } from "./landed.js";

export type OpsDailyRunResult = {
  ok: boolean;
  shopId: string;
  asOf: string;
  phase: number;
  rowCount: number;
  outPath: string;
  weeklyFeePath: string;
  landedCostPath: string;
  meta: BuildPanelResult["meta"] & {
    weeklyFeeRows: number;
    landedCostRows: number;
    packingPath: string | null;
    feishuProductWriteback: boolean;
  };
  message: string;
};

function findShop(shopId: string) {
  return loadRegistry().shops.find((s) => s.id === shopId) ?? null;
}

function opsDailyDir(shopRootDir: string): string {
  return join(shopRootDir, "ops_daily");
}

function emptyMeta(
  extras?: Partial<OpsDailyRunResult["meta"]>,
): OpsDailyRunResult["meta"] {
  return {
    catalogCount: 0,
    stockSkuCount: 0,
    salesExportFile: null,
    salesExportLines: 0,
    stockFile: null,
    trafficFiles: [],
    trafficLines: 0,
    adsDaysPresent: [],
    adsDaysMissing: [],
    adsCoverage: "partial",
    agingFiles: [],
    agingMoves: 0,
    transitSkuCount: 0,
    weeklyFeeRows: 0,
    landedCostRows: 0,
    packingPath: null,
    feishuProductWriteback: false,
    ...extras,
  };
}

export function runOpsDailyForShop(
  shopId: string,
  opts: { asOf?: string | null; state?: AppState } = {},
): OpsDailyRunResult {
  const shop = findShop(shopId);
  if (!shop) {
    return {
      ok: false,
      shopId,
      asOf: opts.asOf ?? "",
      phase: 4,
      rowCount: 0,
      outPath: "",
      weeklyFeePath: "",
      landedCostPath: "",
      meta: emptyMeta(),
      message: `未知店铺 ${shopId}`,
    };
  }
  const state = opts.state ?? getShopState(shopId);
  const built = buildPhase1Panel(state, shop.rootDir, opts.asOf);
  const settings = loadOpsDailySettings();
  const dir = opsDailyDir(shop.rootDir);
  mkdirSync(dir, { recursive: true });

  const fileName = `${settings.output_file_prefix}_${built.asOf}.csv`;
  const outPath = join(dir, fileName);
  writeFileSync(outPath, panelRowsToCsv(built.rows), "utf8");
  const latestPath = join(
    dir,
    `${settings.output_file_prefix}_phase${settings.phase ?? built.phase}.csv`,
  );
  writeFileSync(latestPath, panelRowsToCsv(built.rows), "utf8");

  // Phase4：周费用 + 到仓成本（旁路 CSV；不回写飞书）
  const prefixes = inferStorePrefixes(state.catalog ?? []);
  const weekly = buildWeeklyFeeRows(state, { prefixes });
  const weeklyFeePath = join(dir, "landed_产品表每周信息.csv");
  writeFileSync(weeklyFeePath, weeklyFeeRowsToCsv(weekly), "utf8");

  const landed = buildLandedCostRows(state, { prefixes });
  const landedCostPath = join(dir, "landed_到仓成本.csv");
  writeFileSync(landedCostPath, landedCostRowsToCsv(landed.rows), "utf8");

  // 带 asOf 的副本，便于 FLOW 对账归档
  const weeklyAsOf = join(
    dir,
    `landed_产品表每周信息_${shopId}_${built.asOf}.csv`,
  );
  const landedAsOf = join(dir, `landed_到仓成本_${shopId}_${built.asOf}.csv`);
  copyFileSync(weeklyFeePath, weeklyAsOf);
  copyFileSync(landedCostPath, landedAsOf);

  const feishuWrite = Boolean(settings.feishu_product_writeback);
  // 飞书产品表回写：契约允许但默认关；v1 不实现写路径
  if (feishuWrite) {
    console.warn(
      "[ops-daily] feishu_product_writeback=true 但 Phase4 v1 未实现写回，已跳过",
    );
  }

  return {
    ok: true,
    shopId,
    asOf: built.asOf,
    phase: settings.phase ?? 4,
    rowCount: built.rows.length,
    outPath,
    weeklyFeePath,
    landedCostPath,
    meta: {
      ...built.meta,
      weeklyFeeRows: weekly.length,
      landedCostRows: landed.rows.length,
      packingPath: landed.packingPath,
      feishuProductWriteback: feishuWrite,
    },
    message: `Phase${settings.phase ?? 4} 面板 ${built.rows.length} 行 + 周费用 ${weekly.length} + 到仓 ${landed.rows.length} → ${dir}`,
  };
}

export function runOpsDailyAllShops(opts: {
  asOf?: string | null;
  shopIds?: string[];
} = {}): OpsDailyRunResult[] {
  const ids =
    opts.shopIds?.length
      ? opts.shopIds
      : loadRegistry().shops.map((s) => s.id);
  return ids.map((id) => runOpsDailyForShop(id, { asOf: opts.asOf }));
}
