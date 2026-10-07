/**
 * 一次性：对当前活跃店铺扫 portal-imports 入库 ads
 * 用法：在 apps/api 下 node ../../node_modules/tsx/dist/cli.mjs scripts/ingest-ads-once.mts
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bootstrapShops, getActiveShop, OUTPOST_ROOT } from "../src/shops/registry.js";
import { loadState, saveState } from "../src/data/store.js";
import { runAutoIngest } from "../src/platforms/noon/portal/auto-ingest.js";
import { processPendingInbox } from "../src/modules/sync/pipeline.js";

const { active } = bootstrapShops();
const shop = getActiveShop();
console.log("[ingest] active shop", shop.id, shop.rootDir);

const globalImports = join(OUTPOST_ROOT, "portal-imports");
const shopImports = join(shop.rootDir, "portal-imports");
if (!existsSync(shopImports)) mkdirSync(shopImports, { recursive: true });

// 把全局热目录里的 ads 文件同步到当前店（影刀默认写全局）
if (existsSync(globalImports)) {
  for (const name of readdirSync(globalImports)) {
    if (!/ads|overview/i.test(name)) continue;
    if (!/\.(csv|txt|json)$/i.test(name)) continue;
    const from = join(globalImports, name);
    const to = join(shopImports, name);
    copyFileSync(from, to);
    console.log("[ingest] synced", name, "→ shop portal-imports");
  }
}

const state = loadState();
state.noon.partnerId = shop.projectCode;
const result = await runAutoIngest(state, { force: true });
for (let i = 0; i < 80; i++) {
  const { processed } = await processPendingInbox(state, 300);
  if (!processed) break;
}
saveState(state);

console.log("[ingest] result", JSON.stringify(result, null, 2));
console.log("[ingest] adsFacts", state.adsFacts?.length ?? 0);
if (state.adsFacts?.length) {
  const sample = state.adsFacts.slice(0, 3).map((a) => ({
    sku: a.partner_sku,
    spend: a.spend,
    revenue: a.revenue,
    from: a.from_date,
    to: a.to_date,
  }));
  console.log("[ingest] sample", sample);
}
