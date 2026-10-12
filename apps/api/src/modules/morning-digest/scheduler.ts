/**
 * 晨报墙钟调度：每分钟轮询上海时间，店内默认开、情报默认关。
 */
import type { AppState } from "../../common/types.js";
import { shouldFireWallClock } from "./clock.js";
import {
  envMiDigestDefaultEnabled,
  envStoreDigestDefaultEnabled,
  loadMorningDigestConfig,
} from "./config.js";
import { loadLastRun } from "./persist.js";
import { isMiDigestRunning, runMiMorningDigest } from "./run-mi.js";
import { isStoreDigestRunning, runStoreMorningDigest } from "./run-store.js";

let timer: ReturnType<typeof setInterval> | null = null;
let getStateFn: (() => AppState) | null = null;
let storeEnabled = envStoreDigestDefaultEnabled();
let miEnabled = envMiDigestDefaultEnabled();

export function getMorningDigestSchedulerStatus() {
  const cfg = loadMorningDigestConfig();
  const lastStore = loadLastRun("store");
  const lastMi = loadLastRun("market-intel");
  return {
    timerActive: Boolean(timer),
    pollEveryMs: cfg.pollEveryMs,
    store: {
      enabled: storeEnabled,
      at: cfg.storeAtLabel,
      running: isStoreDigestRunning(),
      lastRunAt: lastStore?.finishedAt ?? lastStore?.startedAt ?? null,
      lastMessage: lastStore?.message ?? null,
      lastOk: lastStore?.ok ?? null,
      lastScheduledDay: lastStore?.scheduledDay ?? null,
    },
    mi: {
      enabled: miEnabled,
      at: cfg.miAtLabel,
      running: isMiDigestRunning(),
      lastRunAt: lastMi?.finishedAt ?? lastMi?.startedAt ?? null,
      lastMessage: lastMi?.message ?? null,
      lastOk: lastMi?.ok ?? null,
      lastScheduledDay: lastMi?.scheduledDay ?? null,
    },
  };
}

export function setStoreDigestEnabled(enabled: boolean) {
  storeEnabled = enabled;
  ensureTimer();
}

export function setMiDigestEnabled(enabled: boolean) {
  miEnabled = enabled;
  ensureTimer();
}

export function stopMorningDigestScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

function ensureTimer() {
  if (!getStateFn) return;
  if (storeEnabled || miEnabled) {
    if (!timer) {
      const cfg = loadMorningDigestConfig();
      timer = setInterval(() => tick(), cfg.pollEveryMs);
      console.log(
        `[morning-digest] wall-clock poll every ${cfg.pollEveryMs}ms (store=${storeEnabled}@${cfg.storeAtLabel} mi=${miEnabled}@${cfg.miAtLabel})`,
      );
    }
  } else {
    stopMorningDigestScheduler();
  }
}

function tick() {
  if (!getStateFn) return;
  const cfg = loadMorningDigestConfig();
  const lastStore = loadLastRun("store");
  const lastMi = loadLastRun("market-intel");

  if (storeEnabled && !isStoreDigestRunning()) {
    const fire = shouldFireWallClock({
      atMinuteOfDay: cfg.storeAtMinute,
      lastScheduledDay: lastStore?.scheduledDay ?? null,
      catchWindowMinutes: cfg.catchWindowMinutes,
    });
    if (fire.fire) {
      console.log(`[morning-digest] store fire day=${fire.day}`);
      void runStoreMorningDigest(getStateFn, {
        triggeredBy: "schedule",
        scheduledDay: fire.day,
      }).then((r) => {
        console.log(`[morning-digest] store done ok=${r.ok} ${r.message}`);
      });
    }
  }

  if (miEnabled && !isMiDigestRunning()) {
    const fire = shouldFireWallClock({
      atMinuteOfDay: cfg.miAtMinute,
      lastScheduledDay: lastMi?.scheduledDay ?? null,
      catchWindowMinutes: cfg.catchWindowMinutes,
    });
    if (fire.fire) {
      console.log(`[morning-digest] mi fire day=${fire.day}`);
      void runMiMorningDigest({
        triggeredBy: "schedule",
        scheduledDay: fire.day,
      }).then((r) => {
        console.log(`[morning-digest] mi done ok=${r.ok} ${r.message}`);
      });
    }
  }
}

export function startMorningDigestScheduler(
  getState: () => AppState,
  opts?: { storeEnabled?: boolean; miEnabled?: boolean },
) {
  getStateFn = getState;
  if (opts?.storeEnabled !== undefined) storeEnabled = opts.storeEnabled;
  if (opts?.miEnabled !== undefined) miEnabled = opts.miEnabled;
  ensureTimer();
  // 启动时立即对齐一次（落在 catch window 内则补跑）
  tick();
}
