import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CampaignsOverview } from "../api";

export function CampaignsPage() {
  const [data, setData] = useState<CampaignsOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getCampaignsOverview()
      .then((res) => setData(res.data))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="page-title">活动管理</h1>
      <p className="page-desc">
        暂用广告 CSV 中的 <code>campaign</code>{" "}
        名做汇总（≠ 平台促销/Deal）。正式活动域未接入。广告明细见{" "}
        <Link to="/ads">广告管理</Link>。
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {data?.summary && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px" }}>{data.summary.caveat}</p>
          <p className="muted" style={{ margin: 0 }}>
            {data.summary.gap}
          </p>
        </div>
      )}
      <div className="card">
        <h3>
          广告活动名汇总（{data?.summary.campaignCount ?? 0}）
        </h3>
        <table className="table">
          <thead>
            <tr>
              <th>活动名</th>
              <th>花费</th>
              <th>收入</th>
              <th>ROAS</th>
              <th>SKU 数</th>
              <th>订单</th>
              <th>区间</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  暂无广告活动名。请先同步 adsFacts。
                </td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.campaign}>
                  <td>{r.campaign}</td>
                  <td>{r.spend}</td>
                  <td>{r.revenue}</td>
                  <td>{r.roas ?? "—"}</td>
                  <td>{r.skuCount}</td>
                  <td>{r.orders}</td>
                  <td>
                    {r.fromDate} → {r.toDate}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
