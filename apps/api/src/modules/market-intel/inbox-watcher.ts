import { loadConfig, saveConfig } from "./config.js";
import { countPendingInbox } from "./inbox-drain.js";
import { runDiscoverPipeline } from "./pipeline.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function getInboxWatcherStatus() {
  const cfg = loadConfig();
  const pending = countPendingInbox();
  return {
    enabled: cfg.inboxWatchEnabled,
    everyMs: cfg.inboxWatchEveryMs,
    timerActive: Boolean(timer),
    running,
    pending,
  };
}

export function stopInboxWatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function startInboxWatcher() {
  stopInboxWatcher();
  const cfg = loadConfig();
  if (!cfg.inboxWatchEnabled) {
    console.log("[market-intel] inbox watcher disabled");
    return getInboxWatcherStatus();
  }
  const every = Math.max(10_000, cfg.inboxWatchEveryMs);
  timer = setInterval(() => {
    if (running) return;
    const pending = countPendingInbox();
    if (pending.yingdao + pending.extension === 0) return;
    running = true;
    void runDiscoverPipeline()
      .then(({ discover, collect }) => {
        console.log(
          `[market-intel] watcher discover ${discover.ok ? "ok" : "fail"} ${discover.message}` +
            (collect ? ` | collect ${collect.ok ? "ok" : "fail"}` : ""),
        );
      })
      .catch((e) => console.error("[market-intel] watcher error", e))
      .finally(() => {
        running = false;
      });
  }, every);
  console.log(`[market-intel] inbox watcher every=${every}ms`);
  return getInboxWatcherStatus();
}

export function setInboxWatcherEnabled(enabled: boolean) {
  const cfg = loadConfig();
  cfg.inboxWatchEnabled = enabled;
  saveConfig(cfg);
  if (enabled) return startInboxWatcher();
  stopInboxWatcher();
  return getInboxWatcherStatus();
}
