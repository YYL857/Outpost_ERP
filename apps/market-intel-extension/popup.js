const msg = document.getElementById("msg");
const btn = document.getElementById("capture");

btn.addEventListener("click", async () => {
  msg.textContent = "采集中…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("no active tab");
    if (!tab.url?.includes("noon.com/saudi-en")) {
      throw new Error("请在 Noon 沙特页（saudi-en）打开后再采集");
    }
    const page = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE" });
    if (page?.error) throw new Error(page.error);
    if (!page?.products?.length) {
      throw new Error("页面未解析到商品（可能无 __NEXT_DATA__ 或结构变化）");
    }
    const res = await fetch("http://127.0.0.1:8787/api/market-intel/ingest", {
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
