import { existsSync, readFileSync } from "node:fs";
import { dailyFileForDay, eventsFileForDay } from "./paths.js";
import type { AuditDailySummary, AuditEvent } from "./types.js";

function emptyDaily(day: string): AuditDailySummary {
  return {
    day,
    generatedAt: new Date().toISOString(),
    totalEvents: 0,
    ok: 0,
    denied: 0,
    error: 0,
    byModule: {},
    byAction: {},
    byActor: {},
    byShop: {},
  };
}

export function readDailySummary(day: string): AuditDailySummary {
  const path = dailyFileForDay(day);
  if (!existsSync(path)) return emptyDaily(day);
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as AuditDailySummary;
    if (raw?.day) return raw;
  } catch {
    /* fall through */
  }
  return emptyDaily(day);
}

export type ListAuditEventsOpts = {
  day: string;
  module?: string;
  actor?: string;
  shopId?: string;
  limit?: number;
  offset?: number;
};

export function listAuditEvents(opts: ListAuditEventsOpts): {
  day: string;
  total: number;
  events: AuditEvent[];
} {
  const file = eventsFileForDay(opts.day);
  if (!existsSync(file)) {
    return { day: opts.day, total: 0, events: [] };
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const all: AuditEvent[] = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as AuditEvent;
      if (opts.module && ev.module !== opts.module) continue;
      if (opts.shopId && ev.shopId !== opts.shopId) continue;
      if (opts.actor) {
        const a = opts.actor.toLowerCase();
        const hit =
          ev.actor.username.toLowerCase() === a ||
          ev.actor.id.toLowerCase() === a;
        if (!hit) continue;
      }
      all.push(ev);
    } catch {
      /* skip bad line */
    }
  }
  // 新事件在文件末尾；查询默认最新在前
  all.reverse();
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  return {
    day: opts.day,
    total: all.length,
    events: all.slice(offset, offset + limit),
  };
}
