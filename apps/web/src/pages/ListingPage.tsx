import { useEffect, useState } from "react";
import { api, type CatalogRow, type ListingTask } from "../api";

export function ListingPage() {
  const [quota, setQuota] = useState({ used: 0, quota: 0, remaining: 0 });
  const [tasks, setTasks] = useState<ListingTask[]>([]);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [sku, setSku] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [q, t, c] = await Promise.all([
      api.getListingQuota(),
      api.getListingTasks(),
      api.getCatalog(),
    ]);
    setQuota(q.data);
    setTasks(t.data);
    setCatalog(c.data);
    if (!sku && c.data[0]) setSku(c.data[0].partnerSku);
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function submit() {
    const item = catalog.find((c) => c.partnerSku === sku);
    if (!item) {
      setError("请选择有效 SKU（先同步 Catalog）");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.createListingTask({ partnerSku: item.partnerSku, title: item.title });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "上架失败");
    } finally {
      setBusy(false);
    }
  }

  const pct = quota.quota ? Math.round((quota.used / quota.quota) * 100) : 0;

  return (
    <div>
      <h1 className="page-title">链接上架</h1>
      <p className="page-desc">本地额度管理 + 上架任务队列。真实提交 NOON 的调用点已预留在 listing 模块。</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>本月上架额度</h3>
        <p style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 650 }}>
          {quota.used} / {quota.quota}
        </p>
        <div className="progress">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="muted">剩余 {quota.remaining}</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>新建上架任务</h3>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="row">
          <select
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", minWidth: 240 }}
          >
            {catalog.length === 0 && <option value="">暂无 Catalog</option>}
            {catalog.map((c) => (
              <option key={c.partnerSku} value={c.partnerSku}>
                {c.partnerSku} · {c.title}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="button" disabled={busy || !sku} onClick={submit}>
            占用额度并上架
          </button>
        </div>
      </div>

      <div className="card">
        <h3>任务列表</h3>
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>标题</th>
              <th>状态</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  暂无任务
                </td>
              </tr>
            )}
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.partnerSku}</td>
                <td>{t.title}</td>
                <td>{t.status}</td>
                <td className="muted">{new Date(t.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
