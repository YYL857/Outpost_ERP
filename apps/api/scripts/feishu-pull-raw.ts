/**
 * P0 CLI：只拉 raw，不入库
 *
 *   pnpm exec tsx scripts/feishu-pull-raw.ts
 *   pnpm exec tsx scripts/feishu-pull-raw.ts --doc product
 *   pnpm exec tsx scripts/feishu-pull-raw.ts --dry-config
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  formatFeishuError,
  isFeishuError,
  loadFeishuDocsConfig,
  pullFeishuRaw,
  summarizeConfig,
} from "../src/platforms/feishu/index.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(apiRoot, "../..");
loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

function parseArgs(argv: string[]) {
  const docIds: string[] = [];
  let dryConfig = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-config") dryConfig = true;
    else if (a === "--doc" || a === "--docs") {
      const v = argv[++i];
      if (v) docIds.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (a.startsWith("--doc=")) {
      docIds.push(
        ...a
          .slice("--doc=".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
  }
  return { docIds, dryConfig };
}

async function main() {
  const { docIds, dryConfig } = parseArgs(process.argv.slice(2));

  try {
    if (dryConfig) {
      const examplePath = resolve(apiRoot, "config", "feishu.docs.example.json");
      let cfg;
      try {
        cfg = loadFeishuDocsConfig({ requireCredentials: false });
      } catch (e) {
        if (isFeishuError(e) && e.code === "CONFIG_MISSING") {
          console.error(
            JSON.stringify(
              {
                stage: "config",
                warning: "正式 docs 文件不存在，改用 example 做结构检查",
                error: e.toJSON(),
                fallback: examplePath,
              },
              null,
              2,
            ),
          );
          cfg = loadFeishuDocsConfig({
            requireCredentials: false,
            docsFilePath: examplePath,
          });
        } else {
          throw e;
        }
      }
      console.log(
        JSON.stringify({ ok: true, config: summarizeConfig(cfg) }, null, 2),
      );
      return;
    }

    const cfg = loadFeishuDocsConfig({ requireCredentials: true });
    console.log(
      JSON.stringify(
        {
          stage: "config",
          message: "feishu config loaded",
          config: summarizeConfig(cfg),
        },
        null,
        2,
      ),
    );

    const manifest = await pullFeishuRaw(cfg, {
      docIds: docIds.length ? docIds : undefined,
    });

    const okCount = manifest.results.filter((r) => r.ok).length;
    const failCount = manifest.results.length - okCount;

    console.log(
      JSON.stringify(
        {
          stage: "pull",
          ok: failCount === 0,
          runId: manifest.runId,
          okCount,
          failCount,
          rawDir: manifest.rawDir,
          results: manifest.results,
        },
        null,
        2,
      ),
    );

    if (failCount > 0) {
      console.error(
        JSON.stringify(
          {
            stage: "pull",
            message: "部分文档拉取失败，请按 result.error.stage/code/hint 定位",
            failures: manifest.results.filter((r) => !r.ok),
          },
          null,
          2,
        ),
      );
      process.exitCode = 2;
    }
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
