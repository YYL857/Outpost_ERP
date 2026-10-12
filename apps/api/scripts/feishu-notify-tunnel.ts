/**
 * 把 Cloudflare 临时隧道 URL 推到飞书（默认日报收件人「慧慧」）。
 *
 *   pnpm exec tsx scripts/feishu-notify-tunnel.ts --url https://xxx.trycloudflare.com
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  readFeishuCredentials,
  sendFeishuTextMessage,
} from "../src/platforms/feishu/index.js";
import { resolvePushTargets } from "../src/modules/daily-brief/recipients.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(apiRoot, "../..");
loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(apiRoot, ".env") });

function parseUrl(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--url") return (argv[++i] ?? "").trim();
    if (a.startsWith("--url=")) return a.slice("--url=".length).trim();
  }
  return "";
}

async function main() {
  const url = parseUrl(process.argv.slice(2));
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/i.test(url.replace(/\/$/, ""))) {
    console.error(
      JSON.stringify({ ok: false, error: "需要 --url https://xxx.trycloudflare.com" }, null, 2),
    );
    process.exitCode = 2;
    return;
  }
  const clean = url.replace(/\/$/, "");
  const targets = resolvePushTargets({});
  const credentials = readFeishuCredentials();
  const text =
    `Outpost 公网临时隧道已更新\n` +
    `${clean}\n` +
    `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}\n` +
    `说明：重启后链接会变；本机需保持开机且服务在跑。`;

  const results = [];
  for (const t of targets) {
    const receiveIdType = t.chatId.startsWith("ou_") ? "open_id" : "chat_id";
    try {
      const sent = await sendFeishuTextMessage({
        credentials,
        receiveId: t.chatId,
        receiveIdType,
        text,
      });
      results.push({ remark: t.remark, chatId: t.chatId, ok: true, messageId: sent.messageId });
    } catch (e) {
      results.push({
        remark: t.remark,
        chatId: t.chatId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({ ok: okCount > 0, url: clean, results }, null, 2));
  if (okCount === 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e) }, null, 2));
  process.exitCode = 1;
});
