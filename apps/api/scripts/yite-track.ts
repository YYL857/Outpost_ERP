/**
 * 义特查件 CLI：装箱「物流编号」去 U 后缀 → nextsls 运单侧滑路由（与汉沙同 UI）
 *
 * 例：YT2604647454U002 → 查 YT2604647454
 *
 * pnpm exec tsx scripts/yite-track.ts --no YT2604647454U002
 * pnpm exec tsx scripts/yite-track.ts --limit 1 --headless
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runYiteTrack } from "../src/platforms/forwarder-portals/adapters/nextsls.js";
import {
  listYiteLogisticsNos,
  yiteWaybillFromLogistics,
} from "../src/platforms/forwarder-portals/packing-keys.js";
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

const listed = listYiteLogisticsNos();
let keys = listed.keys;
if (onlyNo) {
  const want = yiteWaybillFromLogistics(onlyNo);
  keys = keys.filter(
    (k) =>
      k.waybillNo === want ||
      k.logisticsNo === onlyNo ||
      yiteWaybillFromLogistics(k.logisticsNo) === want,
  );
  if (!keys.length) {
    keys = [
      {
        logisticsNo: onlyNo,
        waybillNo: want || onlyNo,
        ticketNo: "",
        boxNo: "",
        modeRaw: "",
        warehouseStatus: "",
        forwarder: "义特",
      },
    ];
  }
}
if (limit != null) keys = keys.slice(0, limit);

if (!keys.length) {
  console.error("装箱快照中没有义特物流编号；可用 --no <物流编号> 指定");
  console.error("source", listed.sourcePath);
  process.exit(1);
}

const creds = loadForwarderCredentials();
const account = creds.accounts.yite ?? null;
if (!account?.username || !account?.password) {
  console.error("credentials.json 无 yite 账号");
  process.exit(1);
}

console.log("packing", listed.sourcePath);
console.log("pulledAt", listed.pulledAt);
console.log(
  "toTrack",
  keys.map((k) => `${k.logisticsNo} → ${k.waybillNo}`),
);

const results = [];
for (const key of keys) {
  console.log(
    `[RUN ] ${key.logisticsNo} → waybill=${key.waybillNo} (box=${key.boxNo || "-"}) …`,
  );
  const r = await runYiteTrack({
    ticketNo: key.waybillNo,
    account,
    opts: { headed: !headless, timeoutMs: 50_000, login: true },
  });
  results.push({
    ...r,
    packing: {
      logisticsNo: key.logisticsNo,
      waybillNo: key.waybillNo,
      ticketNo: key.ticketNo,
      boxNo: key.boxNo,
      modeRaw: key.modeRaw,
      warehouseStatus: key.warehouseStatus,
    },
  });
  console.log(
    `[${r.ok ? "OK  " : "FAIL"}] ${key.waybillNo}: ${r.message} | status=${r.statusText ?? "-"} (${r.durationMs}ms)`,
  );
  if (r.screenshotPath) console.log(`       shot=${r.screenshotPath}`);
}

const outDir = getForwarderPortalsDir();
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `yite-track-${Date.now()}.json`);
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      portalId: "yite",
      adapter: "nextsls",
      queryField: "物流编号",
      note: "物流编号去掉 U 及之后再查运单",
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
