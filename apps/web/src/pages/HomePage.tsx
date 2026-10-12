import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DashboardOverview } from "../api";
import { DataFreshnessBanner } from "../components/DataFreshnessBanner";

function fmtSar(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) {
    return `SAR ${(n / 1000).toFixed(n >= 10000 ? 1 : 2)}K`;
  }
  return `SAR ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtInt(n: number) {
  return n.toLocaleString("en-US");
}

function Trend({ pct }: { pct: number | null | undefined }) {
  if (pct == null || !Number.isFinite(pct)) {
    return <span className="dash-trend is-flat">较上日 —</span>;
  }
  const up = pct > 0;
  const flat = pct === 0;
  return (
    <span
      className={`dash-trend${flat ? " is-flat" : up ? " is-up" : " is-down"}`}
    >
      {flat ? "→" : up ? "↑" : "↓"} {Math.abs(pct).toFixed(2)}%
      <em>较上日</em>
    </span>
  );
}

function SparkBars({
  values,
  labels,
  formatValue,
  accent = false,
}: {
  values: number[];
  labels?: string[];
  formatValue?: (n: number) => string;
  accent?: boolean;
}) {
  const max = Math.max(1, ...values);
  const [tip, setTip] = useState<{
    i: number;
    x: number;
    y: number;
  } | null>(null);

  return (
    <div
      className={`dash-spark${accent ? " is-accent" : ""}`}
      onMouseLeave={() => setTip(null)}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className={tip?.i === i ? "is-hot" : undefined}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const parent = e.currentTarget.parentElement?.getBoundingClientRect();
            if (!parent) return;
            setTip({
              i,
              x: rect.left - parent.left + rect.width / 2,
              y: 0,
            });
          }}
        />
      ))}
      {tip && (
        <div
          className="dash-spark-tip"
          style={{ left: tip.x }}
          role="tooltip"
        >
          <strong>{labels?.[tip.i] ?? `#${tip.i + 1}`}</strong>
          <span>
            {(formatValue ?? String)(values[tip.i] ?? 0)}
          </span>
        </div>
      )}
    </div>
  );
}

function confLabel(c: DashboardOverview["confidence"]) {
  if (c === "high") return "高置信";
  if (c === "medium") return "中置信";
  return "低置信";
}

export function HomePage() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const res = await api.getDashboardOverview();
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const seriesAmounts = useMemo(
    () => data?.sales.series.map((d) => d.amount) ?? [],
    [data],
  );
  const seriesUnits = useMemo(
    () => data?.sales.series.map((d) => d.units) ?? [],
    [data],
  );

  if (loading && !data) {
    return (
      <div className="page">
        <p className="muted">加载数据看板…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page">
        <p style={{ color: "var(--danger)" }}>{error}</p>
        <button type="button" className="btn" onClick={() => void refresh()}>
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const s = data.sales;
  const ads = data.ads;

  return (
    <div className="page dash-page">
      <div className="page-header dash-page-header">
        <div>
          <h1>数据看板</h1>
          <p className="muted">
            {data.shop.name || data.shop.projectCode} · 主营收口径{" "}
            <strong>salesFacts</strong>（与销量统计一致）· 最新销售日{" "}
            {s.latestDate ?? "—"}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className={`dash-conf dash-conf-${data.confidence}`}>
            {confLabel(data.confidence)}
          </span>
          <Link className="btn" to="/ticket-ledger">
            票货台账
          </Link>
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>

      <DataFreshnessBanner compact />

      {data.caveats.length > 0 && (
        <details className="dash-caveats">
          <summary>口径注意 · {data.caveats.length} 条</summary>
          {data.caveats.map((c) => (
            <p key={c}>{c}</p>
          ))}
        </details>
      )}

      <section className="dash-hero-grid">
        <article className="dash-card dash-card-sales">
          <div className="dash-card-top">
            <h3>销售额</h3>
            <Trend pct={s.vsPreviousPct.amount} />
          </div>
          <p className="dash-metric">{fmtSar(s.latest.amount)}</p>
          <p className="dash-sub">
            累计 {fmtSar(s.totalAmount)} · {fmtInt(s.totalUnits)} 件 ·{" "}
            {s.skuCount} SKU
          </p>
          <SparkBars
            values={seriesAmounts}
            labels={s.series.map((d) => d.date)}
            formatValue={(n) => fmtSar(n)}
            accent
          />
          <p className="dash-axis muted">
            近 30 日 · {s.series[0]?.date ?? ""} →{" "}
            {s.series[s.series.length - 1]?.date ?? ""}
          </p>
        </article>

        <article className="dash-card">
          <div className="dash-card-top">
            <h3>广告归因（昨日）</h3>
            <Link className="dash-link" to="/ads">
              广告管理
            </Link>
          </div>
          <p className="dash-metric">
            {ads.roas != null ? `${ads.roas}x` : "—"}
            <span className="dash-metric-unit">投产比</span>
          </p>
          <p className="dash-sub">
            花费 {fmtSar(ads.spend)} · 带来收益 {fmtSar(ads.revenue)}
            {ads.contributionPct != null
              ? ` · 占昨日销售 ${ads.contributionPct}%`
              : ""}
          </p>
          <p className="dash-hint muted">
            {ads.scope === "none" || (!ads.reportFrom && !ads.date)
              ? "暂无昨日广告报表"
              : ads.scope === "covering"
                ? `${ads.date ?? ads.reportFrom} · 区间覆盖估算（非单日）`
                : `${ads.date ?? ads.reportFrom ?? "—"} · 单日归因`}
          </p>
        </article>
      </section>

      <section className="dash-kpi-row">
        <article className="dash-kpi">
          <h4>有库存 SKU</h4>
          <p>{fmtInt(data.catalog.stockSkuCount)}</p>
          <span className="muted">qty&gt;0 · 最近同步快照</span>
        </article>
        <Link className="dash-kpi dash-kpi-link" to="/shipping#packing-in-transit">
          <h4>在库 / 在途</h4>
          <p>
            {fmtInt(data.catalog.onHandQty)}
            <span className="dash-kpi-split">/</span>
            {fmtInt(data.catalog.inTransitQty)}
          </p>
          <span className="muted">
            点击查看票/箱明细
            {data.catalog.inTransitTicketCount
              ? ` · ${data.catalog.inTransitTicketCount}票/${data.catalog.inTransitBoxCount ?? 0}箱`
              : ""}
          </span>
        </Link>
        <article className="dash-kpi">
          <h4>昨日成交订单</h4>
          <p>{fmtInt(data.orders.yesterday?.count ?? 0)}</p>
          <Trend pct={data.orders.vsPreviousDayPct} />
          <span className="muted">
            GMV {fmtSar(data.orders.yesterday?.gmv ?? 0)}
            {data.orders.vsPreviousDayGmvPct != null &&
            Number.isFinite(data.orders.vsPreviousDayGmvPct)
              ? ` · GMV ${data.orders.vsPreviousDayGmvPct > 0 ? "↑" : data.orders.vsPreviousDayGmvPct < 0 ? "↓" : "→"} ${Math.abs(data.orders.vsPreviousDayGmvPct).toFixed(2)}%`
              : ""}
          </span>
          <span className="muted">
            {data.orders.yesterday?.date ?? "—"} · 按单去重
          </span>
        </article>
        <article className="dash-kpi">
          <h4>近 30 日件数</h4>
          <p>{fmtInt(seriesUnits.reduce((a, b) => a + b, 0))}</p>
          <SparkBars
            values={seriesUnits}
            labels={s.series.map((d) => d.date)}
            formatValue={(n) => `${fmtInt(n)} 件`}
          />
        </article>
        <article className="dash-kpi">
          <h4>自然订单</h4>
          <p>{fmtInt(data.orders.organic?.orders ?? 0)}</p>
          <span className="muted">
            总单 − 广告单
            {data.orders.organic
              ? ` · 广告 ${fmtInt(data.orders.organic.adOrders)}`
              : ""}
          </span>
        </article>
        <article className="dash-kpi">
          <h4>自然 GMV</h4>
          <p>{fmtSar(data.orders.organic?.gmv ?? 0)}</p>
          <span className="muted">
            {fmtSar(data.orders.organic?.totalGmv ?? 0)} − 广告{" "}
            {fmtSar(data.orders.organic?.adGmv ?? 0)}
            {data.orders.organic?.gmvFallback
              ? ` · 总GMV用${data.orders.organic.totalGmvDate}`
              : ""}
          </span>
        </article>
      </section>

      <section className="dash-top">
        <div className="dash-card-top">
          <h3>热销 SKU</h3>
          <span className="muted">按 salesFacts 累计件数</span>
        </div>
        {data.topSkus.length === 0 ? (
          <p className="muted">暂无销量事实</p>
        ) : (
          <div className="dash-top-grid">
            {data.topSkus.map((sku, i) => (
              <article key={sku.partnerSku} className="dash-top-item">
                <span className="dash-rank">#{i + 1}</span>
                {sku.imageUrl ? (
                  <img src={sku.imageUrl} alt="" className="dash-thumb" />
                ) : (
                  <div
                    className="dash-thumb is-empty"
                    title="Catalog 未收录该 PSKU 主图（需同步/入库 Catalog）"
                  >
                    <span>无图</span>
                  </div>
                )}
                <div className="dash-top-body">
                  <strong title={sku.title || sku.partnerSku}>
                    {sku.title || "（无标题）"}
                  </strong>
                  <code>{sku.partnerSku}</code>
                  <p>
                    {fmtInt(sku.units)} 件 · {fmtSar(sku.amount)}
                  </p>
                  {!sku.imageUrl && (
                    <p className="dash-noimg-hint">主图未同步进 Catalog</p>
                  )}
                </div>
                <div className="dash-top-spark">
                  <SparkBars
                    values={sku.spark}
                    labels={s.series.map((d) => d.date)}
                    formatValue={(n) => `${fmtInt(n)} 件`}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <details className="dash-defs">
        <summary>数据口径说明</summary>
        <ul>
          {data.definitions.map((d) => (
            <li key={d.id}>
              <strong>{d.label}</strong>（{d.source} · {d.grain}）— {d.note}
            </li>
          ))}
        </ul>
        <p className="muted">
          更新于 {new Date(data.asOf).toLocaleString()} ·{" "}
          <Link to="/finance">财务报表</Link> 已同步以 salesFacts 为营收主口径
        </p>
      </details>
    </div>
  );
}
