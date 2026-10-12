/**
 * 亦邦查件 CLI：装箱表「物流编号」→ yundaomen 查轨迹 → 落盘 JSON
 *
 * pnpm exec tsx scripts/yibang-track.ts
 * pnpm exec tsx scripts/yibang-track.ts --limit 1
 * pnpm exec tsx scripts/yibang-track.ts --no  FNSA202607010138A
 * pnpm exec tsx scripts/yibang-track.ts --headless
 * pnpm exec tsx scripts/yibang-track.ts --login
 * pnpm exec tsx scripts/yibang-track.ts --login --require-login
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runYundaomenTrack } from "../src/platforms/forwarder-portals/adapters/yundaomen.js";
import { listYibangLogisticsNos } from "../src/platforms/forwarder-portals/packing-keys.js";
import {
  getForwarderPortalsDir,
  loadForwarderCredentials,
} from "../src/platforms/forwarder-portals/types.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

const headless = process.argv.includes("--headless");
const doLogin = process.argv.includes("--login");
const requireLogin = process.argv.includes("--require-login");
const onlyNo = arg("--no")?.trim() || null;
const limitRaw = arg("--limit");
const limit = limitRaw ? Math.max(1, Number(limitRaw) || 1) : null;

const listed = listYibangLogisticsNos();
let keys = listed.keys;
if (onlyNo) {
  keys = keys.filter((k) => k.logisticsNo === onlyNo);
  if (!keys.length) {
    keys = [
      {
        logisticsNo: onlyNo,
        ticketNo: "",
        boxNo: "",
        warehouseStatus: "",
        forwarder: "亦邦",
      },
    ];
  }
}
if (limit != null) keys = keys.slice(0, limit);

if (!keys.length) {
  console.error("装箱快照中没有亦邦物流编号；可用 --no <物流编号> 指定");
  console.error("source", listed.sourcePath);
  process.exit(1);
}

const creds = loadForwarderCredentials();
const account = creds.accounts.yibang ?? null;
if (doLogin && (!account?.username || !account?.password)) {
  console.error("credentials.json 无 yibang 账号，无法 --login");
  process.exit(1);
}

console.log("packing", listed.sourcePath);
console.log("pulledAt", listed.pulledAt);
console.log("mode", doLogin ? "login+track" : "anonymous-track");
console.log("toTrack", keys.length, keys.map((k) => k.logisticsNo));

const results = [];
for (const key of keys) {
  console.log(`[RUN ] ${key.logisticsNo} (box=${key.boxNo || "-"}) …`);
  const r = await runYundaomenTrack({
    logisticsNo: key.logisticsNo,
    account,
    opts: {
      headed: !headless,
      timeoutMs: 35_000,
      login: doLogin,
      requireLogin: doLogin && requireLogin,
    },
  });
  results.push({
    ...r,
    packing: {
      ticketNo: key.ticketNo,
      boxNo: key.boxNo,
      warehouseStatus: key.warehouseStatus,
    },
  });
  console.log(
    `[${r.ok ? "OK  " : "FAIL"}] ${key.logisticsNo}: ${r.message} | status=${r.statusText ?? "-"} (${r.durationMs}ms)`,
  );
  if (r.screenshotPath) console.log(`       shot=${r.screenshotPath}`);
}

const outDir = getForwarderPortalsDir();
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `yibang-track-${Date.now()}.json`);
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      portalId: "yibang",
      adapter: "yundaomen",
      queryField: "物流编号",
      packingSource: listed.sourcePath,
      results,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log("\nsummary", {
  ok: results.filter((r) => r.ok).length,
  fail: results.filter((r) => !r.ok).length,
  report: outPath,
});
