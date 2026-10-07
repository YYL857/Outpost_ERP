import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type InboxEvent,
  type NoonOrder,
  type SyncAlert,
  type SyncHealth,
} from "../api";

function tone(status: string): "ok" | "warn" | "danger" | "idle" {
  if (status === "failed" || status === "danger") return "danger";
  if (status === "warning" || status === "running" || status === "warn") return "warn";
  if (status === "success" || status === "ok") return "ok";
  return "idle";
}

export function SyncHealthPage() {
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [alerts, setAlerts] = useState<SyncAlert[]>([]);
  const [inbox, setInbox] = useState<InboxEvent[]>([]);
  const [orders, setOrders] = useState<NoonOrder[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [h, a, i, o] = await Promise.all([
      api.getSyncHealth(),
      api.getSyncAlerts(),
      api.getInbox(),
      api.getNoonOrders(),
    ]);
    setHealth(h.data);
    setAlerts(a.data);
    setInbox(i.data);
    setOrders(o.data);
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
    const timer = setInterval(() => {
      refresh().catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function run(domain: string) {
    setBusy(domain);
    setError("");
    try {
      await api.runSync(domain);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "触发失败");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function ack(id: string) {
    await api.ackAlert(id);
    await refresh();
  }

  async function demoFail() {
    setBusy("demo");
    try {
      await api.demoFail();
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!health) return <p className="muted">{error || "加载中…"}</p>;

  return (
    <div>
      <h1 className="page-title">同步健康中心</h1>
      <p className="page-desc">
        数据只从 NOON 进入本系统。这里看通道状态、Inbox 积压、失败告警与一键回补。
      </p>

      <div className={`status-bar ${tone(health.overall)}`}>
        <div className="row">
          <span className={`badge ${tone(health.overall)}`}>
            总览：{health.overall}
          </span>
          <span className="muted">
            NOON {health.noonMode}
            {health.noonEnabled ? "" : "（已停用）"} · Inbox 待处理{" "}
            {health.inboxPending} / 失败 {health.inboxFailed} · 本地订单{" "}
            {health.orderCount}
          </span>
        </div>
        <div className="row">
          <Link className="btn" to="/noon">
            NOON 接入
          </Link>
          <button className="btn" type="button" onClick={() => refresh()}>
            刷新
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy === "demo"}
            onClick={demoFail}
          >
            模拟告警
          </button>
        </div>
      </div>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>订单游标</h3>
          <p className="muted" style={{ margin: 0 }}>
            {health.cursors.ordersSince
              ? new Date(health.cursors.ordersSince).toLocaleString()
              : "尚未拉取"}
          </p>
        </div>
        <div className="card">
          <h3>Catalog 游标</h3>
          <p className="muted" style={{ margin: 0 }}>
            {health.cursors.catalogSince
              ? new Date(health.cursors.catalogSince).toLocaleString()
              : "尚未拉取"}
          </p>
        </div>
        <div className="card">
          <h3>库存游标</h3>
          <p className="muted" style={{ margin: 0 }}>
            {health.cursors.stockSince
              ? new Date(health.cursors.stockSince).toLocaleString()
              : "尚未拉取"}
          </p>
        </div>
      </div>

      {health.domains && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>分域库存（一域一主页）</h3>
          <table className="table">
            <thead>
              <tr>
                <th>域</th>
                <th>本地条数</th>
                <th>前哨主页面</th>
                <th>最近成功</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(health.domains).map(([domain, info]) => (
                <tr key={domain}>
                  <td>{domain}</td>
                  <td>{info.count}</td>
                  <td>{info.primaryPage}</td>
                  <td className="muted">
                    {info.lastSuccessAt
                      ? new Date(info.lastSuccessAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {health.lastImportSummary && (
            <p className="muted" style={{ marginBottom: 0 }}>
              最近入库：{health.lastImportSummary}
            </p>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>同步任务（经 NOON Client → Inbox）</h3>
        <table className="table">
          <thead>
            <tr>
              <th>域</th>
              <th>状态</th>
              <th>积压</th>
              <th>延迟(分)</th>
              <th>最近成功</th>
              <th>错误</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {health.jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.domain}</td>
                <td>
                  <span className={`badge ${tone(job.status)}`}>{job.status}</span>
                </td>
                <td>{job.backlog}</td>
                <td>{job.latencyMinutes}</td>
                <td>
                  {job.lastSuccessAt
                    ? new Date(job.lastSuccessAt).toLocaleString()
                    : "—"}
                </td>
                <td className="muted">{job.lastError ?? "—"}</td>
                <td>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy === job.domain}
                    onClick={() => run(job.domain)}
                  >
                    从 NOON 同步
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Inbox 原始事件</h3>
          <table className="table">
            <thead>
              <tr>
                <th>来源</th>
                <th>域</th>
                <th>实体</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {inbox.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    暂无事件。点击上方「从 NOON 同步」或向 Webhook 推送。
                  </td>
                </tr>
              )}
              {inbox.slice(0, 12).map((e) => (
                <tr key={e.id}>
                  <td>{e.source}</td>
                  <td>{e.domain}</td>
                  <td>{e.entityKey}</td>
                  <td>
                    <span className={`badge ${tone(e.status === "failed" ? "failed" : e.status === "processed" ? "success" : "warning")}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="muted">{new Date(e.receivedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>已同步订单（来自 NOON）</h3>
          <table className="table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>状态</th>
                <th>金额</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    尚无订单数据
                  </td>
                </tr>
              )}
              {orders.slice(0, 12).map((o) => (
                <tr key={o.orderNr}>
                  <td>{o.orderNr}</td>
                  <td>{o.status}</td>
                  <td>
                    {o.totalAmount} {o.currency}
                  </td>
                  <td className="muted">{new Date(o.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>告警列表</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {alerts.length === 0 && <p className="muted">暂无告警</p>}
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`alert ${alert.level === "danger" ? "danger" : alert.level === "warning" ? "warn" : ""}`}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {alert.title}
                  {alert.acknowledged ? "（已确认）" : ""}
                </strong>
                {!alert.acknowledged && (
                  <button className="btn" type="button" onClick={() => ack(alert.id)}>
                    确认
                  </button>
                )}
              </div>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                {alert.detail}
              </p>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {new Date(alert.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
