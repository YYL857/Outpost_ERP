import { loadConfig, saveConfig } from "./config.js";
import { runCollect } from "./collect.js";
import { runDiscoverPipeline } from "./pipeline.js";

let discoverTimer: ReturnType<typeof setInterval> | null = null;
let collectTimer: ReturnType<typeof setInterval> | null = null;
let runningDiscover = false;
let runningCollect = false;

export function getSchedulerStatus() {
  const cfg = loadConfig();
  return {
    enabled: cfg.scheduler.enabled,
    discoverEveryMs: cfg.scheduler.discoverEveryMs,
    collectEveryMs: cfg.scheduler.collectEveryMs,
    discoverTimerActive: Boolean(discoverTimer),
    collectTimerActive: Boolean(collectTimer),
    runningDiscover,
    runningCollect,
  };
}

export function stopMarketIntelScheduler() {
  if (discoverTimer) clearInterval(discoverTimer);
  if (collectTimer) clearInterval(collectTimer);
  discoverTimer = null;
  collectTimer = null;
}

export function startMarketIntelScheduler() {
  stopMarketIntelScheduler();
  const cfg = loadConfig();
  if (!cfg.scheduler.enabled) {
    console.log("[market-intel] scheduler disabled");
    return getSchedulerStatus();
  }

  const discoverEvery = Math.max(60_000, cfg.scheduler.discoverEveryMs);
  const collectEvery = Math.max(60_000, cfg.scheduler.collectEveryMs);

  discoverTimer = setInterval(() => {
    if (runningDiscover) return;
    runningDiscover = true;
    void runDiscoverPipeline()
      .then(({ discover, collect }) =>
        console.log(
          `[market-intel] scheduled discover ${discover.ok ? "ok" : "fail"} ${discover.message}` +
            (collect ? ` | collect ${collect.ok ? "ok" : "fail"}` : ""),
        ),
      )
      .catch((e) => console.error("[market-intel] discover error", e))
      .finally(() => {
        runningDiscover = false;
      });
  }, discoverEvery);

  collectTimer = setInterval(() => {
    if (runningCollect) return;
    runningCollect = true;
    void runCollect({ limit: Math.max(loadConfig().topN * 5, 200) })
      .then((job) =>
        console.log(`[market-intel] scheduled collect ${job.ok ? "ok" : "fail"} ${job.message}`),
      )
      .catch((e) => console.error("[market-intel] collect error", e))
      .finally(() => {
        runningCollect = false;
      });
  }, collectEvery);

  console.log(
    `[market-intel] scheduler on discover=${discoverEvery}ms collect=${collectEvery}ms`,
  );
  return getSchedulerStatus();
}

export function setSchedulerEnabled(enabled: boolean) {
  const cfg = loadConfig();
  cfg.scheduler.enabled = enabled;
  saveConfig(cfg);
  if (enabled) return startMarketIntelScheduler();
  stopMarketIntelScheduler();
  return getSchedulerStatus();
}
