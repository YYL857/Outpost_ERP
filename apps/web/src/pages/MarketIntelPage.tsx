import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type CategoryFitnessReport,
  type CategoryFitnessResponse,
  type MarketIntelJob,
  type MarketIntelStatus,
  type MarketWatchItem,
} from "../api";

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

  if (action.includes("avoid") || fame.includes("known") || fame.includes("famous")) {
    return { text: "建议：不竞争", tone: "danger" };
  }
  if (action.includes("white") || fame.includes("white")) {
    return { text: "倾向：白板", tone: "ok" };
  }
  if (
    action.includes("needs_human") ||
    action.includes("unknown") ||
    fame.includes("unknown")
  ) {
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

  const refresh = useCallback(async () => {
    const [st, wl, jb, fit] = await Promise.all([
      api.getMarketIntelStatus(),
      api.getMarketIntelWatchlist(),
      api.getMarketIntelJobs(12),
      api.getMarketIntelCategoryFitness(),
    ]);
    setStatus(st.data);
    setWatchlist(wl.data);
    setJobs(jb.data);
    const fitData = fit.data;
    const cats = isFitnessBundle(fitData) ? fitData.categories : [fitData];
    setFitnessCats(cats);
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
          先看<strong>品类值不值得做</strong>，再看该类目里哪些<strong>白板在热卖</strong>。
          商品标题中英对照，方便运营阅读。
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
                  销量中位{" "}
                  {c.metrics.soldRecentlyMedian != null
                    ? Math.round(c.metrics.soldRecentlyMedian)
                    : "—"}
                  {" · "}
                  客单中位{" "}
                  {c.metrics.priceMedianWhite != null
                    ? `${Math.round(c.metrics.priceMedianWhite)} SAR`
                    : "—"}
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
            </p>
          </div>
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
        <table className="table">
          <thead>
            <tr>
              <th>商品（中 / 英）</th>
              <th>分层</th>
              <th>近期销量</th>
              <th>价格</th>
              <th>评分</th>
            </tr>
          </thead>
          <tbody>
            {(activeFitness?.shortlist ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  该类目暂无白牌/候选短名单。
                </td>
              </tr>
            )}
            {(activeFitness?.shortlist ?? []).map((p) => (
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
                </td>
                <td>{brandTierLabel(p.brandTier)}</td>
                <td>
                  {p.soldRecentlyText ??
                    (p.soldRecently != null ? `${p.soldRecently}+` : "—")}
                </td>
                <td>
                  {p.price != null ? `${p.price} ${p.currency || "SAR"}` : "—"}
                </td>
                <td>
                  {p.rating != null
                    ? `${p.rating}${p.reviewCount != null ? ` (${p.reviewCount})` : ""}`
                    : "—"}
                </td>
              </tr>
            ))}
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
                AI 只给参考，确认白板须人工点。
              </p>
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
                  <th style={{ width: 200 }}>你的决定</th>
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
