import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { shanghaiDay } from "./day.js";
import { dailyFileForDay, eventsFileForDay } from "./paths.js";
import type {
  AuditActor,
  AuditDailySummary,
  AuditEvent,
  AuditResult,
} from "./types.js";

export type AppendAuditInput = {
  actor: AuditActor;
  shopId?: string | null;
  module: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  result?: AuditResult;
  summary: string;
  entityType?: string;
  entityId?: string;
  body?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  at?: Date;
};

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

function bump(map: Record<string, number>, key: string) {
  const k = key || "(unknown)";
  map[k] = (map[k] ?? 0) + 1;
}

function resultFromStatus(statusCode: number): AuditResult {
  if (statusCode >= 200 && statusCode < 400) return "ok";
  if (statusCode === 401 || statusCode === 403) return "denied";
  return "error";
}

function loadDaily(day: string): AuditDailySummary {
  const path = dailyFileForDay(day);
  if (!existsSync(path)) return emptyDaily(day);
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as AuditDailySummary;
    if (raw && raw.day === day) return raw;
  } catch {
    /* rebuild from empty */
  }
  return emptyDaily(day);
}

function saveDaily(summary: AuditDailySummary) {
  const path = dailyFileForDay(summary.day);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  summary.generatedAt = new Date().toISOString();
  writeFileSync(tmp, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function applyEventToDaily(summary: AuditDailySummary, ev: AuditEvent) {
  summary.totalEvents += 1;
  if (ev.result === "ok") summary.ok += 1;
  else if (ev.result === "denied") summary.denied += 1;
  else summary.error += 1;
  bump(summary.byModule, ev.module);
  bump(summary.byAction, `${ev.module}.${ev.action}`);
  bump(summary.byActor, ev.actor.username || ev.actor.id);
  if (ev.shopId) bump(summary.byShop, ev.shopId);
}

/** 追加一条审计事件，并增量更新当日汇总 */
export function appendAudit(input: AppendAuditInput): AuditEvent {
  const at = input.at ?? new Date();
  const day = shanghaiDay(at);
  const result = input.result ?? resultFromStatus(input.statusCode);
  const ev: AuditEvent = {
    id: randomUUID(),
    at: at.toISOString(),
    day,
    actor: {
      id: input.actor.id || "",
      username: input.actor.username || "",
      role: input.actor.role || "",
    },
    shopId: input.shopId ?? null,
    module: input.module || "unknown",
    action: input.action || input.method.toLowerCase(),
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    result,
    summary: (input.summary || "").slice(0, 500),
  };
  if (input.entityType) ev.entityType = input.entityType;
  if (input.entityId) ev.entityId = String(input.entityId).slice(0, 200);
  if (input.body) ev.body = input.body;
  if (input.detail) ev.detail = input.detail;

  const file = eventsFileForDay(day);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(ev)}\n`, "utf8");

  const daily = loadDaily(day);
  applyEventToDaily(daily, ev);
  saveDaily(daily);

  return ev;
}
