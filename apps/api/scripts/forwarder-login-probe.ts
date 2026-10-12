/**
 * 货代门户登录探测 CLI
 * 凭据：D:\outpost-data\forwarder-portals\credentials.json
 *
 * pnpm exec tsx scripts/forwarder-login-probe.ts
 * pnpm exec tsx scripts/forwarder-login-probe.ts --id hansha
 * pnpm exec tsx scripts/forwarder-login-probe.ts --headless
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { probePortalLogin } from "../src/platforms/forwarder-portals/login-probe.js";
import {
  getForwarderPortalsDir,
  loadForwarderCredentials,
  loadForwarderPortalsFile,
} from "../src/platforms/forwarder-portals/types.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

const onlyId = arg("--id");
const headless = process.argv.includes("--headless");

const portalsFile = loadForwarderPortalsFile();
const creds = loadForwarderCredentials();
let portals = portalsFile.portals.filter((p) => p.enabled !== false);
if (onlyId) {
  portals = portals.filter((p) => p.id === onlyId || p.name === onlyId);
  if (!portals.length) {
    console.error("未找到 portal", onlyId);
    process.exit(1);
  }
}

const results = [];
for (const portal of portals) {
  const account = creds.accounts[portal.id];
  if (!account?.username || !account?.password) {
    results.push({
      portalId: portal.id,
      name: portal.name,
      ok: false,
      message: "credentials.json 缺少该货代账号",
    });
    console.log(`[SKIP] ${portal.name} — 无账号`);
    continue;
  }
  console.log(`[RUN ] ${portal.name} (${portal.adapter}) …`);
  const r = await probePortalLogin(portal, account, {
    headed: !headless,
    timeoutMs: 30_000,
    keepOpenMs: headless ? 0 : 800,
  });
  results.push(r);
  console.log(
    `[${r.ok ? "OK  " : "FAIL"}] ${portal.name}: ${r.message} (${r.durationMs}ms)`,
  );
  if (r.screenshotPath) console.log(`       shot=${r.screenshotPath}`);
  if (r.finalUrl) console.log(`       url=${r.finalUrl}`);
}

const outDir = getForwarderPortalsDir();
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `login-probe-${Date.now()}.json`);
writeFileSync(
  outPath,
  `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`,
  "utf8",
);
console.log("\nsummary", {
  ok: results.filter((r) => (r as { ok?: boolean }).ok).length,
  fail: results.filter((r) => !(r as { ok?: boolean }).ok).length,
  report: outPath,
});
