const msg = document.getElementById("msg");
const apiBaseInput = document.getElementById("apiBase");
const saveApiBtn = document.getElementById("saveApi");
const pingBtn = document.getElementById("ping");

const DEFAULT_API = "http://192.168.1.112:8787";

function normalizeApiBase(raw) {
  let s = String(raw || "").trim().replace(/\/$/, "");
  if (!s) s = DEFAULT_API;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s.replace(/\/$/, "");
}

async function getApiBase() {
  const stored = await chrome.storage.local.get(["apiBase"]);
  const raw = String(stored.apiBase || "").trim();
  if (!raw || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(raw)) {
    return DEFAULT_API;
  }
  return normalizeApiBase(raw);
}

async function marketApiRoot() {
  return `${await getApiBase()}/api/market-intel`;
}

async function activeNoonTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("no active tab");
  if (!tab.url?.includes("noon.com/saudi-en")) {
    throw new Error("请在 Noon 沙特页（saudi-en）打开后再操作");
  }
  return tab;
}

(async () => {
  apiBaseInput.value = await getApiBase();
})();

saveApiBtn.addEventListener("click", async () => {
  const apiBase = normalizeApiBase(apiBaseInput.value);
  await chrome.storage.local.set({ apiBase });
  apiBaseInput.value = apiBase;
  msg.textContent = `已保存：${apiBase}`;
});

pingBtn.addEventListener("click", async () => {
  msg.textContent = "测试中…";
  try {
    const apiBase = normalizeApiBase(apiBaseInput.value);
    await chrome.storage.local.set({ apiBase });
    apiBaseInput.value = apiBase;
    const res = await fetch(`${apiBase}/api/ready`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    msg.textContent = `API 可达：${apiBase}/api/ready`;
  } catch {
    msg.textContent = [
      "连不上 API。确认后端开机、防火墙放行 8787。",
      `浏览器先打开 ${normalizeApiBase(apiBaseInput.value)}/api/ready`,
    ].join("\n");
  }
});

document.getElementById("capture").addEventListener("click", async () => {
  msg.textContent = "采集中…";
  try {
    const tab = await activeNoonTab();
    const page = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE" });
    if (page?.error) throw new Error(page.error);
    if (!page?.products?.length) {
      throw new Error("页面未解析到商品（可能无 __NEXT_DATA__ 或结构变化）");
    }
    const root = await marketApiRoot();
    const res = await fetch(`${root}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "extension",
        categoryId: page.categoryId,
        products: page.products,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    const text =
      json.data?.ingest?.message ||
      json.data?.message ||
      JSON.stringify(json.data);
    msg.textContent = text;
  } catch (e) {
    msg.textContent = e instanceof Error ? e.message : String(e);
  }
});

document.getElementById("price").addEventListener("click", async () => {
  msg.textContent = "采价中…";
  try {
    const tab = await activeNoonTab();
    const pdp = await chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE_PDP_PRICE",
    });
    if (pdp?.error) throw new Error(pdp.error);
    const root = await marketApiRoot();
    const res = await fetch(`${root}/monitor/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productKey: pdp.productKey,
        url: pdp.url,
        title: pdp.title,
        price: pdp.price,
        currency: pdp.currency || "SAR",
        promoText: pdp.promoText ?? null,
        inStock: pdp.inStock ?? null,
        source: "extension",
        parseMethod: pdp.parseMethod || "dom",
        ensureTarget: true,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    const obs = json.data?.observation;
    const line = [
      json.message || "ok",
      obs
        ? `价=${obs.price} 置信=${obs.tier}(${obs.confidence?.toFixed?.(2) ?? obs.confidence})`
        : "",
      obs?.flags?.length ? `flags=${obs.flags.join(",")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    msg.textContent = line;
  } catch (e) {
    msg.textContent = e instanceof Error ? e.message : String(e);
  }
});

document.getElementById("add-only").addEventListener("click", async () => {
  msg.textContent = "加入监控池…";
  try {
    const tab = await activeNoonTab();
    const pdp = await chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE_PDP_PRICE",
    });
    const productKey = pdp?.productKey;
    if (!productKey) throw new Error(pdp?.error || "无 productKey");
    const root = await marketApiRoot();
    const res = await fetch(`${root}/monitor/targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productKey,
        url: pdp.url || tab.url,
        title: pdp.title || productKey,
        addedFrom: "extension",
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    msg.textContent = json.message || `已加入 ${productKey}`;
  } catch (e) {
    msg.textContent = e instanceof Error ? e.message : String(e);
  }
});
