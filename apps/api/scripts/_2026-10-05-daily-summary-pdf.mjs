/**
 * Outpost ERP 2026-10-05 当日工作总结 → Desktop PDF
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const desktop = "D:\\Desktop";
const outPdf = join(desktop, "Outpost_ERP_2026-10-05_当日工作总结.pdf");
const htmlPath = join(desktop, "_outpost-2026-10-05-daily-tmp.html");

const assets = "C:\\Users\\admin\\.cursor\\projects\\d-Outpost-ERP\\assets";
const img = (name) =>
  `data:image/png;base64,${readFileSync(join(assets, name)).toString("base64")}`;

const imgBefore = img(
  "c__Users_admin_AppData_Roaming_Cursor_User_workspaceStorage_d5137ebfa2bf28c845aae80058980b2c_images_image-666c0853-0d2c-4be7-bb61-18f34737234a.png",
);
const imgAfter = img(
  "c__Users_admin_AppData_Roaming_Cursor_User_workspaceStorage_d5137ebfa2bf28c845aae80058980b2c_images_image-6ba02860-f488-4203-9309-5e1637599088.png",
);
const imgUi = img(
  "c__Users_admin_AppData_Roaming_Cursor_User_workspaceStorage_d5137ebfa2bf28c845aae80058980b2c_images_image-89b0f583-cfe8-4597-81c0-b8ed4befa995.png",
);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Outpost ERP · 2026-10-05 当日工作总结</title>
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
  .box.do { border-top: 3px solid #1b7f4a; }
  .box.fix { border-top: 3px solid #c47b16; }
  .box.new { border-top: 3px solid #1a5f9e; }
  figure {
    margin: 6px 0 10px;
    page-break-inside: avoid;
  }
  figure img {
    width: 100%;
    border: 1px solid #ddd;
    display: block;
  }
  figcaption {
    font-size: 9.5px;
    color: #555;
    margin-top: 4px;
  }
  .shot-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 6px 0 10px;
  }
  .avoid { page-break-inside: avoid; }
</style>
</head>
<body>
  <h1>Outpost ERP · 2026-10-05 当日工作总结</h1>
  <p class="meta">
    日期：2026-10-05（周一）&nbsp;|&nbsp;
    范围：约仓插件形态、数据补洞与权限、广告导出链路、货代面单裁标&nbsp;|&nbsp;
    截图素材：亚优汇空运面单裁剪前 / 裁剪后、物流管理入口
  </p>

  <div class="verdict">
    <strong>一句话：</strong>
    今天同时做了「能继续干活」和「数能跟上」两件事——约仓插件在主机没开时也能抢仓；看板停在 9/29 被定位成入库缺口而非页面没刷新，并做成启动自检 + 超管一键补洞；广告影刀因登录掉线和导出按钮对不上而失败，已改选择器但未再引入爬虫；下午把货代 A4 面单裁成可贴的标签，并接到物流管理页（拖文件即可）。
  </div>

  <h2>今日时间线</h2>
  <table>
    <thead>
      <tr><th style="width:16%">时段</th><th style="width:22%">主题</th><th>结果</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>09:14–09:30</td>
        <td>约仓陪伴插件</td>
        <td>增加在线 / 离线形态（v1.2.8）；约仓逻辑未改。同事安装包：<code>outpost-asn-booking-extension-1.2.8.zip</code>。公网隧道评估后维持局域网。</td>
      </tr>
      <tr>
        <td>09:31–10:07</td>
        <td>看板停在 9/29</td>
        <td>查清销售事实最新日就是 9/29。落地数据补洞：启动审计、按类一次拉缺口、飞书直拉、影刀能触发则触发；前端「一键补洞」仅超管。</td>
      </tr>
      <tr>
        <td>10:26–11:12</td>
        <td>广告导出失败</td>
        <td>补洞触发成功 ≠ 导出成功。根因先是 10/1 起会话掉线，登录后仍找不到「Export all campaigns」。流程改为兼容 Export Data → Campaign Overview。评估 Scrapling：不引入。社区版 CLI 当日额度用尽。</td>
      </tr>
      <tr>
        <td>16:09–18:00</td>
        <td>货代面单裁标</td>
        <td>先手工裁 <code>亚优汇-2026-10-05-空运.pdf</code>（18 张，约 100×95 mm），再封装为物流管理工具：拖 PDF / 点选 → 裁剪并下载 <code>-裁标.pdf</code>，并重排 UI。</td>
      </tr>
    </tbody>
  </table>

  <h2>1. 约仓助手：在线 / 离线（形态，不改功能）</h2>
  <p>
    插件原先必须连办公室主机（默认 <code>192.168.1.112:8787</code>）才能用。要求只改形态：主机没开时仍能自动约仓，但查不到票号 / ASN / 文案。
  </p>
  <div class="cols">
    <div class="box do">
      <h3>在线（默认，与原先一致）</h3>
      <ul>
        <li>票号对齐、ASN、回填、发群文案照旧</li>
        <li>需要主机开着、8787 能通</li>
      </ul>
    </div>
    <div class="box new">
      <h3>离线</h3>
      <ul>
        <li>不再请求主机，查询区隐藏</li>
        <li>日历监控、开始 / 停止约仓照常</li>
        <li>约成功不回填主机</li>
      </ul>
    </div>
  </div>
  <p>
    未改 <code>content.js</code> 抢仓逻辑。公网临时隧道<strong>能用但未接</strong>：插件只放行了 http、约仓 API 对公网 IP 会 401，且隧道比局域网慢、域名会变。结论：办公室继续局域网；人不在时切离线抢仓。
  </p>

  <h2>2. 数据逻辑：看板停在 9/29 → 补洞与权限</h2>
  <p>
    看板「最新销售日」读的是 <code>salesFacts</code> 最大日期，不是接口查询时间。默认店 PRJ396770（KAZA PRJ482387 同样）：销售 / 订单 / 广告都停在 <strong>2026-09-29</strong>。9/30 的 Impex 销售导出里，能解析入库的最大日仍是 9/29（Noon 当天报表通常不完整）。之后没有成功的销售增量。
  </p>
  <p><strong>10/1 之后没续上的原因：</strong> API 进程中间停过，今早才起来；启动默认不跑汇总；影刀目录没有 9/30 之后的广告 CSV；飞书日报表名仍是「9.29」。</p>

  <table>
    <thead>
      <tr><th>看板上看什么</th><th>落盘</th><th>来源</th><th>是否官方接口</th></tr>
    </thead>
    <tbody>
      <tr><td>销售额 / 最新销售日</td><td>salesFacts</td><td>Impex 销售报表</td><td>是（Partner Impex）</td></tr>
      <tr><td>昨日成交单数</td><td>orders</td><td>Impex 订单导出</td><td>是</td></tr>
      <tr><td>库存</td><td>stock</td><td>Impex FBN 库存</td><td>是</td></tr>
      <tr><td>昨日广告投产比</td><td>adsFacts</td><td>影刀 ads_sku_*.csv</td><td>否（门户 RPA）</td></tr>
      <tr><td>自然单 / 自然 GMV</td><td>订单−广告；销售−广告</td><td>上两条相减</td><td>混合</td></tr>
      <tr><td>在途等运营</td><td>飞书表</td><td>飞书开放接口</td><td>不是 Noon</td></tr>
    </tbody>
  </table>

  <h3>补洞规则（已落地）</h3>
  <ul>
    <li><strong>启动自检：</strong> 进程起来后审计各店销售 / 订单 / 广告 / 价库 / 库存 / 费用；相对期望截止日有缺口就自动补。</li>
    <li><strong>Noon Impex：</strong> 官方约每半小时两次。每一类缺口一次拉齐 from～to，再按日清洗入库，避免按天连打。</li>
    <li><strong>飞书：</strong> 无配额限制，缺则直接 pull + 入库。</li>
    <li><strong>影刀广告：</strong> 能 CLI 触发则触发；触发不了则告警写明链路和口径。</li>
  </ul>
  <p>
    入口在<strong>同步健康中心</strong>：「重新审计」「一键补洞」。页面上的「刷新」<strong>只重算已入库数据，不会去 Noon / 飞书 / 影刀拉新数</strong>。
  </p>

  <div class="cols">
    <div class="box do">
      <h3>超级管理员</h3>
      <p>可点一键补洞、汇总同步、影刀导出、飞书入库。后端这些接口均 <code>requireAdmin</code>，非超管 403。</p>
    </div>
    <div class="box fix">
      <h3>普通用户</h3>
      <p>看板有缺口时黄条：「数据不是最新的，请联系超级管理员更新」。Catalog / 销量 / 广告 / 补货页隐藏同步按钮，只留刷新。</p>
    </div>
  </div>

  <h2>3. 广告链路修复：触发成功仍导出失败</h2>
  <p>
    补洞发现广告仍停在 9/29（缺 9/30–10/4），于是反复 CLI 启动「NOON广告投入导出工作流」。CLI 受理即算启动成功，缺口还在就会再挂一条。真正失败在影刀浏览器：点不到按钮。
  </p>
  <table>
    <thead>
      <tr><th>时间</th><th>发生了什么</th></tr>
    </thead>
    <tbody>
      <tr><td>9/30 17:02</td><td>上次成功导出：两店 <code>ads_sku_2026-09-29</code>（当时页上还有 Export all campaigns）</td></tr>
      <tr><td>10/1 16:30</td><td>保活报：影刀浏览器未登录 Ad Manager</td></tr>
      <tr><td>10/1–10/4</td><td>无成功导出；脚本在空壳页点英文按钮</td></tr>
      <tr><td>10/5 上午</td><td>登录后仍找不到「Export all campaigns」；两店 xpath 失败</td></tr>
    </tbody>
  </table>
  <ul>
    <li>流程已改为：先试旧按钮，没有则点 <strong>Export Data / Export</strong>，再选 <strong>Campaign Overview</strong>。</li>
    <li>社区版 CLI <strong>当日额度用尽</strong>（补洞打太多次），后续需在影刀里手动跑，或等次日额度。</li>
    <li>评估 GitHub 爬虫项目 Scrapling：<strong>不引入</strong>。它解决的是公开页抓取解析，带不走 Noon Partners 登录态、Akamai、无官方 Ads 口，以及点击下载 xlsx。销量 / 库存继续走 Impex。</li>
  </ul>

  <h2>4. 新功能：货代面单裁标</h2>
  <p>
    货代后台「打印面单」得到的是浏览器打印的 <strong>A4 PDF</strong>：每页中间才是标签，四周是日期、公司名、网址，无法直接打贴纸。今天先按样张裁 <strong>亚优汇空运 18 件</strong>（样张货描如 <code>yyh1603mpmy: 咖啡磨粉机-8002</code>），再做成系统工具。
  </p>

  <div class="shot-grid">
    <figure>
      <img src="${imgBefore}" alt="裁剪前" />
      <figcaption>裁剪前：整页 A4，标签在中间，四周空白与页眉页脚。示例 1/18，运单 YYH2610050714SA18。</figcaption>
    </figure>
    <figure>
      <img src="${imgAfter}" alt="裁剪后" />
      <figcaption>裁剪后：一页一张标，只留黑框内（线路、件号、条码、货描、Made in China），可按实际大小打印。</figcaption>
    </figure>
  </div>

  <figure>
    <img src="${imgUi}" alt="物流管理货代面单裁标入口" />
    <figcaption>
      物流管理入口：可直接把 PDF 拖进来，也可点选文件。示例文件
      「亚优汇-2026-10-05-空运.pdf」→ 下载「亚优汇-2026-10-05-空运-裁标.pdf」。打印选实际大小 / 100%。
    </figcaption>
  </figure>

  <div class="avoid">
    <h3>怎么用</h3>
    <ul>
      <li>侧栏 <strong>物流管理</strong>（<code>/shipping</code>），在「按箱头程明细」和「货代查轨迹」之间。</li>
      <li>拖入或选择未裁剪 PDF → <strong>裁剪并下载</strong>。文件名自动加 <code>-裁标</code>。</li>
      <li>识别每页标签黑框（Chrome 打印的填充线 / 路径框），裁掉日期、公司名、网址。</li>
      <li>接口：<code>POST /api/shipping-ops/labels/crop</code>；核心 <code>apps/api/src/modules/shipping/label-crop.ts</code>，单测已过。</li>
    </ul>
  </div>

  <h2>权限与操作约定（今天定下来的）</h2>
  <table>
    <thead>
      <tr><th>动作</th><th>谁可以</th><th>说明</th></tr>
    </thead>
    <tbody>
      <tr><td>刷新（看板 / Catalog 等）</td><td>全员</td><td>只重读本地已入库数据</td></tr>
      <tr><td>一键补洞 / 汇总同步 / 影刀导出</td><td>仅超管</td><td>会打 Noon / 飞书 / 影刀</td></tr>
      <tr><td>数据不是最新</td><td>普通用户只提示</td><td>找超管更新，不要连点刷新</td></tr>
      <tr><td>约仓离线</td><td>插件侧栏切换</td><td>主机没开也能抢仓</td></tr>
      <tr><td>面单裁标</td><td>物流页操作员</td><td>拖 PDF 即可，无需 WPS 手工裁</td></tr>
    </tbody>
  </table>

  <h2>尚未闭环 / 下次注意</h2>
  <ul>
    <li>广告 CSV 是否已补到 10/4 之后，取决于影刀手动跑改过的导出是否成功；CLI 额度次日恢复。</li>
    <li>补洞不要在影刀失败时无节制重打 CLI（今天已把社区版额度打光）。</li>
    <li>面单裁标目前按黑框识别，适合亚优汇这类「浏览器打印 A4 + 中间黑框」；其他货代版式若不是这种框，需要再适配。</li>
    <li>约仓插件不接公网隧道；默认仍局域网。</li>
  </ul>

  <p class="muted">
    本文根据 2026-10-05 当日实现与排查整理，截图为当面单裁标样张与物流页入口。非正式发版说明，供内部交接。
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
  margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
});
await browser.close();
unlinkSync(htmlPath);
console.log("wrote", outPdf);
