import { useCallback, useEffect, useState } from "react";
import {
  api,
  type SchedulerId,
  type SchedulerItem,
} from "../api";

function formatEvery(ms: number): string {
  if (ms >= 60 * 60 * 1000) {
    const h = ms / (60 * 60 * 1000);
    return Number.isInteger(h) ? `${h} 小时` : `${h.toFixed(1)} 小时`;
  }
  if (ms >= 60_000) {
    const m = ms / 60_000;
    return Number.isInteger(m) ? `${m} 分钟` : `${m.toFixed(1)} 分钟`;
  }
  return `${Math.round(ms / 1000)} 秒`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function groupLabel(group: SchedulerItem["group"]): string {
  if (group === "sync") return "同步";
  if (group === "digest") return "晨报 / 关账";
  return "市场情报";
}

export function SchedulersPage() {
  const [items, setItems] = useState<SchedulerItem[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState("");

  const refresh = useCallback(async () => {
    const res = await api.listSchedulers();
    setItems(res.data);
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
    const timer = setInterval(() => {
      refresh().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function toggle(item: SchedulerItem) {
    setBusy(`${item.id}-toggle`);
    setError("");
    setLastResult("");
    try {
      if (item.enabled) {
        await api.stopScheduler(item.id);
        setLastResult(`已停用：${item.label}`);
      } else {
        await api.startScheduler(item.id);
        setLastResult(`已启用：${item.label}`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function runNow(id: SchedulerId, label: string) {
    setBusy(`${id}-run`);
    setError("");
    setLastResult("");
    try {
      const res = await api.runScheduler(id);
      setLastResult(
        `${label}：${res.result.ok ? "成功" : "失败"} — ${res.result.message}`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "执行失败");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  if (!items) {
    return <p className="muted">{error || "加载中…"}</p>;
  }

  const activeCount = items.filter((i) => i.timerActive).length;

  return (
    <div>
      <h1 className="page-title">定时任务</h1>
      <p className="page-desc">
        管理本进程内全部调度：启停、立即执行。间隔由环境变量 / 市场情报配置决定；晨报推送按上海墙钟（店内默认 02:00，情报默认 03:30 且关闭）。
      </p>

      <div className={`status-bar ${activeCount > 0 ? "ok" : "idle"}`}>
        <div className="row">
          <span className="badge ok">{activeCount} 个定时器运行中</span>
          <span className="muted">共 {items.length} 项 · 约 5 秒刷新</span>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => {
              refresh().catch((e: Error) => setError(e.message));
            }}
          >
            刷新
          </button>
        </div>
      </div>

      {error ? (
        <p className="alert danger" style={{ marginBottom: 12 }}>
          {error}
        </p>
      ) : null}
      {lastResult ? <p className="muted">{lastResult}</p> : null}

      <table className="table">
        <thead>
          <tr>
            <th>任务</th>
            <th>分组</th>
            <th>间隔</th>
            <th>启用</th>
            <th>定时器</th>
            <th>运行中</th>
            <th>上次结果</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <div>{item.label}</div>
                {item.note ? (
                  <div className="muted" style={{ fontSize: "0.85em" }}>
                    {item.note}
                  </div>
                ) : null}
              </td>
              <td>{groupLabel(item.group)}</td>
              <td>{formatEvery(item.everyMs)}</td>
              <td>
                <span className={`badge ${item.enabled ? "ok" : "idle"}`}>
                  {item.enabled ? "开" : "关"}
                </span>
              </td>
              <td>
                <span className={`badge ${item.timerActive ? "ok" : "idle"}`}>
                  {item.timerActive ? "活跃" : "无"}
                </span>
              </td>
              <td>
                <span className={`badge ${item.running ? "warn" : "idle"}`}>
                  {item.running ? "执行中" : "—"}
                </span>
              </td>
              <td>
                <div>{formatTime(item.lastRunAt)}</div>
                {item.lastMessage ? (
                  <div className="muted" style={{ fontSize: "0.85em" }}>
                    {item.lastMessage}
                  </div>
                ) : null}
              </td>
              <td>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== null}
                    onClick={() => void toggle(item)}
                  >
                    {busy === `${item.id}-toggle`
                      ? "…"
                      : item.enabled
                        ? "停用"
                        : "启用"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy !== null || item.running}
                    onClick={() => void runNow(item.id, item.label)}
                  >
                    {busy === `${item.id}-run` ? "执行中…" : "立即执行"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted" style={{ marginTop: 16 }}>
        Windows 登录自启（OutpostERP-Services）只负责拉起进程，不属于业务定时任务，请用安装脚本管理。
      </p>
    </div>
  );
}
