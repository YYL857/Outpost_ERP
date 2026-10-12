/**
 * 按 ASN 持久存储约仓结果。
 * 会话关掉后仍可按 ASN 找回，供侧栏展示 / 核对后回填装箱表。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capturesDir, ensureWarehouseBookingDirs } from "./paths.js";
import type { BookingCapture } from "./types.js";

export type StoredAsnCapture = BookingCapture & {
  ticketPrefix: string | null;
  sessionId: string | null;
  updatedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

/** 文件名安全：只留字母数字 */
export function normalizeAsnId(asnId: string): string {
  return String(asnId || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function asnCapturePath(asnId: string): string {
  const key = normalizeAsnId(asnId);
  if (!key) throw new Error("ASN 号无效");
  return join(capturesDir(), `${key}.json`);
}

export function loadAsnCapture(asnId: string): StoredAsnCapture | null {
  const key = normalizeAsnId(asnId);
  if (!key) return null;
  const path = join(capturesDir(), `${key}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StoredAsnCapture;
  } catch {
    return null;
  }
}

export function saveAsnCapture(
  capture: BookingCapture,
  meta?: {
    ticketPrefix?: string | null;
    sessionId?: string | null;
  },
): StoredAsnCapture {
  ensureWarehouseBookingDirs();
  const asnId = normalizeAsnId(capture.asnId);
  if (!asnId) throw new Error("ASN 号无效");

  const prev = loadAsnCapture(asnId);
  const stored: StoredAsnCapture = {
    asnId,
    warehouse: (capture.warehouse || "").trim(),
    scheduledDate: capture.scheduledDate.trim(),
    scheduleSlot: capture.scheduleSlot.trim(),
    region: capture.region ?? null,
    pageUrl: capture.pageUrl ?? null,
    capturedAt: capture.capturedAt || prev?.capturedAt || nowIso(),
    source: capture.source || "extension",
    flags: capture.flags ?? [],
    ticketPrefix: meta?.ticketPrefix ?? prev?.ticketPrefix ?? null,
    sessionId: meta?.sessionId ?? prev?.sessionId ?? null,
    updatedAt: nowIso(),
  };
  writeFileSync(asnCapturePath(asnId), JSON.stringify(stored, null, 2), "utf8");
  return stored;
}

/** 仅改用户可编辑字段，保留首次 capturedAt */
export function patchAsnCapture(
  asnId: string,
  patch: {
    warehouse?: string;
    scheduledDate?: string;
    scheduleSlot?: string;
    region?: string | null;
    pageUrl?: string | null;
    source?: "extension" | "manual";
    flags?: string[];
    ticketPrefix?: string | null;
    sessionId?: string | null;
  },
): StoredAsnCapture {
  const prev = loadAsnCapture(asnId);
  if (!prev) {
    const date = patch.scheduledDate?.trim();
    const slot = patch.scheduleSlot?.trim();
    if (!date || !slot) {
      throw new Error(`未找到 ASN=${normalizeAsnId(asnId)} 的约仓记忆，且缺少日期/时段无法新建`);
    }
    return saveAsnCapture(
      {
        asnId: normalizeAsnId(asnId),
        warehouse: (patch.warehouse || "").trim(),
        scheduledDate: date,
        scheduleSlot: slot,
        region: patch.region ?? null,
        pageUrl: patch.pageUrl ?? null,
        capturedAt: nowIso(),
        source: patch.source || "manual",
        flags: patch.flags ?? ["manual_create"],
      },
      {
        ticketPrefix: patch.ticketPrefix,
        sessionId: patch.sessionId,
      },
    );
  }
  return saveAsnCapture(
    {
      ...prev,
      warehouse:
        patch.warehouse !== undefined
          ? patch.warehouse.trim()
          : prev.warehouse,
      scheduledDate:
        patch.scheduledDate !== undefined
          ? patch.scheduledDate.trim()
          : prev.scheduledDate,
      scheduleSlot:
        patch.scheduleSlot !== undefined
          ? patch.scheduleSlot.trim()
          : prev.scheduleSlot,
      region: patch.region !== undefined ? patch.region : prev.region,
      pageUrl: patch.pageUrl !== undefined ? patch.pageUrl : prev.pageUrl,
      source: patch.source || "manual",
      flags: patch.flags ?? [...(prev.flags || []), "user_edited"],
      capturedAt: prev.capturedAt,
    },
    {
      ticketPrefix: patch.ticketPrefix,
      sessionId: patch.sessionId,
    },
  );
}

export function toBookingCapture(stored: StoredAsnCapture): BookingCapture {
  return {
    asnId: stored.asnId,
    warehouse: stored.warehouse,
    scheduledDate: stored.scheduledDate,
    scheduleSlot: stored.scheduleSlot,
    region: stored.region,
    pageUrl: stored.pageUrl,
    capturedAt: stored.capturedAt,
    source: stored.source,
    flags: stored.flags || [],
  };
}
