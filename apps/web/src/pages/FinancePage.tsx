import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type FinanceOverview,
  type FinanceSettlement,
  type FinanceCloseGate,
  type InvoiceDocRow,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import { InterpretPanel } from "../components/InterpretPanel";
import { ProductCell } from "../components/ProductCell";
import { hasProductDisplay } from "../lib/product-display";

export function FinancePage() {
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [settlement, setSettlement] = useState<FinanceSettlement | null>(null);
  const [closeGate, setCloseGate] = useState<FinanceCloseGate | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDocRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  async function refresh() {
    const [ov, inv, st, gate] = await Promise.all([
      api.getFinanceOverview(),
      api.getFinanceInvoices(),
      api.getFinanceSettlement(),
      api.getFinanceCloseGate(),
    ]);
    setData(ov.data);
    setInvoices(inv.data);
    setSettlement(st.data);
    setCloseGate(gate.data);
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function closeTargetMonth(replace = false) {
    setClosing(true);
    setError("");
    try {
      await api.closeFinanceMonth({
        month: closeGate?.month,
        replace,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "关账失败");
    } finally {
      setClosing(false);
    }
  }

  async function syncInvoices() {
    setBusy(true);
    setError("");
    try {
      await api.syncFinanceInvoices();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步发票失败");
    } finally {
      setBusy(false);
    }
  }

  const fees = data?.platformFees;

  /** 无 PSKU 的发票本身仍算有效数据；有 PSKU 但无图/名的默认隐藏 */
  const invoiceRows = useMemo(
    () =>
      invoices.map((r) => ({
        ...r,
        partnerSku: r.partnerSku || r.id,
        title: r.title,
        imageUrl: r.imageUrl,
        _hasSku: Boolean(r.partnerSku),
      })),
    [invoices],
  );

  const invoiceView = useMemo(() => {
    const needle = query.trim();
    const searching = Boolean(needle);
    const n = needle.toLowerCase();
    const hiddenCount = invoiceRows.filter(
      (r) => r._hasSku && !hasProductDisplay(r),
    ).length;
    const visible = invoiceRows.filter((r) => {
      if (searching) {
        return (
          (r.invoiceNr || "").toLowerCase().includes(n) ||
          (r.partnerSku || "").toLowerCase().includes(n) ||
          (r.title || "").toLowerCase().includes(n) ||
          (r.invoiceType || "").toLowerCase().includes(n)
        );
      }
      if (!r._hasSku) return true;
      return hasProductDisplay(r);
    });
    visible.sort((a, b) => {
      const da = a._hasSku && hasProductDisplay(a) ? 1 : a._hasSku ? 0 : 1;
      const db = b._hasSku && hasProductDisplay(b) ? 1 : b._hasSku ? 0 : 1;
      if (db !== da) return db - da;
      return String(b.issuedAt ?? "").localeCompare(String(a.issuedAt ?? ""));
    });
    return { visible, hiddenCount, searching };
  }, [invoiceRows, query]);

  return (
    <div>
      <h1 className="page-title">财务报表</h1>
      <p className="page-desc">
        上方为经营概览（salesFacts + Transaction View，非账单口径）。下方「结算对账」按
        Noon Statement of Account：Net Proceeds / 平台四费 / VAT；CSV 放入{" "}
        <code>portal-imports</code>（文件名含{" "}
        <code>financeweb_statements</code>）。映射见{" "}
        <Link to="/noon">NOON 接入</Link>。
      </p>
      <div className="row" style={{ marginBottom: 14 }}>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={syncInvoices}
        >
          {busy ? "同步中…" : "同步发票（Impex）"}
        </button>
        <button className="btn" type="button" onClick={() => refresh()}>
          刷新
        </button>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <InterpretPanel surface="finance" />

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>结算对账（账单口径）</h3>
        {closeGate ? (
          <div className="card" style={{ marginBottom: 12, padding: 12 }}>
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <strong>上月 {closeGate.month}</strong>
              <span>
                {(() => {
                  const row = settlement?.months.find(
                    (m) => m.month === closeGate.month,
                  );
                  if (row?.closeStatus === "closed") {
                    return `已关账 ${row.closedAt?.slice(0, 10) ?? ""}`;
                  }
                  if (!closeGate.checks.find((c) => c.id === "imported")?.ok) {
                    return "未导入账单";
                  }
                  if (!closeGate.coverageComplete) return "未满月（缺月末段）";
                  if (closeGate.ok) return "可关账";
                  return "门禁未过";
                })()}
              </span>
              <button
                className="btn btn-primary"
                type="button"
                disabled={
                  closing ||
                  !closeGate.ok ||
                  settlement?.months.some(
                    (m) =>
                      m.month === closeGate.month && m.closeStatus === "closed",
                  )
                }
                onClick={() => closeTargetMonth(false)}
              >
                {closing ? "关账中…" : "关账上月"}
              </button>
            </div>
            <ul className="muted" style={{ margin: "8px 0 0" }}>
              {closeGate.checks.map((c) => (
                <li key={c.id}>
                  {c.ok ? "通过" : "未过"} · {c.detail}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ marginBottom: 0 }}>
              纯利=(Net Proceeds−平台四费−VAT)×汇率−采购−头程−包装。销量 GMV
              不进营业额。次月 5 日 10:00 自动关账（账单须覆盖到月末）。
            </p>
          </div>
        ) : null}
        {!settlement ? (
          <p className="muted">加载中…</p>
        ) : settlement.months.length === 0 ? (
          <p className="muted">
            暂无账单月。请将{" "}
            <code>noon_financeweb_statements_*.csv</code>{" "}
            放入本店 <code>portal-imports</code> 后自动/手动导入。
          </p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              口径 {settlement.basis} · FX {settlement.fx} ·{" "}
              {settlement.costBasis}
            </p>
            <div className="grid-3" style={{ marginBottom: 12 }}>
              <div>
                <div className="muted">营业额 Net Proceeds</div>
                <div style={{ fontSize: 20, fontWeight: 650 }}>
                  CNY {settlement.totals.netProceedsCny}
                </div>
                <div className="muted">SAR {settlement.totals.netProceedsSar}</div>
              </div>
              <div>
                <div className="muted">平台四费</div>
                <div style={{ fontSize: 20, fontWeight: 650 }}>
                  CNY {settlement.totals.platformFeesCny}
                </div>
                <div className="muted">SAR {settlement.totals.platformFeesSar}</div>
              </div>
              <div>
                <div className="muted">纯利（估）</div>
                <div style={{ fontSize: 20, fontWeight: 650 }}>
                  CNY {settlement.totals.pureProfitCny}
                </div>
                <div className="muted">
                  已扣 VAT / 采购 / 头程 · 包装{" "}
                  {settlement.totals.packagingCny}
                </div>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>月份</th>
                  <th>营业额 SAR</th>
                  <th>平台费 SAR</th>
                  <th>费占比</th>
                  <th>VAT SAR</th>
                  <th>采购 CNY</th>
                  <th>头程 CNY</th>
                  <th>纯利 CNY</th>
                  <th>覆盖</th>
                  <th>状态</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {settlement.months.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{m.netProceedsSar}</td>
                    <td>{m.platformFeesSar}</td>
                    <td>
                      {m.platformFeePct != null ? `${m.platformFeePct}%` : "—"}
                    </td>
                    <td>{m.vatSar}</td>
                    <td>{m.costs.purchaseCny}</td>
                    <td>{m.costs.headhaulCny}</td>
                    <td>{m.pureProfitCny}</td>
                    <td>
                      {m.minDate || "—"} ~ {m.maxDate || "—"}
                      {!m.coverageComplete ? (
                        <span className="muted">
                          {m.closeStatus === "closed"
                            ? "（实时导入未齐，终稿已锁）"
                            : "（未满月）"}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {m.closeStatus === "closed"
                        ? `终稿 ${m.closedAt?.slice(0, 10) ?? ""}`
                        : m.closeStatus === "incomplete"
                          ? "草稿·未满月"
                          : "草稿"}
                    </td>
                    <td className="muted" style={{ maxWidth: 160 }}>
                      {m.sourceFile}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>合计</strong>
                  </td>
                  <td>
                    <strong>{settlement.totals.netProceedsSar}</strong>
                  </td>
                  <td>
                    <strong>{settlement.totals.platformFeesSar}</strong>
                  </td>
                  <td>—</td>
                  <td>
                    <strong>{settlement.totals.vatSar}</strong>
                  </td>
                  <td>
                    <strong>{settlement.totals.purchaseCny}</strong>
                  </td>
                  <td>
                    <strong>{settlement.totals.headhaulCny}</strong>
                  </td>
                  <td>
                    <strong>{settlement.totals.pureProfitCny}</strong>
                  </td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
            {(settlement.caveats ?? []).length > 0 ? (
              <ul className="muted" style={{ marginBottom: 0 }}>
                {settlement.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>经营概览（非账单）</h2>
      {!data ? (
        <p className="muted">加载中…</p>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3>收入 (CNY估)</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
                {data.revenueCny}
              </p>
              <p className="muted">
                SAR {data.revenueSar}
                {data.primaryRevenue === "salesFacts" ? " · 口径 salesFacts" : ""}
              </p>
              {data.orderRevenueSar != null &&
              data.orderRevenueSar !== data.revenueSar ? (
                <p className="muted">
                  履约单金额对照 SAR {data.orderRevenueSar}
                </p>
              ) : null}
              {(data.caveats ?? []).slice(0, 2).map((c) => (
                <p key={c} className="muted" style={{ color: "var(--warn)" }}>
                  {c}
                </p>
              ))}
            </div>
            <div className="card">
              <h3>平台费用 (CNY估)</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
                {fees?.totalCny ?? 0}
              </p>
              <p className="muted">
                SKU {fees?.feeSkuCount ?? 0} · 均佣金率{" "}
                {(((fees?.avgCommissionRate ?? 0) as number) * 100).toFixed(1)}%
              </p>
            </div>
            <div className="card">
              <h3>预估利润</h3>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
                {data.profitCny}
              </p>
              <p className="muted">
                已扣空运 {data.airCostCny} + 测评 {data.reviewCostCny} + 平台费
              </p>
            </div>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div
              className="row"
              style={{
                marginBottom: 10,
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>发票 / 贷记单</h3>
              <ClearableInput
                className="input"
                style={{ minWidth: 220, maxWidth: 320 }}
                placeholder="搜索单号 / PSKU / 标题"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
              {data.invoices?.count ?? 0} 条 · 合计 SAR{" "}
              {data.invoices?.amountSar ?? 0}
              {data.invoices?.gap ? ` · ${data.invoices.gap}` : ""}
              {" · "}
              展示 {invoiceView.visible.length}
              {invoices.length ? ` / ${invoices.length}` : ""}
              {invoiceView.hiddenCount > 0 && !invoiceView.searching
                ? ` · 已隐藏无产品展示 ${invoiceView.hiddenCount}（搜索可召回）`
                : ""}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>单号</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>金额</th>
                  <th>开票日</th>
                  <th style={{ minWidth: 220 }}>产品</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      暂无发票。live 模式下点「同步发票」。
                    </td>
                  </tr>
                ) : invoiceView.visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      {invoiceView.searching
                        ? "无匹配行。"
                        : "暂无展示行；可搜索单号/PSKU 查看隐藏项。"}
                    </td>
                  </tr>
                ) : (
                  invoiceView.visible.slice(0, 100).map((r) => (
                    <tr key={r.id}>
                      <td>{r.invoiceNr}</td>
                      <td>{r.invoiceType}</td>
                      <td>{r.status || "—"}</td>
                      <td>
                        {r.amount} {r.currency}
                      </td>
                      <td>{r.issuedAt ?? "—"}</td>
                      <td>
                        {r._hasSku ? (
                          <ProductCell
                            partnerSku={r.partnerSku}
                            title={r.title}
                            imageUrl={r.imageUrl}
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>平台费用明细（feeSnapshots）</h3>
            {!fees || fees.feeSkuCount === 0 ? (
              <p className="muted">
                暂无费用快照。请自动同步 Transaction View，或导入 transactionview CSV。
              </p>
            ) : (
              <div className="kv">
                <label>佣金（估）</label>
                <div>SAR {fees.commissionSar}</div>
                <label>出库费合计</label>
                <div>SAR {fees.outboundFeeSar}</div>
                <label>税额合计</label>
                <div>SAR {fees.taxSar}</div>
                <label>平台费用合计</label>
                <div>
                  SAR {fees.totalSar} / CNY {fees.totalCny}
                </div>
              </div>
            )}
          </div>
          <div className="card">
            <h3>本地成本计价快照</h3>
            <div className="kv">
              {Object.entries(data.snapshot).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <label>{k}</label>
                  <div>{String(v)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
