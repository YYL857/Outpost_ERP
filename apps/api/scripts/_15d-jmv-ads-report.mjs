/**
 * 近 15 日 JMV / 销量 / 广告趋势 → Desktop PDF + JSON
 * 明确拆分：总 vs 广告归因 vs 自然
 */
import fs from "fs";
import path from "path";
import { homedir } from "os";
import { chromium } from "playwright";

const SHOPS = [
  { id: "PRJ396770", name: "HUI Beauty" },
  { id: "PRJ482387", name: "HFY-KSA" },
];

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(ymd, delta) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function shanghaiYmd(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

function isDealOrderStatus(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (!s) return true;
  return !/cancel|void|fail|reject|refunded|returned/.test(s);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function pct(curr, prev) {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return round2(((curr - prev) / Math.abs(prev)) * 100);
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtPct(p) {
  if (p == null) return "—";
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
}

function sharePct(part, total) {
  if (!(total > 0)) return null;
  return round2((part / total) * 100);
}

/** 双线折线：广告 + 自然 */
function dualSpark(adsVals, orgVals, w = 240, h = 40) {
  const max = Math.max(...adsVals, ...orgVals, 1e-9);
  const min = Math.min(...adsVals, ...orgVals, 0);
  const span = Math.max(max - min, 1e-9);
  const toPts = (values) =>
    values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * (w - 2) + 1;
        const y = h - 2 - ((v - min) / span) * (h - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline fill="none" stroke="#b45309" stroke-width="1.6" points="${toPts(adsVals)}"/>
    <polyline fill="none" stroke="#15803d" stroke-width="1.6" points="${toPts(orgVals)}"/>
  </svg>`;
}

function sparkSvg(values, color, w = 220, h = 36) {
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1e-9);
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
}

function stackedBarRow(ads, org, maxTotal, w = 120) {
  const total = ads + org;
  if (!(maxTotal > 0) || !(total > 0)) {
    return `<span class="bar-empty">—</span>`;
  }
  const scale = w / maxTotal;
  const aw = Math.max(ads > 0 ? 1 : 0, Math.round(ads * scale));
  const ow = Math.max(org > 0 ? 1 : 0, Math.round(org * scale));
  return `<span class="bar"><span class="bar-ads" style="width:${aw}px"></span><span class="bar-org" style="width:${ow}px"></span></span>`;
}

const today = shanghaiToday();
const end = today;
const start = addDays(end, -14);
const days = [];
for (let i = 0; i < 15; i++) days.push(addDays(start, i));

const shopReports = [];
for (const shop of SHOPS) {
  const statePath = path.join(
    "D:/outpost-data/shops",
    shop.id,
    "json/state.json",
  );
  const st = JSON.parse(fs.readFileSync(statePath, "utf8"));

  const salesByDate = Object.fromEntries(
    days.map((d) => [d, { units: 0, jmv: 0 }]),
  );
  for (const f of st.salesFacts || []) {
    if (!salesByDate[f.date]) continue;
    salesByDate[f.date].units += f.units || 0;
    salesByDate[f.date].jmv += f.amount || 0;
  }

  /** 成交单：orders 去重，与看板自然单口径一致 */
  const dealOrdersByDate = Object.fromEntries(days.map((d) => [d, new Set()]));
  for (const o of st.orders || []) {
    if (!isDealOrderStatus(o.status)) continue;
    const d = shanghaiYmd(o.placedAt);
    if (!d || !dealOrdersByDate[d] || !o.orderNr) continue;
    dealOrdersByDate[d].add(o.orderNr);
  }

  const adsByDate = Object.fromEntries(
    days.map((d) => [
      d,
      { spend: 0, revenue: 0, orders: 0, clicks: 0, views: 0, atc: 0, facts: 0 },
    ]),
  );
  let multiDaySkipped = 0;
  for (const f of st.adsFacts || []) {
    if (f.fromDate !== f.toDate) {
      if (f.toDate >= start && f.fromDate <= end) multiDaySkipped += 1;
      continue;
    }
    const d = f.fromDate;
    if (!adsByDate[d]) continue;
    adsByDate[d].spend += f.spend || 0;
    adsByDate[d].revenue += f.revenue || 0;
    adsByDate[d].orders += f.orders || 0;
    adsByDate[d].clicks += f.clicks || 0;
    adsByDate[d].views += f.views || 0;
    adsByDate[d].atc += f.atc || 0;
    adsByDate[d].facts += 1;
  }

  const series = days.map((d) => {
    const jmv = round2(salesByDate[d].jmv);
    const units = salesByDate[d].units;
    const dealOrders = dealOrdersByDate[d].size;
    const adsJmv = round2(adsByDate[d].revenue);
    const adsOrders = Math.round(adsByDate[d].orders);
    const spend = round2(adsByDate[d].spend);
    const organicJmv = round2(Math.max(0, jmv - adsJmv));
    const organicOrders = Math.max(0, dealOrders - adsOrders);
    /** 件数侧近似：总销量 − 广告归因单（广告侧是订单非件数，仅作参考） */
    const organicUnits = Math.max(0, units - adsOrders);
    return {
      date: d,
      jmv,
      adsJmv,
      organicJmv,
      units,
      adsOrders,
      organicOrders,
      organicUnits,
      dealOrders,
      spend,
      clicks: adsByDate[d].clicks,
      adsFacts: adsByDate[d].facts,
      roas: spend > 0 ? round2(adsJmv / spend) : null,
      adsJmvShare: sharePct(adsJmv, jmv),
      adsOrderShare: sharePct(adsOrders, dealOrders),
    };
  });

  const tot = series.reduce(
    (a, r) => {
      a.jmv += r.jmv;
      a.adsJmv += r.adsJmv;
      a.organicJmv += r.organicJmv;
      a.units += r.units;
      a.adsOrders += r.adsOrders;
      a.organicOrders += r.organicOrders;
      a.organicUnits += r.organicUnits;
      a.dealOrders += r.dealOrders;
      a.spend += r.spend;
      a.clicks += r.clicks;
      a.daysWithAds += r.adsFacts > 0 ? 1 : 0;
      a.daysWithSales += r.units > 0 || r.jmv > 0 ? 1 : 0;
      return a;
    },
    {
      jmv: 0,
      adsJmv: 0,
      organicJmv: 0,
      units: 0,
      adsOrders: 0,
      organicOrders: 0,
      organicUnits: 0,
      dealOrders: 0,
      spend: 0,
      clicks: 0,
      daysWithAds: 0,
      daysWithSales: 0,
    },
  );
  for (const k of [
    "jmv",
    "adsJmv",
    "organicJmv",
    "spend",
  ]) {
    tot[k] = round2(tot[k]);
  }
  tot.roas = tot.spend > 0 ? round2(tot.adsJmv / tot.spend) : null;
  tot.acos =
    tot.adsJmv > 0 ? round2((tot.spend / tot.adsJmv) * 100) : null;
  tot.adsJmvShare = sharePct(tot.adsJmv, tot.jmv);
  tot.orgJmvShare = sharePct(tot.organicJmv, tot.jmv);
  tot.adsOrderShare = sharePct(tot.adsOrders, tot.dealOrders);
  tot.orgOrderShare = sharePct(tot.organicOrders, tot.dealOrders);

  const first7 = series.slice(0, 7);
  const last7 = series.slice(8);
  const sum = (arr, key) => round2(arr.reduce((s, r) => s + (r[key] || 0), 0));
  const trend = {
    jmv: pct(sum(last7, "jmv"), sum(first7, "jmv")),
    adsJmv: pct(sum(last7, "adsJmv"), sum(first7, "adsJmv")),
    organicJmv: pct(sum(last7, "organicJmv"), sum(first7, "organicJmv")),
    units: pct(sum(last7, "units"), sum(first7, "units")),
    adsOrders: pct(sum(last7, "adsOrders"), sum(first7, "adsOrders")),
    organicOrders: pct(
      sum(last7, "organicOrders"),
      sum(first7, "organicOrders"),
    ),
    spend: pct(sum(last7, "spend"), sum(first7, "spend")),
  };

  const skuMap = new Map();
  for (const f of st.salesFacts || []) {
    if (f.date < start || f.date > end) continue;
    const row = skuMap.get(f.partnerSku) || {
      partnerSku: f.partnerSku,
      units: 0,
      jmv: 0,
    };
    row.units += f.units || 0;
    row.jmv += f.amount || 0;
    skuMap.set(f.partnerSku, row);
  }
  const topSkus = [...skuMap.values()]
    .sort((a, b) => b.jmv - a.jmv)
    .slice(0, 8)
    .map((r) => ({ ...r, jmv: round2(r.jmv) }));

  const adsSku = new Map();
  for (const f of st.adsFacts || []) {
    if (f.fromDate !== f.toDate) continue;
    if (f.fromDate < start || f.fromDate > end) continue;
    const row = adsSku.get(f.partnerSku) || {
      partnerSku: f.partnerSku,
      spend: 0,
      revenue: 0,
      orders: 0,
    };
    row.spend += f.spend || 0;
    row.revenue += f.revenue || 0;
    row.orders += f.orders || 0;
    adsSku.set(f.partnerSku, row);
  }
  const topAds = [...adsSku.values()]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8)
    .map((r) => ({
      ...r,
      spend: round2(r.spend),
      revenue: round2(r.revenue),
      roas: r.spend > 0 ? round2(r.revenue / r.spend) : null,
    }));

  shopReports.push({
    shop,
    series,
    tot,
    trend,
    topSkus,
    topAds,
    multiDaySkipped,
    salesUpdated: (st.salesFacts || []).slice(-1)[0]?.updatedAt,
    adsUpdated: (st.adsFacts || []).slice(-1)[0]?.updatedAt,
  });
}

const combinedSeries = days.map((d) => {
  const rows = shopReports.map((r) => r.series.find((s) => s.date === d));
  const jmv = round2(rows.reduce((s, r) => s + r.jmv, 0));
  const adsJmv = round2(rows.reduce((s, r) => s + r.adsJmv, 0));
  const organicJmv = round2(rows.reduce((s, r) => s + r.organicJmv, 0));
  const units = rows.reduce((s, r) => s + r.units, 0);
  const adsOrders = rows.reduce((s, r) => s + r.adsOrders, 0);
  const organicOrders = rows.reduce((s, r) => s + r.organicOrders, 0);
  const dealOrders = rows.reduce((s, r) => s + r.dealOrders, 0);
  const spend = round2(rows.reduce((s, r) => s + r.spend, 0));
  return {
    date: d,
    jmv,
    adsJmv,
    organicJmv,
    units,
    adsOrders,
    organicOrders,
    dealOrders,
    spend,
    roas: spend > 0 ? round2(adsJmv / spend) : null,
    adsJmvShare: sharePct(adsJmv, jmv),
    adsOrderShare: sharePct(adsOrders, dealOrders),
  };
});

const cTot = combinedSeries.reduce(
  (a, r) => {
    a.jmv += r.jmv;
    a.adsJmv += r.adsJmv;
    a.organicJmv += r.organicJmv;
    a.units += r.units;
    a.adsOrders += r.adsOrders;
    a.organicOrders += r.organicOrders;
    a.dealOrders += r.dealOrders;
    a.spend += r.spend;
    return a;
  },
  {
    jmv: 0,
    adsJmv: 0,
    organicJmv: 0,
    units: 0,
    adsOrders: 0,
    organicOrders: 0,
    dealOrders: 0,
    spend: 0,
  },
);
for (const k of ["jmv", "adsJmv", "organicJmv", "spend"]) {
  cTot[k] = round2(cTot[k]);
}
cTot.roas = cTot.spend > 0 ? round2(cTot.adsJmv / cTot.spend) : null;
cTot.adsJmvShare = sharePct(cTot.adsJmv, cTot.jmv);
cTot.orgJmvShare = sharePct(cTot.organicJmv, cTot.jmv);
cTot.adsOrderShare = sharePct(cTot.adsOrders, cTot.dealOrders);
cTot.orgOrderShare = sharePct(cTot.organicOrders, cTot.dealOrders);

const first7 = combinedSeries.slice(0, 7);
const last7 = combinedSeries.slice(8);
const sumK = (arr, k) => round2(arr.reduce((s, r) => s + r[k], 0));
const cTrend = {
  jmv: pct(sumK(last7, "jmv"), sumK(first7, "jmv")),
  adsJmv: pct(sumK(last7, "adsJmv"), sumK(first7, "adsJmv")),
  organicJmv: pct(sumK(last7, "organicJmv"), sumK(first7, "organicJmv")),
  units: pct(sumK(last7, "units"), sumK(first7, "units")),
  adsOrders: pct(sumK(last7, "adsOrders"), sumK(first7, "adsOrders")),
  organicOrders: pct(
    sumK(last7, "organicOrders"),
    sumK(first7, "organicOrders"),
  ),
  spend: pct(sumK(last7, "spend"), sumK(first7, "spend")),
};

const maxJmvDay = Math.max(...combinedSeries.map((s) => s.jmv), 1);
const maxOrderDay = Math.max(...combinedSeries.map((s) => s.dealOrders), 1);

function shopSection(r) {
  const t = r.tot;
  const tr = r.trend;
  const maxJ = Math.max(...r.series.map((s) => s.jmv), 1);
  const maxO = Math.max(...r.series.map((s) => s.dealOrders), 1);
  const rows = r.series
    .map(
      (s) => `<tr>
    <td>${s.date.slice(5)}</td>
    <td class="num">${fmt(s.jmv)}</td>
    <td class="num ads">${fmt(s.adsJmv)}</td>
    <td class="num org">${fmt(s.organicJmv)}</td>
    <td>${stackedBarRow(s.adsJmv, s.organicJmv, maxJ)}</td>
    <td class="num">${fmt(s.units)}</td>
    <td class="num">${s.dealOrders}</td>
    <td class="num ads">${s.adsOrders}</td>
    <td class="num org">${s.organicOrders}</td>
    <td>${stackedBarRow(s.adsOrders, s.organicOrders, maxO)}</td>
    <td class="num">${fmt(s.spend)}</td>
    <td class="num">${s.roas == null ? "—" : s.roas}</td>
  </tr>`,
    )
    .join("");
  const topSales = r.topSkus
    .map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td>${s.partnerSku}</td><td class="num">${fmt(s.jmv)}</td><td class="num">${s.units}</td></tr>`,
    )
    .join("");
  const topAds = r.topAds
    .map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td>${s.partnerSku}</td><td class="num">${fmt(s.spend)}</td><td class="num ads">${fmt(s.revenue)}</td><td class="num">${s.orders}</td><td class="num">${s.roas ?? "—"}</td></tr>`,
    )
    .join("");
  return `
  <h2>${r.shop.name} <span class="muted">(${r.shop.id})</span></h2>
  <div class="split">
    <div class="panel total">
      <h3>总盘</h3>
      <div class="big">${fmt(t.jmv)} <span class="u">SAR JMV</span></div>
      <div class="sub">${fmt(t.units)} 件 · ${t.dealOrders} 成交单 · 后7 ${fmtPct(tr.jmv)}</div>
    </div>
    <div class="panel ads">
      <h3>广告归因</h3>
      <div class="big">${fmt(t.adsJmv)} <span class="u">SAR</span></div>
      <div class="sub">占 JMV ${t.adsJmvShare ?? "—"}% · ${t.adsOrders} 单（占成交 ${t.adsOrderShare ?? "—"}%）</div>
      <div class="sub">花费 ${fmt(t.spend)} · ROAS ${t.roas ?? "—"}${t.acos != null ? ` · ACOS ${t.acos}%` : ""} · 后7 JMV ${fmtPct(tr.adsJmv)}</div>
    </div>
    <div class="panel org">
      <h3>自然</h3>
      <div class="big">${fmt(t.organicJmv)} <span class="u">SAR</span></div>
      <div class="sub">占 JMV ${t.orgJmvShare ?? "—"}% · ${t.organicOrders} 单（占成交 ${t.orgOrderShare ?? "—"}%）</div>
      <div class="sub">后7 自然JMV ${fmtPct(tr.organicJmv)} · 后7 自然单 ${fmtPct(tr.organicOrders)}</div>
    </div>
  </div>
  <div class="sparks">
    <div><span class="lab">JMV 广告<span class="dot ads"></span>/自然<span class="dot org"></span></span>${dualSpark(r.series.map((s) => s.adsJmv), r.series.map((s) => s.organicJmv))}</div>
    <div><span class="lab">订单 广告<span class="dot ads"></span>/自然<span class="dot org"></span></span>${dualSpark(r.series.map((s) => s.adsOrders), r.series.map((s) => s.organicOrders))}</div>
    <div><span class="lab">总销量件数</span>${sparkSvg(r.series.map((s) => s.units), "#111")}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th rowspan="2">日期</th>
        <th colspan="4">JMV（SAR）</th>
        <th colspan="5">销量 / 订单</th>
        <th colspan="2">广告投入</th>
      </tr>
      <tr>
        <th>总</th><th class="ads">广告</th><th class="org">自然</th><th>结构</th>
        <th>件数</th><th>成交单</th><th class="ads">广告单</th><th class="org">自然单</th><th>结构</th>
        <th>花费</th><th>ROAS</th>
      </tr>
    </thead>
    <tbody>${rows}
    <tr class="tot">
      <td>合计</td>
      <td class="num">${fmt(t.jmv)}</td>
      <td class="num ads">${fmt(t.adsJmv)}</td>
      <td class="num org">${fmt(t.organicJmv)}</td>
      <td class="muted">${t.adsJmvShare ?? "—"}% / ${t.orgJmvShare ?? "—"}%</td>
      <td class="num">${fmt(t.units)}</td>
      <td class="num">${t.dealOrders}</td>
      <td class="num ads">${t.adsOrders}</td>
      <td class="num org">${t.organicOrders}</td>
      <td class="muted">${t.adsOrderShare ?? "—"}% / ${t.orgOrderShare ?? "—"}%</td>
      <td class="num">${fmt(t.spend)}</td>
      <td class="num">${t.roas ?? "—"}</td>
    </tr>
    </tbody>
  </table>
  <div class="cols">
    <div>
      <h3>总 JMV Top SKU</h3>
      <table><thead><tr><th>#</th><th>PSKU</th><th>JMV</th><th>件</th></tr></thead><tbody>${topSales}</tbody></table>
    </div>
    <div>
      <h3>广告归因 Top SKU（按花费）</h3>
      <table><thead><tr><th>#</th><th>PSKU</th><th>花费</th><th class="ads">归因JMV</th><th>单</th><th>ROAS</th></tr></thead><tbody>${topAds}</tbody></table>
    </div>
  </div>
  <p class="muted">有销量日 ${t.daysWithSales}/15 · 有单日广告日 ${t.daysWithAds}/15${
    r.multiDaySkipped
      ? ` · 跳过多日区间广告事实 ${r.multiDaySkipped} 条`
      : ""
  } · 销售同步 ${r.salesUpdated || "—"} · 广告同步 ${r.adsUpdated || "—"}</p>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>近15日 总/广告/自然 · JMV与销量</title>
<style>
  @page { size: A4; margin: 9mm; }
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif; color:#111; font-size:10px; line-height:1.4; margin:0; }
  h1 { font-size:16px; margin:0 0 2px; }
  h2 { font-size:12.5px; margin:14px 0 6px; padding-bottom:3px; border-bottom:1.5px solid #222; page-break-before: always; }
  h2:first-of-type { page-break-before: auto; }
  h3 { font-size:10.5px; margin:6px 0 4px; }
  .meta { color:#555; font-size:9px; margin-bottom:8px; }
  .verdict { background:#f3f4f6; border-left:4px solid #111; padding:8px 10px; margin:6px 0 10px; }
  .split { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin:6px 0 8px; }
  .panel { border:1px solid #ddd; padding:7px 9px; }
  .panel.ads { border-color:#d97706; background:#fffbeb; }
  .panel.org { border-color:#16a34a; background:#f0fdf4; }
  .panel h3 { margin:0 0 3px; font-size:10px; }
  .panel .big { font-size:14px; font-weight:700; }
  .panel .u { font-size:9px; font-weight:500; color:#555; }
  .panel .sub { font-size:8.5px; color:#444; margin-top:2px; }
  .sparks { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin:4px 0 8px; align-items:center; }
  .sparks .lab { display:block; color:#555; font-size:8.5px; margin-bottom:2px; }
  .dot { display:inline-block; width:7px; height:7px; border-radius:1px; margin:0 2px 0 4px; vertical-align:middle; }
  .dot.ads { background:#b45309; }
  .dot.org { background:#15803d; }
  table { width:100%; border-collapse:collapse; font-size:8.5px; margin:4px 0 6px; }
  th, td { border:1px solid #ddd; padding:2px 4px; text-align:left; vertical-align:middle; }
  th { background:#f5f5f5; font-weight:600; }
  th.ads, td.ads { color:#92400e; }
  th.org, td.org { color:#166534; }
  td.num { text-align:right; font-variant-numeric: tabular-nums; }
  tr.tot td { font-weight:700; background:#fafafa; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .muted { color:#666; font-size:8.5px; }
  .defs { font-size:8.5px; color:#444; margin-top:8px; }
  .defs li { margin-bottom:2px; }
  .legend { font-size:8.5px; margin:2px 0 6px; color:#444; }
  .bar { display:inline-flex; height:8px; vertical-align:middle; background:#eee; max-width:120px; }
  .bar-ads { display:inline-block; height:8px; background:#d97706; }
  .bar-org { display:inline-block; height:8px; background:#22c55e; }
  .bar-empty { color:#aaa; }
  .kpis-mini { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin:6px 0; }
  .kpi { border:1px solid #ddd; padding:5px 7px; }
  .kpi .lab { font-size:8px; color:#555; }
  .kpi .val { font-size:12px; font-weight:700; }
</style>
</head>
<body>
  <h1>近 15 日 · 总 / 广告 / 自然 · JMV 与销量</h1>
  <div class="meta">窗口 ${start} → ${end}（上海日历） · SAR · ${new Date().toISOString()} · HUI Beauty + HFY-KSA</div>
  <div class="legend"><span class="dot ads"></span>广告归因 &nbsp; <span class="dot org"></span>自然（总 − 广告） &nbsp; 结构条：橙=广告 / 绿=自然</div>

  <div class="split">
    <div class="panel total">
      <h3>两店 · 总盘</h3>
      <div class="big">${fmt(cTot.jmv)} <span class="u">SAR</span></div>
      <div class="sub">${fmt(cTot.units)} 件 · ${cTot.dealOrders} 成交单 · 后7 ${fmtPct(cTrend.jmv)}</div>
    </div>
    <div class="panel ads">
      <h3>两店 · 广告归因</h3>
      <div class="big">${fmt(cTot.adsJmv)} <span class="u">SAR</span></div>
      <div class="sub">占 JMV ${cTot.adsJmvShare ?? "—"}% · ${cTot.adsOrders} 单（${cTot.adsOrderShare ?? "—"}%）</div>
      <div class="sub">花费 ${fmt(cTot.spend)} · ROAS ${cTot.roas ?? "—"} · 后7 ${fmtPct(cTrend.adsJmv)}</div>
    </div>
    <div class="panel org">
      <h3>两店 · 自然</h3>
      <div class="big">${fmt(cTot.organicJmv)} <span class="u">SAR</span></div>
      <div class="sub">占 JMV ${cTot.orgJmvShare ?? "—"}% · ${cTot.organicOrders} 单（${cTot.orgOrderShare ?? "—"}%）</div>
      <div class="sub">后7 自然JMV ${fmtPct(cTrend.organicJmv)} · 后7 自然单 ${fmtPct(cTrend.organicOrders)}</div>
    </div>
  </div>

  <div class="sparks">
    <div><span class="lab">合计 JMV 广告<span class="dot ads"></span>/自然<span class="dot org"></span></span>${dualSpark(combinedSeries.map((s) => s.adsJmv), combinedSeries.map((s) => s.organicJmv))}</div>
    <div><span class="lab">合计订单 广告<span class="dot ads"></span>/自然<span class="dot org"></span></span>${dualSpark(combinedSeries.map((s) => s.adsOrders), combinedSeries.map((s) => s.organicOrders))}</div>
    <div><span class="lab">合计总销量件数</span>${sparkSvg(combinedSeries.map((s) => s.units), "#111")}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th rowspan="2">日期</th>
        <th colspan="4">JMV（SAR）</th>
        <th colspan="5">销量 / 订单</th>
        <th colspan="2">广告</th>
      </tr>
      <tr>
        <th>总</th><th class="ads">广告</th><th class="org">自然</th><th>结构</th>
        <th>件数</th><th>成交单</th><th class="ads">广告单</th><th class="org">自然单</th><th>结构</th>
        <th>花费</th><th>ROAS</th>
      </tr>
    </thead>
    <tbody>
      ${combinedSeries
        .map(
          (s) => `<tr>
        <td>${s.date.slice(5)}</td>
        <td class="num">${fmt(s.jmv)}</td>
        <td class="num ads">${fmt(s.adsJmv)}</td>
        <td class="num org">${fmt(s.organicJmv)}</td>
        <td>${stackedBarRow(s.adsJmv, s.organicJmv, maxJmvDay)}</td>
        <td class="num">${fmt(s.units)}</td>
        <td class="num">${s.dealOrders}</td>
        <td class="num ads">${s.adsOrders}</td>
        <td class="num org">${s.organicOrders}</td>
        <td>${stackedBarRow(s.adsOrders, s.organicOrders, maxOrderDay)}</td>
        <td class="num">${fmt(s.spend)}</td>
        <td class="num">${s.roas ?? "—"}</td>
      </tr>`,
        )
        .join("")}
      <tr class="tot">
        <td>合计</td>
        <td class="num">${fmt(cTot.jmv)}</td>
        <td class="num ads">${fmt(cTot.adsJmv)}</td>
        <td class="num org">${fmt(cTot.organicJmv)}</td>
        <td class="muted">${cTot.adsJmvShare ?? "—"}% / ${cTot.orgJmvShare ?? "—"}%</td>
        <td class="num">${fmt(cTot.units)}</td>
        <td class="num">${cTot.dealOrders}</td>
        <td class="num ads">${cTot.adsOrders}</td>
        <td class="num org">${cTot.organicOrders}</td>
        <td class="muted">${cTot.adsOrderShare ?? "—"}% / ${cTot.orgOrderShare ?? "—"}%</td>
        <td class="num">${fmt(cTot.spend)}</td>
        <td class="num">${cTot.roas ?? "—"}</td>
      </tr>
    </tbody>
  </table>

  ${shopReports.map(shopSection).join("")}

  <div class="defs">
    <strong>口径（与看板一致）</strong>
    <ul>
      <li><b>总 JMV</b> = salesFacts.amount；<b>广告 JMV</b> = adsFacts.revenue（单日 from=to）；<b>自然 JMV</b> = max(0, 总 − 广告)</li>
      <li><b>成交单</b> = orders 按下单日去重（排除取消类）；<b>广告单</b> = adsFacts.orders；<b>自然单</b> = max(0, 成交单 − 广告单)</li>
      <li><b>件数</b> = salesFacts.units（平台销售报表件数；广告侧无件数字段，故不做件数三分）</li>
      <li>无单日广告的日期：广告列=0，自然≈总（可能高估自然，因广告未覆盖）</li>
      <li>后7 vs 前7：第 9–15 日相对第 1–7 日（跳过第 8 日）</li>
    </ul>
  </div>
</body>
</html>`;

const desktop = path.join(homedir(), "Desktop");
const stamp = today.replace(/-/g, "");
const htmlPath = path.join(desktop, "_tmp_15d_jmv_ads.html");
const pdfPath = path.join(
  desktop,
  `Outpost_近15日_总广告自然_JMV销量_${stamp}.pdf`,
);
const jsonPath = path.join(
  desktop,
  `Outpost_近15日_总广告自然_JMV销量_${stamp}.json`,
);

fs.writeFileSync(htmlPath, html, "utf8");
fs.writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      start,
      end,
      generatedAt: new Date().toISOString(),
      definitions: {
        totalJmv: "salesFacts.amount",
        adsJmv: "adsFacts.revenue (exact day)",
        organicJmv: "max(0, totalJmv - adsJmv)",
        dealOrders: "orders unique by placedAt day, exclude cancel",
        adsOrders: "adsFacts.orders",
        organicOrders: "max(0, dealOrders - adsOrders)",
        units: "salesFacts.units",
      },
      combined: { series: combinedSeries, tot: cTot, trend: cTrend },
      shops: shopReports.map((r) => ({
        shop: r.shop,
        tot: r.tot,
        trend: r.trend,
        series: r.series,
        topSkus: r.topSkus,
        topAds: r.topAds,
        multiDaySkipped: r.multiDaySkipped,
      })),
    },
    null,
    2,
  ),
  "utf8",
);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), {
  waitUntil: "load",
});
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  margin: { top: "9mm", bottom: "9mm", left: "9mm", right: "9mm" },
});
await browser.close();
try {
  fs.unlinkSync(htmlPath);
} catch {
  /* ignore */
}

console.log(
  JSON.stringify(
    {
      pdfPath,
      jsonPath,
      start,
      end,
      combined: cTot,
      trend: cTrend,
      shops: shopReports.map((r) => ({
        id: r.shop.id,
        name: r.shop.name,
        tot: {
          jmv: r.tot.jmv,
          adsJmv: r.tot.adsJmv,
          organicJmv: r.tot.organicJmv,
          adsJmvShare: r.tot.adsJmvShare,
          orgJmvShare: r.tot.orgJmvShare,
          dealOrders: r.tot.dealOrders,
          adsOrders: r.tot.adsOrders,
          organicOrders: r.tot.organicOrders,
          adsOrderShare: r.tot.adsOrderShare,
          units: r.tot.units,
          spend: r.tot.spend,
          roas: r.tot.roas,
        },
        trend: r.trend,
      })),
    },
    null,
    2,
  ),
);
