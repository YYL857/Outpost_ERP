import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { OUTPOST_ROOT } from "../shops/registry.js";
import type { SessionRecord } from "./types.js";

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** 被新登录顶掉的会话标记保留时间，用于旧设备识别「被挤下线」 */
const REPLACED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 最近活跃落在此窗口内视为在线 */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
/** 磁盘 touch 节流，避免每个请求写盘 */
const TOUCH_MIN_INTERVAL_MS = 45 * 1000;
const COOKIE_NAME = "outpost_session";

/** 进程内节流：token → 上次写入 lastSeen 的 epoch ms */
const lastTouchWriteMs = new Map<string, number>();

function sessionsDir() {
  return join(OUTPOST_ROOT, "sessions");
}

function ensureSessionsDir() {
  const dir = sessionsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionPath(token: string) {
  return join(ensureSessionsDir(), `${token}.json`);
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

function replacedPath(token: string) {
  return join(ensureSessionsDir(), `${token}.replaced.json`);
}

function purgeExpiredReplacedMarks(dir: string) {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".replaced.json")) continue;
    const p = join(dir, name);
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as { replacedAt?: string };
      const at = Date.parse(raw.replacedAt ?? "");
      if (!Number.isFinite(at) || at + REPLACED_TTL_MS < Date.now()) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

/** 同一账号只保留即将签发的新会话：旧会话删除并留下「被顶下线」标记 */
export function replaceSessionsForUser(userId: string) {
  const dir = ensureSessionsDir();
  purgeExpiredReplacedMarks(dir);
  const replacedAt = new Date().toISOString();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name.endsWith(".replaced.json")) continue;
    const p = join(dir, name);
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as SessionRecord;
      if (raw.userId !== userId || !/^[a-f0-9]{64}$/.test(raw.token)) continue;
      writeFileSync(
        replacedPath(raw.token),
        JSON.stringify({ token: raw.token, userId, replacedAt }, null, 2),
        "utf8",
      );
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

export function sessionWasReplaced(token: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const p = replacedPath(token);
  if (!existsSync(p)) return false;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { replacedAt?: string };
    const at = Date.parse(raw.replacedAt ?? "");
    if (!Number.isFinite(at) || at + REPLACED_TTL_MS < Date.now()) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function createSession(userId: string): SessionRecord {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const record: SessionRecord = {
    token,
    userId,
    createdAt: iso,
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    lastSeenAt: iso,
  };
  writeFileSync(sessionPath(token), JSON.stringify(record, null, 2), "utf8");
  lastTouchWriteMs.set(token, now);
  return record;
}

/**
 * 鉴权通过后刷新 lastSeenAt（节流写盘）。
 * 在线判定依赖此字段，而非「会话文件是否存在」（TTL 长达 14 天）。
 */
export function touchSessionActivity(token: string): void {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  const now = Date.now();
  const prevWrite = lastTouchWriteMs.get(token) ?? 0;
  if (now - prevWrite < TOUCH_MIN_INTERVAL_MS) return;

  const p = sessionPath(token);
  if (!existsSync(p)) return;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as SessionRecord;
    if (raw.token !== token) return;
    if (Date.parse(raw.expiresAt) < now) return;
    const last = Date.parse(raw.lastSeenAt ?? raw.createdAt ?? "");
    if (Number.isFinite(last) && now - last < TOUCH_MIN_INTERVAL_MS) {
      lastTouchWriteMs.set(token, now);
      return;
    }
    const next: SessionRecord = {
      ...raw,
      lastSeenAt: new Date(now).toISOString(),
    };
    writeFileSync(p, JSON.stringify(next, null, 2), "utf8");
    lastTouchWriteMs.set(token, now);
  } catch {
    /* ignore */
  }
}

export type UserPresence = {
  lastSeenAt: string;
  online: boolean;
};

/** 扫描有效会话，按用户取最近 lastSeen；online = 窗口内有活跃 */
export function listUserPresence(
  nowMs = Date.now(),
): Map<string, UserPresence> {
  const dir = ensureSessionsDir();
  const best = new Map<string, number>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name.endsWith(".replaced.json")) continue;
    const p = join(dir, name);
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as SessionRecord;
      if (!raw.userId || !raw.token) continue;
      if (Date.parse(raw.expiresAt) < nowMs) continue;
      const seen = Date.parse(raw.lastSeenAt ?? "");
      if (!Number.isFinite(seen)) continue;
      const prev = best.get(raw.userId) ?? 0;
      if (seen > prev) best.set(raw.userId, seen);
    } catch {
      /* ignore */
    }
  }
  const out = new Map<string, UserPresence>();
  for (const [userId, seen] of best) {
    out.set(userId, {
      lastSeenAt: new Date(seen).toISOString(),
      online: nowMs - seen <= ONLINE_WINDOW_MS,
    });
  }
  return out;
}

export function loadSession(token: string): SessionRecord | null {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const p = sessionPath(token);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as SessionRecord;
    if (raw.token !== token) return null;
    if (Date.parse(raw.expiresAt) < Date.now()) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function destroySession(token: string) {
  const p = sessionPath(token);
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

export function destroySessionsForUser(userId: string) {
  const dir = ensureSessionsDir();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const p = join(dir, name);
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as { userId?: string };
      if (raw.userId === userId) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function readSessionToken(req: {
  headers: { cookie?: string; authorization?: string };
}): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const fromCookie = cookies[COOKIE_NAME]?.trim();
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  return null;
}

export function sessionCookieHeader(token: string, maxAgeSec = SESSION_TTL_MS / 1000) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeSec)}`;
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
