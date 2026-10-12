import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ShipPlanBrief,
  type ShipPlanCargoGap,
  type ShipPlanDetail,
  type ShipPlanForwarderRollup,
  type ShipPlanLine,
  type ShipPlanSummary,
} from "../api";
import { ChevronSelect } from "../components/ChevronSelect";
import { ClearableInput } from "../components/ClearableInput";
import { useIsAdmin } from "../components/DataFreshnessBanner";

const FORWARDERS = [
  "亦邦",
  "飞坦",
  "汉沙",
  "亚优汇",
  "义特",
  "安时达",
  "起克",
] as const;

type LineFilter = "all" | "unassigned" | "pending" | "partial" | "done" | "skip";

const STATUS_LABEL: Record<string, string> = {
  unassigned: "待填货代",
  pending: "待发",
  partial: "部分已发",
  done: "已发完",
  skip: "不补货",
};

function modeLabel(m: string): string {
  return m === "sea" ? "海运" : "空运";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = String(reader.result ?? "");
      const i = r.indexOf(",");
      resolve(i >= 0 ? r.slice(i + 1) : r);
    };
    reader.onerror = () => reject(new Error("读文件失败"));
    reader.readAsDataURL(file);
  });
}

function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return true;
  const t = (file.type || "").toLowerCase();
  return (
    t.includes("spreadsheet") ||
    t.includes("excel") ||
    t === "application/vnd.ms-excel" ||
    t ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

function DropImportZone({
  busy,
  enabled,
  compact,
  onPick,
  onFile,
}: {
  busy: boolean;
  enabled: boolean;
  compact?: boolean;
  onPick: () => void;
  onFile: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  if (!enabled) return null;

  return (
    <div
      className={[
        "sp-drop",
        compact ? "sp-drop-compact" : "",
        dragOver ? "sp-drop-active" : "",
        busy ? "sp-drop-busy" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setDragOver(false);
        if (busy) return;
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        if (!isExcelFile(file)) {
          window.alert("请拖入 .xlsx / .xls 补货计划表");
          return;
        }
        onFile(file);
      }}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!busy) onPick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!busy) onPick();
        }
      }}
    >
      <div className="sp-drop-inner">
        <strong>{dragOver ? "松开即可导入" : "拖入补货计划表"}</strong>
        <span className="muted">
          {compact
            ? "支持 .xlsx / .xls，也可点击选择文件"
            : "固定格式：PSKU / 名称 / 库存 / 在途 / 月销 / 建议空运 / 建议海运 / √或「不补货」 / 备注"}
        </span>
        {!compact ? (
          <span className="sp-drop-cta">{busy ? "导入中…" : "或点击选择文件"}</span>
        ) : null}
      </div>
    </div>
  );
}

function SummaryChips({ s }: { s: ShipPlanSummary }) {
  return (
    <div className="sp-chips">
      <span className="sp-chip">
        纳入 <b>{s.includeCount}</b>
      </span>
      <span className="sp-chip">
        待填货代 <b>{s.unassignedCount}</b>
      </span>
      <span className="sp-chip">
        待发 <b>{s.pendingCount}</b>
      </span>
      <span className="sp-chip">
        部分已发 <b>{s.partialCount}</b>
      </span>
      <span className="sp-chip">
        已发完 <b>{s.doneCount}</b>
      </span>
      <span className="sp-chip warn">
        缺货性 <b>{s.cargoGapCount}</b>
      </span>
      <span className="sp-chip">
        计划 {s.totalShipped}/{s.totalPlanned} 件
      </span>
      <span className="sp-chip muted">
        建议空{s.totalSuggestAir} / 海{s.totalSuggestSea}
      </span>
    </div>
  );
}

function ForwarderBoard({ rows }: { rows: ShipPlanForwarderRollup[] }) {
  if (!rows.length) {
    return (
      <p className="muted sp-hint">
        为发货腿填入货代后，这里会汇总「谁走哪家、空/海各多少、还缺哪些货性」。
      </p>
    );
  }
  return (
    <div className="sp-table-wrap">
      <table className="table sp-table">
        <thead>
          <tr>
            <th>货代</th>
            <th>SKU</th>
            <th>空运</th>
            <th>海运</th>
            <th>已发</th>
            <th>货性已标</th>
            <th>货性待补</th>
            <th>货性分布（件数）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.forwarder}>
              <td style={{ fontWeight: 650 }}>{r.forwarder}</td>
              <td>{r.skuCount}</td>
              <td>{r.airQty}</td>
              <td>{r.seaQty}</td>
              <td>{r.shippedQty}</td>
              <td>{r.withCargoKind}</td>
              <td className={r.missingCargoKind ? "sp-danger" : undefined}>
                {r.missingCargoKind}
              </td>
              <td className="muted" style={{ fontSize: 12 }}>
                {Object.entries(r.byCargoKind)
                  .map(([k, n]) => `${k}×${n}`)
                  .join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CargoGapPanel({
  gaps,
  options,
  onSave,
  busy,
}: {
  gaps: ShipPlanCargoGap[];
  options: Array<{ value: string; label: string }>;
  onSave: (
    items: Array<{ partnerSku: string; forwarder: string; cargoKind: string }>,
  ) => Promise<void>;
  busy: boolean;
}) {
  const missing = gaps.filter((g) => !g.cargoKind);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const g of gaps) {
      const key = `${g.partnerSku}\0${g.forwarder}`;
      next[key] = g.cargoKind ?? draft[key] ?? "";
    }
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaps]);

  if (!gaps.length) {
    return <p className="muted sp-hint">填货代后才会出现货性缺口清单。</p>;
  }

  return (
    <div className="sp-gap">
      <div className="sp-gap-head">
        <strong>货代 × 货性补齐</strong>
        <span className="muted">
          待补 {missing.length} / 共 {gaps.length}（写入本机 cargo-hints，与物流页同源）
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            const items = Object.entries(draft)
              .filter(([, kind]) => !!kind)
              .map(([key, cargoKind]) => {
                const [partnerSku, forwarder] = key.split("\0");
                return { partnerSku: partnerSku!, forwarder: forwarder!, cargoKind };
              });
            void onSave(items);
          }}
        >
          保存已选货性
        </button>
      </div>
      <div className="sp-table-wrap">
        <table className="table sp-table">
          <thead>
            <tr>
              <th>PSKU</th>
              <th>品名</th>
              <th>货代</th>
              <th>方式</th>
              <th>件数</th>
              <th>货性</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => {
              const key = `${g.partnerSku}\0${g.forwarder}`;
              return (
                <tr key={key} className={g.cargoKind ? undefined : "sp-row-gap"}>
                  <td className="mono">{g.partnerSku}</td>
                  <td>{g.productName || "—"}</td>
                  <td>{g.forwarder}</td>
                  <td>{g.modes.map(modeLabel).join("/")}</td>
                  <td>{g.plannedQty}</td>
                  <td>
                    <ChevronSelect
                      className="sp-select"
                      triggerClassName="input"
                      value={draft[key] ?? ""}
                      placeholder="未标注"
                      options={[
                        { value: "", label: "未标注" },
                        ...options,
                      ]}
                      onChange={(next) =>
                        setDraft((d) => ({ ...d, [key]: next }))
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LineCard({
  planId,
  line,
  options,
  onChanged,
}: {
  planId: string;
  line: ShipPlanLine;
  options: Array<{ value: string; label: string }>;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [shipQty, setShipQty] = useState<Record<string, string>>({});
  const [suggest, setSuggest] = useState<string>("");

  const st = line.status ?? (line.include ? "pending" : "skip");

  async function saveLeg(
    legId: string | undefined,
    patch: {
      forwarder?: string;
      mode?: "air" | "sea";
      qty?: number;
      cargoKind?: string;
      status?: "cancelled" | "pending";
    },
  ) {
    setBusy(true);
    setErr("");
    try {
      await api.upsertShipPlanLeg(planId, line.id, { legId, ...patch });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function doShip(legId: string) {
    const n = Number(shipQty[legId] ?? "");
    if (!Number.isFinite(n) || n <= 0) {
      setErr("请输入本次发出件数");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api.shipPlanLegShip(planId, line.id, legId, n);
      setShipQty((s) => ({ ...s, [legId]: "" }));
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "登记失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadSuggest() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.suggestShipPlanChannel(planId, line.partnerSku);
      const d = r.data;
      if (!d?.preferred && !d?.channels?.length) {
        setSuggest("暂无历史渠道");
      } else {
        const pref = d.preferred
          ? `常用：${d.preferred.forwarder} ${modeLabel(d.preferred.mode)}（${d.preferred.pcs}件）`
          : "";
        const rest = (d.channels ?? [])
          .slice(0, 3)
          .map(
            (c) =>
              `${c.forwarder}/${modeLabel(c.mode)}×${c.pcs}${c.cargoKind ? `(${c.cargoKind})` : ""}`,
          )
          .join(" · ");
        setSuggest([pref, rest].filter(Boolean).join("；"));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "查询历史失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`sp-line sp-line-${st}`}>
      <header className="sp-line-head">
        <div>
          <div className="sp-line-title">
            <code>{line.partnerSku}</code>
            <span>{line.productName || "—"}</span>
            <em className={`sp-status sp-status-${st}`}>
              {STATUS_LABEL[st] ?? st}
            </em>
          </div>
          <div className="sp-line-meta muted">
            {line.planDate ? `计划日 ${line.planDate}` : "计划日未定"}
            {" · "}库存 {line.stock ?? "—"} / 在途 {line.inTransit ?? "—"} / 月销{" "}
            {line.monthlySales ?? "—"}
            {" · "}建议空{line.suggestAir ?? 0} / 海{line.suggestSea ?? 0}
            {line.note ? ` · ${line.note}` : ""}
          </div>
        </div>
        <div className="sp-line-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void loadSuggest()}
          >
            历史渠道
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void saveLeg(undefined, {
                mode: "air",
                qty: 1,
                forwarder: "",
              })
            }
          >
            + 拆一腿
          </button>
        </div>
      </header>
      {suggest ? <p className="sp-suggest">{suggest}</p> : null}
      {err ? <p className="sp-err">{err}</p> : null}

      {!line.include ? (
        <p className="muted">表内标记不补货。</p>
      ) : line.legs.filter((l) => l.status !== "cancelled").length === 0 ? (
        <p className="muted">无计划件数；可点「拆一腿」手工加空/海运。</p>
      ) : (
        <div className="sp-legs">
          {line.legs
            .filter((l) => l.status !== "cancelled")
            .map((leg) => {
              const remain = Math.max(0, leg.qty - leg.shippedQty);
              return (
                <div key={leg.id} className="sp-leg">
                  <ChevronSelect
                    className="sp-select"
                    triggerClassName="input"
                    value={leg.mode}
                    disabled={busy}
                    options={[
                      { value: "air", label: "空运" },
                      { value: "sea", label: "海运" },
                    ]}
                    onChange={(next) =>
                      void saveLeg(leg.id, {
                        mode: next as "air" | "sea",
                      })
                    }
                  />
                  <ChevronSelect
                    className="sp-select"
                    triggerClassName="input"
                    value={leg.forwarder}
                    disabled={busy}
                    placeholder="选货代…"
                    options={[
                      { value: "", label: "选货代…" },
                      ...FORWARDERS.map((f) => ({ value: f, label: f })),
                      ...(leg.forwarder &&
                      !(FORWARDERS as readonly string[]).includes(leg.forwarder)
                        ? [{ value: leg.forwarder, label: leg.forwarder }]
                        : []),
                    ]}
                    onChange={(next) =>
                      void saveLeg(leg.id, { forwarder: next })
                    }
                  />
                  <label className="sp-qty">
                    计划
                    <ClearableInput
                      className="input"
                      type="number"
                      min={0}
                      value={leg.qty}
                      disabled={busy}
                      onChange={(e) =>
                        void saveLeg(leg.id, { qty: Number(e.target.value) })
                      }
                    />
                  </label>
                  <span className="muted">
                    已发 {leg.shippedQty} · 剩 {remain}
                  </span>
                  <ChevronSelect
                    className="sp-select"
                    triggerClassName="input"
                    value={leg.cargoKind || ""}
                    disabled={busy || !leg.forwarder}
                    title={!leg.forwarder ? "先选货代" : "货性"}
                    placeholder="货性…"
                    options={[
                      { value: "", label: "货性…" },
                      ...options,
                    ]}
                    onChange={(next) =>
                      void saveLeg(leg.id, { cargoKind: next })
                    }
                  />
                  <ClearableInput
                    className="input sp-ship-input"
                    type="number"
                    min={1}
                    max={remain || undefined}
                    placeholder="本次发"
                    disabled={busy || remain <= 0 || !leg.forwarder}
                    value={shipQty[leg.id] ?? ""}
                    onChange={(e) =>
                      setShipQty((s) => ({ ...s, [leg.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || remain <= 0 || !leg.forwarder}
                    onClick={() => void doShip(leg.id)}
                  >
                    登记发出
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void saveLeg(leg.id, { status: "cancelled" })}
                  >
                    取消
                  </button>
                </div>
              );
            })}
        </div>
      )}
    </article>
  );
}

export function ShipPlanPanel() {
  const isAdmin = useIsAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [briefs, setBriefs] = useState<ShipPlanBrief[]>([]);
  const [planId, setPlanId] = useState("");
  const [detail, setDetail] = useState<ShipPlanDetail | null>(null);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState<LineFilter>("all");
  const [planDate, setPlanDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [tab, setTab] = useState<"lines" | "forwarder" | "cargo">("lines");

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  const refreshList = useCallback(async () => {
    const r = await api.listShipPlans();
    setBriefs(r.data);
    if (!planId && r.data[0]) setPlanId(r.data[0].id);
  }, [planId]);

  const loadDetail = useCallback(
    async (id: string, opts?: { q?: string; status?: string; planDate?: string }) => {
      if (!id) {
        setDetail(null);
        return;
      }
      const r = await api.getShipPlan(id, {
        q: opts?.q,
        status: opts?.status,
        planDate: opts?.planDate,
      });
      setDetail(r.data);
    },
    [],
  );

  const refreshDetail = useCallback(async () => {
    await loadDetail(planId, {
      q: qDebounced || undefined,
      status: status === "all" ? undefined : status,
      planDate: planDate || undefined,
    });
  }, [loadDetail, planId, qDebounced, status, planDate]);

  useEffect(() => {
    refreshList().catch((e: Error) => setError(e.message));
  }, [refreshList]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    loadDetail(planId, {
      q: qDebounced || undefined,
      status: status === "all" ? undefined : status,
      planDate: planDate || undefined,
    })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadDetail, planId, qDebounced, status, planDate]);

  async function importFile(file: File) {
    setBusy(true);
    setError("");
    setHint("");
    try {
      const base64 = await fileToBase64(file);
      const r = await api.importShipPlan({
        filename: file.name,
        base64,
        name: file.name.replace(/\.[^.]+$/, ""),
      });
      setHint(
        r.data.warnings?.length
          ? `${r.message || "导入成功"}（提示 ${r.data.warnings.length} 条）`
          : r.message || "导入成功",
      );
      const newId = r.data.id;
      setPlanId(newId);
      setStatus("all");
      setPlanDate("");
      setQ("");
      setQDebounced("");
      setTab("lines");
      const list = await api.listShipPlans();
      setBriefs(list.data);
      await loadDetail(newId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function importDesktopPath() {
    setBusy(true);
    setError("");
    setHint("");
    try {
      const r = await api.importShipPlan({
        filePath: "D:\\Desktop\\补货(3).xlsx",
        filename: "补货(3).xlsx",
        name: "补货(3)",
      });
      setHint(r.message || "导入成功");
      const newId = r.data.id;
      setPlanId(newId);
      setStatus("all");
      setPlanDate("");
      setQ("");
      setQDebounced("");
      setTab("lines");
      const list = await api.listShipPlans();
      setBriefs(list.data);
      await loadDetail(newId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  const dateOptions = useMemo(() => {
    const fromSummary = detail?.summary.planDates ?? [];
    const fromBrief =
      briefs.find((b) => b.id === planId)?.summary.planDates ?? [];
    return [...new Set([...fromSummary, ...fromBrief])].filter(Boolean).sort();
  }, [detail, briefs, planId]);

  const lines = detail?.doc.lines ?? [];

  return (
    <div className="sp-panel">
      <div className="sp-toolbar">
        <div className="sp-toolbar-main">
          <p className="sp-lead">
            导入固定格式补货表后，按「发什么 / 哪家货代 / 空还是海」整理；可拆腿、可先发一部分。
            货代×货性缺口在下方补齐（本机保存）。
          </p>
          <div className="sp-toolbar-actions">
            {isAdmin ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  上传 xlsx
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void importDesktopPath()}
                  title="读取 D:\Desktop\补货(3).xlsx"
                >
                  导入桌面「补货(3)」
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void importFile(f);
                  }}
                />
              </>
            ) : (
              <span className="muted">导入需管理员</span>
            )}
            <ChevronSelect
              className="sp-select"
              triggerClassName="input"
              value={planId}
              placeholder="选择已导入计划…"
              options={[
                { value: "", label: "选择已导入计划…" },
                ...briefs.map((b) => ({
                  value: b.id,
                  label: `${b.name}（${b.summary.includeCount} 品 · ${b.importedAt.slice(0, 10)}）`,
                })),
              ]}
              onChange={setPlanId}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !planId}
              onClick={() => void refreshDetail()}
            >
              刷新
            </button>
            {isAdmin && planId ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("删除该发货计划？")) return;
                  void api
                    .deleteShipPlan(planId)
                    .then(async () => {
                      setPlanId("");
                      setDetail(null);
                      await refreshList();
                    })
                    .catch((e: Error) => setError(e.message));
                }}
              >
                删除计划
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {hint ? <p className="muted">{hint}</p> : null}
      {error ? <p className="sp-err">{error}</p> : null}

      {isAdmin ? (
        <DropImportZone
          busy={busy}
          enabled
          compact={!!detail}
          onPick={() => fileRef.current?.click()}
          onFile={(f) => void importFile(f)}
        />
      ) : null}

      {detail ? (
        <>
          <SummaryChips s={detail.summary} />

          <div className="rep-tabs" role="tablist">
            {(
              [
                ["lines", "发货明细"],
                ["forwarder", "货代汇总"],
                ["cargo", "货性补齐"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                className={tab === k ? "rep-tab rep-tab-active" : "rep-tab"}
                onClick={() => setTab(k)}
              >
                {label}
                {k === "cargo" && detail.summary.cargoGapCount > 0 ? (
                  <span className="rep-tab-n">{detail.summary.cargoGapCount}</span>
                ) : null}
              </button>
            ))}
          </div>

          {tab === "forwarder" ? (
            <ForwarderBoard rows={detail.forwarderRollup} />
          ) : null}

          {tab === "cargo" ? (
            <CargoGapPanel
              gaps={detail.cargoGaps}
              options={detail.cargoKindOptions}
              busy={busy}
              onSave={async (items) => {
                setBusy(true);
                setError("");
                try {
                  const r = await api.fillShipPlanCargoGaps(planId, items);
                  setHint(r.message || "已保存");
                  await refreshDetail();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "保存失败");
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}

          {tab === "lines" ? (
            <>
              <div className="sp-filters">
                {(
                  [
                    "all",
                    "unassigned",
                    "pending",
                    "partial",
                    "done",
                    "skip",
                  ] as LineFilter[]
                ).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={
                      status === k ? "rep-tab rep-tab-active" : "rep-tab"
                    }
                    onClick={() => setStatus(k)}
                  >
                    {k === "all" ? "全部" : STATUS_LABEL[k]}
                  </button>
                ))}
                <ChevronSelect
                  className="sp-select"
                  triggerClassName="input"
                  value={planDate}
                  placeholder="全部计划日"
                  options={[
                    { value: "", label: "全部计划日" },
                    { value: "none", label: "未定日期" },
                    ...dateOptions.map((d) => ({ value: d, label: d })),
                  ]}
                  onChange={setPlanDate}
                />
                <ClearableInput
                  className="input rep-search"
                  placeholder="搜 PSKU / 品名 / 货代"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              {lines.length === 0 ? (
                <div className="sp-empty-lines">
                  <p className="muted">
                    {busy
                      ? "加载明细中…"
                      : detail.summary.lineCount > 0
                        ? "当前筛选无行，可切回「全部」或清空搜索。"
                        : "该计划没有明细行。"}
                  </p>
                  {isAdmin && !busy ? (
                    <DropImportZone
                      busy={busy}
                      enabled
                      onPick={() => fileRef.current?.click()}
                      onFile={(f) => void importFile(f)}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="sp-lines">
                  {lines.map((line) => (
                    <LineCard
                      key={line.id}
                      planId={planId}
                      line={line}
                      options={detail.cargoKindOptions}
                      onChanged={refreshDetail}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}
        </>
      ) : (
        <div className="sp-empty-lines" style={{ marginTop: 8 }}>
          {busy ? (
            <p className="muted">加载中…</p>
          ) : isAdmin ? null : (
            <p className="muted">
              尚未导入发货计划。请联系管理员上传固定格式补货表。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
