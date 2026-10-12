/**
 * Noon SA consumables new-store conclusions PDF → Desktop
 */
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const desktop = join(homedir(), "Desktop");
const outPdf = join(desktop, "Noon沙特耗材新店结论_2026-09-23.pdf");
const htmlPath = join(desktop, "_outpost-noon-结论-tmp.html");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Noon 沙特耗材新店 · 结论</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
    color: #1a1a1a;
    font-size: 12px;
    line-height: 1.55;
    margin: 0;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 {
    font-size: 13px;
    margin: 16px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1.5px solid #222;
  }
  .meta { color: #555; font-size: 10.5px; margin-bottom: 12px; }
  .verdict {
    background: #f3f4f6;
    border-left: 4px solid #111;
    padding: 10px 12px;
    margin: 8px 0 14px;
  }
  .verdict strong { font-size: 13px; }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 8px 0 12px;
  }
  .box {
    border: 1px solid #ddd;
    padding: 10px 12px;
  }
  .box.do { border-top: 3px solid #1b7f4a; }
  .box.dont { border-top: 3px solid #a33; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    margin: 6px 0 10px;
  }
  th, td {
    border: 1px solid #ddd;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f5f5f5; font-weight: 600; }
  ul, ol { margin: 4px 0 8px; padding-left: 18px; }
  li { margin-bottom: 4px; }
  .muted { color: #666; font-size: 9.5px; margin-top: 14px; }
</style>
</head>
<body>
  <h1>Noon 沙特 · 耗材新店选品结论</h1>
  <p class="meta">
    客群：沙特 Noon 新店 &nbsp;|&nbsp; 日期：2026-09-23 &nbsp;|&nbsp;
    证据：Amazon.sa 耗材榜/搜索代理（约 254 ASIN）&nbsp;|&nbsp;
    Noon 前台采不到，Sold Recently 待影刀复核
  </p>

  <div class="verdict">
    <strong>一句话</strong>
    <p style="margin:6px 0 0">
      先做<strong>厨房日耗白牌</strong>：轻、复购强、客单大约 <b>15–80 SAR</b>。
      首发建议：垃圾袋 + 保鲜膜/罩 + 密封袋；有咖啡供应链再加滤纸和除垢剂。
      上架前务必算清 FBN/运费——垃圾袋、纸巾最容易「卖得出、不赚钱」。
    </p>
  </div>

  <h2>优先做（更容易捞钱）</h2>
  <table>
    <thead>
      <tr><th>品类</th><th>中位价约（SAR）</th><th>为什么</th></tr>
    </thead>
    <tbody>
      <tr><td>密封袋 / 保鲜袋</td><td>46</td><td>复购强、易白牌</td></tr>
      <tr><td>保鲜膜 / 保鲜罩</td><td>40</td><td>轻、便宜、易铺货</td></tr>
      <tr><td>家用抽绳垃圾袋</td><td>30</td><td>刚需；需控体积与克重</td></tr>
      <tr><td>铝箔</td><td>36</td><td>厨房刚需；规格要标清</td></tr>
      <tr><td>化妆棉</td><td>14</td><td>极轻复购；靠多件装拉客单</td></tr>
      <tr><td>V60 滤纸 + 除垢剂</td><td>20 / 67</td><td>可贴咖啡机供应链，差异化</td></tr>
    </tbody>
  </table>

  <h2>先别碰</h2>
  <div class="two">
    <div class="box dont">
      <ul>
        <li>洗衣凝珠（大牌战、认证/配方门槛）</li>
        <li>婴儿湿巾大牌盘</li>
        <li>泡货纸巾（体积大、运费吃利润）</li>
        <li>正统咖啡胶囊（生态绑定，新店难切入）</li>
      </ul>
    </div>
    <div class="box do">
      <b>首发 SKU 建议</b>
      <ul>
        <li>垃圾袋 × 2 规格</li>
        <li>保鲜膜 / 保鲜罩 × 2</li>
        <li>密封袋 × 2</li>
        <li>可选：滤纸 / 除垢 / 化妆棉</li>
      </ul>
    </div>
  </div>

  <h2>落地下一步</h2>
  <ol>
    <li>修好 Edge 影刀插件后，跑 Noon Sold Recently，用真实热度复核上表。</li>
    <li>垃圾袋、纸巾类先做 FBN 尺寸重量算价，再决定备货量。</li>
    <li>OEM 实样对规格与克重，确认净利后再铺量。</li>
  </ol>

  <p class="muted">
    详细证据见 Canvas：sa-consumables-easy-money · 交接：docs/MARKET_INTEL_HANDOFF.md
  </p>
</body>
</html>`;

writeFileSync(htmlPath, html, "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "load" });
await page.pdf({
  path: outPdf,
  format: "A4",
  printBackground: true,
  margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
});
await browser.close();
try {
  unlinkSync(htmlPath);
} catch {
  /* ignore */
}
console.log(JSON.stringify({ outPdf, ok: true }, null, 2));
