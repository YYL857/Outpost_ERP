import type { AppState } from "../../common/types.js";
import { runCollect } from "../market-intel/collect.js";
import {
  getInboxWatcherStatus,
  setInboxWatcherEnabled,
} from "../market-intel/inbox-watcher.js";
import { loadConfig } from "../market-intel/config.js";
import { runDiscoverPipeline } from "../market-intel/pipeline.js";
import {
  getSchedulerStatus,
  setSchedulerEnabled,
} from "../market-intel/scheduler.js";
import { listRecentJobs } from "../market-intel/store.js";
import {
  envMiDigestDefaultEnabled,
  envStoreDigestDefaultEnabled,
  getMorningDigestSchedulerStatus,
  runMiMorningDigest,
  runStoreMorningDigest,
  setMiDigestEnabled,
  setStoreDigestEnabled,
  startMorningDigestScheduler,
} from "../morning-digest/index.js";
import {
  envAssemblySyncDefaultEnabled,
  getAssemblySyncSchedulerStatus,
  setAssemblySyncSchedulerEnabled,
  startAssemblySyncScheduler,
} from "../sync/assembly-scheduler.js";
import {
  envGpCloseDefaultEnabled,
  getGpCloseSchedulerStatus,
  runGpCloseTick,
  setGpCloseSchedulerEnabled,
  startGpCloseScheduler,
  stopGpCloseScheduler,
} from "../finance/gp-close-scheduler.js";
import {
  getLastAssemblySync,
  isAssemblySyncRunning,
  runAssemblySync,
} from "../sync/assembly-sync.js";
import {
  getNoonPollerStatus,
  runNoonPollerTick,
  setNoonPollerEnabled,
  startNoonPoller,
} from "../sync/poller.js";
import {
  getOverrideEnabled,
  setOverrideEnabled,
  type SchedulerOverrideId,
} from "./overrides.js";

export type SchedulerId =
  | "noon-poller"
  | "assembly-sync"
  | "mi-discover"
  | "mi-collect"
  | "inbox-watcher"
  | "store-morning-digest"
  | "mi-morning-digest"
  | "gp-month-close";

export type SchedulerItem = {
  id: SchedulerId;
  label: string;
  group: "sync" | "market-intel" | "digest";
  enabled: boolean;
  timerActive: boolean;
  everyMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastMessage: string | null;
  note?: string;
};

const IDS: SchedulerId[] = [
  "noon-poller",
  "assembly-sync",
  "mi-discover",
  "mi-collect",
  "inbox-watcher",
  "store-morning-digest",
  "mi-morning-digest",
  "gp-month-close",
];

function recentMi(kind: "discover" | "collect") {
  const job = listRecentJobs(30).find((j) => j.kind === kind);
  if (!job) return { lastRunAt: null as string | null, lastMessage: null as string | null };
  return {
    lastRunAt: job.finishedAt || job.startedAt,
    lastMessage: job.message,
  };
}

export function listSchedulers(): SchedulerItem[] {
  const poller = getNoonPollerStatus();
  const assembly = getAssemblySyncSchedulerStatus();
  const mi = getSchedulerStatus();
  const watcher = getInboxWatcherStatus();
  const digest = getMorningDigestSchedulerStatus();
  const discoverRecent = recentMi("discover");
  const collectRecent = recentMi("collect");

  return [
    {
      id: "noon-poller",
      label: "Noon 轮询",
      group: "sync",
      enabled: poller.enabled,
      timerActive: poller.timerActive,
      everyMs: poller.everyMs,
      running: poller.running,
      lastRunAt: poller.lastRunAt,
      lastMessage: poller.lastMessage,
      note: `多店错峰 · 每 ${poller.liveEveryN} tick 最多 1 店 Impex；Catalog/库存过期自动重拉`,
    },
    {
      id: "assembly-sync",
      label: "汇总同步",
      group: "sync",
      enabled: assembly.enabled,
      timerActive: assembly.timerActive,
      everyMs: assembly.everyMs,
      running: assembly.running,
      lastRunAt: assembly.lastRunAt,
      lastMessage: assembly.lastMessage,
      note: "全店广告+飞书 · Noon 每周期最多 1 店",
    },
    {
      id: "store-morning-digest",
      label: "店内晨报推送",
      group: "digest",
      enabled: digest.store.enabled,
      timerActive: digest.timerActive && digest.store.enabled,
      everyMs: 24 * 60 * 60 * 1000,
      running: digest.store.running,
      lastRunAt: digest.store.lastRunAt,
      lastMessage: digest.store.lastMessage,
      note: `每天 ${digest.store.at}（上海）汇总→门禁→模型→飞书`,
    },
    {
      id: "mi-morning-digest",
      label: "市场情报晨报推送",
      group: "digest",
      enabled: digest.mi.enabled,
      timerActive: digest.timerActive && digest.mi.enabled,
      everyMs: 24 * 60 * 60 * 1000,
      running: digest.mi.running,
      lastRunAt: digest.mi.lastRunAt,
      lastMessage: digest.mi.lastMessage,
      note: `每天 ${digest.mi.at}（上海）；默认关，影刀定时就绪后启用`,
    },
    {
      id: "gp-month-close",
      label: "月度毛利关账",
      group: "digest",
      enabled: getGpCloseSchedulerStatus().enabled,
      timerActive: getGpCloseSchedulerStatus().timerActive,
      everyMs: getGpCloseSchedulerStatus().everyMs,
      running: getGpCloseSchedulerStatus().running,
      lastRunAt: getGpCloseSchedulerStatus().lastRunAt,
      lastMessage: getGpCloseSchedulerStatus().lastMessage,
      note: "上海时间每月 3/5/8 日 10:00：提醒缺月末账单 → 门禁关账 → 升级告警。手动运行=关上月。",
    },
    {
      id: "mi-discover",
      label: "市场情报 · 发现",
      group: "market-intel",
      enabled: mi.enabled,
      timerActive: mi.discoverTimerActive,
      everyMs: mi.discoverEveryMs,
      running: mi.runningDiscover,
      lastRunAt: discoverRecent.lastRunAt,
      lastMessage: discoverRecent.lastMessage,
      note: "与「采集」共享启停",
    },
    {
      id: "mi-collect",
      label: "市场情报 · 采集",
      group: "market-intel",
      enabled: mi.enabled,
      timerActive: mi.collectTimerActive,
      everyMs: mi.collectEveryMs,
      running: mi.runningCollect,
      lastRunAt: collectRecent.lastRunAt,
      lastMessage: collectRecent.lastMessage,
      note: "与「发现」共享启停",
    },
    {
      id: "inbox-watcher",
      label: "市场情报 · Inbox 监视",
      group: "market-intel",
      enabled: watcher.enabled,
      timerActive: watcher.timerActive,
      everyMs: watcher.everyMs,
      running: watcher.running,
      lastRunAt: null,
      lastMessage:
        watcher.pending != null
          ? `pending yingdao=${watcher.pending.yingdao} extension=${watcher.pending.extension}`
          : null,
      note: "有待处理文件时触发发现流水线",
    },
  ];
}

export function getScheduler(id: SchedulerId): SchedulerItem | undefined {
  return listSchedulers().find((s) => s.id === id);
}

export function isSchedulerId(id: string): id is SchedulerId {
  return (IDS as string[]).includes(id);
}

function persistSyncOverride(id: SchedulerOverrideId, enabled: boolean) {
  setOverrideEnabled(id, enabled);
}

export function startScheduler(
  id: SchedulerId,
  getState: () => AppState,
): SchedulerItem {
  switch (id) {
    case "noon-poller": {
      persistSyncOverride("noon-poller", true);
      setNoonPollerEnabled(true);
      if (!getNoonPollerStatus().timerActive) {
        const interval = Number(process.env.NOON_POLL_INTERVAL_MS ?? 120_000);
        startNoonPoller(getState, interval, {
          enabled: true,
          skipInitial: true,
        });
      }
      break;
    }
    case "assembly-sync": {
      persistSyncOverride("assembly-sync", true);
      setAssemblySyncSchedulerEnabled(true);
      if (!getAssemblySyncSchedulerStatus().timerActive) {
        startAssemblySyncScheduler(getState, {
          enabled: true,
          respectOnBoot: false,
        });
      }
      break;
    }
    case "mi-discover":
    case "mi-collect":
      setSchedulerEnabled(true);
      break;
    case "inbox-watcher":
      setInboxWatcherEnabled(true);
      break;
    case "store-morning-digest":
      persistSyncOverride("store-morning-digest", true);
      startMorningDigestScheduler(getState, { storeEnabled: true });
      break;
    case "mi-morning-digest":
      persistSyncOverride("mi-morning-digest", true);
      startMorningDigestScheduler(getState, { miEnabled: true });
      break;
    case "gp-month-close":
      persistSyncOverride("gp-month-close", true);
      setGpCloseSchedulerEnabled(true);
      if (!getGpCloseSchedulerStatus().timerActive) {
        startGpCloseScheduler({ enabled: true });
      }
      break;
  }
  return getScheduler(id)!;
}

export function stopScheduler(
  id: SchedulerId,
  _getState: () => AppState,
): SchedulerItem {
  switch (id) {
    case "noon-poller":
      persistSyncOverride("noon-poller", false);
      setNoonPollerEnabled(false);
      break;
    case "assembly-sync":
      persistSyncOverride("assembly-sync", false);
      setAssemblySyncSchedulerEnabled(false);
      break;
    case "mi-discover":
    case "mi-collect":
      setSchedulerEnabled(false);
      break;
    case "inbox-watcher":
      setInboxWatcherEnabled(false);
      break;
    case "store-morning-digest":
      persistSyncOverride("store-morning-digest", false);
      setStoreDigestEnabled(false);
      break;
    case "mi-morning-digest":
      persistSyncOverride("mi-morning-digest", false);
      setMiDigestEnabled(false);
      break;
    case "gp-month-close":
      persistSyncOverride("gp-month-close", false);
      setGpCloseSchedulerEnabled(false);
      stopGpCloseScheduler();
      break;
  }
  return getScheduler(id)!;
}

export async function runScheduler(
  id: SchedulerId,
  getState: () => AppState,
): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  switch (id) {
    case "noon-poller": {
      const r = await runNoonPollerTick({ force: true });
      return { ok: r.ok, message: r.message };
    }
    case "assembly-sync": {
      if (isAssemblySyncRunning()) {
        return {
          ok: false,
          message: "assembly-sync already running",
          detail: getLastAssemblySync(),
        };
      }
      const state = getState();
      const r = await runAssemblySync(state, { triggeredBy: "manual" });
      return { ok: r.ok, message: r.message, detail: r };
    }
    case "mi-discover": {
      const { discover, collect } = await runDiscoverPipeline();
      return {
        ok: discover.ok,
        message:
          discover.message +
          (collect ? ` | collect ${collect.ok ? "ok" : "fail"}` : ""),
        detail: { discover, collect },
      };
    }
    case "mi-collect": {
      const cfg = loadConfig();
      const job = await runCollect({
        limit: Math.max(cfg.topN * 5, 200),
      });
      return { ok: job.ok, message: job.message, detail: job };
    }
    case "inbox-watcher": {
      const { discover, collect } = await runDiscoverPipeline();
      return {
        ok: discover.ok,
        message:
          discover.message +
          (collect ? ` | collect ${collect.ok ? "ok" : "fail"}` : ""),
        detail: { discover, collect },
      };
    }
    case "store-morning-digest": {
      const r = await runStoreMorningDigest(getState, {
        triggeredBy: "manual",
      });
      return { ok: r.ok, message: r.message, detail: r };
    }
    case "mi-morning-digest": {
      const r = await runMiMorningDigest({ triggeredBy: "manual" });
      return { ok: r.ok, message: r.message, detail: r };
    }
    case "gp-month-close": {
      const r = await runGpCloseTick("close", { triggeredBy: "manual" });
      return { ok: r.ok, message: r.message, detail: r };
    }
  }
}

/** Resolve boot-time enabled for sync schedulers (override > env default). */
export function resolveBootEnabled(
  id: SchedulerOverrideId,
): boolean {
  const override = getOverrideEnabled(id);
  if (override !== undefined) return override;
  if (id === "assembly-sync") return envAssemblySyncDefaultEnabled();
  if (id === "pw-keepalive") return false;
  if (id === "store-morning-digest") return envStoreDigestDefaultEnabled();
  if (id === "mi-morning-digest") return envMiDigestDefaultEnabled();
  if (id === "gp-month-close") return envGpCloseDefaultEnabled();
  return true; // noon-poller: always on unless overridden
}
