import type { AppState } from "../../common/types.js";
import { isImpexCoolingDown } from "../../platforms/noon/impex-client.js";
import { pullDomain } from "./pipeline.js";
import { runAutoIngest } from "../../platforms/noon/portal/auto-ingest.js";

/**
 * 全自动调度：
 * - live：Noon Impex 约 30 分钟 20 次，禁止高频轮询。
 *   空 Catalog → catalog；否则轮转 sales → fees → orders（Catalog 可视化优先）。
 *   ads 不走 Impex（影刀 portal-imports）。
 * - portal/mock：定时扫描 portal-imports 入库（无浏览器 SOP）
 */
let timer: ReturnType<typeof setInterval> | null = null;
let getStateFn: (() => AppState) | null = null;
let intervalMs = 120_000;
let liveTicks = 0;
let liveRotate = 0;
let enabled = true;
let running = false;
let lastRunAt: string | null = null;
let lastMessage: string | null = null;

function liveEveryN(): number {
  return Math.max(1, Number(process.env.OUTPOST_LIVE_POLL_EVERY_N_TICKS ?? 15));
}

export function getNoonPollerStatus() {
  return {
    enabled,
    timerActive: Boolean(timer),
    everyMs: intervalMs,
    running,
    lastRunAt,
    lastMessage,
    liveEveryN: liveEveryN(),
  };
}

export function stopNoonPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * @param opts.enabled 覆盖运行时启用态（默认保持当前；首次默认 true）
 * @param opts.skipInitial 为 true 时跳过启动时的 portal 初始 ingest
 */
export function startNoonPoller(
  getState: () => AppState,
  nextIntervalMs = 120_000,
  opts?: { enabled?: boolean; skipInitial?: boolean },
) {
  getStateFn = getState;
  intervalMs = Math.max(5_000, nextIntervalMs);
  if (opts?.enabled !== undefined) enabled = opts.enabled;

  stopNoonPoller();
  if (!enabled) {
    console.log("[noon-poller] disabled");
    return getNoonPollerStatus();
  }

  const state0 = getState();
  if (!opts?.skipInitial) {
    if (state0.noon.mode === "live") {
      console.log(
        `[noon-poller] live: skip initial Impex (catalog=${state0.catalog.length})`,
      );
    } else {
      void runAutoIngest(getState()).catch((err) =>
        console.error("[noon-poller] initial ingest", err),
      );
    }
  }

  timer = setInterval(() => {
    void runNoonPollerTick({ force: false }).catch((err) =>
      console.error("[noon-poller] tick", err),
    );
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  console.log(
    `[noon-poller] every ${intervalMs}ms mode=${state0.noon.mode} (liveEveryN=${liveEveryN()})`,
  );
  return getNoonPollerStatus();
}

export function setNoonPollerEnabled(next: boolean) {
  enabled = next;
  if (!getStateFn) return getNoonPollerStatus();
  if (next) {
    return startNoonPoller(getStateFn, intervalMs, {
      enabled: true,
      skipInitial: true,
    });
  }
  stopNoonPoller();
  console.log("[noon-poller] stopped");
  return getNoonPollerStatus();
}

/**
 * 执行一次轮询。force=true 时绕过 live 的 N-tick 节流（手动「立即执行」）。
 */
export async function runNoonPollerTick(opts?: {
  force?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  if (!getStateFn) {
    return { ok: false, message: "poller not initialized" };
  }
  if (running) {
    return { ok: false, message: "already running" };
  }

  const state = getStateFn();
  if (!state.noon.enabled) {
    lastRunAt = new Date().toISOString();
    lastMessage = "noon disabled";
    return { ok: false, message: lastMessage };
  }

  running = true;
  lastRunAt = new Date().toISOString();
  try {
    if (state.noon.mode === "live") {
      if (!opts?.force) {
        liveTicks += 1;
        if (liveTicks % liveEveryN() !== 0) {
          lastMessage = `skip tick ${liveTicks}/${liveEveryN()}`;
          return { ok: true, message: lastMessage };
        }
      }
      if (isImpexCoolingDown()) {
        lastMessage = "impex cooling down";
        return { ok: false, message: lastMessage };
      }

      const domain = pickLivePollDomain(state, liveRotate);
      liveRotate += 1;
      await pullDomain(state, domain);
      lastMessage = `live pull ${domain}`;
      return { ok: true, message: lastMessage };
    }

    await runAutoIngest(state);
    lastMessage = "auto-ingest";
    return { ok: true, message: lastMessage };
  } catch (err) {
    lastMessage = err instanceof Error ? err.message : String(err);
    console.error("[noon-poller]", err);
    return { ok: false, message: lastMessage };
  } finally {
    running = false;
  }
}

function pickLivePollDomain(
  state: AppState,
  rotate: number,
): "catalog" | "orders" | "sales" | "fees" {
  if (state.catalog.length === 0) return "catalog";
  if (state.salesFacts.length === 0) return "sales";
  if (state.feeSnapshots.length === 0) return "fees";
  const cycle = ["sales", "fees", "orders"] as const;
  return cycle[rotate % cycle.length]!;
}
