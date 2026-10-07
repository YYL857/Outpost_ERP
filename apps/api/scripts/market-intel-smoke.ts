import { ensureMarketDirs } from "../src/modules/market-intel/paths.js";
import { migrateConfigToLiveDefaults, loadConfig } from "../src/modules/market-intel/config.js";
import { runDiscover } from "../src/modules/market-intel/discover.js";
import { runCollect } from "../src/modules/market-intel/collect.js";
import { loadWatchlist } from "../src/modules/market-intel/store.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marketPaths } from "../src/modules/market-intel/paths.js";
import { runDiscoverPipeline } from "../src/modules/market-intel/pipeline.js";
import { purgeTestWatchlist } from "../src/modules/market-intel/ops.js";

async function main() {
  ensureMarketDirs("sa");
  migrateConfigToLiveDefaults();
  const cfg = loadConfig();
  console.log("cfg", {
    primary: cfg.primaryChannel,
    watch: cfg.inboxWatchEnabled,
    auto: cfg.autoCollectAfterDiscover,
    sched: cfg.scheduler.enabled,
  });

  purgeTestWatchlist();
  const d = await runDiscover({ forceMock: true });
  console.log("mock discover", d.ok, d.stats);
  purgeTestWatchlist();

  const paths = marketPaths("sa");
  const dir = join(paths.inbox, "yingdao");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "electronics-and-mobiles_livecheck.json"),
    JSON.stringify({
      source: "yingdao",
      categoryId: "electronics-and-mobiles",
      products: [
        {
          productKey: "LIVE-CHECK-001",
          title: "Live Check Product",
          url: "https://www.noon.com/saudi-en/x",
          price: 11,
          currency: "SAR",
          rating: 4,
          reviewCount: 1,
        },
      ],
    }),
    "utf8",
  );

  const pipe = await runDiscoverPipeline();
  console.log("pipeline", pipe.discover.message, pipe.collect?.message);
  console.log(
    "watchlist has LIVE-CHECK",
    loadWatchlist().items.some((i) => i.productKey === "LIVE-CHECK-001"),
  );
  await runCollect({ limit: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
