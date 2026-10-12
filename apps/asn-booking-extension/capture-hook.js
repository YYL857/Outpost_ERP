/**
 * 约仓成功回填钩子
 * - 必须等结果页（Scheduled / Drop-off，即离开 /schedule）再提取
 * - 优先用页面 Drop-off，其次用 success 消息里点中的时段，禁止用配置日期瞎填
 * - 已约成页若 Drop-off 与会话不一致（改约/抓取过早），自动纠偏再回填
 */
(function () {
  if (globalThis.__OUTPOST_CAPTURE_HOOK__) return;
  globalThis.__OUTPOST_CAPTURE_HOOK__ = true;

  const origSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  let captureInFlight = false;
  /** 避免同 ASN+日期+时段重复打 /capture */
  let lastEmittedKey = "";

  const MONTHS = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  function extractAsnIdFromUrl(urlString) {
    try {
      const path = new URL(urlString || location.href).pathname;
      const m = path.match(/\/asn\/([^/]+)\/(?:schedule|detail|overview)?/i);
      if (m && m[1] && !/^schedule$/i.test(m[1])) return m[1];
      const m2 = path.match(/\/asn\/([A-Z0-9]+)/i);
      return m2 ? m2[1] : "";
    } catch (e) {
      return "";
    }
  }

  function isOnSchedulePath() {
    const path = location.pathname || "";
    return (
      /\/asn\/[^/]+\/schedule(?:\/|$)/i.test(path) ||
      /\/asn\/schedule(?:\/|$)/i.test(path)
    );
  }

  /** 必须看到 Scheduled + Drop-off/Reschedule，禁止仅凭 ASN URL 误判（否则 Drop-off 未渲染就用已点时段回填） */
  function isBookingResultPage() {
    const text = (document.body && document.body.innerText) || "";
    const hasScheduledUi =
      /\bScheduled\b/i.test(text) &&
      (/Drop-?\s*off/i.test(text) ||
        /\bReschedule\b/i.test(text) ||
        /View\s*location/i.test(text));
    if (!hasScheduledUi) return false;
    if (isOnSchedulePath()) {
      return !/Book\s*a\s*slot/i.test(text);
    }
    return true;
  }

  function parseMonthDayYear(raw) {
    const s = String(raw || "").trim();
    const named = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (named) {
      const mon = MONTHS[named[1].toLowerCase()];
      if (mon) {
        return `${named[3]}-${String(mon).padStart(2, "0")}-${String(named[2]).padStart(2, "0")}`;
      }
    }
    const iso = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (iso) {
      return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    }
    return "";
  }

  function normalizeSlot(slot) {
    return String(slot || "")
      .trim()
      .replace(/\s*[-–—]\s*/g, "-")
      .replace(/\s+/g, "");
  }

  /** "Oct 3, 2026 14:00 – 16:00"；Drop-off 常与日期分行 */
  function scrapeScheduleFromPage() {
    const text = (document.body && document.body.innerText) || "";
    const flags = [];
    let scheduledDate = "";
    let scheduleSlot = "";
    let warehouse = "";

    const dropOff =
      text.match(
        /Drop-?\s*off[\s\S]{0,120}?([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/i,
      ) ||
      text.match(
        /Drop-?\s*off[\s\S]{0,120}?(\d{4}[./-]\d{1,2}[./-]\d{1,2})\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/i,
      );
    if (dropOff) {
      scheduledDate = parseMonthDayYear(dropOff[1]);
      scheduleSlot = `${dropOff[2]}-${dropOff[3]}`;
    }

    if (!scheduledDate || !scheduleSlot) {
      const loose = text.match(
        /([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/,
      );
      if (loose) {
        if (!scheduledDate) scheduledDate = parseMonthDayYear(loose[1]);
        if (!scheduleSlot) scheduleSlot = `${loose[2]}-${loose[3]}`;
        flags.push("dropoff_label_missed");
      }
    }

    if (!scheduledDate) {
      const dateMatch =
        text.match(/Scheduled\s*at[:\s]*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i) ||
        text.match(/(\d{4}[./-]\d{1,2}[./-]\d{1,2})/);
      if (dateMatch) scheduledDate = parseMonthDayYear(dateMatch[1]);
    }

    if (!scheduleSlot) {
      const slotMatch =
        text.match(/Schedule\s*slot[:\s]*([0-9:apmAPM\s.-]+)/i) ||
        text.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/) ||
        text.match(/(\d{1,2})\s*(am|pm)\s*[-–—]\s*(\d{1,2})\s*(am|pm)/i);
      if (slotMatch) {
        if (slotMatch[2] && /am|pm/i.test(slotMatch[2])) {
          scheduleSlot = `${slotMatch[1]}${slotMatch[2].toLowerCase()}-${slotMatch[3]}${slotMatch[4].toLowerCase()}`;
        } else if (slotMatch[2] && /^\d/.test(slotMatch[2])) {
          scheduleSlot = `${slotMatch[1]}-${slotMatch[2]}`;
        } else {
          scheduleSlot = slotMatch[1].replace(/\s*[-–—]\s*/, "-").trim();
        }
      }
    }

    const wh = text.match(/\b([A-Z]{3}\d{2}S)\b/);
    if (wh) warehouse = wh[1];

    if (!scheduledDate) flags.push("page_date_missing");
    if (!scheduleSlot) flags.push("page_slot_missing");
    return { scheduledDate, scheduleSlot, warehouse, flags };
  }

  function getStorage(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => resolve(result || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitForResultPage(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isBookingResultPage()) return true;
      await sleep(300);
    }
    return isBookingResultPage();
  }

  /** 等到页面 Drop-off 可解析，避免 SPA 先改 URL、后渲染文案时用已点时段 */
  async function waitForPageSchedule(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isBookingResultPage()) {
        const page = scrapeScheduleFromPage();
        if (page.scheduledDate && page.scheduleSlot) return page;
      }
      await sleep(300);
    }
    return isBookingResultPage() ? scrapeScheduleFromPage() : null;
  }

  function payloadKey(payload) {
    return [
      payload.asnId || "",
      payload.scheduledDate || "",
      normalizeSlot(payload.scheduleSlot),
    ].join("|");
  }

  async function emitBookingCapture(bookedHint, opts) {
    if (captureInFlight) return;
    captureInFlight = true;
    const allowHintFallback = opts?.allowHintFallback !== false;
    try {
      if (!isBookingResultPage()) {
        const arrived = await waitForResultPage(15000);
        if (!arrived) {
          console.warn("[Outpost capture] 仍未进入 Scheduled 结果页，使用已点时段兜底");
        }
      }

      const pageReady = await waitForPageSchedule(12000);
      const store = await getStorage([
        "bookingSessionId",
        "targetConfig",
        "pendingBookingCapture",
        "bookingSessionSnapshot",
      ]);
      const page =
        pageReady && pageReady.scheduledDate && pageReady.scheduleSlot
          ? pageReady
          : isBookingResultPage()
            ? scrapeScheduleFromPage()
            : {
                scheduledDate: "",
                scheduleSlot: "",
                warehouse: "",
                flags: ["not_on_result_page"],
              };
      const cfg = store.targetConfig || {};
      const pending = store.pendingBookingCapture || {};
      const hint = bookedHint || {};
      const flags = [...(page.flags || [])];

      // 页面有 Drop-off 时绝不被 hint/pending 覆盖（改约后以页为准）
      let scheduledDate = page.scheduledDate || "";
      let scheduleSlot = page.scheduleSlot || "";
      if (!scheduledDate || !scheduleSlot) {
        if (allowHintFallback) {
          scheduledDate =
            scheduledDate ||
            hint.date ||
            pending.scheduledDate ||
            "";
          scheduleSlot =
            scheduleSlot ||
            (hint.start && hint.end ? `${hint.start}-${hint.end}` : "") ||
            pending.scheduleSlot ||
            "";
          if (scheduledDate && scheduleSlot) {
            flags.push("used_clicked_slot_fallback");
          }
        }
      }

      if (!scheduledDate) flags.push("date_missing");
      if (!scheduleSlot) flags.push("slot_missing");

      const asnId =
        extractAsnIdFromUrl(location.href) ||
        hint.asnId ||
        pending.asnId ||
        "UNKNOWN";
      const region =
        typeof NoonSiteConfig !== "undefined" && NoonSiteConfig.detectRegion
          ? NoonSiteConfig.detectRegion(location.href)
          : null;

      const payload = {
        sessionId: store.bookingSessionId || null,
        asnId,
        warehouse:
          page.warehouse || hint.warehouse || pending.warehouse || cfg.warehouse || "",
        scheduledDate: scheduledDate || "",
        scheduleSlot: scheduleSlot || "",
        region,
        pageUrl: location.href,
        source: "extension",
        flags,
      };

      if (!payload.scheduledDate || !payload.scheduleSlot) {
        console.warn("[Outpost capture] 缺少日期/时段，暂缓回填", payload);
        return;
      }

      const key = payloadKey(payload);
      if (key === lastEmittedKey) return;

      const snapCap = store.bookingSessionSnapshot?.capture;
      if (
        snapCap &&
        snapCap.asnId === payload.asnId &&
        snapCap.scheduledDate === payload.scheduledDate &&
        normalizeSlot(snapCap.scheduleSlot) === normalizeSlot(payload.scheduleSlot)
      ) {
        lastEmittedKey = key;
        try {
          chrome.storage.local.remove(["pendingBookingCapture"]);
        } catch (e) {
          /* ignore */
        }
        return;
      }

      lastEmittedKey = key;

      try {
        origSend({ action: "bookingCaptured", payload }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) {
        /* ignore */
      }

      try {
        chrome.storage.local.remove(["pendingBookingCapture"]);
      } catch (e) {
        /* ignore */
      }
    } finally {
      captureInFlight = false;
    }
  }

  chrome.runtime.sendMessage = function patchedSendMessage(message, ...rest) {
    try {
      if (message && message.action === "success") {
        const booked = message.booked || null;
        setTimeout(() => {
          void emitBookingCapture(booked);
        }, 400);
      }
    } catch (e) {
      /* ignore */
    }
    return origSend(message, ...rest);
  };

  function tryPendingOnLoad() {
    chrome.storage.local.get(["pendingBookingCapture", "bookingSuccessAt"], (result) => {
      const pending = result.pendingBookingCapture;
      const at = Number(result.bookingSuccessAt || 0);
      if (!pending || !at || Date.now() - at > 120000) return;
      if (!isBookingResultPage()) return;
      void emitBookingCapture({
        date: pending.scheduledDate,
        start: String(pending.scheduleSlot || "").split("-")[0],
        end: String(pending.scheduleSlot || "").split("-")[1],
        warehouse: pending.warehouse,
        asnId: pending.asnId,
      });
    });
  }

  /** 打开已 Scheduled 的 ASN 详情：若页上 Drop-off ≠ 会话约仓结果，纠偏回填 */
  function reconcileFromResultPage() {
    if (!isBookingResultPage()) return;
    const page = scrapeScheduleFromPage();
    if (!page.scheduledDate || !page.scheduleSlot) return;
    chrome.storage.local.get(
      ["bookingSessionId", "bookingSessionSnapshot"],
      (store) => {
        if (!store.bookingSessionId && !store.bookingSessionSnapshot) return;
        const asnId = extractAsnIdFromUrl(location.href);
        const cap = store.bookingSessionSnapshot?.capture;
        if (cap?.asnId && asnId && cap.asnId !== asnId) return;
        if (
          cap &&
          cap.scheduledDate === page.scheduledDate &&
          normalizeSlot(cap.scheduleSlot) === normalizeSlot(page.scheduleSlot)
        ) {
          lastEmittedKey = payloadKey({
            asnId: asnId || cap.asnId,
            scheduledDate: page.scheduledDate,
            scheduleSlot: page.scheduleSlot,
          });
          return;
        }
        void emitBookingCapture(
          {
            asnId,
            warehouse: page.warehouse,
            date: page.scheduledDate,
            start: page.scheduleSlot.split("-")[0],
            end: page.scheduleSlot.split("-")[1],
          },
          { allowHintFallback: false },
        );
      },
    );
  }

  function onPageReady() {
    tryPendingOnLoad();
    setTimeout(reconcileFromResultPage, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onPageReady);
  } else {
    setTimeout(onPageReady, 500);
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (isBookingResultPage()) {
        tryPendingOnLoad();
        setTimeout(reconcileFromResultPage, 600);
      }
      return;
    }
    // SPA 同 URL 后渲染 Drop-off / 改约后文案变化
    if (isBookingResultPage()) reconcileFromResultPage();
  }, 1500);
})();
