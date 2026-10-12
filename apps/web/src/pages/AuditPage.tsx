import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type AuditDailySummary,
  type AuditEventRow,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";

function shanghaiToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function formatAt(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}

function resultLabel(r: AuditEventRow["result"]) {
  if (r === "ok") return "成功";
  if (r === "denied") return "拒绝";
  return "失败";
}

function compactJson(v: unknown) {
  if (v == null) return "—";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function AuditPage() {
  const [day, setDay] = useState(shanghaiToday);
  const [actor, setActor] = useState("");
  const [module, setModule] = useState("");
  const [shopId, setShopId] = useState("");
  const [daily, setDaily] = useState<AuditDailySummary | null>(null);
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [auditRoot, setAuditRoot] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [d, e] = await Promise.all([
        api.getAuditDaily(day),
        api.getAuditEvents({
          day,
          actor: actor.trim() || undefined,
          module: module.trim() || undefined,
          shopId: shopId.trim() || undefined,
          limit: 200,
        }),
      ]);
      setDaily(d.data);
      setEvents(e.data);
      setTotal(e.meta.total);
      setAuditRoot(e.meta.auditRoot || d.meta.auditRoot || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载审计失败");
      setDaily(null);
      setEvents([]);
      setTotal(0);
    } finally {
      setBusy(false);
    }
  }, [day, actor, module, shopId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const actorOptions = useMemo(() => {
    if (!daily?.byActor) return [];
    return Object.keys(daily.byActor).sort();
  }, [daily]);

  const moduleOptions = useMemo(() => {
    if (!daily?.byModule) return [];
    return Object.keys(daily.byModule).sort();
  }, [daily]);

  return (
    <div>
      <h1 className="page-title">操作审计</h1>
      <p className="page-desc">
        追溯已登录用户的增删改（含账目记账）。仅超管可看；按上海时区日期分文件。
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="row"
          style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              日期
            </span>
            <ClearableInput
              className="input"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              用户
            </span>
            <ClearableInput
              className="input"
              list="audit-actors"
              placeholder="用户名或 id"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
            <datalist id="audit-actors">
              {actorOptions.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              模块
            </span>
            <ClearableInput
              className="input"
              list="audit-modules"
              placeholder="如 purchase"
              value={module}
              onChange={(e) => setModule(e.target.value)}
            />
            <datalist id="audit-modules">
              {moduleOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              店铺
            </span>
            <ClearableInput
              className="input"
              placeholder="shopId 可选"
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => load()}
          >
            {busy ? "加载中…" : "查询"}
          </button>
        </div>
        {auditRoot ? (
          <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
            落盘目录：{auditRoot}
          </p>
        ) : null}
      </div>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {daily && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>当日汇总 · {daily.day}</h3>
          <div className="grid-3" style={{ gap: 12 }}>
            <div>
              <div className="muted">总次数</div>
              <div style={{ fontSize: 20, fontWeight: 650 }}>{daily.totalEvents}</div>
            </div>
            <div>
              <div className="muted">成功 / 拒绝 / 失败</div>
              <div style={{ fontSize: 20, fontWeight: 650 }}>
                {daily.ok} / {daily.denied} / {daily.error}
              </div>
            </div>
            <div>
              <div className="muted">按用户（前 8）</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {Object.entries(daily.byActor || {})
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ") || "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", marginBottom: 8 }}
        >
          <h3 style={{ margin: 0 }}>事件明细</h3>
          <span className="muted">
            显示 {events.length} / 共 {total}
          </span>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>角色</th>
                <th>店铺</th>
                <th>模块</th>
                <th>动作</th>
                <th>结果</th>
                <th>摘要</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    {busy ? "加载中…" : "当日无匹配事件"}
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <Fragment key={ev.id}>
                    <tr>
                      <td style={{ whiteSpace: "nowrap" }}>{formatAt(ev.at)}</td>
                      <td>{ev.actor?.username || "—"}</td>
                      <td>{ev.actor?.role || "—"}</td>
                      <td>{ev.shopId || "—"}</td>
                      <td>{ev.module}</td>
                      <td>{ev.action}</td>
                      <td>{resultLabel(ev.result)}</td>
                      <td style={{ maxWidth: 360 }}>{ev.summary}</td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setExpanded((id) => (id === ev.id ? null : ev.id))
                          }
                        >
                          {expanded === ev.id ? "收起" : "详情"}
                        </button>
                      </td>
                    </tr>
                    {expanded === ev.id ? (
                      <tr>
                        <td colSpan={9}>
                          <pre
                            className="muted"
                            style={{
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontSize: 12,
                            }}
                          >
                            {compactJson({
                              path: ev.path,
                              method: ev.method,
                              statusCode: ev.statusCode,
                              entityType: ev.entityType,
                              entityId: ev.entityId,
                              body: ev.body,
                              detail: ev.detail,
                            })}
                          </pre>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
