import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type FinanceOverview } from "../api";

export function FinancePage() {
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getFinanceOverview()
      .then((res) => setData(res.data))
      .catch((e: Error) => setError(e.message));
  }, []);

  const fees = data?.platformFees;

  return (
    <div>
      <h1 className="page-title">财务报表</h1>
      <p className="page-desc">
        收入来自订单；平台佣金/出库费来自 Transaction View（
        <code>feeSnapshots</code>
        ）；本地运费/测评单独估算，科目不混。映射见{" "}
        <Link to="/noon">NOON 接入</Link>。
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {!data ? (
        <p className="muted">加载中…</p>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3>收入 (CNY估)</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>{data.revenueCny}</p>
              <p className="muted">SAR {data.revenueSar}</p>
            </div>
            <div className="card">
              <h3>平台费用 (CNY估)</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
                {fees?.totalCny ?? 0}
              </p>
              <p className="muted">
                SKU {fees?.feeSkuCount ?? 0} · 均佣金率{" "}
                {(((fees?.avgCommissionRate ?? 0) as number) * 100).toFixed(1)}%
              </p>
            </div>
            <div className="card">
              <h3>预估利润</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>{data.profitCny}</p>
              <p className="muted">
                已扣空运 {data.airCostCny} + 测评 {data.reviewCostCny} + 平台费
              </p>
            </div>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>平台费用明细（feeSnapshots）</h3>
            {!fees || fees.feeSkuCount === 0 ? (
              <p className="muted">
                暂无费用快照。请自动同步 Transaction View，或导入 transactionview CSV。
              </p>
            ) : (
              <div className="kv">
                <label>佣金（估）</label>
                <div>SAR {fees.commissionSar}</div>
                <label>出库费合计</label>
                <div>SAR {fees.outboundFeeSar}</div>
                <label>税额合计</label>
                <div>SAR {fees.taxSar}</div>
                <label>平台费用合计</label>
                <div>
                  SAR {fees.totalSar} / CNY {fees.totalCny}
                </div>
              </div>
            )}
          </div>
          <div className="card">
            <h3>本地成本计价快照</h3>
            <div className="kv">
              {Object.entries(data.snapshot).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <label>{k}</label>
                  <div>{String(v)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
