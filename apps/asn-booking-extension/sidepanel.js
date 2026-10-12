const api = globalThis.OutpostBookingApi;

const els = {
  hdrSub: document.getElementById("hdrSub"),
  offlineBanner: document.getElementById("offlineBanner"),
  modeOnlineBtn: document.getElementById("modeOnlineBtn"),
  modeOfflineBtn: document.getElementById("modeOfflineBtn"),
  monitorHint: document.getElementById("monitorHint"),
  apiBaseInput: document.getElementById("apiBaseInput"),
  saveApiBtn: document.getElementById("saveApiBtn"),
  apiBaseStatus: document.getElementById("apiBaseStatus"),
  ticketInput: document.getElementById("ticketInput"),
  alignBtn: document.getElementById("alignBtn"),
  status: document.getElementById("status"),
  autoHints: document.getElementById("autoHints"),
  pageShopBadge: document.getElementById("pageShopBadge"),
  sessionCard: document.getElementById("sessionCard"),
  stepBadge: document.getElementById("stepBadge"),
  sessionId: document.getElementById("sessionId"),
  shopTabs: document.getElementById("shopTabs"),
  shopDetail: document.getElementById("shopDetail"),
  asnCard: document.getElementById("asnCard"),
  asnInput: document.getElementById("asnInput"),
  saveAsnBtn: document.getElementById("saveAsnBtn"),
  packedCheck: document.getElementById("packedCheck"),
  asnCreateLink: document.getElementById("asnCreateLink"),
  refreshBtn: document.getElementById("refreshBtn"),
  captureCard: document.getElementById("captureCard"),
  captureAsnInput: document.getElementById("captureAsnInput"),
  captureWarehouseInput: document.getElementById("captureWarehouseInput"),
  captureDateInput: document.getElementById("captureDateInput"),
  captureSlotInput: document.getElementById("captureSlotInput"),
  captureMeta: document.getElementById("captureMeta"),
  saveCaptureBtn: document.getElementById("saveCaptureBtn"),
  recallAsnBtn: document.getElementById("recallAsnBtn"),
  notifyCard: document.getElementById("notifyCard"),
  notifyText: document.getElementById("notifyText"),
  pdfHint: document.getElementById("pdfHint"),
  copyBtn: document.getElementById("copyBtn"),
  syncPackingBtn: document.getElementById("syncPackingBtn"),
  packingSyncStatus: document.getElementById("packingSyncStatus"),
};

let lastPackingSync = null;

let session = null;
let activeShopPrefix = null;
let pageShop = null;

// 侧栏存活期间连一条 port；断开 = 侧栏关闭 → 恢复悬浮条
try {
  chrome.runtime.connect({ name: "sidepanel" });
} catch (_) {
  chrome.storage.local.set({ sidePanelOpen: true });
}

const STEP_LABEL = {
  ticket: "输入票号",
  align: "对齐清单",
  asn: "填写 ASN",
  schedule: "待约仓",
  notify: "可发群",
  done: "完成",
};

function setStatus(text, isErr = false) {
  els.status.textContent = text || "";
  els.status.classList.toggle("err", Boolean(isErr));
}

function setApiStatus(text, isErr = false) {
  if (!els.apiBaseStatus) return;
  els.apiBaseStatus.textContent = text || "";
  els.apiBaseStatus.classList.toggle("err", Boolean(isErr));
}

async function loadApiBaseIntoForm() {
  if (!els.apiBaseInput || !api?.getApiBase) return;
  els.apiBaseInput.value = await api.getApiBase();
}

els.saveApiBtn?.addEventListener("click", async () => {
  try {
    const apiBase = await api.setApiBase(els.apiBaseInput.value);
    els.apiBaseInput.value = apiBase;
    setApiStatus(`已保存：${apiBase} · 请先打开 ${apiBase}/api/ready 确认能通`);
  } catch (e) {
    setApiStatus(e.message || String(e), true);
  }
});

loadApiBaseIntoForm().catch(() => {});

const ONLINE_SUB = "贴在 Noon 右侧 · 票号对齐 → ASN → 约仓 → 发群文案";
const OFFLINE_SUB = "离线仅自动约仓 · 不连主机，查不到票号/ASN/文案";
const ONLINE_MONITOR_HINT = "请先打开该 ASN 的 schedule 预约页，再在本侧栏开始监控。";
const OFFLINE_MONITOR_HINT = "请先打开 Noon ASN 的 schedule 预约页，再开始监控（不依赖主机）。";

function applyWorkModeUi(mode) {
  const offline = mode === "offline";
  document.body.classList.toggle("mode-offline", offline);
  document.body.classList.toggle("mode-online", !offline);
  els.modeOnlineBtn?.classList.toggle("is-on", !offline);
  els.modeOfflineBtn?.classList.toggle("is-on", offline);
  if (els.hdrSub) els.hdrSub.textContent = offline ? OFFLINE_SUB : ONLINE_SUB;
  els.offlineBanner?.classList.toggle("hidden", !offline);
  if (els.monitorHint) {
    els.monitorHint.textContent = offline ? OFFLINE_MONITOR_HINT : ONLINE_MONITOR_HINT;
  }
}

async function switchWorkMode(mode) {
  const next = await api.setWorkMode(mode);
  applyWorkModeUi(next);
  if (next === "online") {
    await bootCompanion();
  } else {
    setStatus("");
    setApiStatus("");
  }
}

els.modeOnlineBtn?.addEventListener("click", () => {
  void switchWorkMode("online");
});
els.modeOfflineBtn?.addEventListener("click", () => {
  void switchWorkMode("offline");
});

function activeShop() {
  if (!session) return null;
  return (
    session.shops.find((s) => s.shopPrefix === activeShopPrefix) ||
    session.shops[0] ||
    null
  );
}

function applyBookingDefaultsToForm() {
  const d = session?.bookingDefaults;
  if (!d) return;
  const warehouseInput = document.getElementById("warehouseInput");
  const timeRangeStart = document.getElementById("timeRangeStart");
  const timeRangeEnd = document.getElementById("timeRangeEnd");
  const preferredStart = document.getElementById("preferredStart");
  if (warehouseInput && d.warehouse) warehouseInput.value = d.warehouse;
  if (Array.isArray(d.dates) && globalThis.BookingDatePicker?.setSelectedDates) {
    globalThis.BookingDatePicker.setSelectedDates(d.dates);
  }
  if (timeRangeStart && d.timeRangeStart) timeRangeStart.value = d.timeRangeStart;
  if (timeRangeEnd && d.timeRangeEnd) timeRangeEnd.value = d.timeRangeEnd;
  if (preferredStart && d.preferredStart != null) {
    preferredStart.value = d.preferredStart;
  }
  chrome.storage.local.set({
    targetConfig: {
      warehouse: d.warehouse,
      dates: d.dates,
      timeRangeStart: d.timeRangeStart,
      timeRangeEnd: d.timeRangeEnd,
      preferredStart: d.preferredStart || "",
    },
  });
}

function renderHints() {
  const hints = session?.bookingDefaults?.hints || [];
  if (!els.autoHints) return;
  if (!hints.length) {
    els.autoHints.classList.add("hidden");
    els.autoHints.innerHTML = "";
    return;
  }
  els.autoHints.classList.remove("hidden");
  els.autoHints.innerHTML = hints.map((h) => `<li>${escapeHtml(h)}</li>`).join("");
}

function render() {
  if (!session) {
    els.sessionCard.classList.add("hidden");
    els.asnCard.classList.add("hidden");
    els.captureCard.classList.add("hidden");
    els.notifyCard.classList.add("hidden");
    if (els.autoHints) els.autoHints.classList.add("hidden");
    return;
  }

  els.sessionCard.classList.remove("hidden");
  els.stepBadge.textContent = STEP_LABEL[session.step] || session.step;
  els.sessionId.textContent = session.id.slice(0, 8);
  renderHints();

  if (!activeShopPrefix) activeShopPrefix = session.activeShopPrefix;
  if (!session.shops.some((s) => s.shopPrefix === activeShopPrefix)) {
    activeShopPrefix = session.shops[0]?.shopPrefix || null;
  }

  els.shopTabs.innerHTML = "";
  for (const shop of session.shops) {
    const btn = document.createElement("button");
    btn.type = "button";
    const onPage =
      pageShop &&
      (pageShop.prefix === shop.shopPrefix ||
        pageShop.projectCode === shop.projectCode);
    btn.className =
      "tab" +
      (shop.shopPrefix === activeShopPrefix ? " active" : "") +
      (onPage ? " on-page" : "");
    const label = shop.shopLabel || shop.shopPrefix;
    const name = shop.shopName ? ` ${shop.shopName}` : "";
    btn.textContent = `${label}${name} · ${shop.boxes.length}箱`;
    btn.title = shop.projectCode || "";
    btn.addEventListener("click", async () => {
      activeShopPrefix = shop.shopPrefix;
      try {
        const data = await api.patchBookingSession(session.id, {
          activeShopPrefix,
        });
        session = data.session;
        broadcastSession();
        render();
      } catch (e) {
        setStatus(e.message, true);
      }
    });
    els.shopTabs.appendChild(btn);
  }

  const shop = activeShop();
  els.shopDetail.innerHTML = "";
  if (shop) {
    for (const box of shop.boxes) {
      const div = document.createElement("div");
      div.className = "box";
      div.innerHTML = `<h3>${box.logisticsNo} <span class="muted">(${box.suffix} · ${box.pcs}件)</span></h3>`;
      for (const it of box.items) {
        const row = document.createElement("div");
        row.className = "sku";
        row.innerHTML = `<code>${it.partnerSku}</code><span class="name">${escapeHtml(it.name)}</span><strong>×${it.qty}</strong>`;
        div.appendChild(row);
      }
      els.shopDetail.appendChild(div);
    }

    els.asnCard.classList.remove("hidden");
    els.asnInput.value = shop.asnId || "";
    els.packedCheck.checked = Boolean(shop.asnPackedConfirmed);
    if (shop.asnSource === "sheet" && shop.asnId) {
      els.asnInput.title = "已从装箱表 FBA号/ASN号 自动回填";
    }
    if (shop.asnCreateUrl) {
      els.asnCreateLink.href = shop.asnCreateUrl;
      els.asnCreateLink.textContent = shop.asnId
        ? "打开建 ASN 页（已有号可改约）"
        : "打开建 ASN 页";
      els.asnCreateLink.classList.remove("hidden");
    } else {
      els.asnCreateLink.removeAttribute("href");
      els.asnCreateLink.textContent = "未配置 projectCode";
    }
  }

  if (session.capture) {
    els.captureCard.classList.remove("hidden");
    fillCaptureForm(session.capture);
  } else {
    els.captureCard.classList.toggle("hidden", session.step !== "schedule");
    if (session.step === "schedule") {
      clearCaptureForm("等待约仓成功…首次约成会按 ASN 记住，关侧栏后可找回。");
    }
  }

  if (session.step === "notify" || session.capture) {
    refreshNotify();
  } else {
    els.notifyCard.classList.add("hidden");
  }
}

function fillCaptureForm(c) {
  if (!c) return;
  if (els.captureAsnInput) els.captureAsnInput.value = c.asnId || "";
  if (els.captureWarehouseInput) {
    els.captureWarehouseInput.value = c.warehouse || "";
  }
  if (els.captureDateInput) els.captureDateInput.value = c.scheduledDate || "";
  if (els.captureSlotInput) els.captureSlotInput.value = c.scheduleSlot || "";
  if (els.captureMeta) {
    const flags = (c.flags || []).length ? ` · ${c.flags.join(",")}` : "";
    els.captureMeta.textContent = c.capturedAt
      ? `首次记录：${c.capturedAt.slice(0, 19).replace("T", " ")}${flags}`
      : flags.slice(3) || "";
  }
}

function clearCaptureForm(metaText) {
  if (els.captureAsnInput) els.captureAsnInput.value = "";
  if (els.captureWarehouseInput) els.captureWarehouseInput.value = "";
  if (els.captureDateInput) els.captureDateInput.value = "";
  if (els.captureSlotInput) els.captureSlotInput.value = "";
  if (els.captureMeta) els.captureMeta.textContent = metaText || "";
}

function readCaptureForm() {
  return {
    asnId: (els.captureAsnInput?.value || "").trim(),
    warehouse: (els.captureWarehouseInput?.value || "").trim(),
    scheduledDate: (els.captureDateInput?.value || "").trim(),
    scheduleSlot: (els.captureSlotInput?.value || "").trim(),
  };
}

async function recallCaptureByAsn(asnId, { attachSession = true } = {}) {
  const asn = String(asnId || "").trim();
  if (!asn) throw new Error("请先填写 ASN 号");
  const data = await api.getAsnCapture(asn);
  if (data.session && attachSession) {
    session = data.session;
    activeShopPrefix = session.activeShopPrefix;
    if (!session.capture && data.capture) {
      const updated = await api.updateSessionCapture(session.id, {
        asnId: data.capture.asnId,
        warehouse: data.capture.warehouse,
        scheduledDate: data.capture.scheduledDate,
        scheduleSlot: data.capture.scheduleSlot,
      });
      session = updated.session;
    }
  } else if (session && data.capture) {
    const updated = await api.updateSessionCapture(session.id, {
      asnId: data.capture.asnId,
      warehouse: data.capture.warehouse,
      scheduledDate: data.capture.scheduledDate,
      scheduleSlot: data.capture.scheduleSlot,
    });
    session = updated.session;
  } else if (data.capture) {
    els.captureCard.classList.remove("hidden");
    fillCaptureForm(data.capture);
    setStatus(
      `已找回 ASN=${data.capture.asnId} ${data.capture.scheduledDate} ${data.capture.scheduleSlot}；请先对齐票号再建会话后回填装箱表`,
    );
    return data;
  }
  broadcastSession();
  render();
  setStatus(
    `已找回约仓：${data.capture.scheduledDate} ${data.capture.scheduleSlot}（可改后再回填装箱表）`,
  );
  return data;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatPackingSyncStatus(packingSync) {
  if (!packingSync) return "";
  if (packingSync.error) return `装箱表回填失败：${packingSync.error}`;
  const parts = (packingSync.sheets || []).map((s) => {
    if (s.skipped) {
      return s.skipReason
        ? `${s.title}跳过(${s.skipReason})`
        : `${s.title}跳过`;
    }
    return `${s.title}${s.matchedRows}行/${s.updatedCells}格`;
  });
  const totalCells = (packingSync.sheets || []).reduce(
    (n, s) => n + (s.skipped ? 0 : Number(s.updatedCells) || 0),
    0,
  );
  const snap = packingSync.refreshedSnapshot ? " · 已刷新快照" : "";
  const head =
    totalCells > 0
      ? `已回填 ${packingSync.shopPrefix} ASN=${packingSync.asnId} 送仓=${packingSync.arriveAtSheet}`
      : `未写入单元格 ${packingSync.shopPrefix} ASN=${packingSync.asnId}（匹配行可能店码冲突或已是目标值）`;
  return `${head}（${parts.join("；")}）${snap}`;
}

function setPackingSyncStatus(packingSync) {
  lastPackingSync = packingSync || null;
  if (!els.packingSyncStatus) return;
  els.packingSyncStatus.textContent = formatPackingSyncStatus(packingSync);
}

async function refreshNotify() {
  if (!session) return;
  try {
    const data = await api.getNotifyDraft(session.id);
    els.notifyCard.classList.remove("hidden");
    els.notifyText.textContent = data.draft?.text || "";
    els.pdfHint.textContent = data.draft?.pdfHint
      ? `请同时发送 PDF：${data.draft.pdfHint}`
      : "";
    if (lastPackingSync) setPackingSyncStatus(lastPackingSync);
  } catch (e) {
    setStatus(e.message, true);
  }
}

function broadcastSession() {
  chrome.storage.local.set({
    bookingSessionId: session?.id || null,
    bookingSessionSnapshot: session || null,
  });
  chrome.runtime.sendMessage({
    action: "bookingSessionUpdated",
    session,
  }).catch(() => {});
}

els.alignBtn.addEventListener("click", async () => {
  const ticket = els.ticketInput.value.trim();
  if (!ticket) {
    setStatus("请输入票号", true);
    return;
  }
  setStatus("对齐装箱明细中…");
  try {
    const data = await api.createBookingSession(ticket);
    session = data.session;
    activeShopPrefix = session.activeShopPrefix;
    const boxes = session.shops.reduce((n, s) => n + s.boxes.length, 0);
    const withAsn = session.shops.filter((s) => s.asnId).length;
    setStatus(
      `已自动对齐：${session.shops.length} 店 · ${boxes} 箱` +
        (withAsn ? ` · ${withAsn} 店已带 ASN` : " · 请建 ASN 后约仓"),
    );
    applyBookingDefaultsToForm();
    await syncActiveShopToPage();
    broadcastSession();
    render();
  } catch (e) {
    setStatus(e.message, true);
  }
});

els.saveAsnBtn.addEventListener("click", async () => {
  const shop = activeShop();
  if (!session || !shop) return;
  try {
    const asnId = els.asnInput.value.trim();
    const data = await api.patchBookingSession(session.id, {
      shopAsn: { shopPrefix: shop.shopPrefix, asnId },
      activeShopPrefix: shop.shopPrefix,
    });
    session = data.session;
    if (session.capture) {
      setStatus(
        `ASN 已保存，并找回约仓 ${session.capture.scheduledDate} ${session.capture.scheduleSlot}（可改后再回填）`,
      );
    } else {
      setStatus("ASN 已保存，可去 schedule 约仓；若曾约过可点「找回约仓」");
    }
    broadcastSession();
    render();
  } catch (e) {
    setStatus(e.message, true);
  }
});

els.recallAsnBtn?.addEventListener("click", async () => {
  const asn =
    els.asnInput?.value?.trim() ||
    activeShop()?.asnId ||
    els.captureAsnInput?.value?.trim() ||
    "";
  try {
    await recallCaptureByAsn(asn);
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
});

els.saveCaptureBtn?.addEventListener("click", async () => {
  const form = readCaptureForm();
  if (!form.scheduledDate || !form.scheduleSlot) {
    setStatus("请填写送仓日期与时段", true);
    return;
  }
  try {
    if (session) {
      const data = await api.updateSessionCapture(session.id, form);
      session = data.session;
      if (data.notifyDraft?.text) {
        els.notifyCard.classList.remove("hidden");
        els.notifyText.textContent = data.notifyDraft.text;
        els.pdfHint.textContent = data.notifyDraft.pdfHint
          ? `请同时发送 PDF：${data.notifyDraft.pdfHint}`
          : "";
      }
      setStatus("约仓结果已保存（已按 ASN 更新记忆），可回填装箱表");
      broadcastSession();
      render();
      return;
    }
    if (!form.asnId) {
      setStatus("无会话时请先填 ASN", true);
      return;
    }
    const data = await api.putAsnCapture(form.asnId, {
      ...form,
      attachToSession: true,
    });
    if (data.session) {
      session = data.session;
      activeShopPrefix = session.activeShopPrefix;
      broadcastSession();
      render();
      setStatus("约仓结果已保存并挂到会话，可回填装箱表");
    } else {
      fillCaptureForm(data.capture);
      setStatus("约仓结果已按 ASN 记住；请对齐票号后再回填装箱表");
    }
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
});

els.packedCheck.addEventListener("change", async () => {
  const shop = activeShop();
  if (!session || !shop) return;
  try {
    const data = await api.patchBookingSession(session.id, {
      shopPacked: {
        shopPrefix: shop.shopPrefix,
        confirmed: els.packedCheck.checked,
      },
    });
    session = data.session;
    broadcastSession();
    render();
  } catch (e) {
    setStatus(e.message, true);
    els.packedCheck.checked = !els.packedCheck.checked;
  }
});

els.refreshBtn.addEventListener("click", async () => {
  try {
    const data = await api.getActiveBookingSession();
    session = data.session;
    if (session) {
      activeShopPrefix = session.activeShopPrefix;
      setStatus("已刷新");
      broadcastSession();
    } else {
      setStatus("无进行中会话");
    }
    render();
  } catch (e) {
    setStatus(e.message, true);
  }
});

els.copyBtn.addEventListener("click", async () => {
  const text = els.notifyText.textContent || "";
  try {
    await navigator.clipboard.writeText(text);
    setStatus("已复制到剪贴板");
  } catch {
    setStatus("复制失败，请手动选择文案", true);
  }
});

els.syncPackingBtn?.addEventListener("click", async () => {
  if (!session) {
    setStatus("请先对齐票号建立会话，再回填装箱表", true);
    return;
  }
  // 回填前先把表单里的核对结果写入会话 + ASN 记忆
  const form = readCaptureForm();
  if (form.scheduledDate && form.scheduleSlot) {
    try {
      const saved = await api.updateSessionCapture(session.id, form);
      session = saved.session;
    } catch (e) {
      setStatus(`保存约仓结果失败：${e.message}`, true);
      return;
    }
  }
  if (!session.capture?.scheduledDate) {
    setStatus("尚无约仓结果，请先约仓或按 ASN 找回", true);
    return;
  }
  if (els.syncPackingBtn) els.syncPackingBtn.disabled = true;
  setPackingSyncStatus(null);
  if (els.packingSyncStatus) els.packingSyncStatus.textContent = "正在回填装箱表…";
  try {
    const data = await api.syncPackingSheet(session.id, {
      shopPrefix: activeShopPrefix || undefined,
    });
    session = data.session || session;
    setPackingSyncStatus(data.packingSync);
    setStatus(formatPackingSyncStatus(data.packingSync) || "装箱表已回填");
    broadcastSession();
    render();
  } catch (e) {
    setPackingSyncStatus({ error: e.message || String(e) });
    setStatus(e.message || String(e), true);
  } finally {
    if (els.syncPackingBtn) els.syncPackingBtn.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "bookingCaptureApplied") {
    if (message.session) {
      session = message.session;
      activeShopPrefix = session.activeShopPrefix;
    }
    if (message.capture) {
      els.captureCard?.classList.remove("hidden");
      fillCaptureForm(message.capture);
    }
    if (message.packingSync) setPackingSyncStatus(message.packingSync);
    const asnNote = message.capture
      ? `ASN=${message.capture.asnId} ${message.capture.scheduledDate} ${message.capture.scheduleSlot}`
      : "";
    setStatus(
      message.savedWithoutSession
        ? `已按 ASN 记住约仓（${asnNote}）；请对齐票号后核对并回填装箱表`
        : message.packingSync?.error
          ? `约仓已记住；装箱表失败：${message.packingSync.error}`
          : message.packingSync
            ? "约仓已记住，装箱表已同步"
            : `约仓已按 ASN 记住（${asnNote}）。请核对后点「回填装箱表」`,
      Boolean(message.packingSync?.error),
    );
    render();
  }
  if (message.action === "bookingSessionUpdated" && message.session) {
    session = message.session;
    render();
  }
});

function renderPageShopBadge() {
  if (!els.pageShopBadge) return;
  if (!pageShop) {
    els.pageShopBadge.textContent = "未识别当前页店铺（请打开带 project= 的 Noon 页）";
    els.pageShopBadge.classList.add("warn");
    return;
  }
  els.pageShopBadge.classList.remove("warn");
  const src = pageShop.source === "url" ? "URL" : "页头";
  els.pageShopBadge.textContent = `当前页：${pageShop.label} ${pageShop.name}（${pageShop.projectCode} · ${src}）`;
}

async function syncActiveShopToPage() {
  if ((await api.getWorkMode()) === "offline") return;
  if (!session || !pageShop) return;
  const match = session.shops.find(
    (s) =>
      s.shopPrefix === pageShop.prefix ||
      s.projectCode === pageShop.projectCode,
  );
  if (!match) {
    setStatus(
      `当前页是 ${pageShop.name}，但本票货不含该店（请核对是否开错店）`,
      true,
    );
    return;
  }
  if (activeShopPrefix === match.shopPrefix) return;
  activeShopPrefix = match.shopPrefix;
  try {
    const data = await api.patchBookingSession(session.id, {
      activeShopPrefix,
    });
    session = data.session;
    setStatus(`已按当前页切换到 ${match.shopLabel || match.shopPrefix} ${match.shopName || ""}`);
    broadcastSession();
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function refreshPageShopFromActiveTab() {
  const presets =
    typeof NoonSiteConfig !== "undefined" && NoonSiteConfig.shopPresets
      ? NoonSiteConfig.shopPresets
      : null;

  const fromStorage = await new Promise((resolve) => {
    chrome.storage.local.get(["pageShop"], (r) => resolve(r.pageShop || null));
  });

  const tab = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });

  let detected = null;
  if (
    tab?.url &&
    typeof NoonSiteConfig !== "undefined" &&
    NoonSiteConfig.detectPageShop
  ) {
    detected = NoonSiteConfig.detectPageShop(tab.url, null);
  }
  if (!detected && tab?.url && presets) {
    const m = tab.url.match(/[?&#]project=(PRJ\d+)/i);
    if (m) {
      detected =
        NoonSiteConfig.findShopPreset({ projectCode: m[1] }) ||
        presets.find(
          (s) => s.projectCode.toUpperCase() === m[1].toUpperCase(),
        );
      if (detected) detected = { ...detected, source: "url" };
    }
  }

  pageShop = detected || fromStorage;
  if (pageShop) chrome.storage.local.set({ pageShop });
  renderPageShopBadge();
  await syncActiveShopToPage();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.pageShop) return;
  pageShop = changes.pageShop.newValue || null;
  renderPageShopBadge();
  syncActiveShopToPage().then(() => render());
});

async function bootCompanion() {
  try {
    await refreshPageShopFromActiveTab();
    const mode = await api.getWorkMode();
    applyWorkModeUi(mode);
    if (mode === "offline") {
      renderPageShopBadge();
      return;
    }
    const data = await api.getActiveBookingSession();
    session = data.session;
    if (session) {
      els.ticketInput.value = session.ticketPrefix;
      activeShopPrefix = session.activeShopPrefix;
      setStatus("已恢复进行中会话");
      applyBookingDefaultsToForm();
      await syncActiveShopToPage();
      broadcastSession();
      render();
    } else {
      renderPageShopBadge();
    }
  } catch (e) {
    setStatus(`API 未就绪：${e.message} 可点右上角「离线」仅用自动约仓。`, true);
  }
}

(async function boot() {
  await bootCompanion();
})();
