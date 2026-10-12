/**
 * 飞坦查件 CLI：装箱「票号」→ 海运/空运轨迹
 *
 * pnpm exec tsx scripts/feitan-track.ts --no 36384900000005
 * pnpm exec tsx scripts/feitan-track.ts --limit 1 --mode sea
 * pnpm exec tsx scripts/feitan-track.ts --headless --no 36384900000002 --mode air
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  packingModeToFleetan,
  runFleetanTrack,
  type FleetanShipMode,
} from "../src/platforms/forwarder-portals/adapters/fleetan.js";
import { listFeitanTicketNos } from "../src/platforms/forwarder-portals/packing-keys.js";
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
const modeArg = (arg("--mode")?.trim() || "auto") as FleetanShipMode;
const limitRaw = arg("--limit");
const limit = limitRaw ? Math.max(1, Number(limitRaw) || 1) : null;

const listed = listFeitanTicketNos();
let keys = listed.keys;
if (onlyNo) {
  keys = keys.filter((k) => k.ticketNo === onlyNo);
  if (!keys.length) {
    keys = [
      {
        ticketNo: onlyNo,
        logisticsNo: "",
        boxNo: "",
        modeRaw: modeArg === "air" ? "空运" : modeArg === "sea" ? "海运" : "",
        warehouseStatus: "",
        forwarder: "飞坦",
      },
    ];
  }
}
if (limit != null) keys = keys.slice(0, limit);

if (!keys.length) {
  console.error("装箱快照中没有飞坦票号；可用 --no <票号> 指定");
  process.exit(1);
}

const creds = loadForwarderCredentials();
const account = creds.accounts.feitan ?? null;

console.log("packing", listed.sourcePath);
console.log("toTrack", keys.map((k) => `${k.ticketNo}(${k.modeRaw || "?"})`));

const results = [];
for (const key of keys) {
  const mode =
    modeArg !== "auto" ? modeArg : packingModeToFleetan(key.modeRaw);
  console.log(`[RUN ] ${key.ticketNo} mode=${mode} …`);
  const r = await runFleetanTrack({
    ticketNo: key.ticketNo,
    mode,
    account,
    opts: { headed: !headless, timeoutMs: 55_000, login: true },
  });
  results.push({ ...r, packing: key });
  console.log(
    `[${r.ok ? "OK  " : "FAIL"}] ${key.ticketNo}: ${r.message} | ${r.statusText ?? "-"} (${r.durationMs}ms)`,
  );
  if (r.screenshotPath) console.log(`       shot=${r.screenshotPath}`);
}

const outDir = getForwarderPortalsDir();
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `feitan-track-${Date.now()}.json`);
writeFileSync(
  outPath,
  `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`,
  "utf8",
);
console.log("\nsummary", {
  ok: results.filter((r) => r.ok).length,
  fail: results.filter((r) => !r.ok).length,
  report: outPath,
});
