/**
 * M3 CLI：raw → normalized CSV（不入库）
 *
 *   pnpm exec tsx scripts/feishu-normalize.ts
 *   pnpm exec tsx scripts/feishu-normalize.ts --run last
 *   pnpm exec tsx scripts/feishu-normalize.ts --run 2026-09-17T01-39-30-657Z_c26b5b8c
 *   pnpm exec tsx scripts/feishu-normalize.ts --doc product
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  formatFeishuError,
  isFeishuError,
  normalizeFeishuRun,
} from "../src/platforms/feishu/index.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(apiRoot, "../..");
loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

function parseArgs(argv: string[]) {
  let runId = "last";
  const docIds: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--run") runId = argv[++i] ?? "last";
    else if (a.startsWith("--run=")) runId = a.slice("--run=".length);
    else if (a === "--doc" || a === "--docs") {
      const v = argv[++i];
      if (v) docIds.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
    }
  }
  return { runId, docIds };
}

async function main() {
  const { runId, docIds } = parseArgs(process.argv.slice(2));
  try {
    const manifest = normalizeFeishuRun({
      rawRunId: runId,
      docIds: docIds.length ? docIds : undefined,
    });
    const okCount = manifest.results.filter((r) => r.ok).length;
    const failCount = manifest.results.length - okCount;
    const guardFail = manifest.guards.filter((g) => !g.ok);

    console.log(
      JSON.stringify(
        {
          stage: "normalize",
          ok: failCount === 0,
          runId: manifest.runId,
          sourceRawRunId: manifest.sourceRawRunId,
          okCount,
          failCount,
          outDir: manifest.outDir,
          files: manifest.files,
          guards: manifest.guards,
          results: manifest.results,
        },
        null,
        2,
      ),
    );

    if (guardFail.length) {
      console.error(
        JSON.stringify(
          {
            stage: "guard",
            message: "行数骤降守卫触发（CSV 已写出，请人工确认）",
            guardFail,
          },
          null,
          2,
        ),
      );
      process.exitCode = 3;
    }
    if (failCount > 0) process.exitCode = 2;
  } catch (e) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          fatal: true,
          error: isFeishuError(e) ? e.toJSON() : JSON.parse(formatFeishuError(e)),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

await main();
