import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type OpsDailyRunMeta,
  type OpsDailyRunResult,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";

/**
 * Outpost 日更流水线 UI（自有命名与版式）。
 * 能力顺序与旧 Prep 一致，但不以 0.0/.tfl/「从上到下点」作为对外话术。
 */

const PREVIEW_COLS = [
  "日期",
  "PSKU",
  "SKU",
  "产品名称",
  "当前在线状态",
  "在线价",
  "30销量",
  "30访客",
  "FBN",
  "0-90天",
  "空运在途",
  "海运在途",
  "已采购数量",
  "30广告花费",
] as const;

type StepId = "sync" | "ready" | "panel" | "fees";
type StepStatus = "idle" | "running" | "ok" | "skip" | "fail";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtIso(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

function statusLabel(s: StepStatus): string {
  if (s === "running") return "进行中";
  if (s === "ok") return "已完成";
  if (s === "skip") return "可跳过";
  if (s === "fail") return "失败";
  return "未开始";
}

function statusTone(s: StepStatus): string {
  if (s === "ok") return "var(--ok)";
  if (s === "fail") return "var(--danger)";
  if (s === "running") return "var(--warn, #b80)";
  return "var(--muted)";
}

export function OpsDailyPage() {
  const [shopId, setShopId] = useState("");
  const [shops, setShops] = useState<Array<{ id: string; name: string }>>([]);
  const [todayShanghai, setTodayShanghai] = useState("");
  const [asOfMode, setAsOfMode] = useState<"today" | "fixed">("today");
  const [asOfFixed, setAsOfFixed] = useState("2026-09-28");
  const [statusDir, setStatusDir] = useState("");
  const [artifacts, setArtifacts] = useState<
    Array<{
      name: string;
      kind: string;
      sizeBytes: number;
      mtimeIso: string;
    }>
  >([]);
  const [settings, setSettings] = useState<{
    phase: number;
    timezone: string;
    feishu_product_writeback: boolean;
  } | null>(null);
  const [lastRun, setLastRun] = useState<OpsDailyRunResult | null>(null);
  const [previewRows, setPreviewRows] = useState<
    Array<Record<string, string | number>>
  >([]);
  const [previewMeta, setPreviewMeta] = useState<OpsDailyRunMeta | null>(null);
  const [previewAsOf, setPreviewAsOf] = useState("");
  const [previewCount, setPreviewCount] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [showLegacyMap, setShowLegacyMap] = useState(false);
  const [stepStatus, setStepStatus] = useState<Record<StepId, StepStatus>>({
    sync: "idle",
    ready: "idle",
    panel: "idle",
    fees: "idle",
  });
  const [stepMsg, setStepMsg] = useState<Record<StepId, string>>({
    sync: "",
    ready: "",
    panel: "",
    fees: "",
  });

  const effectiveAsOf = useMemo(() => {
    if (asOfMode === "today") return "";
    return asOfFixed.trim().slice(0, 10);
  }, [asOfMode, asOfFixed]);

  const setStep = (id: StepId, status: StepStatus, msg = "") => {
    setStepStatus((prev) => ({ ...prev, [id]: status }));
    if (msg) setStepMsg((prev) => ({ ...prev, [id]: msg }));
  };

  const refreshStatus = useCallback(async (sid?: string) => {
    const res = await api.getOpsDailyStatus(sid);
    setShopId(res.shopId);
    setTodayShanghai(res.todayShanghai);
    setStatusDir(res.dir);
    setArtifacts(res.artifacts);
    setSettings(res.settings);
    return res;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shopsRes = await api.getShops();
        if (cancelled) return;
        const list = (shopsRes.data.shops ?? []).map((s) => ({
          id: s.id,
          name: s.name || s.id,
        }));
        setShops(list);
        const active = shopsRes.data.activeShopId || list[0]?.id || "";
        await refreshStatus(active || undefined);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  async function onShopChange(next: string) {
    setError("");
    try {
      if (next && next !== shopId) await api.setActiveShop(next);
      await refreshStatus(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadPreview(asOfOverride?: string) {
    const asOf = asOfOverride ?? (effectiveAsOf || undefined);
    const res = await api.getOpsDailyPanel({
      shopId,
      asOf,
      limit: 30,
    });
    setPreviewRows(res.rows);
    setPreviewMeta(res.meta);
    setPreviewAsOf(res.asOf);
    setPreviewCount(res.rowCount);
  }

  async function runSync() {
    setError("");
    setBusy(true);
    setStep("sync", "running", "正在同步 Noon / 广告 / 飞书…");
    try {
      const res = await api.assemblySync({ skipOpsDaily: true });
      const msg = res.message ?? res.data.message ?? "同步完成";
      setStep("sync", "ok", msg);
      setStep(
        "ready",
        "ok",
        "主数据已在系统内（Catalog · 飞书 · 费率），可直接产出",
      );
      setHint(msg);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setStep("sync", "fail", m);
      setError(m);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function runProduce() {
    setError("");
    setBusy(true);
    setStep("panel", "running", "正在写运营面板…");
    setStep("fees", "running", "正在写费用与到仓…");
    try {
      const body: { shopId?: string; asOf?: string } = { shopId };
      if (effectiveAsOf) body.asOf = effectiveAsOf;
      const res = await api.runOpsDaily(body);
      setLastRun(res);
      if (!res.ok) {
        setStep("panel", "fail", res.message);
        setStep("fees", "fail", res.message);
        setError(res.message);
        return res;
      }
      setStep("panel", "ok", `${res.rowCount} 行 · asOf ${res.asOf}`);
      setStep(
        "fees",
        "ok",
        `周费用 ${res.meta.weeklyFeeRows ?? 0} · 到仓 ${res.meta.landedCostRows ?? 0}`,
      );
      if (stepStatus.ready === "idle") {
        setStep("ready", "ok", "使用当前店铺 state");
      }
      setHint(res.message);
      await refreshStatus(shopId);
      await loadPreview(res.asOf);
      return res;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setStep("panel", "fail", m);
      setStep("fees", "fail", m);
      setError(m);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function runFullPipeline() {
    setError("");
    setHint("流水线执行中：同步 → 就绪 → 产出…");
    try {
      await runSync();
      await runProduce();
      setHint("本店日更流水线已跑完");
    } catch {
      /* 步骤状态已记 */
    }
  }

  const meta = lastRun?.meta ?? previewMeta;

  const stages: Array<{
    id: StepId;
    no: string;
    title: string;
    tag: string;
    blurb: string;
    actionLabel?: string;
    onAction?: () => void;
    auto?: boolean;
  }> = [
    {
      id: "sync",
      no: "01",
      title: "同步取数",
      tag: "日更",
      blurb: "把 Noon、广告落盘、飞书本地拉进本店系统。本步只取数，不写面板文件。",
      actionLabel: stepStatus.sync === "running" ? "同步中…" : "同步取数",
      onAction: () => void runSync(),
    },
    {
      id: "ready",
      no: "02",
      title: "主数据就绪",
      tag: "自动",
      blurb: "在线状态、尺寸、采购、费率等已在 Outpost state，无需单独操作。",
      auto: true,
    },
    {
      id: "panel",
      no: "03",
      title: "产出日报",
      tag: "日更",
      blurb: "生成 48 列运营面板 CSV（销量、访客、库龄、在途、广告窗等）。",
      actionLabel:
        stepStatus.panel === "running" ? "产出中…" : "产出日报 + 费用",
      onAction: () => void runProduce(),
    },
    {
      id: "fees",
      no: "04",
      title: "产出费用",
      tag: "周更可日跑",
      blurb: "佣金/出库费与到仓成本旁路 CSV；与「产出日报」同一次写入。飞书回写默认关。",
      auto: true,
    },
  ];

  const railDone = (["sync", "ready", "panel", "fees"] as StepId[]).filter(
    (id) => stepStatus[id] === "ok" || stepStatus[id] === "skip",
  ).length;

  return (
    <div className="ops-rail">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            日更流水线
          </h1>
          <p className="page-desc" style={{ margin: 0 }}>
            Outpost 旁路产出：本店 <code>ops_daily/</code> 下的运营面板与费用表。
            不写入 Catalog 主存。
          </p>
        </div>
        <div
          className="muted"
          style={{
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 8,
            background: "var(--accent-soft)",
            color: "var(--accent-hover)",
            whiteSpace: "nowrap",
          }}
        >
          Ops Rail · Phase {settings?.phase ?? 4}
        </div>
      </div>

      {/* 控制台 */}
      <div
        className="card"
        style={{
          marginTop: 14,
          marginBottom: 16,
          background:
            "linear-gradient(135deg, var(--accent-soft) 0%, transparent 55%)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
            <div className="field">
              <label>店铺</label>
              <select
                className="input"
                value={shopId}
                disabled={busy}
                onChange={(e) => void onShopChange(e.target.value)}
              >
                {shops.length === 0 ? (
                  <option value={shopId}>{shopId || "…"}</option>
                ) : (
                  shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="field">
              <label>业务日（上海）</label>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <label style={{ display: "flex", gap: 4, fontSize: 13 }}>
                  <input
                    type="radio"
                    checked={asOfMode === "today"}
                    disabled={busy}
                    onChange={() => setAsOfMode("today")}
                  />
                  今天 {todayShanghai}
                </label>
                <label style={{ display: "flex", gap: 4, fontSize: 13 }}>
                  <input
                    type="radio"
                    checked={asOfMode === "fixed"}
                    disabled={busy}
                    onChange={() => setAsOfMode("fixed")}
                  />
                  指定日
                </label>
                <ClearableInput
                  className="input"
                  type="date"
                  style={{ width: 140 }}
                  value={asOfFixed}
                  disabled={asOfMode !== "fixed" || busy}
                  onChange={(e) => setAsOfFixed(e.target.value)}
                />
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !shopId}
            onClick={() => void runFullPipeline()}
            style={{ minWidth: 160, fontWeight: 650 }}
          >
            {busy ? "流水线执行中…" : "跑完整条流水线"}
          </button>
        </div>

        {/* 进度轨 */}
        <div style={{ marginTop: 16 }}>
          <div
            className="muted"
            style={{
              fontSize: 12,
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>进度 {railDone}/4</span>
            <span>
              {busy ? "执行中" : railDone === 4 ? "本轮完成" : "待命"}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
            }}
          >
            {stages.map((s) => {
              const st = stepStatus[s.id];
              const active = st === "running" || st === "ok";
              return (
                <div
                  key={s.id}
                  style={{
                    borderRadius: 10,
                    padding: "10px 10px 8px",
                    border: `1px solid ${
                      active
                        ? "color-mix(in srgb, var(--accent) 45%, var(--border, #ddd))"
                        : "var(--border, #ddd)"
                    }`,
                    background:
                      st === "ok"
                        ? "var(--ok-soft)"
                        : st === "running"
                          ? "var(--accent-soft)"
                          : "var(--card, #fff)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      color: "var(--accent)",
                      marginBottom: 2,
                    }}
                  >
                    {s.no}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
                  <div
                    style={{
                      fontSize: 11,
                      marginTop: 4,
                      color: statusTone(st),
                    }}
                  >
                    {statusLabel(st)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {error ? (
        <p style={{ color: "var(--danger)" }}>{error}</p>
      ) : null}
      {hint ? <p className="muted">{hint}</p> : null}

      {/* 阶段详情 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {stages.map((s, idx) => {
          const st = stepStatus[s.id];
          return (
            <div
              key={s.id}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: `2px solid ${
                      st === "ok" || st === "running"
                        ? "var(--accent)"
                        : "var(--border, #ccc)"
                    }`,
                    background:
                      st === "ok"
                        ? "var(--accent)"
                        : st === "running"
                          ? "var(--accent-soft)"
                          : "transparent",
                    boxSizing: "border-box",
                  }}
                />
                {idx < stages.length - 1 ? (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      minHeight: 28,
                      background:
                        stepStatus[stages[idx + 1]!.id] === "ok" ||
                        st === "ok"
                          ? "var(--accent-muted)"
                          : "var(--border, #ddd)",
                    }}
                  />
                ) : null}
              </div>
              <div
                className="card"
                style={{
                  marginBottom: idx < stages.length - 1 ? 10 : 0,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 650, marginBottom: 2 }}>
                    {s.title}{" "}
                    <span
                      className="muted"
                      style={{
                        fontWeight: 500,
                        fontSize: 11,
                        padding: "1px 6px",
                        borderRadius: 999,
                        border: "1px solid var(--border, #ddd)",
                      }}
                    >
                      {s.tag}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {s.blurb}
                  </p>
                  {stepMsg[s.id] ? (
                    <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                      <span style={{ color: statusTone(st) }}>
                        {statusLabel(st)}
                      </span>
                      {" · "}
                      {stepMsg[s.id]}
                    </p>
                  ) : null}
                </div>
                <div>
                  {s.onAction ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !shopId}
                      onClick={s.onAction}
                    >
                      {s.actionLabel}
                    </button>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      自动衔接
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 产物 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <h2 style={{ fontSize: 15, margin: 0 }}>产出下载</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            飞书回写{" "}
            <strong>
              {settings?.feishu_product_writeback ? "开" : "关"}
            </strong>
            {" · "}
            <Link to="/catalog">Catalog</Link>
          </span>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          <code>{statusDir || "…/ops_daily"}</code>
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <a
            className="btn"
            href={api.opsDailyDownloadUrl({
              kind: "panel",
              shopId,
              asOf: effectiveAsOf || previewAsOf || undefined,
            })}
          >
            运营面板 CSV
          </a>
          <a
            className="btn"
            href={api.opsDailyDownloadUrl({ kind: "weekly", shopId })}
          >
            周费用 CSV
          </a>
          <a
            className="btn"
            href={api.opsDailyDownloadUrl({ kind: "landed", shopId })}
          >
            到仓成本 CSV
          </a>
        </div>
        {meta ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            广告覆盖{" "}
            <strong>{meta.adsCoverage ?? "—"}</strong>
            {meta.adsCoverage === "partial" ? "（缺日可接受）" : ""}
            {lastRun?.outPath ? (
              <>
                {" · "}
                <code>{lastRun.outPath}</code>
              </>
            ) : null}
          </p>
        ) : null}
        {artifacts.length === 0 ? (
          <p className="muted">还没有文件。先点「跑完整条流水线」或「产出日报 + 费用」。</p>
        ) : (
          <table
            style={{
              width: "100%",
              fontSize: 12,
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr className="muted" style={{ textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>类型</th>
                <th style={{ padding: "4px 6px" }}>文件</th>
                <th style={{ padding: "4px 6px" }}>大小</th>
                <th style={{ padding: "4px 6px" }}>时间</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.slice(0, 12).map((a) => (
                <tr
                  key={a.name}
                  style={{ borderTop: "1px solid var(--border, #ddd)" }}
                >
                  <td style={{ padding: "6px" }}>{a.kind}</td>
                  <td style={{ padding: "6px" }}>
                    <code>{a.name}</code>
                  </td>
                  <td style={{ padding: "6px" }}>{fmtBytes(a.sizeBytes)}</td>
                  <td style={{ padding: "6px" }}>{fmtIso(a.mtimeIso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {previewRows.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>
            面板抽样 · {previewAsOf} · {previewCount} 行
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                fontSize: 11,
                borderCollapse: "collapse",
                whiteSpace: "nowrap",
              }}
            >
              <thead>
                <tr className="muted" style={{ textAlign: "left" }}>
                  {PREVIEW_COLS.map((c) => (
                    <th key={c} style={{ padding: "4px 6px" }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr
                    key={`${row.PSKU}-${i}`}
                    style={{ borderTop: "1px solid var(--border, #ddd)" }}
                  >
                    {PREVIEW_COLS.map((c) => (
                      <td key={c} style={{ padding: "4px 6px" }}>
                        {row[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* 旧工具对照：折叠，不当主叙事 */}
      <details
        style={{ marginTop: 16, fontSize: 12 }}
        open={showLegacyMap}
        onToggle={(e) =>
          setShowLegacyMap((e.target as HTMLDetailsElement).open)
        }
      >
        <summary className="muted" style={{ cursor: "pointer" }}>
          迁移对照（给熟悉旧工具的同事，可折叠）
        </summary>
        <p className="muted" style={{ marginTop: 8, lineHeight: 1.55 }}>
          旧 Tableau Prep 四段与本流水线能力大致对应：前处理≈同步取数；信息更新≈主数据就绪；日报≈产出日报；平台费用/到仓≈产出费用。
          Outpost 以系统 state 为真源，界面与文件命名按本产品设计，不是旧文件夹的复刻。
        </p>
      </details>
    </div>
  );
}
