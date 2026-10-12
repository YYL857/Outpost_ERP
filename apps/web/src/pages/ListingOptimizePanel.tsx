import { useEffect, useState } from "react";
import {
  api,
  type ListingOptimizeJob,
  type ListingOptimizeSummary,
  type ListingOursNoonContent,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";

function emptyContent(): ListingOursNoonContent {
  return {
    titleEn: "",
    titleAr: "",
    fulltype: "",
    brandEn: "",
    brandAr: "",
    longDescriptionEn: "",
    longDescriptionAr: "",
    numberOfPieces: "",
    sizeUnit: "",
    featureBulletsEn: [],
    featureBulletsAr: [],
    gtin: "",
  };
}

async function copyText(text: string) {
  const t = text ?? "";
  if (!t) return;
  await navigator.clipboard.writeText(t);
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function CopyField(props: {
  label: string;
  value: string;
  multiline?: boolean;
  dir?: "ltr" | "rtl";
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="noon-field">
      <div className="noon-field-head">
        <label>{props.label}</label>
        <button
          type="button"
          className="btn btn-ghost noon-copy-btn"
          disabled={!props.value}
          onClick={async () => {
            await copyText(props.value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {props.multiline ? (
        <textarea dir={props.dir} value={props.value} readOnly rows={5} />
      ) : (
        <input dir={props.dir} value={props.value} readOnly />
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  metrics_ready: "已绑指标",
  analyzed: "已诊断",
  rewritten: "已改写",
};

const BUSY_LABEL: Record<string, string> = {
  create: "新建中…",
  save: "保存中…",
  metrics: "清洗指标…",
  analyze: "诊断中…",
  rewrite: "改写中…",
  delete: "删除中…",
  export: "检查广告数据…",
  exportForce: "请求广告重拉…",
};

export function ListingOptimizePanel() {
  const [summaries, setSummaries] = useState<ListingOptimizeSummary[]>([]);
  const [job, setJob] = useState<ListingOptimizeJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [metricsCsv, setMetricsCsv] = useState("");
  const [step, setStep] = useState<"input" | "metrics" | "diagnosis" | "content">(
    "input",
  );
  const [exportReqId, setExportReqId] = useState("");
  const [exportHint, setExportHint] = useState("");

  async function refreshList() {
    const r = await api.listListingOptimizeJobs();
    setSummaries(r.data);
  }

  async function openJob(id: string) {
    const r = await api.getListingOptimizeJob(id);
    setJob(r.data);
    if (r.data.optimized) setStep("content");
    else if (r.data.diagnosis) setStep("diagnosis");
    else if (r.data.metrics) setStep("metrics");
    else setStep("input");
  }

  useEffect(() => {
    refreshList().catch((e: Error) => setError(e.message));
  }, []);

  async function createNew() {
    setBusy("create");
    setError("");
    try {
      const r = await api.createListingOptimizeJob();
      setJob(r.data);
      setMetricsCsv("");
      setStep("input");
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新建失败");
    } finally {
      setBusy("");
    }
  }

  async function saveFields() {
    if (!job) return;
    setBusy("save");
    setError("");
    try {
      const r = await api.patchListingOptimizeJob(job.id, {
        listingUrl: job.listingUrl,
        partnerSku: job.partnerSku,
        noonSku: job.noonSku,
        notes: job.notes,
        current: job.current,
      });
      setJob(r.data);
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  async function requestAdsPull(force = false) {
    setBusy(force ? "exportForce" : "export");
    setError("");
    setExportHint("");
    setExportReqId("");
    try {
      const r = await api.ensureAdsExport({
        force,
        range: "yesterday",
      });
      const hint = r.meta?.hint || "";
      if (r.data.action === "reuse") {
        const f = r.data.freshness;
        setExportHint(
          hint ||
            `已有昨日广告数据（${f.yesterday}，${f.yesterdaySkuCount} SKU），可直接「绑定并清洗指标」。`,
        );
        return;
      }
      const req = r.data.request;
      if (!req) {
        setExportHint(hint || "已请求导出，但未返回 requestId");
        return;
      }
      setExportReqId(req.requestId);
      setExportHint(
        hint ||
          `已启动广告导出（${req.shopIds.join(",")} · ${req.range}）。完成后请汇总同步再绑定。`,
      );
      if (!req.requestId) {
        setExportHint(hint || "已启动导出，但未返回 runId");
        return;
      }
      for (let i = 0; i < 6; i += 1) {
        await new Promise((ok) => setTimeout(ok, 3000));
        const st = await api.getAdsExportRequest(req.requestId);
        if (st.data.status === "done") {
          setExportHint(
            "广告导出已完成。请先汇总同步/扫目录，再点「绑定并清洗指标」。",
          );
          break;
        }
        if (st.data.status === "failed") {
          setExportHint(
            `广告导出失败：${st.data.detail || "见日志 ads_export_pw_*.log"}`,
          );
          break;
        }
        setExportHint(`等待广告导出中…（${st.data.status}）`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "检查/请求导出失败");
    } finally {
      setBusy("");
    }
  }

  async function bindMetrics() {
    if (!job) return;
    setBusy("metrics");
    setError("");
    try {
      await api.patchListingOptimizeJob(job.id, {
        listingUrl: job.listingUrl,
        partnerSku: job.partnerSku,
        noonSku: job.noonSku,
        notes: job.notes,
        current: job.current,
      });
      const r = await api.bindListingOptimizeMetrics(job.id, {
        metricsCsv: metricsCsv.trim() || undefined,
      });
      setJob(r.data);
      setStep("metrics");
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "绑定指标失败");
    } finally {
      setBusy("");
    }
  }

  async function runAnalyze() {
    if (!job) return;
    setBusy("analyze");
    setError("");
    try {
      const r = await api.analyzeListingOptimize(job.id);
      setJob(r.data);
      setStep("diagnosis");
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "诊断失败");
    } finally {
      setBusy("");
    }
  }

  async function runRewrite() {
    if (!job) return;
    setBusy("rewrite");
    setError("");
    try {
      const r = await api.rewriteListingOptimize(job.id);
      setJob(r.data);
      setStep("content");
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "改写失败");
    } finally {
      setBusy("");
    }
  }

  const optimized = job?.optimized ?? emptyContent();
  const busyLabel = busy ? BUSY_LABEL[busy] || busy : "";

  return (
    <div className="listing-layout">
      <aside className="listing-sidebar card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>优化任务</h3>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!!busy}
            onClick={() => createNew()}
          >
            新建
          </button>
        </div>
        <ul className="listing-draft-list">
          {summaries.length === 0 && <li className="muted">暂无任务</li>}
          {summaries.map((s) => (
            <li key={s.id} className="listing-draft-item">
              <button
                type="button"
                className={job?.id === s.id ? "active" : ""}
                onClick={() => openJob(s.id).catch((e: Error) => setError(e.message))}
              >
                <span className="listing-draft-title">{s.titleHint}</span>
                <span className="muted">
                  {STATUS_LABEL[s.status] || s.status}
                  {s.partnerSku ? ` · ${s.partnerSku}` : ""}
                </span>
              </button>
              <button
                type="button"
                className="btn btn-ghost listing-draft-del"
                disabled={!!busy}
                title="删除"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!confirm(`删除「${s.titleHint}」？`)) return;
                  setBusy("delete");
                  setError("");
                  try {
                    await api.deleteListingOptimizeJob(s.id);
                    if (job?.id === s.id) setJob(null);
                    await refreshList();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "删除失败");
                  } finally {
                    setBusy("");
                  }
                }}
              >
                删
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="listing-main">
        {error && (
          <p className="listing-error" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {!job && (
          <div className="card">
            <p className="muted">请新建或选择左侧优化任务。</p>
          </div>
        )}

        {job && (
          <>
            <div className="card listing-toolbar">
              <div className="listing-steps">
                <button
                  type="button"
                  className={`listing-step${step === "input" ? " active" : ""}`}
                  onClick={() => setStep("input")}
                >
                  <span className="listing-step-num">1</span>
                  现有 Listing
                </button>
                <span className="listing-step-arrow" aria-hidden>
                  →
                </span>
                <button
                  type="button"
                  className={`listing-step${step === "metrics" ? " active" : ""}`}
                  onClick={() => setStep("metrics")}
                  disabled={!job.metrics}
                >
                  <span className="listing-step-num">2</span>
                  绩效清洗
                </button>
                <span className="listing-step-arrow" aria-hidden>
                  →
                </span>
                <button
                  type="button"
                  className={`listing-step${step === "diagnosis" ? " active" : ""}`}
                  onClick={() => setStep("diagnosis")}
                  disabled={!job.diagnosis}
                >
                  <span className="listing-step-num">3</span>
                  诊断
                </button>
                <span className="listing-step-arrow" aria-hidden>
                  →
                </span>
                <button
                  type="button"
                  className={`listing-step${step === "content" ? " active" : ""}`}
                  onClick={() => setStep("content")}
                  disabled={!job.optimized}
                >
                  <span className="listing-step-num">4</span>
                  优化文案
                </button>
              </div>
              <div className="listing-actions">
                <span className="muted">
                  {STATUS_LABEL[job.status] || job.status}
                  {busyLabel ? ` · ${busyLabel}` : ""}
                </span>
                {step === "input" && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy}
                      title="有昨日数据则直接复用；缺昨日才启动 Playwright 导出"
                      onClick={() => requestAdsPull(false)}
                    >
                      检查广告数据
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy}
                      title="忽略已有数据，强制启动 Playwright 昨日导出"
                      onClick={() => requestAdsPull(true)}
                    >
                      强制重拉
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy}
                      onClick={() => saveFields()}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!!busy}
                      onClick={() => bindMetrics()}
                    >
                      绑定并清洗指标
                    </button>
                  </>
                )}
                {step === "metrics" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!busy || !job.metrics}
                    onClick={() => runAnalyze()}
                  >
                    开始诊断
                  </button>
                )}
                {step === "diagnosis" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!busy || !job.diagnosis}
                    onClick={() => runRewrite()}
                  >
                    生成优化文案
                  </button>
                )}
              </div>
            </div>

            {step === "input" && (
              <div className="listing-cols">
                <section className="card listing-panel">
                  <h3>链接与 SKU</h3>
                  {(exportHint || exportReqId) && (
                    <p className="muted" style={{ fontSize: 13 }}>
                      {exportHint}
                      {exportReqId ? ` · ${exportReqId}` : ""}
                    </p>
                  )}
                  <label className="noon-field">
                    Listing 链接
                    <ClearableInput
                      className="input"
                      value={job.listingUrl}
                      onChange={(e) =>
                        setJob({ ...job, listingUrl: e.target.value })
                      }
                      placeholder="https://www.noon.com/..."
                    />
                  </label>
                  <div className="row" style={{ gap: 12 }}>
                    <label className="noon-field" style={{ flex: 1 }}>
                      partnerSku
                      <ClearableInput
                        className="input"
                        value={job.partnerSku}
                        onChange={(e) =>
                          setJob({ ...job, partnerSku: e.target.value })
                        }
                        placeholder="Seller SKU"
                      />
                    </label>
                    <label className="noon-field" style={{ flex: 1 }}>
                      noonSku
                      <ClearableInput
                        className="input"
                        value={job.noonSku}
                        onChange={(e) =>
                          setJob({ ...job, noonSku: e.target.value })
                        }
                        placeholder="可选"
                      />
                    </label>
                  </div>
                  <label className="noon-field">
                    备注（真实卖点、目标价等）
                    <textarea
                      rows={3}
                      value={job.notes}
                      onChange={(e) => setJob({ ...job, notes: e.target.value })}
                    />
                  </label>
                  <label className="noon-field">
                    可选：粘贴广告 CSV 覆盖（含 sku/views/clicks/orders…）
                    <textarea
                      rows={4}
                      value={metricsCsv}
                      onChange={(e) => setMetricsCsv(e.target.value)}
                      placeholder="sku,views,clicks,orders,spend,revenue&#10;..."
                    />
                  </label>
                  <p className="muted" style={{ fontSize: 12 }}>
                    默认从已同步的广告导出与销量事实清洗 CTR/CVR；无数据时可粘贴
                    CSV 覆盖。
                  </p>
                </section>
                <section className="card listing-panel">
                  <h3>现有 Listing 文案</h3>
                  <label className="noon-field">
                    标题
                    <ClearableInput
                      className="input"
                      value={job.current.title}
                      onChange={(e) =>
                        setJob({
                          ...job,
                          current: { ...job.current, title: e.target.value },
                        })
                      }
                    />
                  </label>
                  <div className="row" style={{ gap: 12 }}>
                    <label className="noon-field" style={{ flex: 1 }}>
                      价格
                      <ClearableInput
                        className="input"
                        value={job.current.price}
                        onChange={(e) =>
                          setJob({
                            ...job,
                            current: { ...job.current, price: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label className="noon-field" style={{ flex: 1 }}>
                      品牌
                      <ClearableInput
                        className="input"
                        value={job.current.brand}
                        onChange={(e) =>
                          setJob({
                            ...job,
                            current: { ...job.current, brand: e.target.value },
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="noon-field">
                    卖点（每行一条）
                    <textarea
                      rows={5}
                      value={job.current.bullets}
                      onChange={(e) =>
                        setJob({
                          ...job,
                          current: { ...job.current, bullets: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label className="noon-field">
                    描述
                    <textarea
                      rows={6}
                      value={job.current.description}
                      onChange={(e) =>
                        setJob({
                          ...job,
                          current: {
                            ...job.current,
                            description: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </section>
              </div>
            )}

            {step === "metrics" && job.metrics && (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>清洗后的绩效</h3>
                <p className="muted" style={{ fontSize: 13 }}>
                  {job.metrics.sourceNote}
                </p>
                <p>
                  <strong>{job.metrics.partnerSku || "—"}</strong>
                  {job.metrics.noonSku ? ` · ${job.metrics.noonSku}` : ""}
                  {job.metrics.catalogTitle
                    ? ` · ${job.metrics.catalogTitle}`
                    : ""}
                  {job.metrics.price != null
                    ? ` · ${job.metrics.price} ${job.metrics.currency}`
                    : ""}
                </p>
                {job.metrics.funnel && (
                  <p>
                    <strong>漏斗断点</strong>（{job.metrics.funnel.primaryWindow}
                    /{job.metrics.funnel.stage}）：{job.metrics.funnel.dropOff}
                  </p>
                )}
                {job.metrics.baseline && (
                  <p className="muted" style={{ fontSize: 13 }}>
                    店内基线样本 {job.metrics.baseline.sampleSkuCount} SKU · CTR
                    相对中位{" "}
                    {job.metrics.baseline.skuCtrVsP50 != null
                      ? `${(job.metrics.baseline.skuCtrVsP50 * 100).toFixed(0)}%`
                      : "—"}{" "}
                    · CVR 相对中位{" "}
                    {job.metrics.baseline.skuCvrVsP50 != null
                      ? `${(job.metrics.baseline.skuCvrVsP50 * 100).toFixed(0)}%`
                      : "—"}{" "}
                    · ATC率相对中位{" "}
                    {job.metrics.baseline.skuAtcRateVsP50 != null
                      ? `${(job.metrics.baseline.skuAtcRateVsP50 * 100).toFixed(0)}%`
                      : "—"}
                  </p>
                )}
                <div className="listing-cols">
                  {(["d7", "d14", "d30", "latest"] as const).map((k) => {
                    const w = job.metrics!.ads[k];
                    return (
                      <div key={k} className="card listing-panel" style={{ margin: 0 }}>
                        <h4 style={{ marginTop: 0 }}>
                          广告 {k === "latest" ? "最近区间" : k.toUpperCase()}
                        </h4>
                        {!w.hasData ? (
                          <p className="muted">无数据</p>
                        ) : (
                          <ul className="listing-edges">
                            <li>
                              浏览 {w.views} → 点击 {w.clicks} → 加购{" "}
                              {w.atc ?? 0} → 订单 {w.orders}
                            </li>
                            <li>
                              CTR {pct(w.ctr)} · ATC率 {pct(w.atcRate)} · CVR{" "}
                              {pct(w.cvr)}
                            </li>
                            <li>
                              Spend {w.spend} · Rev {w.revenue}
                            </li>
                            <li>
                              ROAS {w.roas ?? "—"} · ACOS {pct(w.acos)}
                            </li>
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
                <h4>销量窗口</h4>
                <p className="muted">
                  7日 {job.metrics.sales.d7.units} 件 /{" "}
                  {job.metrics.sales.d7.amount} · 14日{" "}
                  {job.metrics.sales.d14.units} 件 · 30日{" "}
                  {job.metrics.sales.d30.units} 件
                </p>
                {job.metrics.signals.length > 0 && (
                  <>
                    <h4>信号</h4>
                    <ul className="listing-edges">
                      {job.metrics.signals.map((s) => (
                        <li key={s.code} data-severity={s.severity}>
                          [{s.severity}] {s.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {job.metrics.dataGaps.length > 0 && (
                  <>
                    <h4>数据缺口</h4>
                    <ul className="listing-edges">
                      {job.metrics.dataGaps.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {step === "diagnosis" && job.diagnosis && (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>诊断结论</h3>
                <p>{job.diagnosis.summary}</p>
                {job.diagnosis.priorities.length > 0 && (
                  <>
                    <h4>优先动作</h4>
                    <ol>
                      {job.diagnosis.priorities.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ol>
                  </>
                )}
                <div className="listing-cols">
                  <section className="card listing-panel" style={{ margin: 0 }}>
                    <h4>CTR 相关</h4>
                    <ul className="listing-edges">
                      {job.diagnosis.ctrIssues.length === 0 && (
                        <li className="muted">无</li>
                      )}
                      {job.diagnosis.ctrIssues.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="card listing-panel" style={{ margin: 0 }}>
                    <h4>CVR 相关</h4>
                    <ul className="listing-edges">
                      {job.diagnosis.cvrIssues.length === 0 && (
                        <li className="muted">无</li>
                      )}
                      {job.diagnosis.cvrIssues.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </section>
                </div>
                {job.diagnosis.otherIssues.length > 0 && (
                  <>
                    <h4>其他</h4>
                    <ul className="listing-edges">
                      {job.diagnosis.otherIssues.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </>
                )}
                {job.diagnosis.suggestedFocus.length > 0 && (
                  <p className="muted">
                    建议焦点：{job.diagnosis.suggestedFocus.join(" · ")}
                  </p>
                )}
              </div>
            )}

            {step === "content" && job.optimized && (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>优化后的 Noon 文案</h3>
                <div className="listing-cols">
                  <section className="listing-panel" style={{ margin: 0 }}>
                    <CopyField label="Title EN" value={optimized.titleEn} />
                    <CopyField
                      label="Title AR"
                      value={optimized.titleAr}
                      dir="rtl"
                    />
                    <CopyField label="Brand EN" value={optimized.brandEn} />
                    <CopyField
                      label="Brand AR"
                      value={optimized.brandAr}
                      dir="rtl"
                    />
                    <CopyField label="Fulltype" value={optimized.fulltype} />
                  </section>
                  <section className="listing-panel" style={{ margin: 0 }}>
                    <CopyField
                      label="Feature Bullets EN"
                      value={optimized.featureBulletsEn.join("\n")}
                      multiline
                    />
                    <CopyField
                      label="Feature Bullets AR"
                      value={optimized.featureBulletsAr.join("\n")}
                      multiline
                      dir="rtl"
                    />
                    <CopyField
                      label="Long Description EN"
                      value={optimized.longDescriptionEn}
                      multiline
                    />
                    <CopyField
                      label="Long Description AR"
                      value={optimized.longDescriptionAr}
                      multiline
                      dir="rtl"
                    />
                  </section>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
