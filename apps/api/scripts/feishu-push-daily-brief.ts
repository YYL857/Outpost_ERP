/**
 * 把本地日报简报以飞书卡片推到会话（默认 card；--format text 仅调试）
 *
 *   pnpm exec tsx scripts/feishu-push-daily-brief.ts --chat oc_xxx
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  buildDailyBriefCard,
  formatFeishuError,
  isFeishuError,
  loadDailyBriefFiltered,
  loadFeishuDocsConfig,
  markdownToFeishuText,
  resolveLastDailyFilteredPath,
  sendFeishuInteractiveMessage,
  sendFeishuTextMessage,
  type DailyBriefLlmJudgment,
} from "../src/platforms/feishu/index.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(apiRoot, "../..");
loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

function parseArgs(argv: string[]) {
  let chatId =
    process.env.OUTPOST_FEISHU_DAILY_CHAT_ID?.trim() ||
    "oc_786937f01598e95bf278dd22cd7b4f7f";
  let format: "card" | "text" = "card";
  let dir = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--chat") chatId = argv[++i] ?? chatId;
    else if (a.startsWith("--chat=")) chatId = a.slice("--chat=".length);
    else if (a === "--format") {
      const v = (argv[++i] ?? "card").toLowerCase();
      format = v === "text" ? "text" : "card";
    } else if (a.startsWith("--format=")) {
      format = a.slice("--format=".length).toLowerCase() === "text" ? "text" : "card";
    } else if (a === "--dir") dir = argv[++i] ?? "";
    else if (a.startsWith("--dir=")) dir = a.slice("--dir=".length);
  }
  return { chatId, format, dir };
}

function resolveBriefDir(explicit: string): string {
  if (explicit) {
    const p = resolve(explicit);
    if (!existsSync(p)) throw new Error(`目录不存在: ${p}`);
    return p;
  }
  return dirname(resolveLastDailyFilteredPath());
}

async function main() {
  const { chatId, format, dir } = parseArgs(process.argv.slice(2));
  try {
    if (!chatId.startsWith("oc_") && !chatId.startsWith("ou_")) {
      console.error(
        JSON.stringify(
          { ok: false, error: "chat_id 看起来不像 oc_/ou_，请核对", chatId },
          null,
          2,
        ),
      );
      process.exitCode = 2;
      return;
    }

    const cfg = loadFeishuDocsConfig({ requireCredentials: true });
    const briefDir = resolveBriefDir(dir);
    const filteredPath = join(briefDir, "daily_brief_filtered.json");
    const summaryPath = join(briefDir, "daily_brief_summary.json");
    const mdPath = join(briefDir, "daily_brief_summary.md");
    const receiveIdType = chatId.startsWith("ou_") ? "open_id" : "chat_id";

    if (format === "text") {
      if (!existsSync(mdPath)) {
        throw new Error(`找不到 ${mdPath}，请先运行 feishu-summarize-daily.ts`);
      }
      const result = await sendFeishuTextMessage({
        credentials: cfg.credentials,
        receiveId: chatId,
        receiveIdType,
        text: markdownToFeishuText(readFileSync(mdPath, "utf8")),
      });
      console.log(
        JSON.stringify(
          { stage: "push-daily-brief", ok: true, format, mdPath, ...result },
          null,
          2,
        ),
      );
      return;
    }

    if (!existsSync(summaryPath) || !existsSync(filteredPath)) {
      throw new Error(
        `缺少 summary/filtered：${summaryPath} / ${filteredPath}，请先 normalize + summarize`,
      );
    }

    const filtered = loadDailyBriefFiltered(filteredPath);
    const summaryFile = JSON.parse(readFileSync(summaryPath, "utf8")) as {
      judgment?: DailyBriefLlmJudgment;
    };
    if (!summaryFile.judgment) {
      throw new Error("daily_brief_summary.json 缺少 judgment");
    }

    const card = buildDailyBriefCard({
      judgment: summaryFile.judgment,
      filtered: {
        currentSheet: filtered.currentSheet,
        previousSheet: filtered.previousSheet,
        overview: filtered.overview,
        deltaCounts: filtered.deltaCounts,
      },
    });

    const result = await sendFeishuInteractiveMessage({
      credentials: cfg.credentials,
      receiveId: chatId,
      receiveIdType,
      card,
    });

    console.log(
      JSON.stringify(
        {
          stage: "push-daily-brief",
          ok: true,
          format: "card",
          summaryPath,
          filteredPath,
          header: (card.header as { title?: { content?: string } })?.title
            ?.content,
          ...result,
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
