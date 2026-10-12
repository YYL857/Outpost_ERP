/**
 * CLI：有头登录并保存 Playwright storageState（与采购页「获取 1688 登录态」相同）。
 *
 * pnpm exec tsx scripts/1688-login-save.ts
 * pnpm exec tsx scripts/1688-login-save.ts --wait-ms 180000
 */
import { capture1688LoginSession } from "../src/platforms/alibaba-1688/index.js";

function argNum(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const waitMs = argNum("--wait-ms", 180_000);
console.log("弹出浏览器 → 请在窗口内完成 1688 登录…");
const r = await capture1688LoginSession({ loginWaitMs: waitMs });
console.log(r.ok ? "OK" : "FAIL", r.message, `(${r.durationMs}ms)`);
if (r.screenshotPath) console.log("截图:", r.screenshotPath);
process.exit(r.ok ? 0 : 1);
