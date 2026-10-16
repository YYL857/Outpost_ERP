const msg = document.getElementById("msg");
const btn = document.getElementById("capture");
const apiBaseInput = document.getElementById("apiBase");
const usernameInput = document.getElementById("username");
const saveApiBtn = document.getElementById("saveApi");
const pingBtn = document.getElementById("ping");

/** 与 asn-booking-extension 一致：写死办公室后端局域网 IP */
const DEFAULT_API = "http://192.168.1.112:8787";

function normalizeApiBase(raw) {
  let s = String(raw || "").trim().replace(/\/$/, "");
  if (!s) s = DEFAULT_API;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s.replace(/\/$/, "");
}

function normalizeUsername(raw) {
  return String(raw || "").trim();
}

async function getSettings() {
  const stored = await chrome.storage.local.get(["apiBase", "username"]);
  const rawApi = String(stored.apiBase || "").trim();
  // 旧默认本机地址视为未配置，改用写死的办公室局域网 IP
  const apiBase =
    !rawApi || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(rawApi)
      ? DEFAULT_API
      : normalizeApiBase(rawApi);
  return {
    apiBase,
    username: normalizeUsername(stored.username),
  };
}

async function saveSettings() {
  const apiBase = normalizeApiBase(apiBaseInput.value);
  const username = normalizeUsername(usernameInput.value);
  await chrome.storage.local.set({ apiBase, username });
  apiBaseInput.value = apiBase;
  usernameInput.value = username;
  return { apiBase, username };
}

function isNoonProductTab(url) {
  if (!url || !/noon\.com/i.test(url)) return false;
  // 沙特英/阿商品详情；或路径含 /N…/p
  if (/\/saudi-(en|ar)\//i.test(url)) return true;
  if (/\/N[A-Z0-9]+(?:\/p)?\/?/i.test(url)) return true;
  return false;
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
  const s = await getSettings();
  apiBaseInput.value = s.apiBase;
  usernameInput.value = s.username;
})();

saveApiBtn.addEventListener("click", async () => {
  const s = await saveSettings();
  if (!s.username) {
    msg.textContent =
      "已保存 API 地址，但还请填写 Outpost 用户名（与网页登录名相同），否则采集写不进你的 Listing。";
    return;
  }
  msg.textContent = `已保存：${s.username} @ ${s.apiBase}\n可点「测试连接」，再打开 Noon 商品页采集。`;
});

pingBtn.addEventListener("click", async () => {
  msg.textContent = "测试中…";
  try {
    const s = await saveSettings();
    const res = await fetch(`${s.apiBase}/api/ready`, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const lines = [`API 可达：${s.apiBase}/api/ready`];
    if (!s.username) {
      lines.push("请填写 Outpost 用户名后再采集。");
    } else {
      lines.push(`将写入用户「${s.username}」的 Listing inbox。`);
    }
    msg.textContent = lines.join("\n");
  } catch {
    msg.textContent = [
      `连不上 API。请确认后端电脑开机、防火墙放行 8787。`,
      `浏览器先打开 ${normalizeApiBase(apiBaseInput.value)}/api/ready 试通。`,
      "若办公室 IP 已变，改上方地址并保存。",
    ].join("\n");
  }
});

btn.addEventListener("click", async () => {
  msg.textContent = "采集中…";
  try {
    const { apiBase, username } = await saveSettings();
    if (!username) {
      throw new Error(
        "请先填写并保存 Outpost 用户名（与网页登录名相同），采集才会写入你的 Listing inbox",
      );
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("找不到当前标签页");
    if (!isNoonProductTab(tab.url || "")) {
      throw new Error(
        "请先打开 Noon 商品详情页（如 saudi-en / saudi-ar），再点采集",
      );
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
          username,
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
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(
          json.error ||
            "未授权：请确认用户名与网页登录名一致，且账号未停用；API 需已更新支持扩展用户名。",
        );
      }
      throw new Error(json.error || res.statusText);
    }
    const d = json.data || {};
    msg.textContent = [
      `已写入「${username}」的 Listing 对手 inbox（${apiBase}）`,
      d.pastedTitle ? `标题：${d.pastedTitle.slice(0, 80)}` : "",
      d.pastedPrice ? `价格：${d.pastedPrice}` : "",
      d.pastedBullets
        ? `卖点：${d.pastedBullets.split("\n").filter(Boolean).length} 条`
        : "",
      "用同一账号打开 Outpost「Listing 生成」→「导入扩展采集」",
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
