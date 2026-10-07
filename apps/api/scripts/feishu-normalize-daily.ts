/**
 * 日报第一步 CLI：raw daily → daily_brief_input.json
 *
 *   pnpm exec tsx scripts/feishu-normalize-daily.ts
 *   pnpm exec tsx scripts/feishu-normalize-daily.ts --run last
 *   pnpm exec tsx scripts/feishu-normalize-daily.ts --run 2026-09-17T01-39-30-657Z_c26b5b8c
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  formatFeishuError,
  isFeishuError,
  normalizeDailyBriefRun,
} from "../src/platforms/feishu/index.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(apiRoot, "../..");
loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

function parseArgs(argv: string[]) {
  let runId = "last";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--run") runId = argv[++i] ?? "last";
    else if (a.startsWith("--run=")) runId = a.slice("--run=".length);
  }
  return { runId };
}

async function main() {
  const { runId } = parseArgs(process.argv.slice(2));
  try {
    const result = normalizeDailyBriefRun({ rawRunId: runId });
    const { brief, filtered } = result;
    console.log(
      JSON.stringify(
        {
          stage: "normalize-daily",
          ok: true,
          runId: result.runId,
          sourceRawRunId: result.sourceRawRunId,
          briefPath: result.briefPath,
          filteredPath: result.filteredPath,
          rejectsPath: result.rejectsPath,
          currentSheet: brief.current.meta.title,
          previousSheet: brief.previous?.meta.title ?? null,
          currentAccepted: brief.current.accepted,
          previousAccepted: brief.previous?.accepted ?? 0,
          rejected:
            brief.current.rejected + (brief.previous?.rejected ?? 0),
          deltaCounts: filtered.deltaCounts,
          watchlistKept: filtered.watchlist.length,
          noiseStats: filtered.noiseStats,
          salesUpTop: filtered.deltas.salesUpTop.slice(0, 5),
          salesDownTop: filtered.deltas.salesDownTop.slice(0, 5),
          watchlistSample: filtered.watchlist.slice(0, 8).map((w) => ({
            partnerSku: w.partnerSku,
            productName: w.productName,
            reasons: w.reasons,
            dSales: w.dSales,
          })),
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          fatal: true,
          error: isFeishuError(e)
            ? e.toJSON()
            : JSON.parse(formatFeishuError(e)),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

await main();
