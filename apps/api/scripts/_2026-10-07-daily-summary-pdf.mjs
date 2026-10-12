/**
 * Outpost ERP 2026-10-07 当日工作总结 → Desktop PDF
 */
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const desktop = "D:\\Desktop";
const outPdf = join(desktop, "Outpost_ERP_2026-10-07_当日工作总结.pdf");
const htmlPath = join(desktop, "_outpost-2026-10-07-daily-tmp.html");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Outpost ERP · 2026-10-07 当日工作总结</title>
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
  .box.fix { border-top: 3px solid #c47b16; }
  .avoid { page-break-inside: avoid; }
  code { font-size: 10px; background: #f5f5f5; padding: 0 3px; }
</style>
</head>
<body>
  <h1>Outpost ERP · 2026-10-07 当日工作总结</h1>
  <p class="meta">
    日期：2026-10-07（周三）&nbsp;|&nbsp;
    主题：补货发货计划 · 约仓回填装箱 · Noon 导出与看板对齐 · 向导补链 · GitHub 仓库&nbsp;|&nbsp;
    依据：当日 Cursor 会话与落盘校验
  </p>

  <div class="verdict">
    <strong>一句话：</strong>
    发货侧补了「人为导入补货计划 → 拆腿选货代」；约仓助手打通飞书装箱回填；关掉无用的 Noon 保活弹窗，用真导出把广告/销量落盘并对齐看板昨日口径；向导 Playwright 补到 37/42；项目源码推上 GitHub（作者 YYL857）。
  </div>

  <h2>今日做了什么</h2>
  <table>
    <thead>
      <tr><th style="width:22%">事项</th><th>结果</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>补货计划 · 发货导入</td>
        <td>按桌面固定 xlsx 抽字段；支持上传/拖入；拆空海腿、分批「本次发」；货代汇总 + 货性补齐（品×货代→货性）。验证：47 行、纳入 42、不补货 5。</td>
      </tr>
      <tr>
        <td>约仓 → 装箱表闭环</td>
        <td>约仓成功自动回填飞书装箱；侧栏可重试。箱表写 ASN+送仓日；明细另写「已入库」。票 <code>10001711</code> N1/N2 实写通过。扩展 <strong>v1.2.9</strong>；包装盒/RTV 不填 ASN。</td>
      </tr>
      <tr>
        <td>去掉 Noon 保活弹窗</td>
        <td>定时自动开 Chrome 保活链路已关。保留其余导出类定时任务；登录态过期改为提示刷新。</td>
      </tr>
      <tr>
        <td>广告 / 销量落盘</td>
        <td>近 30 天广告：HUI 561 行、HFY 102 行落盘。近 30 天销量：HUI 57 / HFY 530。下午补昨日单日广告后看板 exact-day 对齐。</td>
      </tr>
      <tr>
        <td>数据看板布局</td>
        <td>顶部长文压缩：同步条一行、任务大卡去掉、口径注意默认折叠；票货台账改标题栏入口。</td>
      </tr>
      <tr>
        <td>Noon 向导补链</td>
        <td>Playwright 爬虫 <code>noon-guide-capture-pw</code>：FBP 11/11、Account Health、Vantage 等写入；合计 <strong>37/42 confirmed</strong>。Payments 5 条需人工点一次 URL。</td>
      </tr>
      <tr>
        <td>GitHub 仓库</td>
        <td>新建 <code>https://github.com/YYL857/Outpost_ERP</code>；历史作者统一为 YYL857；本地大量未提交改动仍在工作区。</td>
      </tr>
    </tbody>
  </table>

  <h2 class="avoid">补货计划 · 发货怎么用</h2>
  <ol>
    <li>打开「补货计划」→「发货计划（导入表）」</li>
    <li>拖入或上传固定表头 xlsx（也可一键导入桌面「补货」表）</li>
    <li>明细里为每条腿选货代 / 空海运 / 件数；可拆腿、可填「本次发」</li>
    <li>「货代汇总」看各家空海量；「货性补齐」补品×货代→货性（本机 cargo-hints）</li>
  </ol>
  <p>表头：PSKU / 名称 / 库存 / 在途 / 月销 / 建议空运 / 建议海运 / √或「不补货」 / 备注；中间日期行=计划发货日。</p>

  <h2 class="avoid">约仓陪伴 v1.2.9</h2>
  <div class="cols">
    <div class="box do">
      <h3>自动回填</h3>
      <ul>
        <li>箱表：ASN + 送仓时间（不动「到仓情况」公式）</li>
        <li>装箱明细：ASN + 送仓时间 + 已入库</li>
        <li>按店前缀 + 物流号匹配，防串店</li>
      </ul>
    </div>
    <div class="box fix">
      <h3>例外</h3>
      <ul>
        <li>RTV / 包装盒：不填 ASN，只填同批送仓时间</li>
        <li>失败可在侧栏「回填装箱表」重试</li>
        <li>后端需重启后新 capture 才自动回填</li>
      </ul>
    </div>
  </div>

  <h2>看板与导出对齐（昨日 2026-10-06）</h2>
  <table>
    <thead>
      <tr><th>店铺</th><th>广告口径</th><th>花费</th><th>归因收入</th><th>订单</th><th>ROAS</th><th>昨日 GMV / 自然</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>HPMY（PRJ396770）</td>
        <td>exact-day</td>
        <td>249.39</td>
        <td>739.10</td>
        <td>16</td>
        <td>2.96</td>
        <td>GMV 2365.36 / 自然 1626.26（约 31% 广告贡献）</td>
      </tr>
      <tr>
        <td>KAZA（PRJ482387）</td>
        <td>exact-day</td>
        <td>91.18</td>
        <td>535.10</td>
        <td>11</td>
        <td>5.87</td>
        <td>GMV 1369.69 / 自然 834.59（约 39% 广告贡献）</td>
      </tr>
    </tbody>
  </table>
  <p>
    上午一度「广告虚高、自然 GMV 塌」：落盘的是近 30 天区间表，缺昨日单日广告；下午导出 <code>ads_sku_2026-10-06_2026-10-06.csv</code> 后恢复。口径习惯仍是「今天补昨天」。
  </p>

  <h2>Noon 向导补链进度</h2>
  <ul>
    <li>已齐：FBP 全套（交运=Handover、包材=packing/orders）、Account Health、Vantage 等 → <strong>37/42</strong></li>
    <li>仍 pending：Payments 下 Statements / SOA / Invoices / Transaction View / Exports（finance 子路径猜不到，需人工点一次地址栏）</li>
    <li>工具目录：<code>apps/api/scripts/noon-guide-capture-pw/</code></li>
  </ul>

  <h2>尚未闭环 / 注意</h2>
  <ul>
    <li>GitHub 上仍是较早快照；本机大量新模块未再 push（有 stash 需留意）。</li>
    <li>向导 Payments 5 条等人工 URL。</li>
    <li>Glam Bag / mmm 广告导出曾卡在 onboarding，不影响已落盘的 HUI/HFY。</li>
    <li>补货计划逻辑本身仍依赖人工表；自动补货算法未完善。</li>
  </ul>

  <p class="muted">
    本文根据 2026-10-07 各会话落地结果整理，非正式发版说明，供内部交接。
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
