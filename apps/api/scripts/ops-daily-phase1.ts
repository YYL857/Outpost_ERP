/**
 * Phase1 运营面板导出（供 FLOW golden diff）
 *
 *   pnpm exec tsx scripts/ops-daily-phase1.ts
 *   pnpm exec tsx scripts/ops-daily-phase1.ts --shop PRJ396770 --asOf 2026-09-28
 */
import { bootstrapShops } from "../src/shops/registry.js";
import { warmDefaultShopCache } from "../src/shops/state-cache.js";
import { runOpsDailyForShop, runOpsDailyAllShops } from "../src/modules/ops-daily/index.js";

bootstrapShops();
warmDefaultShopCache();

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] ?? null;
}
const shop = flag("--shop");
const asOf = flag("--asOf");
const all = args.includes("--all");

if (all) {
  const results = runOpsDailyAllShops({ asOf });
  for (const r of results) {
    console.log(JSON.stringify(r, null, 2));
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

const shopId = shop ?? "PRJ396770";
const result = runOpsDailyForShop(shopId, { asOf });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
