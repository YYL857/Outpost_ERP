import type { BookingCapture, BookingShopBucket, WarehouseBookingSession } from "./types.js";

/** 图二风格：物流编号 + ASN + 送仓时间 */
export function formatNotifyDraft(session: WarehouseBookingSession): {
  text: string;
  logisticsNos: string[];
  asnId: string | null;
  scheduledDisplay: string | null;
  pdfHint: string | null;
} {
  const shop = resolveActiveShop(session);
  const capture = session.capture;
  // 约仓结果可改：文案以 capture 为准，避免侧栏改了 ASN 发群仍用旧店号
  const asnId = capture?.asnId || shop?.asnId || null;
  const logisticsNos = shop
    ? shop.boxes.map((b) => b.logisticsNo)
    : session.shops.flatMap((s) => s.boxes.map((b) => b.logisticsNo));

  const scheduledDisplay = formatScheduledDisplay(capture);
  const lines: string[] = [];
  for (const ln of logisticsNos) {
    lines.push(ln);
  }
  if (asnId) {
    lines.push(`的ASN号: ${asnId}`);
  }
  if (scheduledDisplay) {
    lines.push(`送仓时间: ${scheduledDisplay}`);
  }

  return {
    text: lines.join("\n"),
    logisticsNos,
    asnId,
    scheduledDisplay,
    pdfHint: asnId ? `${asnId}.pdf` : null,
  };
}

function resolveActiveShop(
  session: WarehouseBookingSession,
): BookingShopBucket | null {
  if (session.activeShopPrefix) {
    return (
      session.shops.find((s) => s.shopPrefix === session.activeShopPrefix) ??
      null
    );
  }
  return session.shops[0] ?? null;
}

export function formatScheduledDisplay(
  capture: BookingCapture | null,
): string | null {
  if (!capture?.scheduledDate) return null;
  const date = capture.scheduledDate.replace(/-/g, ".");
  const slot = capture.scheduleSlot || "";
  const start = slotStartToHHmm(slot);
  if (start) return `${date} ${start}`;
  return slot ? `${date} ${slot}` : date;
}

/** "14:00 - 16:00" | "2pm-4pm" | "14:00-16:00" → "14:00" */
export function slotStartToHHmm(slot: string): string | null {
  const t = slot.trim();
  if (!t) return null;
  const range = t.match(
    /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/,
  );
  if (range) {
    return `${range[1]!.padStart(2, "0")}:${range[2]}`;
  }
  const ampm = t.match(/(\d{1,2})\s*(am|pm)/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const ap = ampm[2]!.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

/** 把插件里的 2pm-4pm 规范成 14:00-16:00 */
export function normalizeScheduleSlot(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(t)) {
    return t.replace(/\s*[-–—]\s*/, "-").replace(
      /(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/,
      (_, a, b, c, d) =>
        `${String(a).padStart(2, "0")}:${b}-${String(c).padStart(2, "0")}:${d}`,
    );
  }
  const parts = t.split(/\s*[-–—]\s*/);
  if (parts.length === 2) {
    const a = ampmToHHmm(parts[0]!);
    const b = ampmToHHmm(parts[1]!);
    if (a && b) return `${a}-${b}`;
  }
  const one = ampmToHHmm(t);
  return one || t;
}

function ampmToHHmm(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\s*(am|pm)$/i);
  if (!m) {
    const hm = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (hm) return `${hm[1]!.padStart(2, "0")}:${hm[2]}`;
    return null;
  }
  let h = Number(m[1]);
  const ap = m[2]!.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:00`;
}
