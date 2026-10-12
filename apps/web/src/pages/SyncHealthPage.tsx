import { useCallback, useEffect, useMemo, useState } from "react";
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
  if (status === "warning" || status === "running" || status === "warn")
    return "warn";
  if (status === "success" || status === "ok") return "ok";
  return "idle";
}

const DOMAIN_LABEL: Record<string, string> = {
  orders: "订单",
  catalog: "商品目录",
  stock: "库存",
  sales: "销量",
  fees: "平台费用",
  ads: "广告",
  reconcile: "对账",
  feishu: "飞书",
};

const CHANNEL_LABEL: Record<string, string> = {
  "noon-impex": "Noon Impex 导出",
  "yingdao-ads": "Playwright 广告导出",
  snapshot: "Noon 快照拉取",
  none: "—",
  feishu: "飞书表格直拉",
};

const STATUS_LABEL: Record<string, string> = {
  success: "已完成",
  ok: "正常",
  running: "进行中",
  idle: "未开始",
  failed: "失败",
  warning: "有异常",
  warn: "有异常",
  danger: "失败",
  pending: "待处理",
  processed: "已处理",
};

function domainLabel(domain: string) {
  return DOMAIN_LABEL[domain] ?? domain;
}

function channelLabel(channel: string) {
  return CHANNEL_LABEL[channel] ?? channel;
}

function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status;
}

type DataGapsPayload = Awaited<ReturnType<typeof api.getDataGaps>>["data"];
type DataBackfillLast = Awaited<
  ReturnType<typeof api.getDataBackfillLast>
>["data"];
type GapRow = {
  key: string;
  shopId: string;
  shopName: string;
  domain: string;
  maxDate: string | null;
  expectedEnd: string;
  missingCount: number;
  missingDates: string[];
  fillFrom: string | null;
  fillTo: string | null;
  channel: string;
  message: string;
};

function flattenGaps(
  gaps: DataGapsPayload | null,
  opts?: { healthGateOnly?: boolean },
): GapRow[] {
  if (!gaps) return [];
  const healthGateOnly = opts?.healthGateOnly !== false;
  const rows: GapRow[] = [];
  for (const s of gaps.shops) {
    if (healthGateOnly && s.countsTowardHealth === false) continue;
    for (const d of s.domains) {
      if (d.ok) continue;
      rows.push({
        key: `${s.shopId}:${d.domain}`,
        shopId: s.shopId,
        shopName: s.shopName || s.shopId,
        domain: d.domain,
        maxDate: d.maxDate,
        expectedEnd: d.expectedEnd,
        missingCount: d.missingDates?.length ?? 0,
        missingDates: d.missingDates ?? [],
        fillFrom: d.fillFrom,
        fillTo: d.fillTo,
        channel: d.channel,
        message: d.message,
      });
    }
  }
  return rows;
}

export function SyncHealthPage() {
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [alerts, setAlerts] = useState<SyncAlert[]>([]);
  const [inbox, setInbox] = useState<InboxEvent[]>([]);
  const [orders, setOrders] = useState<NoonOrder[]>([]);
  const [gaps, setGaps] = useState<DataGapsPayload | null>(null);
  const [backfill, setBackfill] = useState<DataBackfillLast | null>(null);
  const [backfillHint, setBackfillHint] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [h, a, i, o, g, bf] = await Promise.all([
      api.getSyncHealth(),
      api.getSyncAlerts(),
      api.getInbox(),
      api.getNoonOrders(),
      api.getDataGaps().catch(() => null),
      api.getDataBackfillLast().catch(() => null),
    ]);
    setHealth(h.data);
    setAlerts(a.data);
    setInbox(i.data);
    setOrders(o.data);
    if (g) setGaps(g.data);
    if (bf) setBackfill(bf.data);
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

  async function clearAlerts() {
    if (!window.confirm(`清空全部 ${alerts.length} 条告警？`)) return;
    setBusy("clear-alerts");
    setError("");
    try {
      await api.clearAlerts();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "清空告警失败");
    } finally {
      setBusy(null);
    }
  }

  async function runDataBackfill() {
    if (
      !window.confirm(
        "确认一键补齐？将按缺口一次拉 Noon（销售/订单/库存等）、飞书，并尽量触发 Playwright 广告导出。Impex 有配额限制，请勿连续狂点。",
      )
    ) {
      return;
    }
    setBusy("data-backfill");
    setError("");
    setBackfillHint("补齐进行中…");
    try {
      const res = await api.runDataBackfill();
      setBackfillHint(res.message || res.data.message || "补齐完成");
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "补齐失败";
      setError(msg);
      setBackfillHint(msg);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const gapRows = useMemo(() => flattenGaps(gaps, { healthGateOnly: true }), [gaps]);
  const gatedShops =
    gaps?.shops.filter((s) => s.countsTowardHealth !== false) ?? [];
  const incompleteShops = gatedShops.filter((s) => !s.complete).length;
  const gapsComplete = gaps?.complete ?? incompleteShops === 0;
  const missingDaysTotal = gapRows.reduce((n, r) => n + r.missingCount, 0);
  const unackedAlerts = alerts.filter((a) => !a.acknowledged).length;
  const backfillRunning = backfill?.running || busy === "data-backfill";
  const expectedEnd =
    gatedShops.find((s) => !s.complete)?.expectedEnd ??
    gatedShops[0]?.expectedEnd ??
    gaps?.shops[0]?.expectedEnd ??
    null;
  const channelStats = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of gapRows) {
      m.set(r.channel, (m.get(r.channel) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [gapRows]);

  if (!health) return <p className="muted">{error || "加载中…"}</p>;

  const heroTone = !gapsComplete
    ? "danger"
    : unackedAlerts > 0 || health.overall === "warning"
      ? "warn"
      : "ok";
  const overviewLabel = gapsComplete ? "成功" : "失败";
  const gateHint =
    gaps?.healthGateShopIds?.length
      ? `门禁店 ${gaps.healthGateShopIds.length} 家`
      : "门禁店前两家";

  return (
    <div className="align-hub">
      <h1 className="page-title">数据对齐</h1>
      <p className="page-desc">
        汇总门禁店相对期望截止日的缺口、同步告警与补齐链路。销量/订单/广告：下午起才要求覆盖昨天；库存/价库按当天新鲜度。一键补齐默认只跑门禁店；本页仅超级管理员可操作。
      </p>

      <section className={`align-hero status-bar ${heroTone}`}>
        <div className="align-hero-main">
          <div className="align-stats">
            <div className="align-stat">
              <span className="align-stat-n">{incompleteShops}</span>
              <span className="align-stat-l">店有缺口</span>
            </div>
            <div className="align-stat">
              <span className="align-stat-n">{gapRows.length}</span>
              <span className="align-stat-l">缺数据项</span>
            </div>
            <div className="align-stat">
              <span className="align-stat-n">{missingDaysTotal}</span>
              <span className="align-stat-l">缺天数合计</span>
            </div>
            <div className="align-stat">
              <span className="align-stat-n">{unackedAlerts}</span>
              <span className="align-stat-l">未确认告警</span>
            </div>
          </div>
          <p className="align-hero-meta muted">
            总览 {overviewLabel}
            {expectedEnd ? ` · 期望覆盖至 ${expectedEnd}` : ""}
            {` · ${gateHint}`}
            {" · "}
            Inbox 待处理 {health.inboxPending} / 失败 {health.inboxFailed}
            {channelStats.length > 0
              ? ` · 待补链路：${channelStats
                  .map(([c, n]) => `${channelLabel(c)}×${n}`)
                  .join("、")}`
              : " · 门禁店相对期望截止日齐全"}
          </p>
          {backfillHint ? (
            <p className="align-hero-hint">{backfillHint}</p>
          ) : null}
          {backfill?.last?.finishedAt ? (
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              上次补齐：
              {new Date(backfill.last.finishedAt).toLocaleString()}
              {backfill.last.message ? ` · ${backfill.last.message}` : ""}
            </p>
          ) : null}
        </div>
        <div className="align-hero-actions">
          <button
            className="btn btn-primary align-cta"
            type="button"
            disabled={backfillRunning || Boolean(busy)}
            onClick={() => void runDataBackfill()}
          >
            {backfillRunning ? "补齐中…" : "一键补齐"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void refresh()}
          >
            重新审计
          </button>
          <Link className="btn" to="/noon">
            NOON 接入
          </Link>
        </div>
      </section>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>待对齐明细</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          按店×数据域列出：本地已到哪天、还差几天、应由哪条链路补齐。日历域（销量/订单/广告）盯尾部滞后；库存/价库/费用按快照新鲜度。
        </p>
        {gaps == null ? (
          <p className="muted">缺口审计加载中或接口不可用</p>
        ) : gapRows.length === 0 ? (
          <p>
            <span className={`badge ${tone("ok")}`}>全部齐全</span>
            <span className="muted" style={{ marginLeft: 8 }}>
              各店相对期望截止日无缺口
            </span>
          </p>
        ) : (
          <div className="align-table-wrap">
            <table className="table align-gap-table">
              <thead>
                <tr>
                  <th>店铺</th>
                  <th>数据域</th>
                  <th>本地最大日</th>
                  <th>期望截止</th>
                  <th>缺天数</th>
                  <th>建议覆盖</th>
                  <th>补齐链路</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {gapRows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.shopName}
                      <div className="muted">{r.shopId}</div>
                    </td>
                    <td>{domainLabel(r.domain)}</td>
                    <td>{r.maxDate ?? "无"}</td>
                    <td>{r.expectedEnd}</td>
                    <td>
                      <span
                        className={`badge ${r.missingCount > 0 ? tone("warn") : tone("idle")}`}
                      >
                        {r.missingCount}
                      </span>
                    </td>
                    <td className="muted">
                      {r.fillFrom && r.fillTo
                        ? `${r.fillFrom}～${r.fillTo}`
                        : "—"}
                    </td>
                    <td>
                      <span className="align-channel">
                        {channelLabel(r.channel)}
                      </span>
                    </td>
                    <td className="muted align-msg" title={r.message}>
                      {r.message}
                      {r.missingDates.length > 0 &&
                      r.missingDates.length <= 14 ? (
                        <div className="align-missing-days">
                          {r.missingDates.join("、")}
                        </div>
                      ) : r.missingDates.length > 14 ? (
                        <div className="align-missing-days">
                          {r.missingDates.slice(0, 8).join("、")}… 共{" "}
                          {r.missingDates.length} 天
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {backfill?.last?.actions && backfill.last.actions.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary className="muted">上次一键补齐动作明细</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {backfill.last.actions.map((a, idx) => (
                <li key={`${a.shopId}-${a.domain}-${idx}`} className="muted">
                  [{a.ok ? "ok" : a.skipped ? "skip" : "fail"}] {a.shopId} ·{" "}
                  {domainLabel(a.domain)} · {a.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="row" style={{ justifyContent: "space-between" }}>
          <span>同步告警</span>
          {alerts.length > 0 && (
            <button
              className="btn"
              type="button"
              disabled={busy === "clear-alerts"}
              onClick={() => clearAlerts()}
            >
              {busy === "clear-alerts" ? "清空中…" : "清空全部"}
            </button>
          )}
        </h3>
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
                  <button
                    className="btn"
                    type="button"
                    onClick={() => ack(alert.id)}
                  >
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

      <details className="card align-advanced" style={{ marginBottom: 16 }}>
        <summary>
          <strong>通道与任务明细</strong>
          <span className="muted">
            {" "}
            · 按域手动同步、游标、Inbox、本地订单条数
          </span>
        </summary>

        <div className="grid-3" style={{ margin: "16px 0" }}>
          <div>
            <h4 style={{ margin: "0 0 4px" }}>订单游标</h4>
            <p className="muted" style={{ margin: 0 }}>
              {health.cursors.ordersSince
                ? new Date(health.cursors.ordersSince).toLocaleString()
                : "尚未拉取"}
            </p>
          </div>
          <div>
            <h4 style={{ margin: "0 0 4px" }}>Catalog 游标</h4>
            <p className="muted" style={{ margin: 0 }}>
              {health.cursors.catalogSince
                ? new Date(health.cursors.catalogSince).toLocaleString()
                : "尚未拉取"}
            </p>
          </div>
          <div>
            <h4 style={{ margin: "0 0 4px" }}>库存游标</h4>
            <p className="muted" style={{ margin: 0 }}>
              {health.cursors.stockSince
                ? new Date(health.cursors.stockSince).toLocaleString()
                : "尚未拉取"}
            </p>
          </div>
        </div>

        {health.domains && (
          <>
            <h4>各类数据条数</h4>
            <table className="table">
              <thead>
                <tr>
                  <th>数据</th>
                  <th>本地条数</th>
                  <th>慧运营主页面</th>
                  <th>最近成功</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(health.domains).map(([domain, info]) => (
                  <tr key={domain}>
                    <td>{domainLabel(domain)}</td>
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
              <p className="muted">最近入库：{health.lastImportSummary}</p>
            )}
          </>
        )}

        <h4>从 Noon 拉取的任务</h4>
        <table className="table">
          <thead>
            <tr>
              <th>数据</th>
              <th>状态</th>
              <th>待处理</th>
              <th>延迟（分钟）</th>
              <th>最近成功</th>
              <th>错误</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {health.jobs.map((job) => (
              <tr key={job.id}>
                <td>{domainLabel(job.domain)}</td>
                <td>
                  <span className={`badge ${tone(job.status)}`}>
                    {statusLabel(job.status)}
                  </span>
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

        <div className="grid-2" style={{ marginTop: 16 }}>
          <div>
            <h4>Inbox 原始事件</h4>
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
                      暂无事件
                    </td>
                  </tr>
                )}
                {inbox.slice(0, 12).map((e) => (
                  <tr key={e.id}>
                    <td>{e.source}</td>
                    <td>{domainLabel(e.domain)}</td>
                    <td>{e.entityKey}</td>
                    <td>
                      <span
                        className={`badge ${tone(e.status === "failed" ? "failed" : e.status === "processed" ? "success" : "warning")}`}
                      >
                        {statusLabel(e.status)}
                      </span>
                    </td>
                    <td className="muted">
                      {new Date(e.receivedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4>已同步订单（来自 NOON）</h4>
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
                    <td className="muted">
                      {new Date(o.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
