/**
 * 晨报通道配置（店内默认开 / 市场情报默认关）
 */
import { formatMinuteOfDay, parseHhMm } from "./clock.js";

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number, min: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

export type MorningDigestConfig = {
  storeEnabled: boolean;
  miEnabled: boolean;
  storeAtMinute: number;
  miAtMinute: number;
  storeAtLabel: string;
  miAtLabel: string;
  /** 门禁失败后最多再试几次（不含首次） */
  gateRetryMax: number;
  gateRetryMs: number;
  /** 情报无新增时是否推「今日无新增」短讯 */
  miNotifyEmpty: boolean;
  pollEveryMs: number;
  catchWindowMinutes: number;
};

export function loadMorningDigestConfig(): MorningDigestConfig {
  const storeAtMinute = parseHhMm(
    process.env.OUTPOST_STORE_DIGEST_AT,
    "02:00",
  );
  const miAtMinute = parseHhMm(process.env.OUTPOST_MI_DIGEST_AT, "03:30");
  return {
    storeEnabled: bool(process.env.OUTPOST_STORE_DIGEST_ENABLED, true),
    miEnabled: bool(process.env.OUTPOST_MI_DIGEST_ENABLED, false),
    storeAtMinute,
    miAtMinute,
    storeAtLabel: formatMinuteOfDay(storeAtMinute),
    miAtLabel: formatMinuteOfDay(miAtMinute),
    gateRetryMax: int(process.env.OUTPOST_DIGEST_GATE_RETRY_MAX, 3, 0),
    gateRetryMs: int(
      process.env.OUTPOST_DIGEST_GATE_RETRY_MS,
      20 * 60 * 1000,
      60_000,
    ),
    miNotifyEmpty: bool(process.env.OUTPOST_MI_DIGEST_NOTIFY_EMPTY, false),
    pollEveryMs: int(process.env.OUTPOST_DIGEST_POLL_MS, 60_000, 15_000),
    catchWindowMinutes: int(process.env.OUTPOST_DIGEST_CATCH_WINDOW_MIN, 5, 1),
  };
}

export function envStoreDigestDefaultEnabled(): boolean {
  return bool(process.env.OUTPOST_STORE_DIGEST_ENABLED, true);
}

export function envMiDigestDefaultEnabled(): boolean {
  return bool(process.env.OUTPOST_MI_DIGEST_ENABLED, false);
}
