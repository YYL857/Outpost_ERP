import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type AdsWindow,
  type CatalogProvenance,
  type CatalogRow,
  type ProvenanceSlice,
  type SalesWindow,
} from "../api";

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function num(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits);
}

function money(n: number | null | undefined, suffix = "") {
  if (n == null) return "—";
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return suffix ? `${s} ${suffix}` : s;
}

async function copyText(text: string) {
  const t = text.trim();
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    /* ignore */
  }
}

function CopyId({ label, value }: { label: string; value: string }) {
  return (
    <span className="cat-id-chip">
      <span>
        {label} {value}
      </span>
      <button
        type="button"
        className="cat-copy-btn"
        title={`复制 ${label}`}
        onClick={() => void copyText(value)}
      >
        复制
      </button>
    </span>
  );
}

function roasText(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}x`;
}

function replenishLabel(status: string) {
  if (status === "urgent") return { text: "紧急", cls: "cat-pill danger" };
  if (status === "stable") return { text: "稳定", cls: "cat-pill ok" };
  if (status === "skip") return { text: "跳过", cls: "cat-pill idle" };
  return { text: "未知", cls: "cat-pill idle" };
}

function marginClass(margin: number | null | undefined) {
  if (margin == null) return "cat-pill idle";
  if (margin >= 0.3) return "cat-pill ok";
  if (margin > 0) return "cat-pill warn";
  return "cat-pill danger";
}

/** 数据越齐分越高：官方 Catalog + 本地齐 + 费用/利润/规格有数 → 排前面 */
function completenessScore(r: CatalogRow): number {
  let s = 0;
  if (r.listingType !== "orphan") s += 100;
  if (r.local?.align === "matched") s += 50;
  else if (r.local?.align === "partial") s += 25;
  if ((r.specs?.purchaseCost ?? 0) > 0) s += 15;
  if ((r.specs?.weightKg ?? 0) > 0 || (r.specs?.volumeCm3 ?? 0) > 0) s += 10;
  if ((r.fees?.commissionRate ?? 0) > 0 || (r.fees?.outboundFee ?? 0) > 0) s += 15;
  if (r.profit?.sar != null) s += 20;
  if (r.imageUrl) s += 5;
  if (r.price > 0) s += 5;
  if (r.ads?.d7?.hasData || r.ads?.latest?.hasData) s += 5;
  if ((r.sales?.d7?.units ?? 0) > 0) s += 5;
  if (r.isActive) s += 3;
  return s;
}

function roasClass(roas: number | null | undefined) {
  if (roas == null) return "cat-pill idle";
  if (roas >= 3) return "cat-pill ok";
  if (roas >= 1) return "cat-pill warn";
  return "cat-pill danger";
}

function adsPrimary(r: CatalogRow): AdsWindow | undefined {
  if (r.ads?.d7?.hasData) return r.ads.d7;
  if (r.ads?.latest?.hasData) return r.ads.latest;
  return r.ads?.d7;
}

function adsTip(r: CatalogRow, provenance?: CatalogProvenance | null): string {
  const latest = r.ads?.latest;
  const range =
    latest?.fromDate && latest?.toDate
      ? `${latest.fromDate} → ${latest.toDate}`
      : provenance?.domains.ads.reportFrom && provenance.domains.ads.reportTo
        ? `${provenance.domains.ads.reportFrom} → ${provenance.domains.ads.reportTo}`
        : "区间未知";
  const file = provenance?.domains.ads.fileName ?? "文件未知";
  const path = provenance?.domains.ads.filePath ?? "";
  if (!r.ads?.d7?.hasData && !r.ads?.latest?.hasData) {
    return `无广告匹配 · 来源 影刀昨日 · 报表 ${range} · ${file}${path ? `\n${path}` : ""}`;
  }
  return `影刀广告·昨日 · 报表 ${range} · ${file}${path ? `\n${path}` : ""}\n仅昨日报时，列内 ROAS≈昨日（非 7 日累计广告）`;
}

function shortIso(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function sliceByKey(
  p: CatalogProvenance | null | undefined,
  key: string,
): ProvenanceSlice | undefined {
  return p?.slices?.find((s) => s.key === key);
}

function sliceTitle(
  p: CatalogProvenance | null | undefined,
  ...keys: string[]
): string | undefined {
  const lines = keys
    .map((key) => sliceByKey(p, key))
    .filter((s): s is ProvenanceSlice => Boolean(s))
    .map((s) => {
      const when = s.syncedAt ? shortIso(s.syncedAt) : "未知";
      const today = s.syncedToday ? "今天已入库" : "不是今天入库";
      return `${s.column}｜来源 ${s.source}｜${s.dataNode}｜入库 ${when}｜${today}`;
    });
  return lines.length ? lines.join("\n") : undefined;
}

function ProvenanceBoard({ p }: { p: CatalogProvenance }) {
  const slices = p.slices ?? [];
  if (!slices.length) return null;
  const synced = slices.filter((s) => s.syncedToday);
  const older = slices.filter((s) => !s.syncedToday);
  return (
    <section className="cat-prov-board">
      <div className="cat-prov-head">
        <strong>数据时效</strong>
        <span>今天 {p.today ?? "—"}</span>
      </div>
      <p className="cat-prov-lead">
        同一行商品把下面几份数据拼在一起。数据时间节点是数字代表的业务日，入库时间是写进本系统的时间，两者可以不是同一天。
      </p>
      <div className="cat-prov-summary">
        <span className="cat-prov-chip ok">
          今天已入库
          {synced.length ? `：${synced.map((s) => s.column).join("、")}` : "：无"}
        </span>
        <span className="cat-prov-chip idle">
          不是今天
          {older.length ? `：${older.map((s) => s.column).join("、")}` : "：无"}
        </span>
      </div>
      <div className="cat-prov-table-wrap">
        <table className="cat-prov-table">
          <thead>
            <tr>
              <th>页面栏目</th>
              <th>来源</th>
              <th>数据时间节点</th>
              <th>入库时间</th>
              <th>今天</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.key} className={s.stale ? "stale" : undefined}>
                <td>{s.column}</td>
                <td>
                  {s.source}
                  <span className="muted"> · {s.count} 条</span>
                </td>
                <td>{s.dataNode}</td>
                <td title={s.note}>{s.syncedAt ? shortIso(s.syncedAt) : "—"}</td>
                <td>
                  <span className={`cat-prov-flag ${s.syncedToday ? "ok" : "idle"}`}>
                    {s.syncedToday ? "已入库" : "不是今天"}
                  </span>
                  {s.stale ? <span className="cat-prov-flag danger">过旧</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  title,
}: {
  label: string;
  value: string | number;
  title?: string;
}) {
  return (
    <div className="cat-metric" title={title}>
      <span className="cat-metric-label">{label}</span>
      <span className="cat-metric-value">{value}</span>
    </div>
  );
}

/** 每个窗口固定三列：销量(件) · 销售额 · 日均销量 */
function SaleWindowRow({ label, w }: { label: string; w?: SalesWindow }) {
  const units = w ? String(w.units) : "—";
  const amount = w ? num(w.amount) : "—";
  const avg = w ? num(w.dailyAvg) : "—";
  return (
    <div
      className="cat-sale"
      title={`${label}：销量 ${units} 件，销售额 ${amount}（窗口内成交额，不是商品栏的单件售价），日均 ${avg} 件`}
    >
      <span className="cat-sale-win">{label}</span>
      <span className="cat-sale-kv">
        <span className="cat-sale-k">销量</span>
        <span className="cat-sale-v">{units}</span>
      </span>
      <span className="cat-sale-kv">
        <span className="cat-sale-k">销售额</span>
        <span className="cat-sale-v">{amount}</span>
      </span>
      <span className="cat-sale-kv">
        <span className="cat-sale-k">日均</span>
        <span className="cat-sale-v">{avg}</span>
      </span>
    </div>
  );
}

function ProductThumb({ url, title }: { url: string; title: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return <div className="cat-thumb cat-thumb-empty" title="暂无图片">!</div>;
  }
  return (
    <img
      className="cat-thumb"
      src={url}
      alt={title || "product"}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

function alignLabel(align: string | undefined) {
  if (align === "matched") return { text: "本地齐", cls: "cat-tag ok" };
  if (align === "partial") return { text: "本地缺半", cls: "cat-tag warn" };
  return { text: "缺本地", cls: "cat-tag idle" };
}

export function CatalogPage() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [hint, setHint] = useState("");
  const [q, setQ] = useState("");
  const [onlyFbn, setOnlyFbn] = useState(false);
  const [onlyAds, setOnlyAds] = useState(false);
  const [onlyMissingLocal, setOnlyMissingLocal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [alignMeta, setAlignMeta] = useState<{
    matched: number;
    partial: number;
    missing: number;
    costRows: number;
    dimsRows: number;
  } | null>(null);
  const [provenance, setProvenance] = useState<CatalogProvenance | null>(null);
  const [buybackRate, setBuybackRate] = useState<number | null>(null);

  async function load() {
    const res = await api.getCatalog();
    setRows(res.data);
    setAlignMeta(res.meta?.localAlign ?? null);
    setProvenance(res.meta?.provenance ?? null);
    return res.data;
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    setHint("刷新中…");
    try {
      const data = await load();
      try {
        const ship = await api.getShipping();
        setBuybackRate(ship.data.buybackRate);
      } catch {
        /* ignore */
      }
      setHint(
        `已刷新 ${new Date().toLocaleTimeString()} · ${data.length} 行（完整度高的在前）`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "刷新失败");
      setHint("");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load()
      .then(async (data) => {
        try {
          const ship = await api.getShipping();
          setBuybackRate(ship.data.buybackRate);
        } catch {
          /* ignore */
        }
        const missing = data.filter((r) => !r.imageUrl).length;
        if (data.length > 0 && missing === data.length) {
          setHint("Catalog 导出不含图片，正在用 Content API 补图…");
          setEnriching(true);
          try {
            const res = await api.enrichCatalogImages({ onlyMissing: true });
            setHint(res.message ?? res.data.message);
            await load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "补图失败");
          } finally {
            setEnriching(false);
          }
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function assemblySync() {
    setSyncing(true);
    setError("");
    setHint("汇总同步中（Noon → 影刀广告入库 → 飞书）…");
    try {
      const res = await api.assemblySync();
      const stages = res.data.stages
        ?.filter((s) => !s.skipped)
        .map((s) => `${s.name}:${s.ok ? "ok" : "fail"}`)
        .join(" · ");
      const align = res.data.localAlign
        ? ` · 成本对齐 ${res.data.localAlign.matchedCost}/${res.data.localAlign.catalogCount}`
        : "";
      const ads = res.data.adsProvenance;
      const adsHint = ads
        ? ` · 广告 ${ads.label}${ads.reportFrom ? ` ${ads.reportFrom}→${ads.reportTo}` : ""}${ads.fileName ? ` · ${ads.fileName}` : ""} · facts ${res.data.adsFacts ?? ads.factsCount ?? 0}`
        : res.data.adsFacts != null
          ? ` · adsFacts ${res.data.adsFacts}`
          : "";
      setHint(
        `${res.message ?? res.data.message}${stages ? ` · ${stages}` : ""}${align}${adsHint}`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "汇总同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function noonOnlySync() {
    setSyncing(true);
    setError("");
    setHint("仅同步 Noon…");
    try {
      const res = await api.autoSync({ skipSop: false });
      setHint(res.message ?? res.data.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noon 同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function enrichImages() {
    setEnriching(true);
    setError("");
    setHint("补图中…");
    try {
      const res = await api.enrichCatalogImages({ onlyMissing: true });
      setHint(res.message ?? res.data.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "补图失败");
    } finally {
      setEnriching(false);
    }
  }

  async function ingestFeishuLocal() {
    setIngesting(true);
    setError("");
    setHint("正在按 PSKU 入库飞书本地成本/尺寸…");
    try {
      const res = await api.ingestFeishuLocal();
      setHint(res.message ?? "飞书本地域已入库");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "飞书本地入库失败");
    } finally {
      setIngesting(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (onlyFbn && (r.inventory?.fbn ?? 0) <= 0) return false;
      if (onlyAds && !r.ads?.d7?.hasData && !r.ads?.latest?.hasData) return false;
      if (onlyMissingLocal && r.local?.align === "matched") return false;
      if (!needle) return true;
      return (
        r.partnerSku.toLowerCase().includes(needle) ||
        r.noonSku?.toLowerCase().includes(needle) ||
        r.title.toLowerCase().includes(needle)
      );
    });
    return list.sort((a, b) => {
      const d = completenessScore(b) - completenessScore(a);
      if (d !== 0) return d;
      return a.partnerSku.localeCompare(b.partnerSku);
    });
  }, [rows, q, onlyFbn, onlyAds, onlyMissingLocal]);

  const withImage = rows.filter((r) => Boolean(r.imageUrl)).length;
  const withAds = rows.filter(
    (r) => r.ads?.d7?.hasData || r.ads?.latest?.hasData,
  ).length;

  return (
    <div>
      <h1 className="page-title">Catalog 产品库</h1>
      <p className="page-desc">
        以 PSKU 对齐汇总：Noon（价/库/销/费）+ 影刀广告（默认昨日）+ 飞书（成本/尺寸）。
        列表按数据完整度排序。币种：售价/佣金/出仓/税费/利润为 SAR；采购价/头程为 RMB。
        税费=(出仓+佣金)×1.15；利润 RMB 需在首页配置「回购汇率」。
      </p>
      {provenance ? <ProvenanceBoard p={provenance} /> : null}
      <div className="row" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          type="button"
          disabled={syncing || ingesting}
          onClick={assemblySync}
        >
          {syncing ? "汇总同步中…" : "汇总同步"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={syncing || ingesting}
          onClick={noonOnlySync}
        >
          仅 Noon
        </button>
        <button
          className="btn"
          type="button"
          disabled={enriching || syncing || ingesting}
          onClick={enrichImages}
        >
          {enriching ? "补图中…" : "补全图片"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={ingesting || syncing}
          onClick={ingestFeishuLocal}
        >
          {ingesting ? "入库中…" : "入库飞书本地"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={refreshing || syncing || enriching || ingesting}
          onClick={() => void refresh()}
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
        <input
          className="input"
          style={{ minWidth: 220, flex: "1 1 220px" }}
          placeholder="搜索 PSKU / SKU / 标题"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="cat-check">
          <input
            type="checkbox"
            checked={onlyFbn}
            onChange={(e) => setOnlyFbn(e.target.checked)}
          />
          FBN 库存 &gt; 0
        </label>
        <label className="cat-check">
          <input
            type="checkbox"
            checked={onlyAds}
            onChange={(e) => setOnlyAds(e.target.checked)}
          />
          有广告数据
        </label>
        <label className="cat-check">
          <input
            type="checkbox"
            checked={onlyMissingLocal}
            onChange={(e) => setOnlyMissingLocal(e.target.checked)}
          />
          缺本地成本/尺寸
        </label>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {filtered.length}/{rows.length} 行 · 有图 {withImage} · 有广告 {withAds}
          {rows.some((r) => r.listingType === "orphan")
            ? ` · 含未在线 ${rows.filter((r) => r.listingType === "orphan").length}`
            : ""}
          {alignMeta
            ? ` · 本地齐 ${alignMeta.matched} / 缺半 ${alignMeta.partial} / 缺 ${alignMeta.missing}`
            : ""}
        </span>
      </div>
      {buybackRate != null && buybackRate <= 0 ? (
        <p style={{ color: "var(--danger)", marginTop: 8 }}>
          首页「回购汇率」未配置（当前 0）：利润可出 SAR（未扣人民币采购/头程），RMB
          利润与扣采需先填写汇率后再刷新。{" "}
          <Link to="/">去首页填写</Link>
        </p>
      ) : null}
      {hint && <p className="muted">{hint}</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="card cat-table-wrap">
        <table className="table cat-table">
          <thead>
            <tr>
              <th style={{ minWidth: 280 }} title={sliceTitle(provenance, "price")}>
                商品信息
                <div className="cat-th-sub">售价来自 Noon Catalog</div>
              </th>
              <th style={{ minWidth: 120 }} title={sliceTitle(provenance, "stock")}>
                库存
                <div className="cat-th-sub">Noon 库存快照</div>
              </th>
              <th style={{ minWidth: 280 }} title={sliceTitle(provenance, "sales")}>
                近 3 / 7 / 14 / 30 日
                <div className="cat-th-sub">每行：销量(件) · 销售额 · 日均销量</div>
              </th>
              <th
                style={{ minWidth: 210 }}
                title={
                  [
                    sliceTitle(provenance, "ads"),
                    provenance?.domains.ads.filePath,
                  ]
                    .filter(Boolean)
                    .join("\n") || "影刀导出昨日广告"
                }
              >
                广告投产
                <div className="cat-th-sub">影刀 · 默认昨日报表</div>
              </th>
              <th style={{ minWidth: 160 }} title={sliceTitle(provenance, "sales")}>
                补货计划
                <div className="cat-th-sub">日均取近 7 日销量</div>
              </th>
              <th
                style={{ minWidth: 170 }}
                title={sliceTitle(provenance, "fees", "shipping", "cost")}
              >
                费用
                <div className="cat-th-sub">平台费 + 本地头程</div>
              </th>
              <th
                style={{ minWidth: 120 }}
                title={sliceTitle(provenance, "price", "fees", "shipping", "cost")}
              >
                毛利
                <div className="cat-th-sub">
                  {buybackRate != null && buybackRate <= 0
                    ? "缺汇率·未扣采"
                    : "售价减费用、头程、采购"}
                </div>
              </th>
              <th style={{ minWidth: 140 }} title={sliceTitle(provenance, "dims", "cost")}>
                规格
                <div className="cat-th-sub">飞书尺寸 · 采购价</div>
              </th>
              <th style={{ minWidth: 120 }} title="这一行自己的售价、成本和尺寸写入时间">
                本行时间
                <div className="cat-th-sub">售价 / 成本 / 尺寸</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  暂无数据。请先「汇总同步」（影刀昨日广告须已落入本店 portal-imports）。
                  广告文件示例：ads_sku_2026-09-16_2026-09-16.csv。
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const rep = replenishLabel(r.replenish?.status ?? "unknown");
              const primaryAds = adsPrimary(r);
              const localAlign = alignLabel(r.local?.align);
              const dims =
                r.specs?.lengthCm || r.specs?.widthCm || r.specs?.heightCm
                  ? `${num(r.specs.lengthCm, 1)}×${num(r.specs.widthCm, 1)}×${num(r.specs.heightCm, 1)}`
                  : "—";
              const freightLabel =
                (r.fees?.freightMode ?? "air") === "sea" ? "海运" : "空运";
              return (
                <tr key={r.partnerSku}>
                  <td>
                    <div className="cat-product">
                      <ProductThumb url={r.imageUrl} title={r.title} />
                      <div className="cat-product-body">
                        <div className="cat-title" title={r.title}>
                          {r.title || "—"}
                        </div>
                        <div className="cat-ids">
                          <CopyId label="PSKU" value={r.partnerSku} />
                          {r.noonSku ? (
                            <CopyId label="SKU" value={r.noonSku} />
                          ) : null}
                        </div>
                        <div className="cat-price-row">
                          <span
                            className="cat-price"
                            title={
                              r.priceUpdatedAt
                                ? `售价：当前单件标价，不是近窗销售额。官方 Catalog · ${r.priceSource ?? "noon:catalog"} · ${r.priceUpdatedAt}`
                                : "售价：当前单件标价，不是近 3/7/14/30 日销售额"
                            }
                          >
                            <span className="cat-sale-k">售价</span>{" "}
                            {r.price > 0 ? money(r.price, r.currency) : "—"}
                          </span>
                          <span className={`cat-tag ${r.isActive ? "ok" : "idle"}`}>
                            {r.isActive ? "在售" : "下架"}
                          </span>
                          {r.listingType === "orphan" ? (
                            <span
                              className="cat-tag idle"
                              title="有销量/费用/飞书数据，但不在 Noon live Catalog 导出中"
                            >
                              未在线Catalog
                            </span>
                          ) : r.listingType ? (
                            <span className="cat-tag idle">{r.listingType}</span>
                          ) : null}
                          {r.source ? <span className="cat-tag idle">{r.source}</span> : null}
                          <span className={localAlign.cls} title={r.local?.costSource ?? ""}>
                            {localAlign.text}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cat-stack">
                      <Metric label="FBN" value={r.inventory?.fbn ?? 0} />
                      <Metric label="FBP" value={r.inventory?.fbp ?? 0} />
                      <Metric label="在途" value={r.inventory?.inTransit ?? 0} />
                      <Metric label="合计" value={r.inventory?.total ?? r.stockQty ?? 0} />
                    </div>
                  </td>
                  <td>
                    <div className="cat-stack cat-stack-tight">
                      <SaleWindowRow label="3日" w={r.sales?.d3} />
                      <SaleWindowRow label="7日" w={r.sales?.d7} />
                      <SaleWindowRow label="14日" w={r.sales?.d14} />
                      <SaleWindowRow label="30日" w={r.sales?.d30} />
                    </div>
                  </td>
                  <td title={adsTip(r, provenance)}>
                    <div className="cat-stack cat-ads">
                      <div
                        className="cat-metric"
                        title="投产比 ROAS = 广告销售额 ÷ 广告花费。有近 7 日广告时用 7 日，否则用最近一次报表（通常是昨日）"
                      >
                        <span className="cat-metric-label">投产比</span>
                        <span className={roasClass(primaryAds?.roas)}>
                          {roasText(primaryAds?.roas)}
                        </span>
                      </div>
                      <Metric
                        label="广告花费"
                        title="影刀报表中的广告花费"
                        value={primaryAds?.hasData ? money(primaryAds.spend) : "—"}
                      />
                      <Metric
                        label="广告销售额"
                        title="广告带来的销售额，不是商品总 GMV"
                        value={primaryAds?.hasData ? money(primaryAds.revenue) : "—"}
                      />
                      <Metric
                        label="ACOS"
                        title="广告成本占销售额 = 广告花费 ÷ 广告销售额；没有销售额时为空"
                        value={primaryAds?.acos != null ? pct(primaryAds.acos) : "—"}
                      />
                      <Metric
                        label="7日投产"
                        title="近 7 日窗口的投产比。只有昨日广告时，通常与上方投产比相同"
                        value={r.ads?.d7?.hasData ? roasText(r.ads.d7.roas) : "—"}
                      />
                      <Metric
                        label="广告净利"
                        title="广告销售额 − 广告花费。优先近 7 日，没有则用最近一次报表"
                        value={
                          r.profit?.adsNet7d != null ? money(r.profit.adsNet7d) : "—"
                        }
                      />
                    </div>
                  </td>
                  <td>
                    <div className="cat-stack">
                      <span className={rep.cls}>{rep.text}</span>
                      <Metric
                        label="可售"
                        value={
                          r.replenish?.availableDays != null
                            ? `${num(r.replenish.availableDays)}天`
                            : "—"
                        }
                      />
                      <Metric label="安全" value={`${r.replenish?.safetyDays ?? "—"}天`} />
                      <Metric label="日均" value={num(r.replenish?.dailyAvg)} />
                      <Metric label="空运周期" value={`${r.replenish?.airLeadDays ?? "—"}天`} />
                      <Metric label="海运周期" value={`${r.replenish?.seaLeadDays ?? "—"}天`} />
                    </div>
                  </td>
                  <td>
                    <div className="cat-stack cat-stack-tight">
                      <Metric
                        label="头程"
                        value={money(r.fees?.headhaul, "RMB")}
                      />
                      {(r.fees?.freightEst ?? 0) > 0 ? (
                        <Metric
                          label={freightLabel}
                          value={money(r.fees?.freightEst, "SAR")}
                        />
                      ) : (
                        <Metric label="方式" value={freightLabel} />
                      )}
                      <Metric
                        label="佣金"
                        value={`${pct(r.fees?.commissionRate)} / ${money(r.fees?.commissionAmount, "SAR")}`}
                      />
                      <Metric
                        label="税费"
                        value={money(r.fees?.taxAmount, "SAR")}
                      />
                      <Metric
                        label="出仓"
                        value={money(r.fees?.outboundFee, "SAR")}
                      />
                      <Metric
                        label="合计"
                        value={money(r.fees?.total, "SAR")}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="cat-stack">
                      <span className={marginClass(r.profit?.margin)}>
                        {pct(r.profit?.margin)}
                      </span>
                      <Metric
                        label="毛利"
                        value={
                          r.profit?.sar != null
                            ? money(r.profit.sar, "SAR")
                            : "—"
                        }
                      />
                      <Metric
                        label="毛利 RMB"
                        value={
                          r.profit?.rmb != null
                            ? money(r.profit.rmb, "RMB")
                            : buybackRate != null && buybackRate <= 0
                              ? "缺汇率"
                              : "—"
                        }
                      />
                    </div>
                  </td>
                  <td>
                    <div className="cat-stack cat-stack-tight">
                      <Metric
                        label="重量"
                        value={r.specs?.weightKg ? `${num(r.specs.weightKg)} kg` : "—"}
                      />
                      <Metric label="尺寸" value={dims} />
                      <Metric
                        label="体积"
                        value={
                          (r.specs?.volumeCm3 ?? 0) > 0
                            ? `${num(r.specs?.volumeCm3)} cm³`
                            : "—"
                        }
                      />
                      <Metric
                        label="计费重"
                        value={
                          (r.specs?.chargeableWeightKg ?? 0) > 0
                            ? `${num(r.specs?.chargeableWeightKg)} kg`
                            : "—"
                        }
                      />
                      <Metric
                        label="采购价"
                        value={
                          (r.specs?.purchaseCost ?? 0) > 0
                            ? money(r.specs?.purchaseCost, "RMB")
                            : "—"
                        }
                      />
                    </div>
                  </td>
                  <td className="muted cat-date">
                    <div className="cat-stack cat-stack-tight">
                      <Metric label="售价" value={shortIso(r.updatedAt)} />
                      <Metric label="成本" value={shortIso(r.local?.costUpdatedAt)} />
                      <Metric label="尺寸" value={shortIso(r.local?.dimsUpdatedAt)} />
                      <Metric
                        label="尺寸来源"
                        value={r.local?.dimsSource ? String(r.local.dimsSource) : "—"}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
