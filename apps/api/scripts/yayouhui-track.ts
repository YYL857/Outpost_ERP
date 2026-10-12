/**
 * 亚优汇查件 CLI：装箱「票号」→ nextsls 运单侧滑路由（与汉沙同 UI）
 *
 * pnpm exec tsx scripts/yayouhui-track.ts --no YYH2608208067
 * pnpm exec tsx scripts/yayouhui-track.ts --limit 1 --headless
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runYayouhuiTrack } from "../src/platforms/forwarder-portals/adapters/nextsls.js";
import { listYayouhuiTicketNos } from "../src/platforms/forwarder-portals/packing-keys.js";
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
const onlyNo = arg("--no")?.trim() || null;
const limitRaw = arg("--limit");
const limit = limitRaw ? Math.max(1, Number(limitRaw) || 1) : null;

const listed = listYayouhuiTicketNos();
let keys = listed.keys;
if (onlyNo) {
  keys = keys.filter((k) => k.ticketNo === onlyNo);
  if (!keys.length) {
    keys = [
      {
        ticketNo: onlyNo,
        logisticsNo: "",
        boxNo: "",
        modeRaw: "",
        warehouseStatus: "",
        forwarder: "亚优汇",
      },
    ];
  }
}
if (limit != null) keys = keys.slice(0, limit);

if (!keys.length) {
  console.error("装箱快照中没有亚优汇票号；可用 --no <票号> 指定");
  console.error("source", listed.sourcePath);
  process.exit(1);
}

const creds = loadForwarderCredentials();
const account = creds.accounts.yayouhui ?? null;
if (!account?.username || !account?.password) {
  console.error("credentials.json 无 yayouhui 账号");
  process.exit(1);
}

console.log("packing", listed.sourcePath);
console.log("pulledAt", listed.pulledAt);
console.log(
  "toTrack",
  keys.map((k) => k.ticketNo),
);

const results = [];
for (const key of keys) {
  console.log(`[RUN ] ${key.ticketNo} (box=${key.boxNo || "-"}) …`);
  const r = await runYayouhuiTrack({
    ticketNo: key.ticketNo,
    account,
    opts: { headed: !headless, timeoutMs: 50_000, login: true },
  });
  results.push({
    ...r,
    packing: {
      logisticsNo: key.logisticsNo,
      boxNo: key.boxNo,
      modeRaw: key.modeRaw,
      warehouseStatus: key.warehouseStatus,
    },
  });
  console.log(
    `[${r.ok ? "OK  " : "FAIL"}] ${key.ticketNo}: ${r.message} | status=${r.statusText ?? "-"} (${r.durationMs}ms)`,
  );
  if (r.screenshotPath) console.log(`       shot=${r.screenshotPath}`);
}

const outDir = getForwarderPortalsDir();
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `yayouhui-track-${Date.now()}.json`);
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      portalId: "yayouhui",
      adapter: "nextsls",
      queryField: "票号",
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
