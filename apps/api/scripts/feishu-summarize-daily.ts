/**
 * 日报简报 LLM CLI（本地规则包 → 模型 → 本地 summary；不写飞书）
 *
 *   pnpm exec tsx scripts/feishu-summarize-daily.ts
 *   pnpm exec tsx scripts/feishu-summarize-daily.ts --from last
 *   pnpm exec tsx scripts/feishu-summarize-daily.ts --filtered D:\outpost-data\...\daily_brief_filtered.json
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  formatFeishuError,
  isFeishuError,
  summarizeDailyBriefFromFile,
} from "../src/platforms/feishu/index.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(apiRoot, "../..");
loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

function parseArgs(argv: string[]) {
  let filteredPath = "last";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--from" || a === "--filtered") {
      filteredPath = argv[++i] ?? "last";
    } else if (a.startsWith("--filtered=")) {
      filteredPath = a.slice("--filtered=".length);
    } else if (a.startsWith("--from=")) {
      filteredPath = a.slice("--from=".length);
    }
  }
  return { filteredPath };
}

async function main() {
  const { filteredPath } = parseArgs(process.argv.slice(2));
  try {
    const result = await summarizeDailyBriefFromFile({ filteredPath });
    console.log(
      JSON.stringify(
        {
          stage: "summarize-daily",
          ok: true,
          model: result.model,
          filteredPath: result.filteredPath,
          judgmentPath: result.outPaths.judgmentPath,
          markdownPath: result.outPaths.markdownPath,
          confidence: result.judgment.confidence,
          clampNotes: result.clampNotes,
          headline: result.judgment.headline,
          highlights: result.judgment.highlights.length,
          risks: result.judgment.risks.length,
          actions: result.judgment.actions.length,
        },
        null,
        2,
      ),
    );
    console.log("\n----- markdown preview -----\n");
    console.log(result.markdown);
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
