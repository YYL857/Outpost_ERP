import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type ProvenanceSlice,
  type ReplenishPlanResponse,
  type ReplenishWorkbookResponse,
} from "../api";
import { ChevronSelect } from "../components/ChevronSelect";
import { ClearableInput } from "../components/ClearableInput";
import { InterpretPanel } from "../components/InterpretPanel";
import { PageBar } from "../components/PageBar";
import { ProductCell } from "../components/ProductCell";
import {
  AdminSyncOnlyHint,
  DataFreshnessBanner,
  useIsAdmin,
} from "../components/DataFreshnessBanner";
import { ShipPlanPanel } from "./ShipPlanPanel";

const PAGE_SIZE = 40;
const TOP_PCT_OPTIONS = [
  { value: "30", label: "30%" },
  { value: "40", label: "40%" },
  { value: "50", label: "50%" },
  { value: "100", label: "全部" },
];
const COVER_MONTHS_KEY = "outpost.replenish.coverMonths";
const DEFAULT_COVER_MONTHS = 3;

function clampCoverMonthsUi(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_COVER_MONTHS;
  const n = Math.round(raw * 10) / 10;
  if (n < 0.1) return 0.1;
  if (n > 24) return 24;
  return n;
}

function readStoredCoverMonths(): number {
  try {
    const raw = Number(localStorage.getItem(COVER_MONTHS_KEY));
    return clampCoverMonthsUi(raw);
  } catch {
    return DEFAULT_COVER_MONTHS;
  }
}

type StatusTab = "all" | "urgent" | "stable";
type ViewMode = "workbook" | "urgency" | "shipPlan";

const TAB_LABEL: Record<StatusTab, string> = {
  all: "全部",
  urgent: "紧急",
  stable: "暂稳",
};

function daysTone(days: number | null, status: string, fbn = 0): string {
  if (fbn <= 0 && status !== "skip") return "rep-days danger";
  if (days == null) return "rep-days muted";
  if (status === "urgent" || days < 7) return "rep-days danger";
  if (days < 14) return "rep-days warn";
  return "rep-days ok";
}

function fmtDays(days: number | null): string {
  if (days == null) return "—";
  if (days >= 100) return "100+";
  return String(Math.round(days * 10) / 10);
}

function shortIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n.toFixed(digits)).toString();
}

function FreshnessBar({
  today,
  slices,
  isAdmin,
}: {
  today?: string;
  slices?: ProvenanceSlice[];
  isAdmin?: boolean | null;
}) {
  if (!slices?.length) return null;
  const stale = slices.filter((s) => !s.syncedToday);
  return (
    <section className="rep-fresh">
      <div className="rep-fresh-head">
        <strong>今日入库</strong>
        <span>今天 {today ?? "—"}</span>
        {isAdmin ? (
          <Link className="btn" to="/sync-health" style={{ marginLeft: "auto" }}>
            {stale.length > 0 ? "缺口与一键补齐 → 数据对齐" : "数据对齐"}
          </Link>
        ) : null}
      </div>
      <div className="rep-fresh-chips">
        {slices.map((s) => (
          <span
            key={s.key}
            className={
              s.syncedToday ? "rep-fresh-chip ok" : "rep-fresh-chip idle"
            }
            title={s.note ?? ""}
          >
            {s.column}
            {s.syncedToday ? " · 今天已入库" : " · 不是今天"}
            <em>{shortIso(s.syncedAt)}</em>
          </span>
        ))}
      </div>
    </section>
  );
}

function weightBar(w: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(w * 100)));
  return `${pct}%`;
}

export function ReplenishPage() {
  const isAdmin = useIsAdmin();
  const [view, setView] = useState<ViewMode>("workbook");

  // ── 补货表（本地 xlsx 镜像；店前缀跟顶栏当前店）────────────
  const [wb, setWb] = useState<ReplenishWorkbookResponse | null>(null);
  const [coverMonths, setCoverMonths] = useState(readStoredCoverMonths);
  const [onlyNeed, setOnlyNeed] = useState(true);
  const [topPct, setTopPct] = useState(40);
  const [wbQuery, setWbQuery] = useState("");
  const [wbQDebounced, setWbQDebounced] = useState("");
  const [wbPage, setWbPage] = useState(1);
  const [wbPageCount, setWbPageCount] = useState(1);
  const [wbTotal, setWbTotal] = useState(0);
  const [wbLoading, setWbLoading] = useState(false);
  const [wbBusy, setWbBusy] = useState(false);
  const [wbError, setWbError] = useState("");
  const [wbHint, setWbHint] = useState("");
  const [savingSku, setSavingSku] = useState("");
  const [draftBySku, setDraftBySku] = useState<
    Record<string, { manualTag: string; note: string }>
  >({});

  // ── 旧库存预警视图────────────────────────────────────────
  const [data, setData] = useState<ReplenishPlanResponse | null>(null);
  const [query, setQuery] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [showFeishu, setShowFeishu] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [salesHint, setSalesHint] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setWbQDebounced(wbQuery), 280);
    return () => window.clearTimeout(t);
  }, [wbQuery]);

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(query), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  const prevWb = useRef({
    q: wbQDebounced,
    onlyNeed,
    topPct,
    coverMonths,
  });
  const prevQ = useRef(qDebounced);
  const prevTab = useRef(statusTab);

  useEffect(() => {
    try {
      localStorage.setItem(COVER_MONTHS_KEY, String(coverMonths));
    } catch {
      /* ignore */
    }
  }, [coverMonths]);

  async function refreshWorkbook(targetPage = wbPage) {
    setWbLoading(true);
    setWbError("");
    try {
      const res = await api.getReplenishWorkbook({
        page: targetPage,
        pageSize: PAGE_SIZE,
        q: wbQDebounced || undefined,
        onlyNeed,
        topPct: topPct > 0 && topPct < 100 ? topPct : undefined,
        coverMonths,
      });
      setWb(res.data);
      setWbTotal(res.meta?.total ?? res.data.rows.length);
      setWbPageCount(res.meta?.pageCount ?? 1);
      setWbPage(res.meta?.page ?? targetPage);
    } catch (e) {
      setWbError(e instanceof Error ? e.message : "加载补货表失败");
    } finally {
      setWbLoading(false);
    }
  }

  async function rebuildWorkbook() {
    setWbBusy(true);
    setWbError("");
    setWbHint("");
    try {
      const cur = wb?.meta?.shopPrefix?.trim().toUpperCase();
      const r = await api.rebuildReplenishWorkbook({
        prefixes: cur ? [cur] : undefined,
        coverMonths,
      });
      setWbHint(
        r.message ||
          `已写入 ${r.data.shops.map((s) => s.shopPrefix).join("、")} → ${r.data.dir}`,
      );
      await refreshWorkbook(1);
    } catch (e) {
      setWbError(e instanceof Error ? e.message : "重算失败");
    } finally {
      setWbBusy(false);
    }
  }

  function draftOf(r: {
    partnerSku: string;
    manualTag: string;
    note: string;
  }) {
    return (
      draftBySku[r.partnerSku] ?? {
        manualTag: r.manualTag || "",
        note: r.note || "",
      }
    );
  }

  function setDraft(
    partnerSku: string,
    patch: Partial<{ manualTag: string; note: string }>,
    base: { manualTag: string; note: string },
  ) {
    setDraftBySku((prev) => ({
      ...prev,
      [partnerSku]: { ...base, ...prev[partnerSku], ...patch },
    }));
  }

  async function saveManual(partnerSku: string) {
    const draft = draftBySku[partnerSku];
    const prefix = wb?.meta?.shopPrefix?.trim().toUpperCase();
    if (!draft || !prefix) return;
    setSavingSku(partnerSku);
    setWbError("");
    try {
      await api.patchReplenishWorkbookManual({
        prefix,
        partnerSku,
        manualTag: draft.manualTag,
        note: draft.note,
        coverMonths,
      });
      setDraftBySku((prev) => {
        const next = { ...prev };
        delete next[partnerSku];
        return next;
      });
      await refreshWorkbook(wbPage);
    } catch (e) {
      setWbError(e instanceof Error ? e.message : "保存标记失败");
    } finally {
      setSavingSku("");
    }
  }

  useEffect(() => {
    if (view !== "workbook") return;
    const prev = prevWb.current;
    let reset = false;
    if (
      prev.q !== wbQDebounced ||
      prev.onlyNeed !== onlyNeed ||
      prev.topPct !== topPct ||
      prev.coverMonths !== coverMonths
    ) {
      prevWb.current = {
        q: wbQDebounced,
        onlyNeed,
        topPct,
        coverMonths,
      };
      reset = true;
    }
    if (reset && wbPage !== 1) {
      setWbPage(1);
      return;
    }
    void refreshWorkbook(wbPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, wbPage, wbQDebounced, onlyNeed, topPct, coverMonths]);

  async function refresh(targetPage = page) {
    setLoading(true);
    try {
      const res = await api.getReplenishPlan({
        page: targetPage,
        pageSize: PAGE_SIZE,
        q: qDebounced || undefined,
        status: statusTab === "all" ? undefined : statusTab,
      });
      setData(res.data);
      setTotal(res.meta?.total ?? res.data.rows.length);
      setPageCount(res.meta?.pageCount ?? 1);
      setPage(res.meta?.page ?? targetPage);
      if ((res.data.summary.withFeishuPlan ?? 0) > 0) {
        setShowFeishu(true);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (view !== "urgency") return;
    let reset = false;
    if (prevQ.current !== qDebounced) {
      prevQ.current = qDebounced;
      reset = true;
    }
    if (prevTab.current !== statusTab) {
      prevTab.current = statusTab;
      reset = true;
    }
    if (reset && page !== 1) {
      setPage(1);
      return;
    }
    refresh(page).catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, page, qDebounced, statusTab]);

  async function exportPortalSales() {
    setBusy(true);
    setError("");
    setSalesHint("");
    try {
      const r = await api.runPwJob("sales");
      setSalesHint(
        r.meta?.hint ||
          r.data.message ||
          "Playwright 销量导出已启动（默认两店）；导完会自动入库",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动销量导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function syncStockSales() {
    setBusy(true);
    setError("");
    try {
      await api.autoSync({ forceIngest: true });
      if (view === "workbook") await refreshWorkbook(wbPage);
      else await refresh(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  async function syncFeishuDaily() {
    setBusy(true);
    setError("");
    try {
      await api.syncReplenishFeishuDaily();
      setShowFeishu(true);
      await refresh(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步日报失败");
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;
  const rows = data?.rows ?? [];
  const urgentN = summary?.byStatus?.urgent ?? 0;
  const stableN = summary?.byStatus?.stable ?? 0;
  const hasFeishu = (summary?.feishuOpsCount ?? 0) > 0;
  const shopLabel =
    summary?.shopName && summary?.projectCode
      ? `${summary.shopName}（${summary.projectCode}）`
      : summary?.shopName || summary?.projectCode || "";

  const wbRows = wb?.rows ?? [];
  const wbMeta = wb?.meta;
  const tagOptions = wb?.summary.manualTagOptions ?? [
    { value: "", label: "可补（按公式）" },
    { value: "不补", label: "不补" },
    { value: "暂时不补", label: "暂时不补" },
    { value: "淘汰", label: "淘汰" },
    { value: "清仓", label: "清仓" },
    { value: "走线下", label: "走线下" },
  ];

  return (
    <div className="rep-page">
      <header className="rep-hero">
        <div className="rep-hero-main">
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            补货计划
          </h1>
          <div
            className="rep-view-switch"
            role="tablist"
            aria-label="视图"
            style={{ marginTop: 8 }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "workbook"}
              className={
                view === "workbook" ? "rep-tab rep-tab-active" : "rep-tab"
              }
              onClick={() => setView("workbook")}
            >
              补货表
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "urgency"}
              className={
                view === "urgency" ? "rep-tab rep-tab-active" : "rep-tab"
              }
              onClick={() => setView("urgency")}
            >
              库存预警
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "shipPlan"}
              className={
                view === "shipPlan" ? "rep-tab rep-tab-active" : "rep-tab"
              }
              onClick={() => setView("shipPlan")}
            >
              发货计划（导入表）
            </button>
          </div>
        </div>
        {view === "workbook" ? (
          <div className="rep-hero-actions">
            {isAdmin ? (
              <>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={wbBusy}
                  onClick={() => void rebuildWorkbook()}
                  title="按当前顶栏店铺重算并写入本地补货表"
                >
                  {wbBusy ? "重算中…" : "重算并写本地表"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void syncStockSales()}
                >
                  {busy ? "同步中…" : "重加载库存/销量"}
                </button>
              </>
            ) : null}
            <button
              className="btn"
              type="button"
              disabled={wbLoading}
              onClick={() => void refreshWorkbook(wbPage)}
            >
              刷新
            </button>
          </div>
        ) : null}
        {view === "urgency" ? (
          <div className="rep-hero-actions">
            {isAdmin ? (
              <>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void exportPortalSales()}
                >
                  {busy ? "导出启动中…" : "导出销量表"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void syncStockSales()}
                >
                  {busy ? "同步中…" : "重加载库存/销量"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void syncFeishuDaily()}
                >
                  同步飞书计划
                </button>
              </>
            ) : null}
            <button
              className="btn"
              type="button"
              disabled={loading}
              onClick={() => void refresh(page)}
            >
              刷新
            </button>
          </div>
        ) : null}
      </header>

      {view === "shipPlan" ? <ShipPlanPanel /> : null}

      {view === "workbook" ? (
        <>
          {isAdmin === false ? (
            <AdminSyncOnlyHint action="重算本地补货表 / 重加载库存销量" />
          ) : null}
          <DataFreshnessBanner compact />
          {wbHint ? <p className="muted">{wbHint}</p> : null}
          {wbError ? (
            <p style={{ color: "var(--danger)" }}>{wbError}</p>
          ) : null}

          <div className="rep-wb-meta">
            <div className="rep-wb-meta-text">
              <span>
                {wbMeta?.shopPrefix
                  ? `${wbMeta.shopPrefix}${
                      wbMeta.shopName ? ` · ${wbMeta.shopName}` : ""
                    }`
                  : "当前店"}
              </span>
              <span>
                本地文件{" "}
                <code title={wbMeta?.filePath}>
                  {wbMeta?.filePath ?? "尚未生成"}
                </code>
              </span>
              <span>生成 {shortIso(wbMeta?.generatedAt)}</span>
              <span>
                全表 {wb?.summary.rowCount ?? "—"} · 建议补{" "}
                {wb?.summary.needCount ?? "—"}
              </span>
            </div>
          </div>

          <div className="rep-tabs" role="toolbar">
            <label
              className="rep-feishu-toggle"
              title="需求 = 月均 × 备货月数 + 15；改月数后需求与建议补同步重算"
            >
              备货月数
              <ClearableInput
                className="input"
                type="number"
                min={0.1}
                max={24}
                step={0.1}
                style={{ width: 72 }}
                value={coverMonths}
                onChange={(e) => {
                  if (e.target.value === "") {
                    setCoverMonths(DEFAULT_COVER_MONTHS);
                    return;
                  }
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  setCoverMonths(clampCoverMonthsUi(n));
                }}
              />
            </label>
            <label className="rep-feishu-toggle">
              <input
                type="checkbox"
                checked={onlyNeed}
                onChange={(e) => setOnlyNeed(e.target.checked)}
              />
              仅建议补货
            </label>
            <label className="rep-feishu-toggle">
              销量 Top
              <ChevronSelect
                className="rep-top-pct"
                triggerClassName="input"
                value={String(topPct)}
                options={TOP_PCT_OPTIONS}
                onChange={(v) => setTopPct(Number(v))}
              />
            </label>
            <ClearableInput
              className="input rep-search"
              placeholder="搜 PSKU / 品名 / 备注"
              value={wbQuery}
              onChange={(e) => setWbQuery(e.target.value)}
            />
          </div>

          <PageBar
            page={wbPage}
            pageCount={wbPageCount}
            total={wbTotal}
            pageSize={PAGE_SIZE}
            busy={wbLoading}
            onChange={setWbPage}
          />

          <div className="rep-table-wrap rep-table-wrap--sticky">
            <table className="table rep-table rep-wb-table">
              <thead>
                <tr>
                  <th className="rep-wb-sticky-rank">排名</th>
                  <th className="rep-wb-sticky-product">产品</th>
                  <th title="近90日销量÷3">月均</th>
                  <th title={`月均×${coverMonths}+15`}>需求</th>
                  <th title="分仓 FBN + supermall，贴近门户 Active Net">
                    可售
                  </th>
                  <th title="仅 FBN 仓合计">FBN</th>
                  <th title="超商仓合计">supermall</th>
                  <th title="ASN空·装箱明细">在途</th>
                  <th>运输</th>
                  <th>建议补</th>
                  <th>权重</th>
                  <th style={{ minWidth: 200 }}>标记 / 备注</th>
                </tr>
              </thead>
              <tbody>
                {wbRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="muted" style={{ padding: 28 }}>
                      {wbLoading
                        ? "加载中…"
                        : "暂无行。管理员可点「重算并写本地表」。"}
                    </td>
                  </tr>
                ) : (
                  wbRows.map((r) => {
                    const draft = draftOf(r);
                    const dirty =
                      draft.manualTag !== (r.manualTag || "") ||
                      draft.note !== (r.note || "");
                    const knownTag = tagOptions.some(
                      (o) => o.value === draft.manualTag,
                    );
                    return (
                    <tr
                      key={r.partnerSku}
                      className={
                        r.needReplenish ? "rep-row-urgent" : undefined
                      }
                    >
                      <td className="rep-rank rep-wb-sticky-rank">
                        {r.salesRank ?? "—"}
                      </td>
                      <td className="rep-wb-sticky-product">
                        <ProductCell
                          partnerSku={r.partnerSku}
                          title={r.title}
                          imageUrl={r.imageUrl}
                          sub={r.noonSku || undefined}
                          detail={
                            r.needReplenishLabel === "补货"
                              ? "建议补货"
                              : "不补货"
                          }
                        />
                      </td>
                      <td className="rep-sales">{fmtNum(r.monthlyAvg, 2)}</td>
                      <td className="rep-sales">{fmtNum(r.demandQty, 1)}</td>
                      <td className="rep-stock">
                        <strong>{r.fbn}</strong>
                      </td>
                      <td className="rep-stock" title="仅 FBN 仓">
                        {r.fbnWh ?? Math.max(0, (r.fbn ?? 0) - (r.supermall ?? 0))}
                      </td>
                      <td className="muted">{r.supermall}</td>
                      <td className="rep-stock" title={`空运${r.inTransitAir} / 海运${r.inTransitSea}`}>
                        {r.inTransit}
                        {(r.inTransitAir > 0 || r.inTransitSea > 0) && (
                          <div className="cat-th-sub">
                            空{r.inTransitAir}·海{r.inTransitSea}
                          </div>
                        )}
                      </td>
                      <td>{r.shipModesLabel || "—"}</td>
                      <td>
                        <strong
                          className={
                            r.needReplenish ? "rep-suggest-qty" : "muted"
                          }
                        >
                          {r.needReplenish ? r.suggestQty : 0}
                        </strong>
                      </td>
                      <td className="rep-weight">
                        <span
                          className="rep-weight-bar"
                          style={{ width: weightBar(r.salesWeight) }}
                        />
                        <em>{fmtNum(r.salesWeight, 2)}</em>
                      </td>
                      <td className="rep-manual">
                        {isAdmin ? (
                          <>
                            <ChevronSelect
                              value={knownTag ? draft.manualTag : ""}
                              options={tagOptions}
                              placeholder="可补（按公式）"
                              triggerClassName="input rep-manual-select"
                              onChange={(next) =>
                                setDraft(
                                  r.partnerSku,
                                  { manualTag: next },
                                  draft,
                                )
                              }
                            />
                            {!knownTag && draft.manualTag ? (
                              <div className="rep-offline-hint">
                                原标记：{draft.manualTag}
                              </div>
                            ) : null}
                            <ClearableInput
                              className="input rep-manual-note"
                              placeholder="手写备注（可选）"
                              value={draft.note}
                              onChange={(e) =>
                                setDraft(
                                  r.partnerSku,
                                  { note: e.target.value },
                                  draft,
                                )
                              }
                            />
                            {dirty ? (
                              <button
                                type="button"
                                className="btn"
                                disabled={savingSku === r.partnerSku}
                                onClick={() => void saveManual(r.partnerSku)}
                              >
                                {savingSku === r.partnerSku ? "保存中…" : "保存"}
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">
                            {r.manualTag || "—"}
                            {r.note ? ` · ${r.note}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {view === "urgency" ? (
        <>
          {isAdmin === false ? (
            <AdminSyncOnlyHint action="导出销量表 / 重加载库存/销量 / 同步飞书计划" />
          ) : null}

          <DataFreshnessBanner compact />

          {salesHint && <p className="muted">{salesHint}</p>}

          <FreshnessBar
            today={data?.freshness?.today}
            slices={data?.freshness?.slices}
            isAdmin={isAdmin}
          />

          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

          <div className="rep-tabs" role="tablist">
            {(Object.keys(TAB_LABEL) as StatusTab[]).map((key) => {
              const count =
                key === "urgent"
                  ? urgentN
                  : key === "stable"
                    ? stableN
                    : (summary?.skuCount ?? 0);
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={statusTab === key}
                  className={
                    statusTab === key ? "rep-tab rep-tab-active" : "rep-tab"
                  }
                  onClick={() => setStatusTab(key)}
                >
                  {TAB_LABEL[key]}
                  <span className="rep-tab-n">{count}</span>
                </button>
              );
            })}
            <label className="rep-feishu-toggle">
              <input
                type="checkbox"
                checked={showFeishu}
                onChange={(e) => setShowFeishu(e.target.checked)}
              />
              飞书计划列
              {!hasFeishu ? <span className="muted">（未同步）</span> : null}
            </label>
            <ClearableInput
              className="input rep-search"
              placeholder="搜 PSKU / 品名 / 店"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {summary?.offlineCatalogCount ? (
            <p className="muted" style={{ marginTop: 0 }}>
              其中 {summary.offlineCatalogCount}{" "}
              个未进 Noon Catalog（有销量/库存或飞书名，无站内主图）。
            </p>
          ) : null}

          <PageBar
            page={page}
            pageCount={pageCount}
            total={total}
            pageSize={PAGE_SIZE}
            busy={loading}
            onChange={setPage}
          />

          <div className="rep-table-wrap">
            <table className="table rep-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 280 }}>产品</th>
                  <th>规格</th>
                  <th title="FBN库存 ÷ 近90日日均销量">FBN可撑</th>
                  <th>
                    实际库存
                    <div className="cat-th-sub">FBN · supermall参考 · 在途</div>
                  </th>
                  <th>
                    销量
                    <div className="cat-th-sub">近 7 天 · 近 90 天</div>
                  </th>
                  {showFeishu ? (
                    <>
                      <th>空运/海运计划</th>
                      <th>飞书在途</th>
                      <th>已采购</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={showFeishu ? 8 : 5}
                      className="muted"
                      style={{ padding: "28px 12px" }}
                    >
                      {loading ? "加载中…" : "暂无数据。"}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const specBits = [
                      r.specs?.dimsLabel,
                      r.specs?.weightLabel,
                      r.specs?.purchaseCost != null
                        ? `采购¥${r.specs.purchaseCost}`
                        : null,
                    ].filter(Boolean);
                    const detailBits = [
                      shopLabel || null,
                      r.offlineCatalog ? "未进 Noon Catalog" : null,
                      r.isActive === false && !r.offlineCatalog ? "下架" : null,
                    ].filter(Boolean);
                    return (
                      <tr
                        key={r.partnerSku}
                        className={
                          r.status === "urgent" ? "rep-row-urgent" : undefined
                        }
                      >
                        <td>
                          <ProductCell
                            partnerSku={r.partnerSku}
                            title={r.title}
                            imageUrl={r.imageUrl}
                            sub={r.noonSku || undefined}
                            detail={detailBits.join(" · ") || undefined}
                          />
                        </td>
                        <td className="rep-specs">
                          {specBits.length ? (
                            specBits.map((b) => (
                              <div key={String(b)}>{b}</div>
                            ))
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <div
                            className={daysTone(
                              r.availableDays,
                              r.status,
                              r.inventory.fbn,
                            )}
                          >
                            {r.inventory.fbn <= 0
                              ? "0"
                              : fmtDays(r.availableDays)}
                            <span className="rep-days-unit">天</span>
                          </div>
                        </td>
                        <td className="rep-stock">
                          <strong>{r.inventory.fbn}</strong>
                          <span className="rep-sep">·</span>
                          <span className="muted">
                            {r.inventory.supermall ?? 0}
                          </span>
                          <span className="rep-sep">·</span>
                          <span>{r.inventory.inTransit}</span>
                        </td>
                        <td className="rep-sales">
                          <strong>{r.salesD7}</strong>
                          <span className="rep-sep">·</span>
                          <span className="muted">{r.salesD90 ?? "—"}</span>
                        </td>
                        {showFeishu ? (
                          <>
                            <td>
                              {r.feishu
                                ? `${r.feishu.airReplenishPlan}/${r.feishu.seaReplenishPlan}`
                                : "—"}
                            </td>
                            <td>
                              {r.feishu
                                ? `${r.feishu.airInTransit}/${r.feishu.seaInTransit}`
                                : "—"}
                            </td>
                            <td>{r.feishu?.purchasedQty ?? "—"}</td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <details className="rep-more">
            <summary>解读与说明</summary>
            <InterpretPanel surface="replenish" />
          </details>
        </>
      ) : null}
    </div>
  );
}
