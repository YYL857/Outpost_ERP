/**
 * 浏览器一键登录 Cursor SDK（给 Listing 自动出图用）
 *
 * 用法（在 apps/api 下）:
 *   npm run listing-promo:login
 *
 * 会打开浏览器；用你指定的「出图专用」账号登录一次即可。
 * Key 写入 ~/.cursor/sdk/auth.json（默认约 90 天），之后 Listing 自动出图不必再配 .env。
 * 也可把打印出的 CURSOR_API_KEY 自行备份到密码本（勿提交进 git）。
 */
import { Cursor, getDefaultSdkAuthPath } from "@cursor/sdk";

async function main() {
  console.log("将打开浏览器登录 Cursor…");
  console.log("请用「出图专用」账号登录（可与日常切换的 IDE 账号不同）。");
  console.log("凭证路径:", getDefaultSdkAuthPath());

  const result = await Cursor.auth.login({
    apiKeyName: "Outpost Listing Promo",
    openBrowser: true,
  });

  console.log("");
  console.log("登录成功。");
  if (result.email) console.log("账号:", result.email);
  if (result.apiKeyExpiresAtMs) {
    console.log("过期:", new Date(result.apiKeyExpiresAtMs).toISOString());
  }
  console.log("");
  console.log("请自行备份（可选，勿提交 git）:");
  console.log("CURSOR_API_KEY=" + result.apiKey);
  console.log("");
  console.log("下一步: npm run listing-promo:gate");
  console.log("通过后再重启 API，到 Listing 页点「生成宣传图」。");
}

main().catch((e) => {
  console.error("登录失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
