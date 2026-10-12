import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type CargoLedgerMeta,
  type CargoLedgerTicketDetail,
  type CargoLedgerTicketSummary,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import { PageBar } from "../components/PageBar";

function money(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function basisLabel(b: CargoLedgerTicketSummary["freightBasis"]) {
  if (b === "ticket") return "整票实付";
  if (b === "box_sum") return "箱级加总";
  return "缺运费";
}

export function TicketLedgerPage() {
  const [meta, setMeta] = useState<CargoLedgerMeta | null>(null);
  const [rows, setRows] = useState<CargoLedgerTicketSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [shop, setShop] = useState("ALL");
  const [transit, setTransit] = useState("all");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState("");
  const [detail, setDetail] = useState<CargoLedgerTicketDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const loadMeta = useCallback(async () => {
    const res = await api.getCargoLedgerMeta();
    setMeta(res.data);
  }, []);

  const loadRows = useCallback(async () => {
    const res = await api.getCargoLedgerTickets({
      shop,
      q,
      transit,
      page,
      pageSize: 50,
    });
    setRows(res.data);
    setTotal(res.meta.total);
    setPageCount(res.meta.pageCount);
    setPage(res.meta.page);
  }, [shop, q, transit, page]);

  useEffect(() => {
    loadMeta().catch((e: Error) => setError(e.message));
  }, [loadMeta]);

  useEffect(() => {
    setBusy(true);
    loadRows()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, [loadRows]);

  async function rebuild() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await api.rebuildCargoLedger();
      setMeta(res.data);
      setInfo(res.message || "已重新清洗");
      setPage(1);
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openTicket(key: string) {
    if (openKey === key) {
      setOpenKey("");
      setDetail(null);
      return;
    }
    setOpenKey(key);
    setDetailBusy(true);
    setDetail(null);
    try {
      const res = await api.getCargoLedgerTicket(key);
      setDetail(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailBusy(false);
    }
  }

  const shops = meta?.shops ?? [];

  return (
    <div>
      <h1 className="page-title">票货台账</h1>
      <p className="page-desc">
        今日新增试运行：飞书装箱/产品/采购仍保留，这里按「店铺 → 票 → 箱 → SKU」查看。
        选店铺 → 搜票号/箱号/PSKU → 点开一票看件数和分摊运费。采购单价只是最近一单参考，不是本票批次。物流查件仍在{" "}
        <Link to="/shipping">物流管理</Link>。
      </p>

      {error ? <p className="error">{error}</p> : null}
      {info ? <p className="muted">{info}</p> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={rebuild}
          >
            {busy ? "处理中…" : "重新清洗飞书快照"}
          </button>
          <span className="muted">
            {meta
              ? `建成 ${new Date(meta.builtAt).toLocaleString()} · 票 ${meta.ticketCount} · 箱 ${meta.boxCount} · SKU行 ${meta.skuLineCount} · 问题 ${meta.issueCount}`
              : "首次打开会自动清洗"}
          </span>
        </div>
        {shops.length ? (
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {shops.map((s) => (
              <button
                key={s.shopCode}
                type="button"
                className={shop === s.shopCode ? "btn btn-primary" : "btn"}
                onClick={() => {
                  setShop(s.shopCode);
                  setPage(1);
                }}
              >
                {s.shopCode} · {s.tickets}票 / {s.inTransitTickets}在途
              </button>
            ))}
            <button
              type="button"
              className={shop === "ALL" ? "btn btn-primary" : "btn"}
              onClick={() => {
                setShop("ALL");
                setPage(1);
              }}
            >
              全部店铺
            </button>
          </div>
        ) : null}
        {meta ? (
          <p className="muted" style={{ marginTop: 10 }}>
            侧账未并入票内：采购 {meta.side.purchaseLots} 行 / 包装{" "}
            {meta.side.packagingRows} / 入账开支 {meta.side.cashEntries} / 产品主数据{" "}
            {meta.side.productMaster}
            {meta.side.dailyLatestSheet
              ? ` / 日报「${meta.side.dailyLatestSheet}」${meta.side.dailyPskus} SKU`
              : ""}
            。这些仍可对照，不算本票成本。
          </p>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <ClearableInput
            className="input"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setQ(qDraft);
                setPage(1);
              }
            }}
            placeholder="票号 / 箱号 / PSKU / 货代"
            style={{ minWidth: 240 }}
          />
          <button
            className="btn"
            type="button"
            onClick={() => {
              setQ(qDraft);
              setPage(1);
            }}
          >
            搜索
          </button>
          <select
            value={transit}
            onChange={(e) => {
              setTransit(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">全部状态</option>
            <option value="in_transit">在途</option>
            <option value="arrived">已到仓</option>
          </select>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>店铺</th>
              <th>票号</th>
              <th>货代</th>
              <th>方式</th>
              <th>发货</th>
              <th>箱/SKU/件</th>
              <th>跨境运费</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.ticketKey}>
                <tr
                  onClick={() => openTicket(r.ticketKey)}
                  style={{ cursor: "pointer" }}
                >
                  <td>{r.shopCode || "—"}</td>
                  <td>
                    {r.ticketNo || r.ticketKey}
                    {r.logisticsNo && r.logisticsNo !== r.ticketNo ? (
                      <div className="muted">{r.logisticsNo}</div>
                    ) : null}
                  </td>
                  <td>{r.forwarder || "—"}</td>
                  <td>{r.modeRaw || r.mode || "—"}</td>
                  <td>{r.shipAt || "—"}</td>
                  <td>
                    {r.boxCount}/{r.skuCount}/{r.pcs}
                  </td>
                  <td>
                    {money(r.crossFreight)}
                    <div className="muted">{basisLabel(r.freightBasis)}</div>
                  </td>
                  <td>{r.inTransit ? "在途" : r.arriveAt || "已到仓"}</td>
                </tr>
                {openKey === r.ticketKey ? (
                  <tr>
                    <td colSpan={8}>
                      {detailBusy ? (
                        <p className="muted">加载 SKU…</p>
                      ) : detail ? (
                        <div>
                          <p className="muted">
                            国内运费 {money(detail.domesticFreight)} · 重量{" "}
                            {detail.weightKg} kg · 点行可收起
                          </p>
                          <table className="table">
                            <thead>
                              <tr>
                                <th>PSKU</th>
                                <th>名称</th>
                                <th>件数</th>
                                <th>重量</th>
                                <th>分摊头程</th>
                                <th>采购参考</th>
                                <th>箱号</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.skuLines.map((s) => (
                                <tr key={s.partnerSku}>
                                  <td>
                                    {s.partnerSku}
                                    {!s.inProductMaster ? (
                                      <div className="muted">不在产品表</div>
                                    ) : null}
                                    {s.shopMismatch ? (
                                      <div className="muted">店铺前缀不一致</div>
                                    ) : null}
                                  </td>
                                  <td>{s.name || "—"}</td>
                                  <td>{s.qty}</td>
                                  <td>{s.weightKg || "—"}</td>
                                  <td>{money(s.allocatedCrossFreight)}</td>
                                  <td>
                                    {s.purchaseUnitHint != null
                                      ? `${money(s.purchaseUnitHint)} × ${s.purchaseLotCount}单`
                                      : "无采购行"}
                                  </td>
                                  <td>{s.boxNos.join("、") || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="muted">无明细</p>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!rows.length && !busy ? <p className="muted">无票货。先同步装箱表再点清洗。</p> : null}
        <PageBar
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={50}
          busy={busy}
          onChange={setPage}
        />
      </div>

      {meta?.issuesPreview.length ? (
        <div className="card">
          <h2 className="card-title">清洗问题（前 40）</h2>
          <ul>
            {meta.issuesPreview.map((i, idx) => (
              <li key={`${i.code}-${idx}`} className="muted">
                [{i.severity}] {i.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
