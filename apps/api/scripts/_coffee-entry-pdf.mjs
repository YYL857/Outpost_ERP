/**
 * Render concise Saudi coffee entry PDF to Desktop via Playwright.
 */
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const desktop = join(homedir(), "Desktop");
const outPdf = join(desktop, "沙特咖啡机垂类入场分析_Amazon.sa_2026-09-23.pdf");
const htmlPath = join(desktop, "_coffee-entry-report-tmp.html");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>沙特咖啡机垂类入场分析</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
    color: #1a1a1a;
    font-size: 11.5px;
    line-height: 1.55;
    margin: 0;
  }
  h1 { font-size: 20px; margin: 0 0 6px; letter-spacing: 0.02em; }
  h2 {
    font-size: 13px;
    margin: 18px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1.5px solid #222;
  }
  h3 { font-size: 12px; margin: 12px 0 6px; }
  p { margin: 0 0 8px; }
  .meta { color: #555; font-size: 10.5px; margin-bottom: 12px; }
  .verdict {
    background: #f3f4f6;
    border-left: 4px solid #111;
    padding: 10px 12px;
    margin: 10px 0 14px;
  }
  .verdict strong { font-size: 13px; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 8px;
    margin: 10px 0 14px;
  }
  .stat {
    border: 1px solid #ddd;
    padding: 8px 10px;
  }
  .stat .v { font-size: 16px; font-weight: 700; }
  .stat .l { font-size: 10px; color: #555; margin-top: 2px; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
    margin: 6px 0 10px;
  }
  th, td {
    border: 1px solid #ddd;
    padding: 5px 7px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f5f5f5; font-weight: 600; }
  ul { margin: 4px 0 8px; padding-left: 18px; }
  li { margin-bottom: 3px; }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .box {
    border: 1px solid #ddd;
    padding: 10px 12px;
  }
  .box.pro { border-top: 3px solid #1b7f4a; }
  .box.con { border-top: 3px solid #a33; }
  .muted { color: #666; font-size: 10px; }
  .tag {
    display: inline-block;
    border: 1px solid #333;
    padding: 1px 7px;
    font-size: 10px;
    margin-right: 6px;
  }
  .footer {
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #ccc;
    font-size: 9.5px;
    color: #666;
  }
</style>
</head>
<body>
  <h1>沙特咖啡机垂类 · 入场分析报告</h1>
  <p class="meta">
    客群：沙特 &nbsp;|&nbsp; 证据：Amazon.sa 有头抓取（2026-09-23）&nbsp;|&nbsp;
    样本：去重 183 ASIN · 商详核实 18 款 &nbsp;|&nbsp;
    前提：我司具备咖啡机供应链优势
  </p>

  <div class="verdict">
    <strong>结论：有条件适合入场</strong>
    <p style="margin:6px 0 0">
      不要做「整类咖啡机铺货」，做两条窄带：
      <b>锥刀磨豆 SAR 180–350</b> +
      <b>入门半自动泵压机 SAR 350–700</b>。
      用供应链打性价比与交付稳定性，避开全自动高端、纯胶囊生态、低价滴滤红海。
    </p>
  </div>

  <div class="grid">
    <div class="stat"><div class="v">有条件进</div><div class="l">决策</div></div>
    <div class="stat"><div class="v">35% / 65%</div><div class="l">大牌 vs 挑战者+白牌</div></div>
    <div class="stat"><div class="v">1,193 评</div><div class="l">Stilosa 需求锚（SAR 348）</div></div>
    <div class="stat"><div class="v">2 条窄带</div><div class="l">磨豆 + 半自动首发</div></div>
  </div>

  <h2>一、市场一眼看懂</h2>
  <p>
    沙特亚马逊上咖啡相关货架<strong>需求真实、大牌占位清晰、白牌缝隙存在</strong>。
    Kitchen/Home 总畅销榜几乎看不到咖啡机，热度要看「Coffee/Tea/Espresso」类目与搜索；
    无 Sold Recently，本报告用<strong>商详评价数</strong>作需求代理。
  </p>
  <table>
    <thead>
      <tr><th>品类</th><th>市场特征</th><th>对我们的含义</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>半自动/泵压意式</td>
        <td>Stilosa≈348（1,193评）、Dedica≈699–799；白牌已在 360–400</td>
        <td><b>可进</b>：打大牌下方/同带，拼供应链一致性和配件包</td>
      </tr>
      <tr>
        <td>锥刀磨豆</td>
        <td>DOSCHER≈228（65评）、HiBREW G3≈330（176评）、G5≈521</td>
        <td><b>优先</b>：挑战者带已验证，供应链优势最容易转化为溢价</td>
      </tr>
      <tr>
        <td>土耳其咖啡机</td>
        <td>Arzum 占约六成；单款 300–500+ 评，本地刚需</td>
        <td>需求强但品牌集中；无土壶机专长则缓进</td>
      </tr>
      <tr>
        <td>胶囊</td>
        <td>Nespresso 系主导，评价高、生态锁客</td>
        <td>除非多兼容+耗材链，否则不做</td>
      </tr>
      <tr>
        <td>全自动</td>
        <td>多为 DeLonghi 等，价 1500–6500，评价高</td>
        <td>品牌/售后重，白牌难赢，不做首发</td>
      </tr>
      <tr>
        <td>低价滴滤 &lt;150</td>
        <td>SKU 密、中位价低</td>
        <td>红海，供应链优势难变现</td>
      </tr>
    </tbody>
  </table>

  <h2>二、需求锚点（商详核实）</h2>
  <table>
    <thead>
      <tr><th>产品</th><th>价 (SAR)</th><th>评价</th><th>说明</th></tr>
    </thead>
    <tbody>
      <tr><td>DeLonghi Stilosa</td><td>348</td><td>1,193</td><td>入门泵压销量锚</td></tr>
      <tr><td>Nespresso Vertuo Pop</td><td>—</td><td>844</td><td>胶囊生态</td></tr>
      <tr><td>Arzum OKKA RICH</td><td>299</td><td>545</td><td>土耳其本地刚需</td></tr>
      <tr><td>CASABREWS 3700</td><td>1,244</td><td>533</td><td>挑战者半自动可起量</td></tr>
      <tr><td>HiBREW G3 磨豆</td><td>330</td><td>176</td><td>锥刀挑战者</td></tr>
      <tr><td>Dedica Arte</td><td>799</td><td>157</td><td>大牌中端锚</td></tr>
      <tr><td>DOSCHER V60 锥刀</td><td>228</td><td>65</td><td>价带对标</td></tr>
    </tbody>
  </table>
  <p class="muted">来源：Amazon.sa 商品详情页 · 2026-09-23 有头抓取 · 当日部分带国庆 Deal，价格可能偏低</p>

  <h2>三、我司优劣势（相对沙特该市场）</h2>
  <div class="two">
    <div class="box pro">
      <h3>优势（可放大）</h3>
      <ul>
        <li><b>供应链优势可对准已验证价带</b>：磨豆 180–350、半自动 350–700 已有挑战者成单，不是从零教育市场。</li>
        <li><b>白牌/挑战者空间约六成货架</b>：大牌占位约 35%，其余为挑战者与小牌——适合用交付与成本说话，不必先堆品牌广告。</li>
        <li><b>可做「机+磨」组合</b>：若供应链同时覆盖半自动与锥刀，沙特家用意式入门套装叙事清晰，比单卖配件更好转化。</li>
        <li><b>沙特客群路径清楚</b>：Amazon.sa 可先验证评价与退货；料号可复用到 Noon SA（渠道策略另定）。</li>
      </ul>
    </div>
    <div class="box con">
      <h3>劣势 / 风险（须正视）</h3>
      <ul>
        <li><b>大牌心智强</b>：Stilosa/Dedica/Nespresso 评价体量大，正面硬刚品牌溢价很难。</li>
        <li><b>白牌评价爬坡慢</b>：同带已有 ibsun、Cafelffe、CASABREWS 等，后发要靠品质一致性与售后，不靠堆 SKU。</li>
        <li><b>本地文化带被占</b>：土耳其机需求真，但 Arzum 过强；非专长品类会分散供应链焦点。</li>
        <li><b>合规与运营未验证</b>：本轮未核 SASO/插头/质保；促销季价格波动大；Amazon 无 Sold Recently，投放与评价运营成本要单独算。</li>
        <li><b>缺落地成本闭环</b>：尚未用货代/FBN 实测尺寸重量算净利，入场仍需成本闸门。</li>
      </ul>
    </div>
  </div>

  <h2>四、建议动作（简洁）</h2>
  <ol>
    <li><b>首发 2 SKU</b>：1 款锥刀磨豆（对标 DOSCHER/HiBREW G3 带）+ 1 款泵压半自动（对标 Stilosa–Dedica 下方）。</li>
    <li><b>不做</b>：全自动 1500+、纯胶囊、&lt;150 滴滤；土耳其机无专长则不做。</li>
    <li><b>上架前闸门</b>：OEM 实样对标上述价带 → 算清 FBN/头程净利 → 沙特认证与质保话术定稿 → 再开 Amazon.sa。</li>
  </ol>

  <div class="footer">
    <span class="tag">证据渠道</span> Amazon.sa（有头）· 列表+类目+18 PDP · 已按「渠道一次吃透」封存，本报告仅汇总不再新抓<br/>
    文件生成：Outpost 分析 · 2026-09-23 · 原始数据：Outpost_ERP/apps/api/scripts/_out/
  </div>
</body>
</html>`;

writeFileSync(htmlPath, html, "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), {
  waitUntil: "load",
});
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
