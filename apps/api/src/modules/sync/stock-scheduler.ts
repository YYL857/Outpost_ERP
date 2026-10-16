/**
 * 分仓库存日更两次：上海 09:30 / 16:00 对健康门禁 live 店强制 pullDomain("stock")。
 * 轮询侧 stale 安全网见 live-impex-domains.stockRefreshStaleMs（默认 14h）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isImpexCoolingDown } from "../../platforms/noon/impex-client.js";
import { getHealthGateShopIds } from "../../shops/registry.js";
import {
  getShopState,
  runAsShopAsync,
  saveShopState,
} from "../../shops/state-cache.js";
import { listLiveImpexShops } from "./multi-shop-sync.js";
import { pullDomain } from "./pipeline.js";
import { shanghaiYmd } from "./gap-audit.js";
import {
  cancelDebouncedReplenishRebuild,
  rebuildReplenishAfterStockSync,
} from "../replenish/after-stock-sync.js";

export type StockWindowId = "am" | "pm";

type ScheduleState = {
  /** `${shopId}:${ymd}:${window}` → ISO 成功时间 */
  done: Record<string, string>;
  lastTickAt: string | null;
  lastMessage: string | null;
};

const WINDOWS: Array<{
  id: StockWindowId;
  hour: number;
  minute: number;
  graceMinutes: number;
}> = [
  { id: "am", hour: 9, minute: 30, graceMinutes: 10 },
  { id: "pm", hour: 16, minute: 0, graceMinutes: 10 },
];

let timer: ReturnType<typeof setInterval> | null = null;
let enabled = true;
let running = false;
let lastRunAt: string | null = null;
let lastMessage: string | null = null;

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function envStockScheduleDefaultEnabled(): boolean {
  return bool(process.env.OUTPOST_STOCK_SCHEDULE_ENABLED, true);
}

function outpostRoot(): string {
  const explicit = process.env.OUTPOST_ROOT?.trim();
  if (explicit) return resolve(explicit);
  return resolve("D:\\outpost-data");
}

function statePath(): string {
  return join(outpostRoot(), "sync", "stock-schedule-last.json");
}

function loadState(): ScheduleState {
  const p = statePath();
  if (!existsSync(p)) {
    return { done: {}, lastTickAt: null, lastMessage: null };
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as ScheduleState;
    return {
      done: raw.done && typeof raw.done === "object" ? raw.done : {},
      lastTickAt: raw.lastTickAt ?? null,
      lastMessage: raw.lastMessage ?? null,
    };
  } catch {
    return { done: {}, lastTickAt: null, lastMessage: null };
  }
}

function saveScheduleState(st: ScheduleState) {
  const p = statePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(st, null, 2), "utf8");
}

function shanghaiParts(d = new Date()): {
  ymd: string;
  hour: number;
  minute: number;
} {
  const ymd = shanghaiYmd(d);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { ymd, hour, minute };
}

/** 当前是否落在某窗（含 grace）；供测试导出 */
export function activeStockWindow(
  now = new Date(),
): { ymd: string; window: StockWindowId } | null {
  const { ymd, hour, minute } = shanghaiParts(now);
  const mins = hour * 60 + minute;
  for (const w of WINDOWS) {
    const start = w.hour * 60 + w.minute;
    const end = start + w.graceMinutes;
    if (mins >= start && mins < end) {
      return { ymd, window: w.id };
    }
  }
  return null;
}

function doneKey(shopId: string, ymd: string, window: StockWindowId) {
  return `${shopId}:${ymd}:${window}`;
}

function targetShops() {
  const gate = new Set(getHealthGateShopIds());
  return listLiveImpexShops().filter((s) => gate.has(s.id));
}

export function getStockSchedulerStatus() {
  return {
    enabled,
    timerActive: Boolean(timer),
    everyMs: 60_000,
    running,
    lastRunAt,
    lastMessage,
    windows: WINDOWS.map((w) => `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`),
  };
}

export function stopStockScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function setStockSchedulerEnabled(next: boolean) {
  enabled = next;
  if (!next) stopStockScheduler();
  else if (!timer) startStockScheduler({ enabled: true });
  return getStockSchedulerStatus();
}

/**
 * 执行一次调度 tick（可 force 忽略时间窗，对未完成窗重试 / 测试用）。
 */
export async function runStockScheduleTick(opts?: {
  force?: boolean;
  now?: Date;
}): Promise<{ ok: boolean; message: string }> {
  if (running) {
    return { ok: false, message: "stock-schedule already running" };
  }
  const now = opts?.now ?? new Date();
  const win = activeStockWindow(now);
  if (!win && !opts?.force) {
    const msg = "not in stock window (Shanghai 09:30 / 16:00 ±10m)";
    lastMessage = msg;
    return { ok: true, message: msg };
  }

  running = true;
  const st = loadState();
  const shops = targetShops();
  const notes: string[] = [];
  let anyOk = false;

  try {
    // force 且不在窗内：补当天尚未成功的窗（优先 pm，否则 am）
    const windowsToRun: StockWindowId[] = win
      ? [win.window]
      : opts?.force
        ? (["am", "pm"] as const).filter((w) =>
            shops.some(
              (s) => !st.done[doneKey(s.id, shanghaiYmd(now), w)],
            ),
          )
        : [];

    if (!windowsToRun.length && opts?.force) {
      const msg = "force: all windows already done today";
      lastMessage = msg;
      return { ok: true, message: msg };
    }

    const ymd = win?.ymd ?? shanghaiYmd(now);
    for (const windowId of windowsToRun.length ? windowsToRun : win ? [win.window] : []) {
      for (const shop of shops) {
        const key = doneKey(shop.id, ymd, windowId);
        if (st.done[key]) {
          notes.push(`${shop.id}/${windowId}: skip done`);
          continue;
        }
        if (isImpexCoolingDown(shop.id)) {
          notes.push(`${shop.id}/${windowId}: cooling`);
          continue;
        }
        try {
          await runAsShopAsync(shop.id, async () => {
            const state = getShopState(shop.id);
            if (!state.noon.enabled) {
              notes.push(`${shop.id}/${windowId}: noon disabled`);
              return;
            }
            await pullDomain(state, "stock");
            // Catalog 带 stock_fbn_net（门户 Active Net），补货可售对齐用
            try {
              await pullDomain(state, "catalog");
            } catch (catErr) {
              const cm =
                catErr instanceof Error ? catErr.message : String(catErr);
              notes.push(`${shop.id}/${windowId}: catalog ${cm.slice(0, 80)}`);
            }
            saveShopState(shop.id, state);
          });
          cancelDebouncedReplenishRebuild(shop.id);
          const wb = rebuildReplenishAfterStockSync(shop.id);
          notes.push(wb.message);
          st.done[key] = new Date().toISOString();
          anyOk = true;
          notes.push(`${shop.id}/${windowId}: ok`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          notes.push(`${shop.id}/${windowId}: fail ${msg.slice(0, 120)}`);
        }
      }
    }

    // 清理 7 天前记录
    const cutoff = shanghaiYmd(new Date(now.getTime() - 8 * 86400_000));
    for (const k of Object.keys(st.done)) {
      const m = k.match(/:(\d{4}-\d{2}-\d{2}):/);
      if (m?.[1] && m[1] < cutoff) delete st.done[k];
    }

    const message = notes.join(" · ") || "noop";
    st.lastTickAt = new Date().toISOString();
    st.lastMessage = message;
    saveScheduleState(st);
    lastRunAt = st.lastTickAt;
    lastMessage = message;
    return { ok: anyOk || notes.every((n) => /skip done|cooling|disabled|noop/.test(n)), message };
  } finally {
    running = false;
  }
}

export function startStockScheduler(opts?: { enabled?: boolean }) {
  if (opts?.enabled !== undefined) enabled = opts.enabled;
  else enabled = envStockScheduleDefaultEnabled();

  stopStockScheduler();
  if (!enabled) {
    console.log("[stock-schedule] disabled");
    return getStockSchedulerStatus();
  }

  timer = setInterval(() => {
    if (!enabled) return;
    void runStockScheduleTick().catch((err) =>
      console.error("[stock-schedule] tick", err),
    );
  }, 60_000);
  if (typeof timer.unref === "function") timer.unref();

  // 启动后稍延迟一次：若正好在窗内可补拉
  setTimeout(() => {
    void runStockScheduleTick().catch((err) =>
      console.error("[stock-schedule] boot tick", err),
    );
  }, 15_000).unref?.();

  console.log("[stock-schedule] every 60s · Shanghai 09:30 / 16:00 (±10m)");
  return getStockSchedulerStatus();
}
