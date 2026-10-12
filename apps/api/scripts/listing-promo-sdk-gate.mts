/**
 * P0 闸门：验证本机 Cursor SDK 能否跑通，并尝试让 Agent 在指定目录写出测试图。
 *
 * 用法（在 apps/api 下）:
 *   npm run listing-promo:gate
 *
 * 鉴权：CURSOR_API_KEY 或先 npm run listing-promo:login
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { Cursor } from "@cursor/sdk";

const outDir = resolve(
  process.env.LISTING_PROMO_GATE_OUT ||
    join(homedir(), "Desktop", "listing-promo-sdk-gate", "out"),
);
mkdirSync(outDir, { recursive: true });

const apiKey = process.env.CURSOR_API_KEY?.trim();
const auth = await Cursor.auth.status().catch(() => ({ status: "logged-out" as const }));
if (!apiKey && auth.status !== "logged-in") {
  console.error("FAIL: 未登录且缺少 CURSOR_API_KEY");
  console.error("请先: npm run listing-promo:login");
  console.error("结论: cannot_start");
  process.exit(1);
}
if (!apiKey) {
  console.log("使用 Cursor.auth 已登录凭证（无需 .env CURSOR_API_KEY）");
}

const repoRoot = resolve(join(import.meta.dirname, "..", "..", ".."));
const modelId = process.env.LISTING_PROMO_MODEL?.trim() || "composer-2.5";

const prompt = `You are running a capability gate for Outpost Listing promo images.

HARD RULES:
- Only write files under this absolute output directory (create if needed):
  ${outDir}
- Do NOT edit any other project source files.
- Prefer using an image-generation tool if available to create ONE simple 9:16 product-style JPG named 00-gate-test-9x16.jpg in that folder.
- If you cannot generate images, write a tiny text file named GATE_NO_IMAGE_TOOL.txt in that folder explaining why, and also copy or write a 1x1 placeholder is NOT required — just the txt is enough.

When done, reply with one line: GATE_OK_IMAGE or GATE_OK_NO_IMAGE.`;

async function main() {
  console.log("repoRoot:", repoRoot);
  console.log("outDir:", outDir);
  console.log("model:", modelId);

  let Agent: typeof import("@cursor/sdk").Agent;
  try {
    ({ Agent } = await import("@cursor/sdk"));
  } catch (e) {
    console.error("FAIL: 无法 import @cursor/sdk", e);
    console.error("结论: sdk_missing — 先 npm install @cursor/sdk");
    process.exit(1);
  }

  const marker = join(outDir, "_gate_started.txt");
  writeFileSync(marker, new Date().toISOString(), "utf8");

  try {
    await using agent = await Agent.create({
      ...(apiKey ? { apiKey } : {}),
      model: { id: modelId },
      local: { cwd: repoRoot },
    });
    console.log("agentId:", agent.agentId);

    const run = await agent.send(prompt);
    const result = await run.wait();
    console.log("run.status:", result.status);
    console.log("run.result:", (result.result || "").slice(0, 500));
    if (result.error) console.error("run.error:", result.error);

    const files = existsSync(outDir) ? readdirSync(outDir) : [];
    console.log("out files:", files);

    const hasImage = files.some((f) => /\.(jpe?g|png|webp)$/i.test(f));
    const hasNoTool = files.some((f) => f === "GATE_NO_IMAGE_TOOL.txt");

    if (result.status === "finished" && hasImage) {
      console.log("结论: sdk_image_ok — Cursor SDK 可出图并落盘，可走自动驱动");
      process.exit(0);
    }
    if (result.status === "finished" && (hasNoTool || files.length > 1)) {
      console.log(
        "结论: sdk_run_ok_no_image — Agent 能跑但无出图工具；Listing 应走 awaiting_manual + 文件夹回填",
      );
      process.exit(0);
    }
    console.log("结论: sdk_uncertain — 检查上方 run 输出与 out 目录");
    process.exit(result.status === "finished" ? 0 : 2);
  } catch (e) {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    console.error("结论: sdk_error — 见错误信息（鉴权/Node 版本/本机 runtime）");
    process.exit(1);
  }
}

main();
