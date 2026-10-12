import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type CashLedgerRow,
  type PurchaseArrivingTodayRow,
  type PurchaseCostRow,
  type PurchaseLineRow,
  type PurchaseSummary,
} from "../api";
import { AccountsLedgerCard } from "../components/AccountsLedgerCard";
import { ClearableInput } from "../components/ClearableInput";
import { ProductCell } from "../components/ProductCell";
import { filterProductDisplayRows } from "../lib/product-display";

export function PurchasePage() {
  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [costs, setCosts] = useState<PurchaseCostRow[]>([]);
  const [lines, setLines] = useState<PurchaseLineRow[]>([]);
  const [cash, setCash] = useState<CashLedgerRow[]>([]);
  const [arriving, setArriving] = useState<PurchaseArrivingTodayRow[]>([]);
  const [arrivingToday, setArrivingToday] = useState("");
  const [arrivalDraft, setArrivalDraft] = useState<Record<string, string>>({});
  const [arrivalBusyKey, setArrivalBusyKey] = useState("");
  const [costQuery, setCostQuery] = useState("");
  const [lineQuery, setLineQuery] = useState("");
  const [filterArriving, setFilterArriving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [busy1688, setBusy1688] = useState(false);
  const [busyLogin, setBusyLogin] = useState(false);
  const [has1688Session, setHas1688Session] = useState(false);
  const [sessionHint, setSessionHint] = useState("");

  async function refresh() {
    const [s, c, l, cashRes, a, sess] = await Promise.all([
      api.getPurchaseSummary(),
      api.getPurchaseCosts({ page: 1, pageSize: 100 }),
      api.getPurchaseLines({ page: 1, pageSize: 100 }),
      api.getPurchaseCash({ page: 1, pageSize: 100 }),
      api.getPurchaseArrivingToday(),
      api.getPurchase1688Session().catch(() => ({
        data: {
          hasSession: false,
          storageStatePath: "",
          cookieHits: [] as string[],
          savedAt: null as string | null,
          fileBytes: 0,
        },
      })),
    ]);
    setSummary(s.data);
    setCosts(c.data);
    setLines(l.data);
    setCash(cashRes.data);
    setArriving(a.data);
    setArrivingToday(a.meta.today);
    const ok = Boolean(sess.data.hasSession || s.data.alibaba1688HasSession);
    setHas1688Session(ok);
    if (ok) {
      const when = sess.data.savedAt
        ? new Date(sess.data.savedAt).toLocaleString()
        : "";
      const cookies = (sess.data.cookieHits || []).slice(0, 6).join(", ");
      setSessionHint(
        [when && `保存于 ${when}`, cookies && `Cookie: ${cookies}`]
          .filter(Boolean)
          .join(" · "),
      );
    } else {
      setSessionHint("");
    }
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function syncAccounts() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await api.syncPurchaseAccounts();
      setInfo(r.message || "账目同步完成");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步账目失败");
    } finally {
      setBusy(false);
    }
  }

  async function capture1688Login() {
    setBusyLogin(true);
    setError("");
    setInfo(
      "正在弹出 1688 登录窗口… 请扫码/登录；检测到登录 Cookie 会立即保存（最长约 4 分钟）",
    );
    try {
      const r = await api.capturePurchase1688Login({ loginWaitMs: 240_000 });
      setHas1688Session(true);
      const hits = (r.data.cookieHits || []).join(", ");
      setInfo(
        r.message ||
          r.data.message ||
          `登录态已保存${hits ? `（${hits}）` : ""}`,
      );
      await refresh();
    } catch (e) {
      setHas1688Session(false);
      setError(e instanceof Error ? e.message : "获取 1688 登录态失败");
      await refresh().catch(() => {});
    } finally {
      setBusyLogin(false);
    }
  }

  async function sync1688() {
    if (!has1688Session) {
      setError("请先点「获取 1688 登录态」完成登录，再同步物流。");
      return;
    }
    setBusy1688(true);
    setError("");
    setInfo(
      "分块查询：无头浏览器后台查 1688（每批≤30）…",
    );
    const poll = window.setInterval(() => {
      api
        .getPurchase1688LogisticsProgress()
        .then((p) => {
          const d = p.data;
          if (d.batchTotal > 0) {
            setInfo(
              `${d.message || "查询中"}（${d.batchIndex}/${d.batchTotal} 批 · ${d.orderDone}/${d.orderTotal} 单）`,
            );
          } else if (d.message) {
            setInfo(d.message);
          }
        })
        .catch(() => {});
    }, 1500);
    try {
      const r = await api.syncPurchase1688Logistics({
        limit: 60,
        chunkSize: 15,
        recentDays: 30,
      });
      setInfo(
        r.message ||
          `1688 物流：匹配 ${r.data.applied.matchedLines} 行 · 今日关注 ${r.data.arrivingTodayCount}`,
      );
      setArriving(r.data.arrivingToday);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步 1688 物流失败");
    } finally {
      window.clearInterval(poll);
      setBusy1688(false);
    }
  }

  async function confirmArrival(
    row: PurchaseArrivingTodayRow,
    opts: { addQty?: number; markComplete?: boolean },
  ) {
    const key = row.receiptKey || row.id;
    setArrivalBusyKey(key);
    setError("");
    setInfo("");
    try {
      const r = await api.confirmPurchaseArrival({
        receiptKey: row.receiptKey,
        id: row.id,
        partnerSku: row.partnerSku,
        orderId: row.orderId,
        addQty: opts.addQty,
        markComplete: opts.markComplete,
      });
      setArriving(r.data.arrivingToday);
      setArrivalDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setInfo(r.message || "已确认到货");
      if (summary) {
        setSummary({
          ...summary,
          arrivingTodayCount: r.data.arrivingTodayCount,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认到货失败");
    } finally {
      setArrivalBusyKey("");
    }
  }

  const costView = useMemo(
    () =>
      filterProductDisplayRows(costs, costQuery, {
        compare: (a, b) => (b.purchaseCost || 0) - (a.purchaseCost || 0),
      }),
    [costs, costQuery],
  );

  const arrivingIds = useMemo(
    () => new Set(arriving.map((a) => a.id)),
    [arriving],
  );

  const lineDisplayRows = useMemo(
    () =>
      lines.map((r) => ({
        ...r,
        title: r.title || r.productName,
      })),
    [lines],
  );

  // 采购明细以飞书行为准：默认全部展示（不因缺 Catalog 图而隐藏）
  const lineView = useMemo(() => {
    const needle = lineQuery.trim().toLowerCase();
    const searching = Boolean(needle);
    const matched = searching
      ? lineDisplayRows.filter((r) => {
          return (
            r.partnerSku.toLowerCase().includes(needle) ||
            (r.title || "").toLowerCase().includes(needle) ||
            (r.productName || "").toLowerCase().includes(needle) ||
            (r.supplier || "").toLowerCase().includes(needle) ||
            (r.orderId || "").toLowerCase().includes(needle) ||
            (r.trackingNo || "").toLowerCase().includes(needle) ||
            (r.transitStatus || "").toLowerCase().includes(needle)
          );
        })
      : [...lineDisplayRows];
    matched.sort((a, b) => {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Shanghai",
      });
      const atA = String(a.purchasedAt ?? "");
      const atB = String(b.purchasedAt ?? "");
      const futureA = atA > today ? 1 : 0;
      const futureB = atB > today ? 1 : 0;
      if (futureA !== futureB) return futureA - futureB;
      return atB.localeCompare(atA);
    });
    return { visible: matched, searching, total: lineDisplayRows.length };
  }, [lineDisplayRows, lineQuery]);

  const lineVisible = useMemo(() => {
    if (!filterArriving) return lineView.visible;
    return lineView.visible.filter((r) => arrivingIds.has(r.id));
  }, [lineView.visible, filterArriving, arrivingIds]);

  return (
    <div>
      <h1 className="page-title">采购管理</h1>
      <p className="page-desc">
        单位采购成本来自飞书产品表；采购明细 / 入账开支来自账目表「产品采购」等。Catalog{" "}
        <Link to="/catalog">本地入库</Link>{" "}
        与汇总同步也会带上 accounts。        1688：先「获取 1688 登录态」，再「同步 1688
        物流」。物流查询只对齐近 30 天（约一个月）、有采购日期的在途/无运单；更早单无追踪意义。历史无日期脏数据不进入本功能。查询带人工节奏（逐字输入、批间短休），过慢可设 OUTPOST_1688_PACE=fast；物流只回填本系统，不写飞书。
      </p>
      <div className="row" style={{ marginBottom: 14 }}>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || busy1688 || busyLogin}
          onClick={syncAccounts}
        >
          {busy ? "同步中…" : "同步飞书账目表"}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || busy1688 || busyLogin}
          onClick={capture1688Login}
        >
          {busyLogin
            ? "等待登录…"
            : has1688Session
              ? "刷新 1688 登录态"
              : "获取 1688 登录态"}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || busy1688 || busyLogin || !has1688Session}
          onClick={sync1688}
          title={
            has1688Session ? undefined : "请先获取 1688 登录态"
          }
        >
          {busy1688 ? "查询 1688…" : "同步 1688 物流"}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => refresh().catch((e: Error) => setError(e.message))}
        >
          刷新
        </button>
        <span className="muted" style={{ alignSelf: "center" }}>
          1688 登录态：{has1688Session ? "已保存" : "未获取"}
          {sessionHint ? ` · ${sessionHint}` : ""}
        </span>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {info && <p className="muted">{info}</p>}

      <AccountsLedgerCard
        onError={(msg) => setError(msg)}
        onInfo={(msg) => setInfo(msg)}
        onSynced={() => {
          refresh().catch((e: Error) => setError(e.message));
        }}
      />

      {arriving.length > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            borderColor: "var(--warning, #c9a227)",
            background: "color-mix(in srgb, var(--warning, #c9a227) 8%, transparent)",
          }}
        >
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <h3 style={{ margin: 0 }}>
              今日要处理 · {arrivingToday || "今天"} · {arriving.length} 单
            </h3>
            <button
              className="btn"
              type="button"
              onClick={() => setFilterArriving((v) => !v)}
            >
              {filterArriving ? "显示全部明细" : "在明细中只看这些"}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            派送中 / 预计今日达 / 已签收等需跟进的采购。货可能分批到：登记本次到货数量，到齐后自动清出本列表。
          </p>
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 280 }}>产品</th>
                <th>订购</th>
                <th>已到 / 剩余</th>
                <th>本次到货</th>
                <th>供应商</th>
                <th>采购日</th>
                <th>物流状态</th>
                <th>运单</th>
                <th>订单号</th>
              </tr>
            </thead>
            <tbody>
              {arriving.slice(0, 40).map((r) => {
                const feishuName = (r.productName || "").trim();
                const catalogTitle = (r.title || "").trim();
                const primary =
                  feishuName || catalogTitle || r.partnerSku || "—";
                const catalogLine =
                  feishuName &&
                  catalogTitle &&
                  feishuName !== catalogTitle
                    ? catalogTitle
                    : "";
                const remark = (r.remark || "").trim();
                const detail = [catalogLine, remark].filter(Boolean).join(" · ");
                const noon = (r.noonSku || "").trim();
                const noonSub =
                  noon && noon !== r.partnerSku ? `Noon ${noon}` : null;
                const rowKey = r.receiptKey || r.id;
                const received = r.receivedQty ?? 0;
                const remaining =
                  r.remainingQty ?? Math.max(0, r.qty - received);
                const busy = arrivalBusyKey === rowKey;
                const draft = arrivalDraft[rowKey] ?? "";
                return (
                  <tr key={rowKey}>
                    <td>
                      <ProductCell
                        partnerSku={r.partnerSku}
                        title={primary}
                        imageUrl={r.imageUrl}
                        detail={detail || null}
                        sub={noonSub}
                        thumbSize={72}
                      />
                    </td>
                    <td>{r.qty}</td>
                    <td>
                      {received} / {remaining}
                      <div className="muted" style={{ fontSize: 12 }}>
                        剩余待确认
                      </div>
                    </td>
                    <td>
                      <div
                        className="row"
                        style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}
                      >
                        <ClearableInput
                          className="input"
                          type="number"
                          min={1}
                          max={remaining}
                          placeholder={`≤${remaining}`}
                          style={{ width: 88 }}
                          value={draft}
                          disabled={busy}
                          onChange={(e) =>
                            setArrivalDraft((prev) => ({
                              ...prev,
                              [rowKey]: e.target.value,
                            }))
                          }
                        />
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const n = Number(draft);
                            if (!Number.isFinite(n) || n <= 0) {
                              setError("请填写本次到货数量");
                              return;
                            }
                            void confirmArrival(r, { addQty: Math.floor(n) });
                          }}
                        >
                          {busy ? "…" : "确认"}
                        </button>
                        <button
                          className="btn"
                          type="button"
                          disabled={busy}
                          title="记满订购数量并清出"
                          onClick={() =>
                            void confirmArrival(r, { markComplete: true })
                          }
                        >
                          到齐
                        </button>
                      </div>
                    </td>
                    <td>{r.supplier || "—"}</td>
                    <td className="muted">{r.purchasedAt || "—"}</td>
                    <td>{r.transitStatus || "—"}</td>
                    <td>{r.trackingNo || "—"}</td>
                    <td className="muted">{r.orderId || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {summary && (
        <div className="grid-3" style={{ marginBottom: 16 }}>
          <div className="card">
            <h3>有采购价 SKU</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.withPurchaseCost}
            </p>
            <p className="muted">单位成本行 {summary.rowCount}</p>
          </div>
          <div className="card">
            <h3>采购明细</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.purchaseLineCount ?? 0}
            </p>
            <p className="muted">金额 {summary.purchaseLineAmount ?? 0}</p>
          </div>
          <div className="card">
            <h3>今日物流关注</h3>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>
              {summary.arrivingTodayCount ?? arriving.length}
            </p>
            <p className="muted">
              入账/开支 {summary.cashIncome ?? 0} / {summary.cashExpense ?? 0}
            </p>
          </div>
        </div>
      )}
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
          <h3 style={{ margin: 0 }}>产品采购明细</h3>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <ClearableInput
              className="input"
              style={{ minWidth: 220, maxWidth: 320 }}
              placeholder="搜索 PSKU / 标题 / 供应商 / 订单号"
              value={lineQuery}
              onChange={(e) => setLineQuery(e.target.value)}
            />
            {lineQuery.trim() ? (
              <button
                className="btn"
                type="button"
                onClick={() => setLineQuery("")}
              >
                清空搜索
              </button>
            ) : null}
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
          本地共 {summary?.purchaseLineCount ?? lines.length} 条采购明细
          {lines.length
            ? ` · 本页加载 ${lines.length} 条`
            : ""}
          {lineView.searching
            ? ` · 搜索「${lineQuery.trim()}」命中 ${lineVisible.length}`
            : ` · 展示 ${lineVisible.length}`}
          {filterArriving ? " · 已筛选今日关注" : ""}
          。来源飞书账目表工作表「产品采购」（历史累计，不是你正在看的「产品架构」那几行）。
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>日期</th>
              <th style={{ minWidth: 260 }}>产品</th>
              <th>数量</th>
              <th>单价</th>
              <th>金额</th>
              <th>供应商</th>
              <th>订单号</th>
              <th>运单</th>
              <th>物流状态</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted">
                  暂无采购明细。配置 feishu.docs.json 的 accounts 后点同步。
                </td>
              </tr>
            ) : lineVisible.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted">
                  {filterArriving
                    ? "今日关注列表为空，或明细中尚无对应行。"
                    : lineView.searching
                      ? `没有匹配「${lineQuery.trim()}」的行。点「清空搜索」可看全部已加载明细。`
                      : "暂无明细。"}
                </td>
              </tr>
            ) : (
              lineVisible.slice(0, 100).map((r) => (
                <tr
                  key={r.id}
                  style={
                    arrivingIds.has(r.id)
                      ? {
                          background:
                            "color-mix(in srgb, var(--warning, #c9a227) 10%, transparent)",
                        }
                      : undefined
                  }
                >
                  <td>
                    {r.purchasedAt ?? "—"}
                    {r.purchasedAt &&
                    r.purchasedAt >
                      new Date().toLocaleDateString("en-CA", {
                        timeZone: "Asia/Shanghai",
                      }) ? (
                      <span className="muted" title="飞书采购时间晚于今天，多为表内填错">
                        {" "}
                        (表日期异常)
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <ProductCell
                      partnerSku={r.partnerSku}
                      title={r.title || r.productName}
                      imageUrl={r.imageUrl}
                    />
                  </td>
                  <td>{r.qty}</td>
                  <td>{r.unitCost}</td>
                  <td>{r.amount}</td>
                  <td>{r.supplier || "—"}</td>
                  <td className="muted">{r.orderId || "—"}</td>
                  <td>{r.trackingNo || "—"}</td>
                  <td>{r.transitStatus || "—"}</td>
                  <td>{r.status || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>入账 / 开支流水</h3>
        <table className="table">
          <thead>
            <tr>
              <th>日期</th>
              <th>类型</th>
              <th>科目</th>
              <th>金额</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {cash.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  暂无现金流水。
                </td>
              </tr>
            ) : (
              cash.slice(0, 100).map((r) => (
                <tr key={r.id}>
                  <td>{r.occurredAt ?? "—"}</td>
                  <td>
                    {r.kind === "income"
                      ? "入账"
                      : r.kind === "expense"
                        ? "开支"
                        : r.kind}
                  </td>
                  <td>{r.category || "—"}</td>
                  <td>{r.amount}</td>
                  <td>{r.remark || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="card">
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
          <h3 style={{ margin: 0 }}>SKU 单位采购成本</h3>
          <ClearableInput
            className="input"
            style={{ minWidth: 220, maxWidth: 320 }}
            placeholder="搜索 PSKU / 标题（含无图无标题）"
            value={costQuery}
            onChange={(e) => setCostQuery(e.target.value)}
          />
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 10 }}>
          默认只展示有图/有标题的 {costView.visible.length}
          {costs.length ? ` / ${costs.length}` : ""} 行
          {costView.hiddenCount > 0 && !costView.searching
            ? ` · 已隐藏无 Catalog 展示 ${costView.hiddenCount}（搜索可召回）`
            : ""}
          {costView.searching ? ` · 搜索「${costQuery.trim()}」` : ""}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: 260 }}>产品</th>
              <th>采购价 RMB</th>
              <th>优先空运</th>
              <th>货型</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {costs.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  暂无本地成本。
                </td>
              </tr>
            ) : costView.visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  {costView.searching
                    ? "无匹配行。"
                    : "暂无有图/有标题的成本行；可搜索 PSKU 查看隐藏项。"}
                </td>
              </tr>
            ) : (
              costView.visible.slice(0, 100).map((r) => (
                <tr key={r.partnerSku}>
                  <td>
                    <ProductCell
                      partnerSku={r.partnerSku}
                      title={r.title}
                      imageUrl={r.imageUrl}
                    />
                  </td>
                  <td>{r.purchaseCost}</td>
                  <td>{r.preferAir ? "是" : "否"}</td>
                  <td>{r.cargoType}</td>
                  <td className="muted">{r.source ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
