const msg = document.getElementById("msg");
const btn = document.getElementById("capture");
const apiBaseInput = document.getElementById("apiBase");
const saveApiBtn = document.getElementById("saveApi");

/** 与 asn-booking-extension 一致：写死办公室后端局域网 IP */
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
  // 旧默认本机地址视为未配置，改用写死的办公室局域网 IP
  if (!raw || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(raw)) {
    return DEFAULT_API;
  }
  return normalizeApiBase(raw);
}

async function captureFromTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_LISTING_PDP" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_LISTING_PDP" });
  }
}

(async () => {
  apiBaseInput.value = await getApiBase();
})();

saveApiBtn.addEventListener("click", async () => {
  const apiBase = normalizeApiBase(apiBaseInput.value);
  await chrome.storage.local.set({ apiBase });
  apiBaseInput.value = apiBase;
  msg.textContent = `已保存：${apiBase}\n请确认该地址在浏览器能打开 ${apiBase}/api/ready`;
});

btn.addEventListener("click", async () => {
  msg.textContent = "采集中…";
  try {
    const apiBase = await getApiBase();
    apiBaseInput.value = apiBase;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("找不到当前标签页");
    if (!tab.url?.includes("noon.com/saudi-en")) {
      throw new Error("请先打开 Noon 沙特商品详情页（地址含 saudi-en），再点采集");
    }

    const page = await captureFromTab(tab.id);
    if (page?.error) throw new Error(page.error);

    const endpoint = `${apiBase}/api/listing/competitor-capture`;
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: page.url || tab.url,
          pageUrl: page.pageUrl || tab.url,
          title: page.title,
          price: page.price,
          bullets: page.bullets,
          description: page.description,
          brand: page.brand,
        }),
      });
    } catch {
      throw new Error(
        [
          `连不上 Outpost API（${apiBase}）。`,
          "请确认跑后端的电脑已开机、服务在跑，且防火墙放行 8787。",
          "浏览器先打开该地址 /api/ready 试通；若办公室 IP 已变，在上方改地址并保存。",
        ].join("\n"),
      );
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || res.statusText);
    const d = json.data || {};
    msg.textContent = [
      `已写入 Listing 对手 inbox（${apiBase}）`,
      d.pastedTitle ? `标题：${d.pastedTitle.slice(0, 80)}` : "",
      d.pastedPrice ? `价格：${d.pastedPrice}` : "",
      d.pastedBullets
        ? `卖点：${d.pastedBullets.split("\n").filter(Boolean).length} 条`
        : "",
      "回到 Outpost「Listing 生成」点「导入扩展采集」",
    ]
      .filter(Boolean)
      .join("\n");
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (/Receiving end does not exist|Could not establish connection/i.test(raw)) {
      msg.textContent =
        "连不上页面脚本。请：① 扩展点刷新 ② 把 Noon 商品页也刷新一下 ③ 再点采集";
      return;
    }
    if (/Failed to fetch/i.test(raw)) {
      msg.textContent = [
        "Failed to fetch = 浏览器请求 API 失败。",
        `默认应连办公室后端 ${DEFAULT_API}。`,
        "确认后端电脑开机、防火墙放行 8787；浏览器先打开 /api/ready。",
        "若 IP 已变，在上方改地址并保存后再采集。",
      ].join("\n");
      return;
    }
    msg.textContent = raw;
  }
});
