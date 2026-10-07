/**
 * M4 CLI：规范化 CSV → 当前店 AppState（按 partnerSku）
 *
 *   pnpm exec tsx scripts/feishu-ingest-local.ts
 *   pnpm exec tsx scripts/feishu-ingest-local.ts --dry-run
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { bootstrapShops } from "../src/shops/registry.js";
import { loadState, saveState } from "../src/data/store.js";
import {
  formatIngestError,
  ingestFeishuLocalIntoState,
} from "../src/platforms/feishu/ingest/local.js";
import { isFeishuError } from "../src/platforms/feishu/errors.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(apiRoot, "../..");
loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

const dryRun = process.argv.includes("--dry-run");

try {
  bootstrapShops();
  const state = loadState();
  const report = ingestFeishuLocalIntoState(state, { dryRun });
  if (!dryRun) saveState(state);
  console.log(
    JSON.stringify(
      {
        stage: "ingest",
        ok: true,
        dryRun,
        shop: state.store.account || state.store.id,
        joinKey: report.joinKey,
        report,
      },
      null,
      2,
    ),
  );
  // Catalog 缺本地成本超过 5% 时非 0 退出，便于发现对齐问题
  const missRate =
    report.catalogCount > 0
      ? report.cost.catalogMissing / report.catalogCount
      : 0;
  if (missRate > 0.05) {
    console.error(
      JSON.stringify(
        {
          stage: "align-guard",
          message: `当前店 Catalog 缺本地成本 ${(missRate * 100).toFixed(1)}%（>${5}%）`,
          catalogMissingCostSample: report.catalogMissingCost.slice(0, 10),
        },
        null,
        2,
      ),
    );
    process.exitCode = 3;
  }
} catch (e) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        fatal: true,
        error: isFeishuError(e) ? e.toJSON() : formatIngestError(e),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
