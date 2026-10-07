/**
 * 汇总同步定时调度（与 noon-poller 并列，不替代 Impex 轻量轮询）
 */
import type { AppState } from "../../common/types.js";
import {
  getLastAssemblySync,
  isAssemblySyncRunning,
  runAssemblySync,
} from "./assembly-sync.js";

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function envDefaultEnabled(): boolean {
  return bool(process.env.OUTPOST_ASSEMBLY_SYNC_ENABLED, true);
}

function resolveEveryMs(): number {
  return Math.max(
    60_000,
    Number(process.env.OUTPOST_ASSEMBLY_SYNC_EVERY_MS ?? 6 * 60 * 60 * 1000),
  );
}

let timer: ReturnType<typeof setInterval> | null = null;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let getStateFn: (() => AppState) | null = null;
let enabled = envDefaultEnabled();
let everyMs = resolveEveryMs();

/**
 * 默认每 6 小时跑一条 Noon+飞书汇总链。
 * OUTPOST_ASSEMBLY_SYNC_ENABLED=0 关闭
 * OUTPOST_ASSEMBLY_SYNC_EVERY_MS 覆盖间隔
 * OUTPOST_ASSEMBLY_SYNC_ON_BOOT=1 启动后延迟一次（默认关，避撞手动）
 */
export function getAssemblySyncSchedulerStatus() {
  const last = getLastAssemblySync();
  return {
    enabled,
    timerActive: Boolean(timer),
    everyMs,
    running: isAssemblySyncRunning(),
    lastRunAt: last?.finishedAt ?? last?.startedAt ?? null,
    lastMessage: last?.message ?? null,
    lastOk: last?.ok ?? null,
  };
}

export function stopAssemblySyncScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
}

function scheduleTick() {
  if (isAssemblySyncRunning()) {
    console.log("[assembly-sync] skip schedule: already running");
    return;
  }
  if (!getStateFn) return;
  const state = getStateFn();
  if (!state.noon.enabled) return;
  void runAssemblySync(state, { triggeredBy: "schedule" })
    .then((r) => {
      console.log(`[assembly-sync] schedule done ok=${r.ok} ${r.message}`);
    })
    .catch((err) => {
      console.error("[assembly-sync] schedule failed", err);
    });
}

/**
 * @param opts.enabled 覆盖运行时启用态；未传则用当前值（首次用 env 默认）
 * @param opts.respectOnBoot 仅冷启动时为 true，才可能安排 boot 延迟跑
 */
export function startAssemblySyncScheduler(
  getState: () => AppState,
  opts?: { enabled?: boolean; respectOnBoot?: boolean },
) {
  getStateFn = getState;
  everyMs = resolveEveryMs();
  if (opts?.enabled !== undefined) enabled = opts.enabled;

  stopAssemblySyncScheduler();
  if (!enabled) {
    console.log("[assembly-sync] scheduler disabled");
    return getAssemblySyncSchedulerStatus();
  }

  timer = setInterval(scheduleTick, everyMs);
  if (typeof timer.unref === "function") timer.unref();

  if (opts?.respectOnBoot !== false) {
    const onBoot = bool(process.env.OUTPOST_ASSEMBLY_SYNC_ON_BOOT, false);
    const bootDelayMs = Math.max(
      5_000,
      Number(process.env.OUTPOST_ASSEMBLY_SYNC_BOOT_DELAY_MS ?? 120_000),
    );
    if (onBoot) {
      bootTimer = setTimeout(scheduleTick, bootDelayMs);
      if (typeof bootTimer.unref === "function") bootTimer.unref();
    }
    console.log(`[assembly-sync] every ${everyMs}ms onBoot=${onBoot}`);
  } else {
    console.log(`[assembly-sync] every ${everyMs}ms`);
  }

  return getAssemblySyncSchedulerStatus();
}

export function setAssemblySyncSchedulerEnabled(next: boolean) {
  enabled = next;
  if (!getStateFn) return getAssemblySyncSchedulerStatus();
  if (next) {
    return startAssemblySyncScheduler(getStateFn, {
      enabled: true,
      respectOnBoot: false,
    });
  }
  stopAssemblySyncScheduler();
  console.log("[assembly-sync] scheduler stopped");
  return getAssemblySyncSchedulerStatus();
}

export function envAssemblySyncDefaultEnabled(): boolean {
  return envDefaultEnabled();
}
