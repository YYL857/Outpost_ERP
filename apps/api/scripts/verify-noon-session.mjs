/**
 * CLI：探测本地 noon-session 是否真能进 Seller Lab。
 * 复用 API 同款 probeSessionUsability（不打印 Cookie 值）。
 */
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probeMod = join(
  __dirname,
  "..",
  "src",
  "platforms",
  "noon",
  "portal",
  "session-probe.ts",
);

async function main() {
  // tsx / node --import tsx
  const { probeSessionUsability, readLastSessionProbe } = await import(
    pathToFileURL(probeMod).href
  );
  const result = await probeSessionUsability();
  const last = readLastSessionProbe();
  console.log(
    JSON.stringify(
      {
        probe: result,
        lastCached: last,
        usableForSop: result.usable === "ok",
      },
      null,
      2,
    ),
  );
  process.exit(result.usable === "ok" ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
