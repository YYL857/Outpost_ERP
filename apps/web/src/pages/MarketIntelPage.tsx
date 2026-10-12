import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type CategoryFitnessReport,
  type CategoryFitnessResponse,
  type MarketIntelJob,
  type MarketIntelStatus,
  type MarketWatchItem,
  type MiIntelSource,
  type MiMonitorTarget,
  type MiPendingPriceChange,
  type MiPriceAlert,
  type MiSourceSnippet,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import {
  assumptionsForProfile,
  estimateFbnUnitProfit,
  mergeFbnAssumptions,
  type FbnCommissionProfile,
} from "../lib/fbn-profit";

type PendingBrand = NonNullable<
  NonNullable<MarketIntelStatus["brandRegistry"]>["pendingTop"]
>[number];

function jobMessage(
  data: MarketIntelJob | { discover: MarketIntelJob; collect: MarketIntelJob | null },
): string {
  if ("message" in data && typeof data.message === "string" && !("discover" in data)) {
    return data.message;
  }
  const d = data as { discover: MarketIntelJob; collect: MarketIntelJob | null };
  return d.collect
    ? `${d.discover.message} → ${d.collect.message}`
    : d.discover.message;
}

function aiAdviceLabel(ai: PendingBrand["ai"]): {
  text: string;
  tone: "ok" | "warn" | "danger" | "idle";
} {
  if (!ai) return { text: "暂无建议", tone: "idle" };
  if (ai.applied) return { text: "已标为不竞争", tone: "ok" };

  const action = (ai.action ?? "").toLowerCase();
  const fame = (ai.fameLevel ?? "").toLowerCase();

  // 勿用 fame.includes("known")：会把 unknown 误判成不竞争
  if (action === "avoid_compete" || fame === "global" || fame === "mena_known") {
    return { text: "建议：不竞争", tone: "danger" };
  }
  if (action === "keep_candidate" || fame === "niche") {
    return { text: "倾向：可跟（待确认白板）", tone: "ok" };
  }
  if (action === "needs_human" || fame === "unknown" || action === "unknown") {
    return { text: "证据不足，需人工", tone: "warn" };
  }
  return { text: "需人工判断", tone: "warn" };
}

function brandTierLabel(tier?: string): string {
  if (tier === "white_label") return "确认白板";
  if (tier === "white_candidate") return "白板候选";
  if (tier === "avoid_compete" || tier === "big_brand") return "不竞争";
  if (tier === "unknown") return "未定性";
  return tier ?? "—";
}

function confTierLabel(tier?: string | null): string {
  if (tier === "high") return "高";
  if (tier === "mid") return "中";
  if (tier === "low") return "低";
  return "—";
}

function verdictTone(v: CategoryFitnessReport["verdict"]): "ok" | "warn" | "danger" | "idle" {
  if (v === "go") return "ok";
  if (v === "skip") return "danger";
  if (v === "watch") return "warn";
  return "idle";
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function isFitnessBundle(
  data: CategoryFitnessResponse | CategoryFitnessReport,
): data is CategoryFitnessResponse {
  return "categories" in data && Array.isArray(data.categories);
}

/** 上中文、下原文，方便运营阅读 */
function TitleBilingual(props: {
  title: string;
  titleZh?: string | null;
  href?: string;
}) {
  const { title, titleZh, href } = props;
  const en = href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {title}
    </a>
  ) : (
    <span>{title}</span>
  );
  return (
    <div className="mi-title-bi">
      <div className="mi-title-zh">{titleZh?.trim() || "（待译中文）"}</div>
      <div className="mi-title-en muted">{en}</div>
    </div>
  );
}

/** 品牌定性：样例图 + 可点链接 + 卡片标签 */
function PendingSample(props: { row: PendingBrand }) {
  const ref = props.row.exampleRefs?.[0];
  const title = ref?.title || props.row.examples?.[0] || "—";
  const url = ref?.url || undefined;
  const img = ref?.imageUrl || undefined;
  const tags = ref?.tags ?? [];

  return (
    <div className="mi-pending-sample">
      {img ? (
        <a
          className="mi-pending-thumb"
          href={url || img}
          target="_blank"
          rel="noreferrer"
          title="查看商品图"
        >
          <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </a>
      ) : (
        <div className="mi-pending-thumb mi-pending-thumb-empty" aria-hidden />
      )}
      <div className="mi-pending-sample-body">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="mi-pending-link">
            {title}
          </a>
        ) : (
          <div className="mi-sample">{title}</div>
        )}
        {tags.length > 0 && (
          <div className="mi-tag-row">
            {tags.slice(0, 6).map((t) => (
              <span key={t} className="mi-tag">
                {t}
              </span>
            ))}
          </div>
        )}
        {url ? (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            点击标题跳转 Noon
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MarketIntelPage() {
  const [status, setStatus] = useState<MarketIntelStatus | null>(null);
  const [watchlist, setWatchlist] = useState<MarketWatchItem[]>([]);
  const [jobs, setJobs] = useState<MarketIntelJob[]>([]);
  const [fitnessCats, setFitnessCats] = useState<CategoryFitnessReport[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>("");
  const [titleZhMap, setTitleZhMap] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [lastMsg, setLastMsg] = useState("");
  const [fbnProfile, setFbnProfile] = useState<FbnCommissionProfile>("general_15");
  const [purchaseCostSar, setPurchaseCostSar] = useState<number | "">(80);
  const [firstMileSar, setFirstMileSar] = useState(2.5);
  const [outboundFeeSar, setOutboundFeeSar] = useState(10.5);
  const [storageSar, setStorageSar] = useState(0);
  const [cpcSar, setCpcSar] = useState(0.5);
  const [assumedClicks, setAssumedClicks] = useState(20);

  const [monitorItems, setMonitorItems] = useState<MiMonitorTarget[]>([]);
  const [monitorPending, setMonitorPending] = useState<MiPendingPriceChange[]>([]);
  const [monitorAlerts, setMonitorAlerts] = useState<MiPriceAlert[]>([]);
  const [intelSources, setIntelSources] = useState<MiIntelSource[]>([]);
  const [sourceSnippets, setSourceSnippets] = useState<MiSourceSnippet[]>([]);
  const [pasteSourceId, setPasteSourceId] = useState("noon-reviews");
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualPrice, setManualPrice] = useState<number | "">("");

  const fbnAssumptions = useMemo(
    () =>
      mergeFbnAssumptions(assumptionsForProfile(fbnProfile), {
        purchaseCostSar:
          purchaseCostSar === "" || !Number.isFinite(Number(purchaseCostSar))
            ? null
            : Number(purchaseCostSar),
        firstMileSar,
        outboundFeeSar,
        storageSar,
        cpcSar,
        assumedClicks,
      }),
    [
      fbnProfile,
      purchaseCostSar,
      firstMileSar,
      outboundFeeSar,
      storageSar,
      cpcSar,
      assumedClicks,
    ],
  );

  const refresh = useCallback(async () => {
    const [st, wl, jb, fit, mon, src] = await Promise.all([
      api.getMarketIntelStatus(),
      api.getMarketIntelWatchlist(),
      api.getMarketIntelJobs(12),
      api.getMarketIntelCategoryFitness(),
      api.getMarketIntelMonitor(),
      api.getMarketIntelSources(),
    ]);
    setStatus(st.data);
    setWatchlist(wl.data);
    setJobs(jb.data);
    const fitData = fit.data;
    const cats = isFitnessBundle(fitData) ? fitData.categories : [fitData];
    setFitnessCats(cats);
    setMonitorItems(mon.data.items);
    setMonitorPending(mon.data.pendingChanges);
    setMonitorAlerts(mon.data.alerts);
    setIntelSources(src.data.sources);
    setSourceSnippets(src.data.snippets);
    setPasteSourceId((prev) =>
      src.data.sources.some((s) => s.sourceId === prev)
        ? prev
        : (src.data.sources[0]?.sourceId ?? prev),
    );
    const fromWl: Record<string, string> = {};
    for (const w of wl.data) {
      if (w.titleZh?.trim()) fromWl[w.productKey] = w.titleZh.trim();
    }
    for (const c of cats) {
      for (const p of c.shortlist ?? []) {
        if (p.titleZh?.trim()) fromWl[p.productKey] = p.titleZh.trim();
      }
    }
    setTitleZhMap((prev) => ({ ...fromWl, ...prev }));
    setSelectedCat((prev) => {
      if (prev && cats.some((c) => c.categoryId === prev)) return prev;
      const preferred =
        cats.find((c) => c.verdict === "go") ??
        cats.find((c) => c.sampleSize > 0) ??
        cats[0];
      return preferred?.categoryId ?? "";
    });
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const activeFitness = useMemo(
    () => fitnessCats.find((c) => c.categoryId === selectedCat) ?? fitnessCats[0] ?? null,
    [fitnessCats, selectedCat],
  );

  const shortlistKeySig = (activeFitness?.shortlist ?? [])
    .map((p) => p.productKey)
    .join("|");

  useEffect(() => {
    if (!activeFitness?.shortlist?.length) return;
    const keys = activeFitness.shortlist.map((p) => p.productKey);
    const missing = keys.filter((k) => !titleZhMap[k]);
    if (missing.length === 0) return;

    let cancelled = false;
    setTranslating(true);
    void (async () => {
      try {
        const res = await api.translateMarketIntelTitlesZh({
          productKeys: missing,
          limit: Math.min(missing.length, 20),
        });
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const row of res.data.rows) {
          if (row.titleZh?.trim()) next[row.productKey] = row.titleZh.trim();
        }
        setTitleZhMap((prev) => ({ ...prev, ...next }));
        if (!res.data.configured && res.data.translated === 0) {
          setLastMsg(
            "未配置 DeepSeek，无法自动译标题（DEEPSEEK_API_KEY 或 DS-key.txt）",
          );
        } else if (res.data.translated > 0) {
          setLastMsg(`已翻译 ${res.data.translated} 条标题`);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setTranslating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // titleZhMap 故意不进依赖，避免译完后再触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFitness?.categoryId, shortlistKeySig]);

  async function run(
    action:
      | "discover-mock"
      | "collect-mock"
      | "discover-real"
      | "collect-real"
      | "sched-on"
      | "sched-off"
      | "watch-on"
      | "watch-off"
      | "purge-mock"
      | "purge-test"
      | "live-mode",
  ) {
    setError("");
    setBusy(action);
    setLastMsg("");
    try {
      if (action === "discover-mock") {
        const res = await api.runMarketIntelDiscover({ forceMock: true });
        setLastMsg(`[开发] ${jobMessage(res.data)}`);
      } else if (action === "collect-mock") {
        const res = await api.runMarketIntelCollect({ forceMock: true });
        setLastMsg(`[开发] ${res.data.message}`);
      } else if (action === "discover-real") {
        const res = await api.runMarketIntelDiscover({});
        setLastMsg(jobMessage(res.data));
      } else if (action === "collect-real") {
        const res = await api.runMarketIntelCollect({ limit: 500 });
        setLastMsg(res.data.message);
      } else if (action === "sched-on") {
        await api.startMarketIntelScheduler();
        setLastMsg(`定时已开`);
      } else if (action === "sched-off") {
        await api.stopMarketIntelScheduler();
        setLastMsg(`定时已关`);
      } else if (action === "watch-on") {
        await api.startMarketIntelWatcher();
        setLastMsg(`投递监视已开`);
      } else if (action === "watch-off") {
        await api.stopMarketIntelWatcher();
        setLastMsg(`投递监视已关`);
      } else if (action === "purge-mock") {
        const res = await api.purgeMarketIntelMock();
        setLastMsg(res.message ?? `已清除 Mock ${res.data.removed}`);
      } else if (action === "purge-test") {
        const res = await api.purgeMarketIntelTest();
        setLastMsg(res.message ?? `已清除测试数据 ${res.data.removed}`);
      } else {
        const res = await api.enableMarketIntelLiveMode();
        setLastMsg(res.message ?? "已切换正式模式");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const registry = status?.brandRegistry;
  const pending = (registry?.pendingTop ?? []).slice(0, 20);
  const watcherOn = Boolean(status?.inboxWatcher?.enabled);
  const schedOn = Boolean(status?.scheduler?.enabled);

  const sortedWatch = [...watchlist]
    .sort((a, b) => {
      const rank = (t?: string) =>
        t === "white_label"
          ? 0
          : t === "white_candidate"
            ? 1
            : t === "unknown"
              ? 2
              : 3;
      const sold = (b.soldRecently ?? -1) - (a.soldRecently ?? -1);
      if (sold !== 0) return sold;
      return rank(a.brandTier) - rank(b.brandTier);
    })
    .slice(0, 150);

  return (
    <div className="mi-page">
      <header className="mi-hero">
        <h1 className="page-title">市场情报 · Noon 沙特</h1>
        <p className="page-desc">
          先看<strong>品类值不值得做</strong>，再看白板热卖；下方「竞品盯价」用扩展采价（双次同向才告警），「情报来源」登记沙特社媒/新闻粘贴。
        </p>
      </header>

      {registry && (
        <div className="mi-stats" aria-label="摘要">
          <div className="mi-stat mi-stat-focus">
            <span className="mi-stat-n">
              {fitnessCats.filter((c) => c.verdict === "go").length}
            </span>
            <span className="mi-stat-l">建议跟品类</span>
          </div>
          <div className="mi-stat">
            <span className="mi-stat-n">{registry.pendingCount}</span>
            <span className="mi-stat-l">待判定牌子</span>
          </div>
          <div className="mi-stat">
            <span className="mi-stat-n">{registry.confirmedWhiteCount}</span>
            <span className="mi-stat-l">确认白板</span>
          </div>
          <div className="mi-stat">
            <span className="mi-stat-n">{monitorItems.length}</span>
            <span className="mi-stat-l">盯价目标</span>
          </div>
          <div className="mi-stat">
            <span className="mi-stat-n">
              {monitorAlerts.filter((a) => a.status === "open").length}
            </span>
            <span className="mi-stat-l">价变告警</span>
          </div>
          <div className="mi-stat mi-stat-soft">
            <span className="mi-stat-l">
              监视 {watcherOn ? "开" : "关"} · 定时 {schedOn ? "开" : "关"}
            </span>
          </div>
        </div>
      )}

      {error && (
        <p className="alert danger" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}
      {lastMsg && <p className="muted mi-toast">{lastMsg}</p>}

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="mi-work-head">
          <div>
            <h2 className="mi-section-title">品类适销</h2>
            <p className="muted" style={{ margin: 0 }}>
              综合近期销量、客单区间、白牌竞争密度，给出建议跟 / 观望 / 不建议。
            </p>
          </div>
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy)}
            onClick={() => void refresh()}
          >
            刷新结论
          </button>
        </div>

        {fitnessCats.length === 0 ? (
          <p className="muted">暂无品类数据。跑影刀投递并入库后会出现结论。</p>
        ) : (
          <div className="mi-fitness-grid">
            {fitnessCats.map((c) => (
              <button
                key={c.categoryId}
                type="button"
                className={`mi-fitness-card${selectedCat === c.categoryId ? " is-active" : ""}`}
                onClick={() => setSelectedCat(c.categoryId)}
              >
                <div className="mi-fitness-card-top">
                  <span className="mi-fitness-title">{c.categoryTitle}</span>
                  <span className={`badge ${verdictTone(c.verdict)}`}>{c.verdictLabel}</span>
                </div>
                <ul className="mi-fitness-reasons">
                  {(c.reasons.length ? c.reasons : ["暂无理由"]).slice(0, 3).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="mi-fitness-metrics muted">
                  样本 {c.sampleSize}
                  {" · "}
                  白牌 {pct(c.metrics.whiteShare)}
                  {" · "}
                  销量覆盖 {pct(c.metrics.soldRecentlyCoverage)}
                  {" · "}
                  销量中位{" "}
                  {c.metrics.soldRecentlyMedian != null
                    ? Math.round(c.metrics.soldRecentlyMedian)
                    : "—"}
                  {" · "}
                  客单中位{" "}
                  {c.metrics.priceMedianWhite != null
                    ? `${Math.round(c.metrics.priceMedianWhite)} SAR`
                    : "—"}
                  {" · "}
                  甜区 {pct(c.metrics.aspInSweetShare)}
                  {c.metrics.priceCleanShare != null ? (
                    <>
                      {" · "}
                      价可信 {pct(c.metrics.priceCleanShare)}
                    </>
                  ) : null}
                  {c.metrics.sellerTopShare != null ? (
                    <>
                      {" · "}
                      卖家集中 {pct(c.metrics.sellerTopShare)}
                    </>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="mi-work-head">
          <div>
            <h2 className="mi-section-title">
              白牌热销短名单
              {activeFitness ? (
                <span className="muted" style={{ fontWeight: 500, marginLeft: 8 }}>
                  · {activeFitness.categoryTitle}
                </span>
              ) : null}
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              上中文、下原文。打开类目会自动补译
              {translating ? "（翻译中…）" : ""}。
              FBN 毛利对齐成本利润表（售价 − 货源 − 仓配头程 − 落地配 − 佣金 −
              VAT − 仓储 − 假设广告）；当前采集通常只有售价，其余为手工假设。
            </p>
          </div>
          <div className="mi-shortlist-actions">
            <label className="mi-cost-field">
              佣金档
              <select
                value={fbnProfile}
                onChange={(e) =>
                  setFbnProfile(e.target.value as FbnCommissionProfile)
                }
              >
                <option value="general_15">普货 15%</option>
                <option value="fashion_25">时尚 25%</option>
              </select>
            </label>
            <label className="mi-cost-field">
              货源
              <ClearableInput
                type="number"
                min={0}
                step={1}
                placeholder="未知"
                value={purchaseCostSar}
                onChange={(e) => {
                  const v = e.target.value;
                  setPurchaseCostSar(v === "" ? "" : Number(v));
                }}
              />
            </label>
            <label className="mi-cost-field">
              头程
              <ClearableInput
                type="number"
                min={0}
                step={0.1}
                value={firstMileSar}
                onChange={(e) => setFirstMileSar(Number(e.target.value) || 0)}
              />
            </label>
            <label className="mi-cost-field">
              落地配
              <ClearableInput
                type="number"
                min={0}
                step={0.1}
                value={outboundFeeSar}
                onChange={(e) => setOutboundFeeSar(Number(e.target.value) || 0)}
              />
            </label>
            <label className="mi-cost-field">
              CPC
              <ClearableInput
                type="number"
                min={0}
                step={0.1}
                value={cpcSar}
                onChange={(e) => setCpcSar(Number(e.target.value) || 0)}
              />
            </label>
            <label className="mi-cost-field">
              点击/单
              <ClearableInput
                type="number"
                min={1}
                step={1}
                value={assumedClicks}
                onChange={(e) => setAssumedClicks(Number(e.target.value) || 20)}
              />
            </label>
            <label className="mi-cost-field">
              仓储
              <ClearableInput
                type="number"
                min={0}
                step={0.1}
                value={storageSar}
                onChange={(e) => setStorageSar(Number(e.target.value) || 0)}
              />
            </label>
            <a
              className={`btn${activeFitness?.shortlist?.length ? "" : " disabled"}`}
              href={
                activeFitness
                  ? api.marketIntelShortlistCsvUrl({
                      categoryId: activeFitness.categoryId,
                      profile: fbnProfile,
                      purchaseCostSar: fbnAssumptions.purchaseCostSar,
                      firstMileSar: fbnAssumptions.firstMileSar,
                      outboundFeeSar: fbnAssumptions.outboundFeeSar,
                      storageSar: fbnAssumptions.storageSar,
                      cpcSar: fbnAssumptions.cpcSar,
                      assumedClicks: fbnAssumptions.assumedClicks,
                    })
                  : undefined
              }
              download={
                activeFitness
                  ? `market-intel-${activeFitness.categoryId}-shortlist.csv`
                  : undefined
              }
              aria-disabled={!activeFitness?.shortlist?.length}
              onClick={(e) => {
                if (!activeFitness?.shortlist?.length) e.preventDefault();
              }}
            >
              导出选品表
            </a>
            <button
              type="button"
              className="btn"
              disabled={translating || !activeFitness?.shortlist?.length}
              onClick={() => {
                if (!activeFitness) return;
                const keys = activeFitness.shortlist.map((p) => p.productKey);
                setTitleZhMap((prev) => {
                  const next = { ...prev };
                  for (const k of keys) delete next[k];
                  return next;
                });
                void (async () => {
                  setTranslating(true);
                  try {
                    const res = await api.translateMarketIntelTitlesZh({
                      productKeys: keys,
                      limit: keys.length,
                      force: true,
                    });
                    const next: Record<string, string> = {};
                    for (const row of res.data.rows) {
                      if (row.titleZh?.trim()) next[row.productKey] = row.titleZh.trim();
                    }
                    setTitleZhMap((prev) => ({ ...prev, ...next }));
                    setLastMsg(res.message ?? `翻译完成 ${res.data.translated}`);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setTranslating(false);
                  }
                })();
              }}
            >
              {translating ? "翻译中…" : "重新翻译本页"}
            </button>
          </div>
        </div>
        {activeFitness && activeFitness.metrics.soldRecentlyCoverage < 0.15 ? (
          <p className="mi-dq-banner">
            销量覆盖率仅 {pct(activeFitness.metrics.soldRecentlyCoverage)}
            ，短名单排序与中位数仅供参考，不要据此下铺货决定。
          </p>
        ) : null}
        {activeFitness &&
        activeFitness.metrics.priceCleanShare != null &&
        activeFitness.metrics.priceCleanShare < 0.4 ? (
          <p className="mi-dq-banner">
            价格可信度约 {pct(activeFitness.metrics.priceCleanShare)}
            ，脏价已从适销计算中剔除；请重跑影刀后再看客单。
          </p>
        ) : null}
        <table className="table">
          <thead>
            <tr>
              <th>商品（中 / 英）</th>
              <th>分层</th>
              <th>近期销量</th>
              <th>价格</th>
              <th>FBN估算毛利</th>
              <th>利润率</th>
              <th>评分</th>
            </tr>
          </thead>
          <tbody>
            {(activeFitness?.shortlist ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  该类目暂无白牌/候选短名单。
                </td>
              </tr>
            )}
            {(activeFitness?.shortlist ?? []).map((p) => {
              const est = estimateFbnUnitProfit(p.price, fbnAssumptions);
              const marginPct =
                est?.marginPct != null
                  ? `${Math.round(est.marginPct * 1000) / 10}%`
                  : "—";
              return (
              <tr key={p.productKey}>
                <td>
                  {p.isAd ? (
                    <span className="badge idle" style={{ marginRight: 6 }}>
                      广告
                    </span>
                  ) : null}
                  {p.isBestSeller ? (
                    <span className="badge ok" style={{ marginRight: 6 }}>
                      Best Seller
                    </span>
                  ) : null}
                  <TitleBilingual
                    title={p.title || p.productKey}
                    titleZh={titleZhMap[p.productKey] ?? p.titleZh}
                    href={p.url}
                  />
                  {p.sellerName ? (
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      卖家 {p.sellerName}
                    </div>
                  ) : null}
                </td>
                <td>{brandTierLabel(p.brandTier)}</td>
                <td>
                  {p.soldRecentlyText ??
                    (p.soldRecently != null ? `${p.soldRecently}+` : "—")}
                </td>
                <td>
                  {p.price != null ? `${p.price} ${p.currency || "SAR"}` : "—"}
                </td>
                <td
                  className={
                    est != null && est.profitSar < 0 ? "mi-margin-neg" : undefined
                  }
                >
                  {est != null ? (
                    <>
                      {est.profitSar} SAR
                      {!est.profitComplete ? (
                        <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                          估算
                        </span>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{marginPct}</td>
                <td>
                  {p.rating != null
                    ? `${p.rating}${p.reviewCount != null ? ` (${p.reviewCount})` : ""}`
                    : "—"}
                  {p.url ? (
                    <div style={{ marginTop: 4 }}>
                      <Link
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: "2px 8px" }}
                        to={`/listing?${new URLSearchParams({
                          competitorUrl: p.url,
                          ...(p.title ? { competitorTitle: p.title } : {}),
                          ...(p.price != null
                            ? {
                                competitorPrice: `${p.price} ${p.currency || "SAR"}`,
                              }
                            : {}),
                        }).toString()}`}
                      >
                        → Listing
                      </Link>
                    </div>
                  ) : null}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {registry && (
        <details className="card mi-fold" style={{ marginBottom: 16 }}>
          <summary className="mi-fold-summary">
            <span>品牌定性</span>
            <span className="muted">待判定 {registry.pendingCount}</span>
          </summary>
          <div className="mi-fold-body">
            <div className="mi-work-head">
              <p className="muted" style={{ margin: 0 }}>
                AI 只给参考，确认白板须人工点。脏 token 可一键清理或单条删除（不进白板/避开）。
              </p>
              <button
                type="button"
                className="btn"
                disabled={Boolean(busy)}
                onClick={() =>
                  void (async () => {
                    setBusy("prune");
                    try {
                      const res = await api.pruneMarketIntelBrandNoise();
                      setLastMsg(res.message ?? `已清理噪声 ${res.data.removed}`);
                      await refresh();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy("");
                    }
                  })()
                }
              >
                {busy === "prune" ? "清理中…" : "清理脏 token"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy) || !status?.brandIntel?.configured}
                onClick={() =>
                  void (async () => {
                    setBusy("ai-brand");
                    setError("");
                    try {
                      const res = await api.reviewMarketIntelBrandsAi({
                        limit: 8,
                        autoApply: true,
                      });
                      setLastMsg(
                        res.message ??
                          (res.data.appliedAvoid.length
                            ? `AI 已自动标不竞争：${res.data.appliedAvoid.join("、")}`
                            : "AI 审核完成，无自动写入"),
                      );
                      await refresh();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy("");
                    }
                  })()
                }
              >
                {busy === "ai-brand" ? "AI 审核中…" : "让 AI 先筛一轮"}
              </button>
            </div>
            <table className="table mi-table">
              <thead>
                <tr>
                  <th>牌子</th>
                  <th style={{ width: 72 }}>出现</th>
                  <th>样例商品</th>
                  <th style={{ width: 140 }}>AI 参考</th>
                  <th style={{ width: 260 }}>你的决定</th>
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      暂无待判定品牌
                    </td>
                  </tr>
                )}
                {pending.map((p) => {
                  const advice = aiAdviceLabel(p.ai);
                  return (
                    <tr key={p.token}>
                      <td>
                        <div className="mi-brand">{p.token}</div>
                        {p.categoryId ? (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {p.categoryId}
                          </div>
                        ) : null}
                      </td>
                      <td>{p.hits}</td>
                      <td>
                        <PendingSample row={p} />
                      </td>
                      <td>
                        <span className={`badge ${advice.tone}`}>{advice.text}</span>
                      </td>
                      <td>
                        <div className="mi-actions">
                          <button
                            type="button"
                            className="btn"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void (async () => {
                                setBusy("brand");
                                try {
                                  const res = await api.promoteMarketIntelBrand(
                                    p.token,
                                    "avoidCompete",
                                    p.categoryId,
                                  );
                                  setLastMsg(res.message ?? `已标不竞争：${p.token}`);
                                  await refresh();
                                } catch (e) {
                                  setError(
                                    e instanceof Error ? e.message : String(e),
                                  );
                                } finally {
                                  setBusy("");
                                }
                              })()
                            }
                          >
                            不竞争
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void (async () => {
                                setBusy("brand");
                                try {
                                  const res = await api.promoteMarketIntelBrand(
                                    p.token,
                                    "confirmedWhite",
                                    p.categoryId,
                                  );
                                  setLastMsg(res.message ?? `已确认白板：${p.token}`);
                                  await refresh();
                                } catch (e) {
                                  setError(
                                    e instanceof Error ? e.message : String(e),
                                  );
                                } finally {
                                  setBusy("");
                                }
                              })()
                            }
                          >
                            确认白板
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void (async () => {
                                setBusy("brand");
                                try {
                                  const res = await api.discardMarketIntelBrand(
                                    p.token,
                                    p.categoryId,
                                  );
                                  setLastMsg(res.message ?? `已删除：${p.token}`);
                                  await refresh();
                                } catch (e) {
                                  setError(
                                    e instanceof Error ? e.message : String(e),
                                  );
                                } finally {
                                  setBusy("");
                                }
                              })()
                            }
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <details className="card mi-fold" style={{ marginBottom: 16 }} open>
        <summary className="mi-fold-summary">
          <span>竞品盯价</span>
          <span className="muted">
            {monitorItems.length} 目标 · 待确认 {monitorPending.length} · 告警{" "}
            {monitorAlerts.filter((a) => a.status === "open").length}
          </span>
        </summary>
        <div className="mi-fold-body">
          <p className="muted" style={{ marginTop: 0 }}>
            扩展商详「采价」为主通道；仅中/高置信 + 两次同向价变才出告警。低置信可存不可推。
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <ClearableInput
              placeholder="productKey"
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              style={{ width: 120 }}
            />
            <ClearableInput
              placeholder="Noon URL"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <ClearableInput
              placeholder="标题（可选）"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              style={{ width: 140 }}
            />
            <ClearableInput
              type="number"
              placeholder="价 SAR"
              value={manualPrice}
              onChange={(e) =>
                setManualPrice(e.target.value === "" ? "" : Number(e.target.value))
              }
              style={{ width: 90 }}
            />
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy) || !manualKey.trim() || !manualUrl.trim()}
              onClick={() =>
                void (async () => {
                  setBusy("mon-add");
                  setError("");
                  try {
                    await api.addMarketIntelMonitorTarget({
                      productKey: manualKey.trim(),
                      url: manualUrl.trim(),
                      title: manualTitle.trim() || undefined,
                      addedFrom: "manual",
                    });
                    if (manualPrice !== "" && Number.isFinite(Number(manualPrice))) {
                      const res = await api.ingestMarketIntelMonitorPrice({
                        productKey: manualKey.trim(),
                        url: manualUrl.trim(),
                        title: manualTitle.trim() || undefined,
                        price: Number(manualPrice),
                        source: "manual",
                        parseMethod: "manual",
                      });
                      setLastMsg(res.message ?? "已登记并采价");
                    } else {
                      setLastMsg("已加入监控池");
                    }
                    setManualKey("");
                    setManualUrl("");
                    setManualTitle("");
                    setManualPrice("");
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy("");
                  }
                })()
              }
            >
              {busy === "mon-add" ? "提交中…" : "登记 / 手工采价"}
            </button>
          </div>

          {monitorAlerts.filter((a) => a.status === "open").length > 0 && (
            <table className="table" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>告警</th>
                  <th>商品</th>
                  <th>变化</th>
                  <th>确认时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {monitorAlerts
                  .filter((a) => a.status === "open")
                  .map((a) => (
                    <tr key={a.id}>
                      <td style={{ color: a.direction === "down" ? "var(--danger)" : "var(--ok, green)" }}>
                        {a.direction === "down" ? "降价" : "涨价"} · {confTierLabel(a.tier)}
                      </td>
                      <td>
                        <a href={a.url} target="_blank" rel="noreferrer">
                          {a.title || a.productKey}
                        </a>
                      </td>
                      <td>
                        {a.fromPrice} → {a.toPrice}（
                        {Math.round(a.changePct * 100)}%）
                      </td>
                      <td>{a.confirmedAt.replace("T", " ").slice(0, 19)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void (async () => {
                              setBusy(`ack-${a.id}`);
                              try {
                                await api.ackMarketIntelPriceAlert(a.id);
                                setLastMsg(`已确认告警 ${a.productKey}`);
                                await refresh();
                              } catch (e) {
                                setError(e instanceof Error ? e.message : String(e));
                              } finally {
                                setBusy("");
                              }
                            })()
                          }
                        >
                          知悉
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {monitorPending.length > 0 && (
            <p className="muted" style={{ fontSize: 12 }}>
              待二次确认：{" "}
              {monitorPending
                .map(
                  (p) =>
                    `${p.productKey} ${p.fromPrice}→${p.toPrice}(${p.direction})`,
                )
                .join("；")}
            </p>
          )}

          <table className="table">
            <thead>
              <tr>
                <th>商品</th>
                <th>最近价</th>
                <th>置信</th>
                <th>采集时间</th>
                <th>来源</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {monitorItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    暂无盯价目标。用扩展在商详点「采价」，或上方手工登记。
                  </td>
                </tr>
              )}
              {monitorItems.map((m) => (
                <tr key={m.productKey}>
                  <td>
                    <a href={m.url} target="_blank" rel="noreferrer">
                      {m.title || m.productKey}
                    </a>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {m.productKey}
                    </div>
                  </td>
                  <td>{m.lastPrice != null ? `${m.lastPrice} SAR` : "—"}</td>
                  <td>
                    {confTierLabel(m.lastTier)}
                    {m.lastConfidence != null
                      ? ` (${m.lastConfidence.toFixed(2)})`
                      : ""}
                  </td>
                  <td>
                    {m.lastCapturedAt
                      ? m.lastCapturedAt.replace("T", " ").slice(0, 19)
                      : "—"}
                  </td>
                  <td>{m.addedFrom}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void (async () => {
                          setBusy(`rm-${m.productKey}`);
                          try {
                            await api.removeMarketIntelMonitorTarget(m.productKey);
                            await refresh();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                          } finally {
                            setBusy("");
                          }
                        })()
                      }
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="card mi-fold" style={{ marginBottom: 16 }}>
        <summary className="mi-fold-summary">
          <span>情报来源</span>
          <span className="muted">
            {intelSources.filter((s) => s.status === "active").length} 启用 ·{" "}
            {sourceSnippets.length} 近期片段
          </span>
        </summary>
        <div className="mi-fold-body">
          <p className="muted" style={{ marginTop: 0 }}>
            先登记来源再粘贴情报；社媒默认「仮説」，与 Noon 交叉验证后再升结论。
          </p>
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <select
              value={pasteSourceId}
              onChange={(e) => setPasteSourceId(e.target.value)}
            >
              {intelSources.map((s) => (
                <option key={s.sourceId} value={s.sourceId}>
                  {s.title}（{s.status}）
                </option>
              ))}
            </select>
            <ClearableInput
              className="input"
              placeholder="标题（可选）"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              style={{ width: 160 }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(busy) || !pasteText.trim() || !pasteSourceId}
              onClick={() =>
                void (async () => {
                  setBusy("paste");
                  setError("");
                  try {
                    const res = await api.pasteMarketIntelSource({
                      sourceId: pasteSourceId,
                      text: pasteText.trim(),
                      title: pasteTitle.trim() || undefined,
                    });
                    setLastMsg(res.message ?? "已粘贴");
                    setPasteText("");
                    setPasteTitle("");
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy("");
                  }
                })()
              }
            >
              {busy === "paste" ? "提交中…" : "粘贴入库"}
            </button>
          </div>
          <textarea
            rows={4}
            placeholder="粘贴阿语/英语评论、Trends 摘要、新闻要点、达人文案…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            style={{ width: "100%", marginBottom: 12, boxSizing: "border-box" }}
          />

          <table className="table" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>来源</th>
                <th>类型</th>
                <th>获取</th>
                <th>状态</th>
                <th>分</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {intelSources.map((s) => (
                <tr key={s.sourceId}>
                  <td>
                    {s.title}
                    {s.note ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {s.note}
                      </div>
                    ) : null}
                  </td>
                  <td>{s.type}</td>
                  <td>{s.howWeGet}</td>
                  <td>{s.status}</td>
                  <td>{s.score.toFixed(2)}</td>
                  <td>
                    <select
                      value={s.status}
                      disabled={Boolean(busy)}
                      onChange={(e) =>
                        void (async () => {
                          const status = e.target.value as MiIntelSource["status"];
                          setBusy(`src-${s.sourceId}`);
                          try {
                            await api.setMarketIntelSourceStatus(s.sourceId, status);
                            await refresh();
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : String(err),
                            );
                          } finally {
                            setBusy("");
                          }
                        })()
                      }
                    >
                      <option value="active">active</option>
                      <option value="trial">trial</option>
                      <option value="watch">watch</option>
                      <option value="retired">retired</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {sourceSnippets.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>来源</th>
                  <th>置信</th>
                  <th>摘要</th>
                </tr>
              </thead>
              <tbody>
                {sourceSnippets.slice(0, 12).map((sn) => (
                  <tr key={sn.id}>
                    <td>{sn.capturedAt.replace("T", " ").slice(0, 19)}</td>
                    <td>{sn.sourceId}</td>
                    <td>
                      {confTierLabel(sn.tier)}
                      {sn.flags.length ? ` · ${sn.flags.join(",")}` : ""}
                    </td>
                    <td>
                      {sn.title ? <strong>{sn.title} </strong> : null}
                      {sn.text.slice(0, 160)}
                      {sn.text.length > 160 ? "…" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      <details className="card mi-fold" style={{ marginBottom: 16 }}>
        <summary className="mi-fold-summary">
          <span>监控池</span>
          <span className="muted">{watchlist.length} 条</span>
        </summary>
        <div className="mi-fold-body">
          <table className="table">
            <thead>
              <tr>
                <th>分层</th>
                <th>商品（中 / 英）</th>
                <th>近期销量</th>
                <th>卖家</th>
                <th>店评分</th>
                <th>90天客户</th>
                <th>价格</th>
              </tr>
            </thead>
            <tbody>
              {sortedWatch.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    监控池为空
                  </td>
                </tr>
              )}
              {sortedWatch.map((w) => (
                <tr key={w.productKey}>
                  <td>{brandTierLabel(w.brandTier)}</td>
                  <td>
                    <TitleBilingual
                      title={w.title || w.productKey}
                      titleZh={titleZhMap[w.productKey] ?? w.titleZh}
                    />
                  </td>
                  <td>
                    {w.soldRecentlyText ??
                      (w.soldRecently != null ? String(w.soldRecently) : "—")}
                  </td>
                  <td>{w.seller?.sellerName ?? "—"}</td>
                  <td>
                    {w.seller?.sellerRating != null
                      ? `${w.seller.sellerRating}`
                      : "—"}
                  </td>
                  <td>{w.seller?.sellerCustomers90d ?? "—"}</td>
                  <td>{w.price != null ? `${w.price} ${w.currency}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="card mi-fold" style={{ marginBottom: 16 }}>
        <summary className="mi-fold-summary">
          <span>日常运维</span>
          <span className="muted">处理投递、补采 — 偶尔用</span>
        </summary>
        <div className="mi-fold-body">
          <div className="row" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(busy)}
              onClick={() => void run("live-mode")}
            >
              一键正式模式
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void run("discover-real")}
            >
              {busy === "discover-real" ? "处理中…" : "立即处理投递"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void run("collect-real")}
            >
              {busy === "collect-real" ? "采集中…" : "补采快照"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void run("watch-on")}
            >
              开投递监视
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void run("sched-on")}
            >
              开定时刷新
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void refresh()}
            >
              刷新
            </button>
          </div>
        </div>
      </details>

      <details className="card mi-fold">
        <summary className="mi-fold-summary">
          <span>运行日志与诊断</span>
          <span className="muted">业务可忽略</span>
        </summary>
        <div className="mi-fold-body">
          <table className="table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>通道</th>
                <th>结果</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    暂无任务
                  </td>
                </tr>
              )}
              {jobs.map((j) => (
                <tr key={`${j.kind}-${j.id}`}>
                  <td>{j.finishedAt?.replace("T", " ").slice(0, 19)}</td>
                  <td>{j.kind}</td>
                  <td>{j.channel}</td>
                  <td style={{ color: j.ok ? "var(--ok, green)" : "var(--danger)" }}>
                    {j.ok ? "成功" : "失败"}
                  </td>
                  <td className="mi-tech-note">{j.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void run("discover-mock")}
            >
              Mock 发现
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void run("collect-mock")}
            >
              Mock 采集
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => void run("purge-mock")}
            >
              清 Mock
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
