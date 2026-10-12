/**
 * 月度毛利关账墙钟：上海时间每月 3 / 5 / 8 日 10:00。
 * 3 日提醒缺月末段；5 日门禁通过则关账；8 日仍未关则升级。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppState } from "../../common/types.js";
import { shouldFireWallClock } from "../morning-digest/clock.js";
import { listEligibleSyncShops } from "../sync/multi-shop-sync.js";
import { getShopState, runAsShop } from "../../shops/state-cache.js";
import { pushAlert } from "../sync/alerts.js";
import { saveState } from "../../data/store.js";
import { closeGpMonth } from "./gp-close.js";
import {
  evaluateCloseGate,
  findActiveClose,
  lastDayOfMonth,
  previousCalendarMonth,
} from "./statement-settlement.js";

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function envGpCloseDefaultEnabled(): boolean {
  return bool(process.env.OUTPOST_GP_CLOSE_ENABLED, true);
}

const AT_MINUTE = 10 * 60;
const POLL_MS = 60_000;

type CloseDay = 3 | 5 | 8;

type Persist = {
  lastByDay: Partial<Record<string, string>>;
  lastRunAt: string | null;
  lastMessage: string | null;
  lastOk: boolean | null;
};

function persistPath(): string {
  const root =
    process.env.OUTPOST_GP_CLOSE_DIR?.trim() ||
    join(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data", "gp-close");
  return join(resolve(root), "last.json");
}

function loadPersist(): Persist {
  const p = persistPath();
  if (!existsSync(p)) {
    return { lastByDay: {}, lastRunAt: null, lastMessage: null, lastOk: null };
  }
  try {
    return { lastByDay: {}, ...JSON.parse(readFileSync(p, "utf8")) } as Persist;
  } catch {
    return { lastByDay: {}, lastRunAt: null, lastMessage: null, lastOk: null };
  }
}

function savePersist(next: Persist): void {
  const p = persistPath();
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n", "utf8");
}

let timer: ReturnType<typeof setInterval> | null = null;
let enabled = envGpCloseDefaultEnabled();
let running = false;
let persist = loadPersist();

export function getGpCloseSchedulerStatus() {
  return {
    enabled,
    timerActive: Boolean(timer),
    everyMs: POLL_MS,
    running,
    lastRunAt: persist.lastRunAt,
    lastMessage: persist.lastMessage,
    lastOk: persist.lastOk,
  };
}

export function setGpCloseSchedulerEnabled(on: boolean) {
  enabled = on;
  ensureTimer();
}

export function stopGpCloseScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

function ensureTimer() {
  if (enabled) {
    if (!timer) {
      timer = setInterval(() => tick(), POLL_MS);
      console.log("[gp-month-close] wall-clock poll every 60s @ 10:00 days 3/5/8");
    }
  } else {
    stopGpCloseScheduler();
  }
}

export function startGpCloseScheduler(opts?: { enabled?: boolean }) {
  if (opts?.enabled !== undefined) enabled = opts.enabled;
  ensureTimer();
}

function shanghaiDayNumber(day: string): number {
  return Number(day.slice(8, 10));
}

function tick() {
  if (!enabled || running) return;
  const dayNum = shanghaiDayNumber(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  ) as CloseDay | number;
  if (dayNum !== 3 && dayNum !== 5 && dayNum !== 8) return;
  const key = String(dayNum);
  const fire = shouldFireWallClock({
    atMinuteOfDay: AT_MINUTE,
    lastScheduledDay: persist.lastByDay[key] ?? null,
  });
  if (!fire.fire) return;
  void runGpCloseTick(dayNum, { triggeredBy: "schedule", scheduledDay: fire.day });
}

export type GpCloseTickResult = {
  ok: boolean;
  message: string;
  month: string;
  day: CloseDay;
  shops: Array<{ shopId: string; action: string; detail: string }>;
};

export async function runGpCloseTick(
  day: CloseDay | "close",
  opts?: { triggeredBy?: "schedule" | "manual"; scheduledDay?: string },
): Promise<GpCloseTickResult> {
  if (running) {
    return {
      ok: false,
      message: "gp-month-close already running",
      month: previousCalendarMonth(),
      day: day === "close" ? 5 : day,
      shops: [],
    };
  }
  running = true;
  const month = previousCalendarMonth();
  const actionDay: CloseDay = day === "close" ? 5 : day;
  const shops: GpCloseTickResult["shops"] = [];
  try {
    for (const shop of listEligibleSyncShops()) {
      const line = runAsShop(shop.id, () =>
        runForShop(getShopState(shop.id), shop.id, month, actionDay),
      );
      shops.push(line);
    }
    const ok = shops.every(
      (s) => !s.action.endsWith("fail") && s.action !== "escalate",
    );
    const message = shops
      .map((s) => `${s.shopId}:${s.action}`)
      .join("；") || "无店铺";
    persist = {
      ...persist,
      lastRunAt: new Date().toISOString(),
      lastMessage: message,
      lastOk: ok,
    };
    if (opts?.scheduledDay) {
      persist.lastByDay = {
        ...persist.lastByDay,
        [String(actionDay)]: opts.scheduledDay,
      };
    }
    savePersist(persist);
    return { ok, message, month, day: actionDay, shops };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    persist = {
      ...persist,
      lastRunAt: new Date().toISOString(),
      lastMessage: message,
      lastOk: false,
    };
    savePersist(persist);
    return { ok: false, message, month, day: actionDay, shops };
  } finally {
    running = false;
  }
}

function runForShop(
  state: AppState,
  shopId: string,
  month: string,
  day: CloseDay,
): { shopId: string; action: string; detail: string } {
  const closed = findActiveClose(state, month);
  const last = lastDayOfMonth(month);

  if (day === 3) {
    if (closed) {
      return { shopId, action: "skip", detail: "已关账" };
    }
    const gate = evaluateCloseGate(state, month);
    if (!gate.coverageComplete) {
      pushAlert(state, {
        level: "warning",
        title: `${month} 毛利关账：账单未齐`,
        detail: `请导入含月末段（${last}）的 noon_financeweb_statements CSV。覆盖至 ${
          gate.settlement?.maxDate || "无"
        }。`,
      });
      return { shopId, action: "remind", detail: "缺月末段" };
    }
    return { shopId, action: "ok", detail: "覆盖已到月末" };
  }

  if (day === 5) {
    if (closed) {
      return { shopId, action: "skip", detail: `已关账 ${closed.closedAt}` };
    }
    const result = closeGpMonth(state, month, {
      closedBy: "schedule",
    });
    if (result.ok) {
      saveState(state);
      pushAlert(state, {
        level: "info",
        title: `${month} 毛利已关账`,
        detail: `纯利 CNY ${result.close.pureProfitCny}（账单口径，终稿）。`,
      });
      return { shopId, action: "closed", detail: "自动关账" };
    }
    pushAlert(state, {
      level: "warning",
      title: `${month} 毛利未能关账`,
      detail: result.error,
    });
    return { shopId, action: "gate-fail", detail: result.error };
  }

  if (closed) {
    return { shopId, action: "skip", detail: "已关账" };
  }
  const gate = evaluateCloseGate(state, month);
  const fail = gate.checks.filter((c) => !c.ok).map((c) => c.detail).join("；");
  pushAlert(state, {
    level: "danger",
    title: `${month} 毛利仍未关账`,
    detail: fail || "超过关账窗（次月 8 日），请导入月末账单后手动关账。",
  });
  return { shopId, action: "escalate", detail: fail || "未关账" };
}
