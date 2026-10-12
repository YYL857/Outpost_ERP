/** 与 Outpost API 通信（侧栏 / background 共用）；默认写死办公室后端局域网 IP */
const DEFAULT_API_BASE = "http://192.168.1.112:8787";

function normalizeApiBase(raw) {
  let s = String(raw || "").trim().replace(/\/$/, "");
  if (!s) s = DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s.replace(/\/$/, "");
}

const WORK_MODE_KEY = "bookingWorkMode";

async function getWorkMode() {
  const stored = await chrome.storage.local.get([WORK_MODE_KEY]);
  return stored[WORK_MODE_KEY] === "offline" ? "offline" : "online";
}

async function setWorkMode(mode) {
  const next = mode === "offline" ? "offline" : "online";
  await chrome.storage.local.set({ [WORK_MODE_KEY]: next });
  return next;
}

async function getApiBase() {
  const stored = await chrome.storage.local.get(["apiBase"]);
  const raw = String(stored.apiBase || "").trim();
  // 旧默认本机地址视为未配置，改用写死的办公室局域网 IP
  if (!raw || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(raw)) {
    return DEFAULT_API_BASE;
  }
  return normalizeApiBase(raw);
}

async function setApiBase(raw) {
  const apiBase = normalizeApiBase(raw);
  await chrome.storage.local.set({ apiBase });
  return apiBase;
}

async function getBookingApiRoot() {
  return `${await getApiBase()}/api/warehouse-booking`;
}

function fetchFailHint(apiBase) {
  return [
    `连不上 Outpost API（${apiBase}）。`,
    "请确认跑后端的电脑已开机、服务在跑，且防火墙放行 8787。",
    "浏览器先打开该地址 /api/ready 试通；若办公室 IP 已变，在侧栏改地址并保存。",
  ].join(" ");
}

async function apiJson(path, options = {}) {
  const apiBase = await getApiBase();
  const root = `${apiBase}/api/warehouse-booking`;
  let res;
  try {
    res = await fetch(`${root}${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
  } catch {
    throw new Error(fetchFailHint(apiBase));
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || (json && json.ok === false)) {
    throw new Error((json && json.error) || res.statusText || `HTTP ${res.status}`);
  }
  return json?.data ?? json;
}

async function createBookingSession(ticketPrefix) {
  return apiJson("/sessions", {
    method: "POST",
    body: JSON.stringify({ ticketPrefix }),
  });
}

async function getActiveBookingSession() {
  return apiJson("/sessions/active");
}

async function getBookingSession(id) {
  return apiJson(`/sessions/${encodeURIComponent(id)}`);
}

async function patchBookingSession(id, body) {
  return apiJson(`/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function postBookingCapture(payload) {
  return apiJson("/capture", {
    method: "POST",
    body: JSON.stringify({
      syncPackingSheet: false,
      ...payload,
    }),
  });
}

async function getAsnCapture(asnId) {
  return apiJson(`/captures/${encodeURIComponent(asnId)}`);
}

async function putAsnCapture(asnId, body) {
  return apiJson(`/captures/${encodeURIComponent(asnId)}`, {
    method: "PUT",
    body: JSON.stringify(body || {}),
  });
}

async function updateSessionCapture(id, body) {
  return apiJson(`/sessions/${encodeURIComponent(id)}/capture`, {
    method: "PUT",
    body: JSON.stringify(body || {}),
  });
}

async function getNotifyDraft(id) {
  return apiJson(`/sessions/${encodeURIComponent(id)}/notify-draft`);
}

async function syncPackingSheet(id, body = {}) {
  return apiJson(`/sessions/${encodeURIComponent(id)}/sync-packing-sheet`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

async function getShopPresets() {
  return apiJson("/shop-presets");
}

async function resolveShop(query) {
  const qs = new URLSearchParams();
  if (query?.projectCode) qs.set("projectCode", query.projectCode);
  if (query?.prefix) qs.set("prefix", query.prefix);
  return apiJson(`/resolve-shop?${qs.toString()}`);
}

if (typeof globalThis !== "undefined") {
  globalThis.OutpostBookingApi = {
    DEFAULT_API_BASE,
    WORK_MODE_KEY,
    normalizeApiBase,
    getWorkMode,
    setWorkMode,
    getApiBase,
    setApiBase,
    getBookingApiRoot,
    apiJson,
    createBookingSession,
    getActiveBookingSession,
    getBookingSession,
    patchBookingSession,
    postBookingCapture,
    getAsnCapture,
    putAsnCapture,
    updateSessionCapture,
    getNotifyDraft,
    syncPackingSheet,
    getShopPresets,
    resolveShop,
  };
}
