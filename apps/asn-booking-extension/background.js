importScripts("api.js");

const LOG_STATE_KEY = "logFileState";
const LOG_ERROR_KEY = "logFileError";
const CAPTURE_RETRY_KEY = "pendingBookingCapture";

function pad(value) {
  return String(value).padStart(2, "0");
}

function createLogFileName(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.log`;
}

function createTimestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getLogState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(LOG_STATE_KEY, (result) => {
      resolve(result[LOG_STATE_KEY] || null);
    });
  });
}

function setLogState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [LOG_STATE_KEY]: state }, resolve);
  });
}

function setLogError(errorMessage) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [LOG_ERROR_KEY]: errorMessage || "" }, resolve);
  });
}

function ensureLogState(forceNew = false) {
  return new Promise((resolve) => {
    chrome.storage.local.get(LOG_STATE_KEY, (result) => {
      const existing = result[LOG_STATE_KEY];
      if (existing && !forceNew) {
        resolve(existing);
        return;
      }
      const nextState = {
        fileName: createLogFileName(),
        lines: [],
        dirty: false,
      };
      chrome.storage.local.set({ [LOG_STATE_KEY]: nextState }, () =>
        resolve(nextState),
      );
    });
  });
}

function toDataUrl(text) {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
}

async function downloadLogFile(state) {
  const content = state.lines.join("\n");
  const url = toDataUrl(content);
  await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: `logs/${state.fileName}`,
        conflictAction: "overwrite",
        saveAs: false,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      },
    );
  });
}

async function appendLogLine(text) {
  const state = await ensureLogState(false);
  const nextState = {
    ...state,
    lines: [...state.lines, `[${createTimestamp()}] ${text}`],
    dirty: true,
  };
  await setLogState(nextState);
  await setLogError("");
}


async function postCapture(payload) {
  return globalThis.OutpostBookingApi.postBookingCapture(payload);
}

async function handleBookingCaptured(payload) {
  try {
    const workMode = await globalThis.OutpostBookingApi.getWorkMode();
    if (workMode === "offline") {
      // 离线也按 ASN 记在本机，重开侧栏可展示；连上主机后再同步
      try {
        const localKey = "offlineAsnCaptures";
        const prev = await chrome.storage.local.get([localKey]);
        const map = prev[localKey] && typeof prev[localKey] === "object" ? prev[localKey] : {};
        const asn = String(payload.asnId || "").trim().toUpperCase();
        if (asn) {
          map[asn] = {
            ...payload,
            asnId: asn,
            capturedAt: new Date().toISOString(),
            source: "extension",
          };
          await chrome.storage.local.set({ [localKey]: map });
        }
      } catch (_) {
        /* ignore */
      }
      await appendLogLine(
        `离线模式：约仓成功，已本机按 ASN 记住 ${payload.asnId} ${payload.scheduledDate} ${payload.scheduleSlot}（未写主机/装箱表）`,
      );
      return { ok: true, skipped: true, reason: "offline" };
    }
    const data = await postCapture({
      ...payload,
      syncPackingSheet: false,
    });
    await chrome.storage.local.remove(CAPTURE_RETRY_KEY);
    if (data?.session) {
      await chrome.storage.local.set({
        bookingSessionId: data.session.id,
        bookingSessionSnapshot: data.session,
      });
    } else if (data?.capture) {
      await chrome.storage.local.set({
        lastAsnCapture: data.capture,
      });
    }
    chrome.runtime.sendMessage({
      action: "bookingCaptureApplied",
      session: data?.session || null,
      capture: data?.capture || null,
      savedWithoutSession: Boolean(data?.savedWithoutSession),
      notifyDraft: data?.notifyDraft || null,
      packingSync: data?.packingSync || null,
    }).catch(() => {});
    const syncNote = data?.packingSync?.error
      ? `；装箱表失败: ${data.packingSync.error}`
      : data?.packingSync
        ? `；装箱表已回填 ${data.packingSync.shopPrefix}`
        : "；已按 ASN 记住，待核对后回填装箱表";
    await appendLogLine(
      `约仓已记住 ASN=${payload.asnId} ${payload.scheduledDate} ${payload.scheduleSlot}${syncNote}`,
    );
    return { ok: true, data };
  } catch (error) {
    await chrome.storage.local.set({
      [CAPTURE_RETRY_KEY]: { payload, error: error.message, at: Date.now() },
    });
    await appendLogLine(`约仓回填失败: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setOptions) {
    chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
  }
  // 点击工具栏图标 → 真正的 Chrome 右侧栏（不是新标签页）
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

// service worker 冷启动也保证行为生效
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;
  chrome.storage.local.set({ sidePanelOpen: true });
  port.onDisconnect.addListener(() => {
    chrome.storage.local.set({ sidePanelOpen: false });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openSidePanel" || message.action === "openCompanionPage") {
    // 内容脚本无手势，不能代开侧栏；提示用户点工具栏图标
    sendResponse({
      ok: false,
      error: "请点击浏览器工具栏的扩展图标，在右侧打开约仓陪伴侧栏",
    });
    return false;
  }

  if (message.action === "bookingCaptured") {
    handleBookingCaptured(message.payload || {})
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.action === "retryPendingCapture") {
    chrome.storage.local.get(CAPTURE_RETRY_KEY, (result) => {
      const pending = result[CAPTURE_RETRY_KEY];
      if (!pending?.payload) {
        sendResponse({ ok: false, error: "无待重试回填" });
        return;
      }
      handleBookingCaptured(pending.payload).then(sendResponse);
    });
    return true;
  }

  if (message.action === "startLogSession") {
    ensureLogState(true)
      .then(async (state) => {
        await setLogError("");
        sendResponse({ ok: true, fileName: state.fileName });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === "log" || message.action === "persistLog") {
    appendLogLine(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        await setLogError(error.message);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.action === "downloadLogFile") {
    getLogState()
      .then(async (state) => {
        if (!state || !state.lines.length) {
          sendResponse({ ok: false, error: "当前没有可下载的日志" });
          return;
        }
        await downloadLogFile(state);
        await setLogError("");
        sendResponse({ ok: true, fileName: state.fileName });
      })
      .catch(async (error) => {
        await setLogError(error.message);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.action === "getLogStatus") {
    chrome.storage.local.get([LOG_STATE_KEY, LOG_ERROR_KEY], (result) => {
      const state = result[LOG_STATE_KEY] || null;
      sendResponse({
        ok: true,
        fileName: state ? state.fileName : "",
        error: result[LOG_ERROR_KEY] || "",
        dirty: state ? Boolean(state.dirty) : false,
      });
    });
    return true;
  }

  if (message.action === "success") {
    // 兼容旧钩子；真正回填走 bookingCaptured
    sendResponse({ ok: true });
    return false;
  }
});
