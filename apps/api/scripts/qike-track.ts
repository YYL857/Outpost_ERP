/**
 * 起克查件 CLI：装箱「物流编号」→ B2B报表「入仓号」
 *
 * pnpm exec tsx scripts/qike-track.ts --no HPMYKSA04004-2
 * pnpm exec tsx scripts/qike-track.ts --limit 1 --headless
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runQikeTrack } from "../src/platforms/forwarder-portals/adapters/chicexpress.js";
import { listQikeLogisticsNos } from "../src/platforms/forwarder-portals/packing-keys.js";
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

const listed = listQikeLogisticsNos();
let keys = listed.keys;
if (onlyNo) {
  keys = keys.filter((k) => k.logisticsNo === onlyNo);
  if (!keys.length) {
    keys = [
      {
        logisticsNo: onlyNo,
        ticketNo: "",
        boxNo: "",
        modeRaw: "",
        warehouseStatus: "",
        forwarder: "起克",
      },
    ];
  }
}
if (limit != null) keys = keys.slice(0, limit);

if (!keys.length) {
  console.error("装箱快照中没有起克物流编号；可用 --no <物流编号> 指定");
  console.error("source", listed.sourcePath);
  process.exit(1);
}

const creds = loadForwarderCredentials();
const account = creds.accounts.qike ?? null;
if (!account?.username || !account?.password) {
  console.error("credentials.json 无 qike 账号");
  process.exit(1);
}

console.log("packing", listed.sourcePath);
console.log("pulledAt", listed.pulledAt);
console.log(
  "toTrack",
  keys.map((k) => k.logisticsNo),
);

const results = [];
for (const key of keys) {
  console.log(`[RUN ] ${key.logisticsNo} (box=${key.boxNo || "-"}) …`);
  const r = await runQikeTrack({
    logisticsNo: key.logisticsNo,
    account,
    opts: { headed: !headless, timeoutMs: 55_000, login: true },
  });
  results.push({
    ...r,
    packing: {
      ticketNo: key.ticketNo,
      boxNo: key.boxNo,
      modeRaw: key.modeRaw,
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
const outPath = join(outDir, `qike-track-${Date.now()}.json`);
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      portalId: "qike",
      adapter: "chicexpress",
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
