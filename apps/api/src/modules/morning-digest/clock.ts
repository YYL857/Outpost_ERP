/**
 * 晨报墙钟：统一用 Asia/Shanghai，避免服务器时区漂移。
 */

const TZ = "Asia/Shanghai";

export type ShanghaiParts = {
  /** YYYY-MM-DD */
  day: string;
  hour: number;
  minute: number;
  /** 当日分钟数 hour*60+minute */
  minuteOfDay: number;
};

export function shanghaiParts(now: Date = new Date()): ShanghaiParts {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { day, hour, minute, minuteOfDay: hour * 60 + minute };
}

/** 解析 "HH:MM" → 当日分钟；非法时回退 fallback */
export function parseHhMm(raw: string | undefined, fallback: string): number {
  const s = (raw ?? fallback).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) {
    const fb = /^(\d{1,2}):(\d{2})$/.exec(fallback);
    if (!fb) return 2 * 60;
    return Number(fb[1]) * 60 + Number(fb[2]);
  }
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return h * 60 + min;
}

export function formatMinuteOfDay(mod: number): string {
  const h = Math.floor(mod / 60) % 24;
  const m = mod % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 是否应在本分钟触发：目标时刻起 catchWindowMinutes 内、且当日尚未跑过。
 */
export function shouldFireWallClock(opts: {
  now?: Date;
  atMinuteOfDay: number;
  lastScheduledDay: string | null;
  catchWindowMinutes?: number;
}): { fire: boolean; day: string; reason: string } {
  const parts = shanghaiParts(opts.now);
  if (opts.lastScheduledDay === parts.day) {
    return { fire: false, day: parts.day, reason: "already_ran_today" };
  }
  const window = Math.max(1, opts.catchWindowMinutes ?? 5);
  const delta = parts.minuteOfDay - opts.atMinuteOfDay;
  if (delta >= 0 && delta < window) {
    return { fire: true, day: parts.day, reason: "in_window" };
  }
  return { fire: false, day: parts.day, reason: "outside_window" };
}

/** 上海日历的「昨天」YYYY-MM-DD */
export function shanghaiYesterday(now: Date = new Date()): string {
  const parts = shanghaiParts(now);
  // 用正午避免 DST 边界（上海无 DST，仍保持稳妥）
  const noonUtc = Date.parse(`${parts.day}T04:00:00.000Z`);
  const y = new Date(noonUtc - 24 * 60 * 60 * 1000);
  return shanghaiParts(y).day;
}
