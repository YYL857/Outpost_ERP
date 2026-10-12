import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type NoonOrder,
  type SalesFactRow,
  type SalesSummary,
} from "../api";
import { InterpretPanel } from "../components/InterpretPanel";
import { PageBar } from "../components/PageBar";
import { ProductCell } from "../components/ProductCell";
import {
  AdminSyncOnlyHint,
  DataFreshnessBanner,
  useIsAdmin,
} from "../components/DataFreshnessBanner";

const FACT_PAGE = 100;
const ORDER_PAGE = 100;

export function SalesPage() {
  const isAdmin = useIsAdmin();
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [facts, setFacts] = useState<SalesFactRow[]>([]);
  const [orders, setOrders] = useState<NoonOrder[]>([]);
  const [factPage, setFactPage] = useState(1);
  const [factTotal, setFactTotal] = useState(0);
  const [factPageCount, setFactPageCount] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPageCount, setOrderPageCount] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(opts?: { factPage?: number; orderPage?: number }) {
    const fp = opts?.factPage ?? factPage;
    const op = opts?.orderPage ?? orderPage;
    const [s, f, o] = await Promise.all([
      api.getSalesSummary(),
      api.getSalesFacts({ page: fp, pageSize: FACT_PAGE }),
      api.getSalesOrders({ page: op, pageSize: ORDER_PAGE }),
    ]);
    setSummary(s.data);
    setFacts(f.data);
    setFactTotal(f.meta.total);
    setFactPageCount(f.meta.pageCount ?? 1);
    setFactPage(f.meta.page ?? fp);
    setOrders(o.data);
    setOrderTotal(o.meta?.total ?? o.data.length);
    setOrderPageCount(o.meta?.pageCount ?? 1);
    setOrderPage(o.meta?.page ?? op);
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factPage, orderPage]);

  async function syncOrders() {
    setBusy(true);
    setError("");
    try {
      await api.runSync("orders");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function autoSyncSales() {
    setBusy(true);
    setError("");
    try {
      await api.autoSync({ skipSop: false });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "自动同步失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">销量统计</h1>
      <p className="page-desc">
        主数据为 NOON Sales 报表（SKU×日，<code>salesFacts</code>
        ）；订单仅作履约补充，不与日销量混为一谈。详见{" "}
        <Link to="/noon">NOON 接入 · 分域映射</Link>。
      </p>
      <DataFreshnessBanner compact />
      {isAdmin === false ? (
        <AdminSyncOnlyHint action="自动同步销售 / 订单" />
      ) : null}
      <div className="row" style={{ marginBottom: 14 }}>
        {isAdmin ? (
          <>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={autoSyncSales}
            >
              {busy ? "同步中…" : "自动同步（含 Sales 报表）"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={syncOrders}
            >
              仅同步订单
            </button>
          </>
        ) : null}
        <button className="btn" type="button" onClick={() => refresh()}>
          刷新
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <InterpretPanel surface="sales" />
      {summary && (
        <div className="grid-3" style={{ marginBottom: 16 }}>
          <div className="card">
            <h3>销售报表件数</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.salesUnits ?? summary.units}
            </p>
            <p className="muted">
              事实行 {summary.salesFactCount ?? 0} · SKU {summary.salesSkuCount ?? 0}
            </p>
          </div>
          <div className="card">
            <h3>销售报表金额</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.salesAmount ?? summary.gmv} {summary.currency}
            </p>
            <p className="muted">主源 salesFacts</p>
          </div>
          <div className="card">
            <h3>订单履约（补充）</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.orderCount} 单 / {summary.orderUnits ?? 0} 件
            </p>
            <p className="muted">GMV {summary.orderGmv ?? 0}</p>
          </div>
        </div>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>销售事实（SKU × 日）</h3>
        <PageBar
          page={factPage}
          pageCount={factPageCount}
          total={factTotal}
          pageSize={FACT_PAGE}
          onChange={setFactPage}
        />
        <table className="table">
          <thead>
            <tr>
              <th>日期</th>
              <th style={{ minWidth: 260 }}>产品</th>
              <th>件数</th>
              <th>金额</th>
            </tr>
          </thead>
          <tbody>
            {facts.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  暂无 salesFacts。请自动同步或将 sales_export CSV 放入 portal-imports。
                </td>
              </tr>
            ) : (
              facts.map((f) => (
                <tr key={`${f.partnerSku}-${f.date}`}>
                  <td>{f.date}</td>
                  <td>
                    <ProductCell
                      partnerSku={f.partnerSku}
                      title={f.title}
                      imageUrl={f.imageUrl}
                    />
                  </td>
                  <td>{f.units}</td>
                  <td>{f.amount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>订单明细（履约补充）</h3>
        <PageBar
          page={orderPage}
          pageCount={orderPageCount}
          total={orderTotal}
          pageSize={ORDER_PAGE}
          onChange={setOrderPage}
        />
        <table className="table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>状态</th>
              <th>金额</th>
              <th>件数</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  暂无订单。
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.orderNr}>
                  <td>{o.orderNr}</td>
                  <td>{o.status}</td>
                  <td>
                    {o.totalAmount} {o.currency}
                  </td>
                  <td>{o.itemCount}</td>
                  <td className="muted">{new Date(o.updatedAt).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
