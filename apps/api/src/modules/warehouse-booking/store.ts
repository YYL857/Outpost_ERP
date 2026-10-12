import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  activeSessionPath,
  ensureWarehouseBookingDirs,
  sessionsDir,
} from "./paths.js";
import {
  loadAsnCapture,
  saveAsnCapture,
  toBookingCapture,
  type StoredAsnCapture,
} from "./asn-captures.js";
import { buildShopBucketsForTicket } from "./pack-ticket.js";
import { loadHolidayDates } from "./holidays.js";
import { buildBookingDefaults } from "./suggest.js";
import type {
  BookingCapture,
  BookingStep,
  WarehouseBookingSession,
} from "./types.js";

function nowIso() {
  return new Date().toISOString();
}

function sessionPath(id: string) {
  return join(sessionsDir(), `${id}.json`);
}

export function createSession(ticketPrefix: string): WarehouseBookingSession {
  ensureWarehouseBookingDirs();
  const ticket = ticketPrefix.trim();
  if (!ticket) throw new Error("票号不能为空");

  const { shops, matchedLineCount } = buildShopBucketsForTicket(ticket);
  if (matchedLineCount === 0) {
    throw new Error(`装箱明细中未找到物流编号含「${ticket}」的行`);
  }

  const bookingDefaults = buildBookingDefaults({ region: "sa" });
  const sheetAsnShops = shops.filter((s) => s.asnId);
  if (sheetAsnShops.length) {
    bookingDefaults.hints.unshift(
      `箱表已带回 ASN：${sheetAsnShops.map((s) => `${s.shopPrefix}=${s.asnId}`).join("，")}`,
    );
  } else {
    bookingDefaults.hints.unshift(
      "箱表尚无 ASN：请先按清单建 ASN，保存后即可约仓",
    );
  }

  let step: BookingStep = "align";
  if (shops.some((s) => s.asnId && s.asnPackedConfirmed)) {
    step = "schedule";
  } else if (shops.some((s) => s.asnId)) {
    step = "asn";
  }

  const session: WarehouseBookingSession = {
    id: randomUUID(),
    ticketPrefix: ticket,
    step,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    shops,
    activeShopPrefix: shops[0]?.shopPrefix ?? null,
    capture: null,
    holidaysBlocked: loadHolidayDates(),
    bookingDefaults,
    notes: "",
  };
  hydrateSessionCaptureFromAsnMemory(session);
  saveSession(session);
  setActiveSessionId(session.id);
  return session;
}

/** 用本票各店 ASN 去记忆库找回约仓结果（关侧栏后重开也能对上） */
export function hydrateSessionCaptureFromAsnMemory(
  session: WarehouseBookingSession,
): StoredAsnCapture | null {
  const ordered = [
    session.shops.find((s) => s.shopPrefix === session.activeShopPrefix),
    ...session.shops,
  ].filter(Boolean) as typeof session.shops;
  const seen = new Set<string>();
  for (const shop of ordered) {
    const asn = (shop.asnId || "").trim();
    if (!asn || seen.has(asn.toUpperCase())) continue;
    seen.add(asn.toUpperCase());
    const stored = loadAsnCapture(asn);
    if (!stored) continue;
    session.capture = toBookingCapture(stored);
    session.step = "notify";
    if (!session.activeShopPrefix) session.activeShopPrefix = shop.shopPrefix;
    bookingDefaultsHintRemembered(session, stored);
    return stored;
  }
  return null;
}

function bookingDefaultsHintRemembered(
  session: WarehouseBookingSession,
  stored: StoredAsnCapture,
) {
  const line = `已按 ASN=${stored.asnId} 找回约仓记忆：${stored.scheduledDate} ${stored.scheduleSlot}（可改后再回填装箱表）`;
  if (!session.bookingDefaults.hints.includes(line)) {
    session.bookingDefaults.hints.unshift(line);
  }
}

export function findSessionByAsn(asnId: string): WarehouseBookingSession | null {
  const key = asnId.trim().toUpperCase();
  if (!key) return null;
  const active = getActiveSession();
  if (active?.shops.some((s) => (s.asnId || "").toUpperCase() === key)) {
    return active;
  }
  if (active?.capture?.asnId?.toUpperCase() === key) return active;
  for (const s of listRecentSessions(50)) {
    if (s.shops.some((shop) => (shop.asnId || "").toUpperCase() === key)) {
      return s;
    }
    if (s.capture?.asnId?.toUpperCase() === key) return s;
  }
  return null;
}

export function saveSession(session: WarehouseBookingSession): void {
  ensureWarehouseBookingDirs();
  session.updatedAt = nowIso();
  writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), "utf8");
}

export function loadSession(id: string): WarehouseBookingSession | null {
  const path = sessionPath(id);
  if (!existsSync(path)) return null;
  try {
    const session = JSON.parse(
      readFileSync(path, "utf8"),
    ) as WarehouseBookingSession;
    if (!session.bookingDefaults) {
      session.bookingDefaults = buildBookingDefaults({ region: "sa" });
    }
    for (const shop of session.shops || []) {
      if (shop.asnSource === undefined) {
        shop.asnSource = shop.asnId ? "manual" : null;
      }
      if (shop.forwarder === undefined) shop.forwarder = null;
      if (shop.shopLabel === undefined) shop.shopLabel = null;
      if (shop.shopName === undefined) shop.shopName = null;
      for (const box of shop.boxes || []) {
        if (box.asnFromSheet === undefined) box.asnFromSheet = null;
      }
    }
    return session;
  } catch {
    return null;
  }
}

export function setActiveSessionId(id: string | null): void {
  ensureWarehouseBookingDirs();
  writeFileSync(
    activeSessionPath(),
    JSON.stringify({ sessionId: id, updatedAt: nowIso() }, null, 2),
    "utf8",
  );
}

export function getActiveSessionId(): string | null {
  const path = activeSessionPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      sessionId?: string | null;
    };
    return raw.sessionId || null;
  } catch {
    return null;
  }
}

export function getActiveSession(): WarehouseBookingSession | null {
  const id = getActiveSessionId();
  if (!id) return null;
  return loadSession(id);
}

export function listRecentSessions(limit = 20): WarehouseBookingSession[] {
  ensureWarehouseBookingDirs();
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const sessions: WarehouseBookingSession[] = [];
  for (const f of files) {
    try {
      const s = JSON.parse(
        readFileSync(join(dir, f), "utf8"),
      ) as WarehouseBookingSession;
      sessions.push(s);
    } catch {
      /* skip */
    }
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions.slice(0, limit);
}

export type SessionPatch = {
  activeShopPrefix?: string | null;
  notes?: string;
  step?: BookingStep;
  shopAsn?: { shopPrefix: string; asnId: string };
  shopPacked?: { shopPrefix: string; confirmed: boolean };
};

export function patchSession(
  id: string,
  patch: SessionPatch,
): WarehouseBookingSession {
  const session = loadSession(id);
  if (!session) throw new Error("会话不存在");

  if (patch.activeShopPrefix !== undefined) {
    session.activeShopPrefix = patch.activeShopPrefix;
  }
  if (patch.notes !== undefined) session.notes = patch.notes;
  if (patch.step) session.step = patch.step;

  if (patch.shopAsn) {
    const shop = session.shops.find(
      (s) => s.shopPrefix === patch.shopAsn!.shopPrefix,
    );
    if (!shop) throw new Error(`未找到店 ${patch.shopAsn.shopPrefix}`);
    shop.asnId = patch.shopAsn.asnId.trim();
    shop.asnSource = shop.asnId ? "manual" : null;
    if (shop.asnId) session.step = "schedule";
    // 填/改 ASN 后立刻按号找回约仓记忆
    if (shop.asnId) {
      const stored = loadAsnCapture(shop.asnId);
      if (stored) {
        session.capture = toBookingCapture(stored);
        session.step = "notify";
        bookingDefaultsHintRemembered(session, stored);
      }
    }
  }

  if (patch.shopPacked) {
    const shop = session.shops.find(
      (s) => s.shopPrefix === patch.shopPacked!.shopPrefix,
    );
    if (!shop) throw new Error(`未找到店 ${patch.shopPacked.shopPrefix}`);
    if (
      patch.shopPacked.confirmed &&
      session.shops.filter((s) => s.shopPrefix !== shop.shopPrefix).length > 0
    ) {
      // 允许多店各自确认，但不允许把其他店货勾进本店（UI 侧只展示本店 items）
    }
    shop.asnPackedConfirmed = patch.shopPacked.confirmed;
    if (shop.asnPackedConfirmed && shop.asnId) session.step = "schedule";
  }

  saveSession(session);
  setActiveSessionId(session.id);
  return session;
}

export type ApplyCaptureResult = {
  session: WarehouseBookingSession | null;
  capture: BookingCapture;
  stored: StoredAsnCapture;
  /** 无会话时仍已按 ASN 落盘，关插件后可查 */
  savedWithoutSession: boolean;
};

export function applyCapture(
  payload: {
    sessionId?: string | null;
    asnId: string;
    warehouse?: string;
    scheduledDate: string;
    scheduleSlot: string;
    region?: string | null;
    pageUrl?: string | null;
    source?: "extension" | "manual";
    flags?: string[];
  },
): ApplyCaptureResult {
  const asnId = payload.asnId.trim();
  const capture: BookingCapture = {
    asnId,
    warehouse: (payload.warehouse || "").trim(),
    scheduledDate: payload.scheduledDate.trim(),
    scheduleSlot: payload.scheduleSlot.trim(),
    region: payload.region ?? null,
    pageUrl: payload.pageUrl ?? null,
    capturedAt: nowIso(),
    source: payload.source || "extension",
    flags: payload.flags ?? [],
  };

  let session: WarehouseBookingSession | null = null;
  if (payload.sessionId) session = loadSession(payload.sessionId);
  if (!session) session = getActiveSession();
  if (!session) session = findSessionByAsn(asnId);

  const stored = saveAsnCapture(capture, {
    ticketPrefix: session?.ticketPrefix ?? null,
    sessionId: session?.id ?? null,
  });

  if (!session) {
    return {
      session: null,
      capture: toBookingCapture(stored),
      stored,
      savedWithoutSession: true,
    };
  }

  session.capture = toBookingCapture(stored);

  // 回填到匹配 ASN 的店，否则当前店（约仓成功必须以该店为准，避免 N1/N2 串店）
  let shop =
    session.shops.find((s) => s.asnId && s.asnId === asnId) ||
    session.shops.find((s) => s.shopPrefix === session.activeShopPrefix) ||
    session.shops[0];
  if (shop) {
    shop.asnId = asnId;
    if (!shop.asnSource) shop.asnSource = "manual";
    session.activeShopPrefix = shop.shopPrefix;
  }

  session.step = "notify";
  saveSession(session);
  setActiveSessionId(session.id);
  return {
    session,
    capture: session.capture,
    stored,
    savedWithoutSession: false,
  };
}

/** 用户核对后改约仓结果：写会话 + ASN 记忆 */
export function updateSessionCapture(
  sessionId: string,
  patch: {
    asnId?: string;
    warehouse?: string;
    scheduledDate?: string;
    scheduleSlot?: string;
  },
): WarehouseBookingSession {
  const session = loadSession(sessionId);
  if (!session) throw new Error("会话不存在");
  const base = session.capture;
  const asnId = (patch.asnId || base?.asnId || "").trim();
  if (!asnId) throw new Error("需要 ASN 号");
  const scheduledDate = (
    patch.scheduledDate ||
    base?.scheduledDate ||
    ""
  ).trim();
  const scheduleSlot = (
    patch.scheduleSlot ||
    base?.scheduleSlot ||
    ""
  ).trim();
  if (!scheduledDate || !scheduleSlot) {
    throw new Error("需要送仓日期与时段");
  }
  const capture: BookingCapture = {
    asnId,
    warehouse: (
      patch.warehouse !== undefined
        ? patch.warehouse
        : base?.warehouse || ""
    ).trim(),
    scheduledDate,
    scheduleSlot,
    region: base?.region ?? null,
    pageUrl: base?.pageUrl ?? null,
    capturedAt: base?.capturedAt || nowIso(),
    source: "manual",
    flags: [...(base?.flags || []), "user_edited"],
  };
  const stored = saveAsnCapture(capture, {
    ticketPrefix: session.ticketPrefix,
    sessionId: session.id,
  });
  session.capture = toBookingCapture(stored);
  session.step = "notify";
  // 改 ASN 时写回当前店（不要只匹配旧号，否则侧栏改了号店上仍是旧 ASN）
  const shop =
    session.shops.find((s) => s.shopPrefix === session.activeShopPrefix) ||
    session.shops.find((s) => s.asnId && s.asnId === asnId) ||
    session.shops[0];
  if (shop) {
    shop.asnId = asnId;
    shop.asnSource = "manual";
    session.activeShopPrefix = shop.shopPrefix;
  }
  saveSession(session);
  setActiveSessionId(session.id);
  return session;
}
