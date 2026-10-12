import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type AdsBySkuRow,
  type AdsFactRow,
  type AdsSummary,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import { ProductCell } from "../components/ProductCell";
import { filterProductDisplayRows } from "../lib/product-display";
import {
  AdminSyncOnlyHint,
  DataFreshnessBanner,
  useIsAdmin,
} from "../components/DataFreshnessBanner";

export function AdsPage() {
  const isAdmin = useIsAdmin();
  const [summary, setSummary] = useState<AdsSummary | null>(null);
  const [bySku, setBySku] = useState<AdsBySkuRow[]>([]);
  const [facts, setFacts] = useState<AdsFactRow[]>([]);
  const [skuQuery, setSkuQuery] = useState("");
  const [factQuery, setFactQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportHint, setExportHint] = useState("");

  async function refresh() {
    const [s, sku, f] = await Promise.all([
      api.getAdsSummary(),
      api.getAdsBySku(),
      api.getAdsFacts(),
    ]);
    setSummary(s.data);
    setBySku(sku.data);
    setFacts(f.data);
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function syncAds() {
    setBusy(true);
    setError("");
    try {
      await api.runSync("ads");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function runAdsExport() {
    setExportBusy(true);
    setError("");
    setExportHint("");
    try {
      const r = await api.runAdsPwExport();
      setExportHint(
        r.meta?.hint ||
          r.data.message ||
          "Playwright 已启动（默认两店）；导完会自动入库",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动广告导出失败");
    } finally {
      setExportBusy(false);
    }
  }

  const skuView = useMemo(
    () =>
      filterProductDisplayRows(bySku, skuQuery, {
        match: (r, needle) => {
          const n = needle.toLowerCase();
          return (
            r.partnerSku.toLowerCase().includes(n) ||
            (r.catalogPartnerSku || "").toLowerCase().includes(n) ||
            (r.title || "").toLowerCase().includes(n)
          );
        },
        compare: (a, b) => (b.spend || 0) - (a.spend || 0),
      }),
    [bySku, skuQuery],
  );

  const factView = useMemo(
    () =>
      filterProductDisplayRows(facts, factQuery, {
        match: (r, needle) => {
          const n = needle.toLowerCase();
          return (
            r.partnerSku.toLowerCase().includes(n) ||
            (r.catalogPartnerSku || "").toLowerCase().includes(n) ||
            (r.title || "").toLowerCase().includes(n) ||
            (r.campaign || "").toLowerCase().includes(n)
          );
        },
        compare: (a, b) => (b.spend || 0) - (a.spend || 0),
      }),
    [facts, factQuery],
  );

  return (
    <div>
      <h1 className="page-title">广告管理</h1>
      <p className="page-desc">
        主存 <code>adsFacts</code>（Playwright 导出 Noon Ads Campaign Overview
        SKU CSV）。Catalog 投产比引用同一数据。映射见{" "}
        <Link to="/noon">NOON 接入</Link>。
      </p>
      <DataFreshnessBanner compact />
      {isAdmin === false ? (
        <AdminSyncOnlyHint action="导出广告表 / 同步广告" />
      ) : null}
      <div className="row" style={{ marginBottom: 14 }}>
        {isAdmin ? (
          <>
            <button
              className="btn btn-primary"
              type="button"
              disabled={exportBusy || busy}
              onClick={() => void runAdsExport()}
            >
              {exportBusy ? "导出启动中…" : "导出广告表"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy || exportBusy}
              onClick={syncAds}
            >
              {busy ? "同步中…" : "同步广告（ads）"}
            </button>
          </>
        ) : null}
        <button className="btn" type="button" onClick={() => refresh()}>
          刷新
        </button>
      </div>
      {exportHint && <p className="muted">{exportHint}</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {summary && (
        <div className="grid-3" style={{ marginBottom: 16 }}>
          <div className="card">
            <h3>花费</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.spend}
            </p>
            <p className="muted">
              {summary.reportFrom ?? "—"} → {summary.reportTo ?? "—"}
            </p>
          </div>
          <div className="card">
            <h3>归因收入 / ROAS</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.revenue} / {summary.roas ?? "—"}
            </p>
            <p className="muted">
              订单 {summary.orders} · 点击 {summary.clicks}
            </p>
          </div>
          <div className="card">
            <h3>覆盖</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.skuCount} SKU
            </p>
            <p className="muted">
              事实 {summary.factCount} · 活动名 {summary.campaignCount}
            </p>
          </div>
        </div>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="row"
          style={{
            marginBottom: 10,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0 }}>按 SKU 汇总</h3>
          <ClearableInput
            className="input"
            style={{ minWidth: 220, maxWidth: 320 }}
            placeholder="搜索 PSKU / 标题 / 活动"
            value={skuQuery}
            onChange={(e) => setSkuQuery(e.target.value)}
          />
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
          默认只展示有图/有标题的 {skuView.visible.length}
          {bySku.length ? ` / ${bySku.length}` : ""} 行
          {skuView.hiddenCount > 0 && !skuView.searching
            ? ` · 已隐藏 ${skuView.hiddenCount}（搜索可召回）`
            : ""}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: 260 }}>产品</th>
              <th>花费</th>
              <th>收入</th>
              <th>ROAS</th>
              <th>订单</th>
              <th>活动数</th>
            </tr>
          </thead>
          <tbody>
            {bySku.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  暂无 adsFacts。请「导出广告表」至 portal-imports 后同步 ads。
                </td>
              </tr>
            ) : skuView.visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  {skuView.searching
                    ? "无匹配行。"
                    : "暂无有图/有标题的行；可搜索 PSKU 查看隐藏项。"}
                </td>
              </tr>
            ) : (
              skuView.visible.slice(0, 100).map((r) => (
                <tr key={r.partnerSku}>
                  <td>
                    <ProductCell
                      partnerSku={r.catalogPartnerSku || r.partnerSku}
                      title={r.title}
                      imageUrl={r.imageUrl}
                      sub={
                        r.catalogPartnerSku && r.catalogPartnerSku !== r.partnerSku
                          ? r.partnerSku
                          : undefined
                      }
                    />
                  </td>
                  <td>{r.spend}</td>
                  <td>{r.revenue}</td>
                  <td>{r.roas ?? "—"}</td>
                  <td>{r.orders}</td>
                  <td>{r.campaignCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div
          className="row"
          style={{
            marginBottom: 10,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0 }}>事实明细（最多 500）</h3>
          <ClearableInput
            className="input"
            style={{ minWidth: 220, maxWidth: 320 }}
            placeholder="搜索 PSKU / 标题 / 活动"
            value={factQuery}
            onChange={(e) => setFactQuery(e.target.value)}
          />
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
          默认只展示有图/有标题的 {factView.visible.length}
          {facts.length ? ` / ${facts.length}` : ""} 行
          {factView.hiddenCount > 0 && !factView.searching
            ? ` · 已隐藏 ${factView.hiddenCount}（搜索可召回）`
            : ""}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>区间</th>
              <th style={{ minWidth: 260 }}>产品</th>
              <th>活动</th>
              <th>花费</th>
              <th>收入</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {facts.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  暂无事实明细。
                </td>
              </tr>
            ) : factView.visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  {factView.searching
                    ? "无匹配行。"
                    : "暂无有图/有标题的行；可搜索 PSKU 查看隐藏项。"}
                </td>
              </tr>
            ) : (
              factView.visible.slice(0, 500).map((f) => (
                <tr
                  key={`${f.partnerSku}-${f.campaign}-${f.fromDate}-${f.toDate}`}
                >
                  <td>
                    {f.fromDate} → {f.toDate}
                  </td>
                  <td>
                    <ProductCell
                      partnerSku={f.catalogPartnerSku || f.partnerSku}
                      title={f.title}
                      imageUrl={f.imageUrl}
                      sub={
                        f.catalogPartnerSku && f.catalogPartnerSku !== f.partnerSku
                          ? f.partnerSku
                          : undefined
                      }
                    />
                  </td>
                  <td>{f.campaign || "—"}</td>
                  <td>{f.spend}</td>
                  <td>{f.revenue}</td>
                  <td>{f.roas ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
