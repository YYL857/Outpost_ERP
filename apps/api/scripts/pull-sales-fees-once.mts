/**
 * 一次性：live Impex 拉 sales + fees（各占 1 次导出配额，约 30 分钟窗口内最多 2 次）。
 * ads 无 Impex，请继续用影刀 → portal-imports。
 *
 * 用法（apps/api）：
 *   npx tsx scripts/pull-sales-fees-once.mts
 *   npx tsx scripts/pull-sales-fees-once.mts sales
 *   npx tsx scripts/pull-sales-fees-once.mts fees
 */
import { bootstrapShops, getActiveShop } from "../src/shops/registry.js";
import { loadState, saveState } from "../src/data/store.js";
import { pullDomain } from "../src/modules/sync/pipeline.js";

const arg = (process.argv[2] ?? "both").toLowerCase();
const domains =
  arg === "sales"
    ? (["sales"] as const)
    : arg === "fees"
      ? (["fees"] as const)
      : (["sales", "fees"] as const);

bootstrapShops();
const shop = getActiveShop();
console.log("[pull] active shop", shop.id, shop.projectCode);

const state = loadState();
if (state.noon.mode !== "live") {
  console.warn("[pull] noon.mode=", state.noon.mode, "（建议 live 走 Impex）");
}
state.noon.enabled = true;
state.noon.partnerId = shop.projectCode;

for (const domain of domains) {
  console.log(`[pull] start ${domain} …`);
  try {
    await pullDomain(state, domain);
    const n =
      domain === "sales" ? state.salesFacts.length : state.feeSnapshots.length;
    console.log(`[pull] ${domain} ok → count=${n}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pull] ${domain} FAIL:`, msg);
    if (/export limit|限额/i.test(msg)) {
      console.error("[pull] Impex 限额，请约 30 分钟后再拉另一域");
      break;
    }
  }
}

saveState(state);
console.log("[pull] done", {
  salesFacts: state.salesFacts.length,
  feeSnapshots: state.feeSnapshots.length,
  adsFacts: state.adsFacts.length,
  catalog: state.catalog.length,
});
if (state.salesFacts[0]) {
  console.log("[pull] sales sample", state.salesFacts[0]);
}
if (state.feeSnapshots[0]) {
  console.log("[pull] fees sample", state.feeSnapshots[0]);
}

// 若慧运营 API 已启动，热重载内存，避免磁盘已更新但页面仍空
try {
  const res = await fetch("http://127.0.0.1:8787/api/shops/reload", {
    method: "POST",
  });
  const body = await res.text();
  console.log("[pull] api reload", res.status, body.slice(0, 200));
} catch (err) {
  console.log(
    "[pull] API 未连通，请稍后手动 POST http://127.0.0.1:8787/api/shops/reload",
    err instanceof Error ? err.message : err,
  );
}
