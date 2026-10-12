/**
 * Outpost ERP 2026-10-06 当日工作总结 → Desktop PDF
 */
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const desktop = "D:\\Desktop";
const outPdf = join(desktop, "Outpost_ERP_2026-10-06_当日工作总结.pdf");
const htmlPath = join(desktop, "_outpost-2026-10-06-daily-tmp.html");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Outpost ERP · 2026-10-06 当日工作总结</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
    color: #1a1a1a;
    font-size: 11.5px;
    line-height: 1.52;
    margin: 0;
  }
  h1 { font-size: 19px; margin: 0 0 4px; }
  h2 {
    font-size: 13px;
    margin: 14px 0 6px;
    padding-bottom: 3px;
    border-bottom: 1.5px solid #222;
  }
  h3 { font-size: 11.5px; margin: 8px 0 4px; }
  .meta { color: #555; font-size: 10px; margin-bottom: 10px; }
  .verdict {
    background: #f3f4f6;
    border-left: 4px solid #111;
    padding: 8px 11px;
    margin: 6px 0 10px;
  }
  .verdict strong { font-size: 12px; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
    margin: 4px 0 8px;
  }
  th, td {
    border: 1px solid #ddd;
    padding: 5px 7px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f5f5f5; font-weight: 600; }
  ul, ol { margin: 3px 0 6px; padding-left: 18px; }
  li { margin-bottom: 3px; }
  .muted { color: #666; font-size: 9.5px; margin-top: 10px; }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 4px 0 8px;
  }
  .box {
    border: 1px solid #ddd;
    padding: 8px 10px;
  }
  .box h3 { margin: 0 0 4px; font-size: 11px; }
  .box.do { border-top: 3px solid #1b7f4a; }
  .box.new { border-top: 3px solid #1a5f9e; }
  .box.fix { border-top: 3px solid #c47b16; }
  .avoid { page-break-inside: avoid; }
  .step {
    font-weight: 600;
  }
</style>
</head>
<body>
  <h1>Outpost ERP · 2026-10-06 当日工作总结</h1>
  <p class="meta">
    日期：2026-10-06（周二）&nbsp;|&nbsp;
    主题：飞书常用表分析 → 自有票货体系（店×票×SKU）→ 票货台账试运行&nbsp;|&nbsp;
    快照：飞书 raw 2026-10-06
  </p>

  <div class="verdict">
    <strong>一句话：</strong>
    飞书表格难填、难看，根因不是缺表，而是「作业录入」和「经营观测」糊在一起，缺「每一店、每一票、每个 SKU」这一层账。今天把七份常用表拆清楚，定了与飞书共存的原则，并上线「票货台账」给用户实测。飞书继续当云文档填装箱和采购；看票、对件数、分摊头程改用我们。
  </div>

  <h2>今日做了什么</h2>
  <table>
    <thead>
      <tr><th style="width:22%">事项</th><th>结果</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>分析常用飞书表</td>
        <td>对照 wiki-graph 与当日快照：装箱、产品、账目、日报、Deals、信息检查、货代大纲。写清每张表帮用户干什么、粒度和关联。</td>
      </tr>
      <tr>
        <td>定共存策略</td>
        <td>飞书负责人写、多人改；Outpost 负责按店/票/SKU 算得清、看得快。不立刻废云文档。</td>
      </tr>
      <tr>
        <td>票货台账</td>
        <td>侧栏「供应链 → 票货台账」。已清洗写入 <code>D:\\outpost-data\\cargo-ledger\\latest.json</code>。</td>
      </tr>
      <tr>
        <td>通知用户</td>
        <td>数据看板顶部「今日任务汇总」；登录任务弹窗发给 admin、慧慧、乐东、黎哥、阿沈。</td>
      </tr>
    </tbody>
  </table>

  <h2>这些表到底帮用户做什么</h2>
  <table>
    <thead>
      <tr><th>表</th><th>用户要完成的事</th><th>粒度</th></tr>
    </thead>
    <tbody>
      <tr><td>装箱（箱表+明细）</td><td>这票发了没、哪家货代、到没到仓、运费、箱里哪些 SKU</td><td>箱 / 票 / SKU 行（最接近目标）</td></tr>
      <tr><td>产品表</td><td>PSKU 是什么、尺寸货型、补货偏好</td><td>SKU 主数据（利润公式是后来堆的）</td></tr>
      <tr><td>到仓成本</td><td>空运/海运到仓大概多少钱</td><td>SKU × 运输方式均价，不是某一票</td></tr>
      <tr><td>账目·产品采购</td><td>1688 下了哪些单、付了多少</td><td>订单行，对不上箱和票</td></tr>
      <tr><td>包装 / 入账开支</td><td>纸箱杂费、公司进出账</td><td>店外现金，不进票</td></tr>
      <tr><td>日报</td><td>该补、该清、广告亏不亏</td><td>一半是 Noon 已有数，一半才是人判</td></tr>
      <tr><td>Deals / 信息检查</td><td>活动价勾对</td><td>和日报、产品表重复</td></tr>
      <tr><td>货代大纲</td><td>货代挂价</td><td>报价带，实付看装箱</td></tr>
    </tbody>
  </table>
  <p>
    枢纽键是 <strong>PSKU</strong>。票号只活在装箱里。所以现在能拼「这票有哪些 SKU」，还不能诚实说「这票这个 SKU 用的是哪一单采购」。
  </p>

  <h2 class="avoid">和飞书怎么共存（今天定的）</h2>
  <div class="cols">
    <div class="box do">
      <h3>飞书继续写</h3>
      <ul>
        <li>装箱、产品主数据、采购记账</li>
        <li>云端多人改、留痕</li>
        <li>我们定时拉快照清洗</li>
      </ul>
    </div>
    <div class="box new">
      <h3>以我们为主看</h3>
      <ul>
        <li>店 → 票 → 箱 → SKU（票货台账）</li>
        <li>售价/库存/广告用 Catalog，少抄日报</li>
        <li>到仓成本、分摊运费由系统算</li>
      </ul>
    </div>
  </div>
  <p>人仍必须写的：补货/清货判断、装箱明细、采购下单。其余观测以系统为准。</p>

  <h2>新功能：票货台账 · 怎么用</h2>
  <ol>
    <li><span class="step">入口：</span>左侧「供应链」点「票货台账」（数据看板顶部也有链接）。</li>
    <li><span class="step">选店：</span>点 N1 / N2 / N3，或看全部。</li>
    <li><span class="step">搜索：</span>票号、箱号或 PSKU。</li>
    <li><span class="step">点开一票：</span>看箱数、件数、每个 SKU 的重量和分摊头程。</li>
    <li><span class="step">采购参考：</span>该 SKU 最近一次采购单价，<strong>不是</strong>这一票锁定的批次。</li>
  </ol>
  <p>请用自己熟悉的一票对一下店铺和件数。对不上把票号回在今日任务里。</p>

  <h2>当日清洗结果（飞书快照）</h2>
  <table>
    <thead>
      <tr><th>店铺</th><th>票</th><th>箱</th><th>件数</th><th>SKU 数</th><th>在途票</th></tr>
    </thead>
    <tbody>
      <tr><td>N1</td><td>156</td><td>595</td><td>25,163</td><td>486</td><td>55</td></tr>
      <tr><td>N2</td><td>43</td><td>129</td><td>5,744</td><td>101</td><td>26</td></tr>
      <tr><td>N3</td><td>1</td><td>5</td><td>159</td><td>5</td><td>1</td></tr>
      <tr><td>合计</td><td>200</td><td>729</td><td>—</td><td>1,528 行</td><td>—</td></tr>
    </tbody>
  </table>
  <p>
    侧账未并入票内：采购 1,340 行、包装 200 行、产品主数据 575、日报「9.29」461 个 SKU。清洗问题 124 条（例如有箱无明细），台账页底部可看。
  </p>

  <h2>尚未闭环</h2>
  <ul>
    <li>采购批次还锁不到「这一票用的哪一单货」，到仓成本仍是运输方式均价。</li>
    <li>日报/信息检查里的平台数尚未停手填，Catalog 侧已有售价库存广告。</li>
    <li>装箱/采购录入仍在飞书；迁到 Outpost 表单是以后的可选步骤。</li>
  </ul>

  <p class="muted">
    本文根据 2026-10-06 分析与实现整理，非正式发版说明，供内部交接与用户试用。
  </p>
</body>
</html>
`;

writeFileSync(htmlPath, html, "utf8");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, {
  waitUntil: "load",
});
await page.pdf({
  path: outPdf,
  format: "A4",
  printBackground: true,
  margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
});
await browser.close();
unlinkSync(htmlPath);
console.log(outPdf);
