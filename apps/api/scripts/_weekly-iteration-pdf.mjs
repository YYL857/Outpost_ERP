/**
 * Outpost ERP 近七天迭代总结 → Desktop PDF
 */
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const desktop = join(homedir(), "Desktop");
const outPdf = join(desktop, "Outpost_ERP_近七天迭代总结_2026-09-23_09-30.pdf");
const htmlPath = join(desktop, "_outpost-weekly-iteration-tmp.html");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Outpost ERP · 近七天迭代总结</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
    color: #1a1a1a;
    font-size: 11.5px;
    line-height: 1.5;
    margin: 0;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 {
    font-size: 12.5px;
    margin: 14px 0 6px;
    padding-bottom: 3px;
    border-bottom: 1.5px solid #222;
  }
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
  th { background: #f5f5f5; font-weight: 600; width: 22%; }
  ul { margin: 3px 0 6px; padding-left: 16px; }
  li { margin-bottom: 3px; }
  .tag {
    display: inline-block;
    font-size: 9px;
    padding: 1px 5px;
    border: 1px solid #bbb;
    margin-right: 4px;
    color: #333;
  }
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
</style>
</head>
<body>
  <h1>Outpost ERP · 近七天迭代总结</h1>
  <p class="meta">
    周期：2026-09-23 ～ 2026-09-30 &nbsp;|&nbsp;
    范围：本地功能开发与业务链路落地（多数尚未合入远端 commit）&nbsp;|&nbsp;
    店铺：PRJ396770 / PRJ482387
  </p>

  <div class="verdict">
    <strong>一句话：</strong>
    本周从「运营看板 + 同步」推进到「AI 中枢、权限审计、约仓约束、补货分仓、Listing 优化、毛利核算」一整套可落地能力；
    影刀自动化与飞书/门户数据链路并行打通，系统开始具备公网可用与角色可控的形态。
  </div>

  <h2>1. 本周新增的核心能力</h2>
  <table>
    <tr>
      <th>模块</th>
      <td>
        <span class="tag">新</span>
        <b>Agent Hub + Wiki Graph</b>：私有 AI 助理中枢；工具清单、防幻觉校验、对话上下文；
        箱号/票号/物流号/PSKU/订单号预加载与跨表跳转；装配同步后自动重建知识图。
      </td>
    </tr>
    <tr>
      <th>安全与权限</th>
      <td>
        <span class="tag">新</span>
        <b>Auth / Capability / Audit</b>：登录会话、角色能力点、Agent 工具权限；
        操作审计日志与审计页；登录页视觉重做，适配公网隧道访问。
      </td>
    </tr>
    <tr>
      <th>约仓</th>
      <td>
        <span class="tag">新</span>
        <b>Warehouse Booking</b>：约仓约束流程（对齐店铺/票件信息）；浏览器插件补强「约成功」点击与结果页信息提取。
      </td>
    </tr>
    <tr>
      <th>信息检查</th>
      <td>
        <span class="tag">新</span>
        <b>Info Check</b>：对接飞书产品表 / 月度等三表，做字段对齐与查询核对（页面已上线）。
      </td>
    </tr>
    <tr>
      <th>Listing</th>
      <td>
        <span class="tag">增强</span>
        模块更名为 Listing；新增<strong>本店 Listing 优化</strong>（指标绑定、漏斗/诊断、改写）；
        影刀广告导出链路对接 Ad Manager → 店隔离 portal-imports。
      </td>
    </tr>
    <tr>
      <th>补货库存</th>
      <td>
        <span class="tag">增强</span>
        FBN vs Supermall 分仓库存（Impex Detailed + 影刀导出）；
        门户 Sales 90 天销量导出与清洗；补货页按门户口径对齐可售天。
      </td>
    </tr>
    <tr>
      <th>采购 / 头程</th>
      <td>
        <span class="tag">增强</span>
        到货分批确认与待办清项；操作审计；1688 物流回填思路落地；
        货代大纲驱动的头程计费；发货渠道（海运/普货/敏货/带电）统计。
      </td>
    </tr>
    <tr>
      <th>财务毛利</th>
      <td>
        <span class="tag">交付</span>
        两店 2026-06～09 毛利汇总：按月账单 Net Proceeds / 平台费 / VAT，
        扣采购与头程，汇率 1.76；桌面交付 HUI / HFY 汇总表。
      </td>
    </tr>
    <tr>
      <th>市场选品</th>
      <td>
        <span class="tag">调研</span>
        咖啡垂类入场研判 + 沙特耗材新店选品结论（Amazon.sa 等渠道一次吃透并封存）；
        影刀耗材 Sold Recently 链路打通（CLI→inbox）。
      </td>
    </tr>
  </table>

  <h2>2. 按日推进脉络</h2>
  <table>
    <tr><th>09-23</th><td>Listing 优化立项 + 影刀广告导出；咖啡/耗材选品；1688 采购物流回填；晨报熔断与信号展示优化。</td></tr>
    <tr><th>09-24</th><td>Wiki Graph / Agent Hub 中枢；审计日志；Catalog 分页性能；助手 UI；头程计算与采购到齐统计。</td></tr>
    <tr><th>09-28</th><td>约仓限制流程 + 插件修复；FBN/Supermall 影刀库存导出；发货货代渠道统计；Listing 插件补强。</td></tr>
    <tr><th>09-29</th><td>Sales 导出清洗灌入补货；四个月毛利核算；公网访问 + 登录页改版；Listing 优化逻辑融入。</td></tr>
    <tr><th>09-30</th><td>信息检查页；补货断货口径排查；广告归因 / 自然单·自然 JMV；首页与店铺配色；权限与看板对齐。</td></tr>
  </table>

  <h2>3. 已实现的关键需求（对照）</h2>
  <div class="cols">
    <div class="box">
      <h3>产品 / 运营侧</h3>
      <ul>
        <li>补货看清 FBN 与 Supermall 分仓，对齐门户销量</li>
        <li>约仓必须对齐票件信息，降低漏填/串店</li>
        <li>采购到货可分批确认，待办可清、可追溯</li>
        <li>Listing 从「竞品创建」扩展到「本店优化」</li>
        <li>两店六月起毛利表可复核交付</li>
        <li>信息检查：飞书多表交叉核对</li>
      </ul>
    </div>
    <div class="box">
      <h3>平台 / 工程侧</h3>
      <ul>
        <li>私有 Agent：有证据才报 SKU/金额</li>
        <li>Wiki 图：跨箱票物流订单跳转</li>
        <li>角色能力点 + 审计轨迹</li>
        <li>Catalog 分页，缓解全量卡死</li>
        <li>影刀 Skill 化（flow-build / PC CLI）</li>
        <li>公网隧道可用，登录体验升级</li>
      </ul>
    </div>
  </div>

  <h2>4. 自动化与数据链路（本周打通）</h2>
  <ul>
    <li><b>影刀</b>：广告导出、FBN 库存分仓、Sales 门户导出、耗材 Sold Recently（CLI 可跑）</li>
    <li><b>落盘规范</b>：按店隔离至 <code>outpost-data/shops/&#123;shopId&#125;/portal-imports/</code></li>
    <li><b>财务源</b>：Noon 月账单 + 飞书采购/装箱摊销 → 毛利汇总 xlsx</li>
    <li><b>知识图</b>：飞书装配成功后自动重建 Wiki Graph</li>
  </ul>

  <h2>5. 仍在跟进 / 已知缺口</h2>
  <ul>
    <li>补货「断货仍显示可买/可售天」——门户库存与本地装配口径继续对齐</li>
    <li>广告归因与自然单 / 自然 JMV 看板口径收口</li>
    <li>毛利表平台费与同事五月样板差额、9 月账单月末完整性</li>
    <li>大量功能仍在本地工作区，尚未统一 git 提交远端</li>
  </ul>

  <p class="muted">
    依据：本地模块变更（agent-hub / wiki-graph / audit / warehouse-booking / info-check / listing / replenish 等）
    + 交接文档 docs/*HANDOFF.md + Cursor 会话记录（2026-09-23～09-30）。生成日：2026-09-30。
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
  margin: { top: "11mm", bottom: "11mm", left: "11mm", right: "11mm" },
});
await browser.close();
try {
  unlinkSync(htmlPath);
} catch {
  /* ignore */
}
console.log(JSON.stringify({ outPdf, ok: true }, null, 2));
