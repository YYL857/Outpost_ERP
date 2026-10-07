import { useEffect, useState } from "react";
import { api, type BestSellRow } from "../api";

export function BestSellPage() {
  const [rows, setRows] = useState<BestSellRow[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const res = await api.getBestSell();
    setRows(res.data);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="page-title">Best Sell 爆款分析</h1>
      <p className="page-desc">按本地已同步订单粗排。先同步 Catalog 与订单效果更好。</p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>排名</th>
              <th>SKU</th>
              <th>标题</th>
              <th>销量件数</th>
              <th>GMV</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  暂无排行数据
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.partnerSku}>
                <td>{i + 1}</td>
                <td>{r.partnerSku}</td>
                <td>{r.title}</td>
                <td>{r.units}</td>
                <td>{r.gmv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
