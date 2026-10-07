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
  envAssemblySyncDefaultEnabled,
  getAssemblySyncSchedulerStatus,
  setAssemblySyncSchedulerEnabled,
  startAssemblySyncScheduler,
} from "../sync/assembly-scheduler.js";
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
  | "inbox-watcher";

export type SchedulerItem = {
  id: SchedulerId;
  label: string;
  group: "sync" | "market-intel";
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
      note: `live 每 ${poller.liveEveryN} tick 一次 Impex`,
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
      note: "Noon + 广告入库 + 飞书",
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
  }
}

/** Resolve boot-time enabled for sync schedulers (override > env default). */
export function resolveBootEnabled(
  id: SchedulerOverrideId,
): boolean {
  const override = getOverrideEnabled(id);
  if (override !== undefined) return override;
  if (id === "assembly-sync") return envAssemblySyncDefaultEnabled();
  return true; // noon-poller: always on unless overridden
}
