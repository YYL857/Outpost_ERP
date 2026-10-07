import { useEffect, useMemo, useState } from "react";
import { api, type CatalogRow, type SalesWindow } from "../api";

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

function saleLine(label: string, w?: SalesWindow) {
  if (!w) return `${label} —`;
  return `${label} ${w.units} / ${num(w.dailyAvg)}`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="cat-metric">
      <span className="cat-metric-label">{label}</span>
      <span className="cat-metric-value">{value}</span>
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

export function CatalogPage() {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [hint, setHint] = useState("");
  const [q, setQ] = useState("");
  const [onlyFbn, setOnlyFbn] = useState(false);

  async function load() {
    const res = await api.getCatalog();
    setRows(res.data);
    return res.data;
  }

  useEffect(() => {
    load()
      .then(async (data) => {
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

  async function autoSync() {
    setSyncing(true);
    setError("");
    setHint("自动同步中…");
    try {
      const res = await api.autoSync({ skipSop: false });
      setHint(res.message ?? res.data.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "自动同步失败");
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyFbn && (r.inventory?.fbn ?? 0) <= 0) return false;
      if (!needle) return true;
      return (
        r.partnerSku.toLowerCase().includes(needle) ||
        r.noonSku?.toLowerCase().includes(needle) ||
        r.title.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, onlyFbn]);

  const withImage = rows.filter((r) => Boolean(r.imageUrl)).length;

  return (
    <div>
      <h1 className="page-title">Catalog 产品库</h1>
      <p className="page-desc">
        对齐竞品列组的全量拼装展示。商品图由 Content API（GetContent）按 noonSku 父码补全；Catalog
        CSV 本身不含图片列。
      </p>
      <div className="row" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="button" disabled={syncing} onClick={autoSync}>
          {syncing ? "自动同步中…" : "同步 SKU"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={enriching || syncing}
          onClick={enrichImages}
        >
          {enriching ? "补图中…" : "补全图片"}
        </button>
        <button className="btn" type="button" onClick={() => load()}>
          刷新
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
        <span className="muted" style={{ marginLeft: "auto" }}>
          {filtered.length}/{rows.length} 行 · 有图 {withImage}
        </span>
      </div>
      {hint && <p className="muted">{hint}</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="card cat-table-wrap">
        <table className="table cat-table">
          <thead>
            <tr>
              <th style={{ minWidth: 280 }}>商品信息</th>
              <th style={{ minWidth: 120 }}>库存</th>
              <th style={{ minWidth: 150 }}>销量</th>
              <th style={{ minWidth: 160 }}>补货计划</th>
              <th style={{ minWidth: 170 }}>费用</th>
              <th style={{ minWidth: 110 }}>利润</th>
              <th style={{ minWidth: 140 }}>规格</th>
              <th style={{ minWidth: 100 }}>更新/截止</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  暂无数据。请在「NOON 接入」登录后点同步，或将报表放入
                  D:\outpost-data\portal-imports。
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const rep = replenishLabel(r.replenish?.status ?? "unknown");
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
                          <span>PSKU {r.partnerSku}</span>
                          {r.noonSku ? <span>SKU {r.noonSku}</span> : null}
                        </div>
                        <div className="cat-price-row">
                          <span className="cat-price">
                            {r.price > 0 ? money(r.price, r.currency) : "—"}
                          </span>
                          <span className={`cat-tag ${r.isActive ? "ok" : "idle"}`}>
                            {r.isActive ? "在售" : "下架"}
                          </span>
                          {r.listingType ? (
                            <span className="cat-tag idle">{r.listingType}</span>
                          ) : null}
                          {r.source ? <span className="cat-tag idle">{r.source}</span> : null}
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
                      <span>{saleLine("3日", r.sales?.d3)}</span>
                      <span>{saleLine("7日", r.sales?.d7)}</span>
                      <span>{saleLine("14日", r.sales?.d14)}</span>
                      <span>{saleLine("30日", r.sales?.d30)}</span>
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
                      <Metric label="头程" value={money(r.fees?.headhaul)} />
                      <Metric
                        label={freightLabel}
                        value={money(r.fees?.freightEst)}
                      />
                      <Metric
                        label="佣金"
                        value={`${pct(r.fees?.commissionRate)} / ${money(r.fees?.commissionAmount)}`}
                      />
                      <Metric label="税费" value={money(r.fees?.taxAmount)} />
                      <Metric label="出仓" value={money(r.fees?.outboundFee)} />
                      <Metric label="合计" value={money(r.fees?.total)} />
                    </div>
                  </td>
                  <td>
                    <div className="cat-stack">
                      <span className={marginClass(r.profit?.margin)}>
                        {pct(r.profit?.margin)}
                      </span>
                      <Metric label="SAR" value={money(r.profit?.sar)} />
                      <Metric
                        label="RMB"
                        value={r.profit?.rmb != null ? money(r.profit.rmb) : "—"}
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
                            ? money(r.specs?.purchaseCost)
                            : "—"
                        }
                      />
                    </div>
                  </td>
                  <td className="muted cat-date">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "—"}
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
