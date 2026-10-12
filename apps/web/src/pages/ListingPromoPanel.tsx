import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ListingDraft,
  type ListingPromoBrief,
  type ListingPromoJob,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "正在投递任务包…",
  awaiting_images: "已投递，等待 out/ 出图（自动轮询）",
  awaiting_manual: "待补图",
  succeeded: "已完成",
  failed: "失败",
  needs_review: "待审核",
  approved: "已通过",
};

function emptyBrief(): ListingPromoBrief {
  return {
    platform: "Noon SA",
    language: "English only (no Chinese)",
    frameCount: 9,
    aspectRatio: "9:16",
    productName: "",
    sellingPoints: [],
    skuLock: {
      colorOnly: "",
      forbidColors: "",
      specOnly: "",
      forbidSpecs: "",
      sizeFit: "",
      effectNumber: "",
    },
    extraNotes: "",
  };
}

export function ListingPromoPanel(props: {
  draft: ListingDraft;
  onDraft: (d: ListingDraft) => void;
}) {
  const { draft, onDraft } = props;
  const [brief, setBrief] = useState<ListingPromoBrief>(
    () => draft.promo?.brief || emptyBrief(),
  );
  const [pointsText, setPointsText] = useState(
    () => (draft.promo?.brief?.sellingPoints || []).join("\n"),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<ListingPromoJob | null>(null);
  const [reviseNote, setReviseNote] = useState("");
  const [selectedFrames, setSelectedFrames] = useState<string[]>([]);
  const [promptCopied, setPromptCopied] = useState(false);

  const activeJobId = draft.promo?.activeJobId || job?.id || null;

  useEffect(() => {
    if (draft.promo?.brief) {
      setBrief(draft.promo.brief);
      setPointsText((draft.promo.brief.sellingPoints || []).join("\n"));
    }
    const j =
      draft.promo?.jobs?.find((x) => x.id === draft.promo?.activeJobId) ||
      draft.promo?.jobs?.[0] ||
      null;
    if (j) setJob(j);
  }, [draft]);

  useEffect(() => {
    if (!activeJobId) return;
    const terminal = ["approved", "failed"];
    if (job && terminal.includes(job.status) && job.images.length) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const r = await api.getListingPromoJob(draft.id, activeJobId);
        if (cancelled) return;
        setJob(r.data);
      } catch {
        /* ignore poll errors */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [draft.id, activeJobId, job?.status, job?.images.length]);

  const statusText = useMemo(
    () => (job ? STATUS_LABEL[job.status] || job.status : "尚未生成"),
    [job],
  );

  async function saveBrief(): Promise<ListingDraft | null> {
    setBusy("save");
    setErr(null);
    try {
      const sellingPoints = pointsText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
      const r = await api.patchListingPromoBrief(draft.id, {
        ...brief,
        sellingPoints,
      });
      onDraft(r.data);
      return r.data;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function startJob() {
    setBusy("start");
    setErr(null);
    try {
      const saved = await saveBrief();
      if (!saved) return;
      setBusy("start");
      const r = await api.startListingPromoJob(draft.id);
      onDraft(r.data);
      const id = r.meta?.jobId || r.data.promo?.activeJobId;
      if (id) {
        const j = await api.getListingPromoJob(draft.id, id);
        setJob(j.data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function ingest() {
    if (!activeJobId) return;
    setBusy("ingest");
    setErr(null);
    try {
      const r = await api.ingestListingPromoJob(draft.id, activeJobId);
      onDraft(r.data);
      const j = r.data.promo?.jobs.find((x) => x.id === activeJobId);
      if (j) setJob(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function revise() {
    if (!activeJobId || !reviseNote.trim()) {
      setErr("请填写修改意见");
      return;
    }
    setBusy("revise");
    setErr(null);
    try {
      const r = await api.reviseListingPromoJob(draft.id, activeJobId, {
        note: reviseNote.trim(),
        frameIndexes: selectedFrames.length ? selectedFrames : undefined,
      });
      onDraft(r.data);
      setReviseNote("");
      const j = await api.getListingPromoJob(draft.id, activeJobId);
      setJob(j.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!activeJobId) return;
    setBusy("approve");
    setErr(null);
    try {
      const r = await api.approveListingPromoJob(draft.id, activeJobId);
      onDraft(r.data);
      const j = r.data.promo?.jobs.find((x) => x.id === activeJobId);
      if (j) setJob(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function copyPrompt() {
    if (!activeJobId) return;
    setBusy("prompt");
    setErr(null);
    try {
      const url = api.listingPromoPromptUrl(draft.id, activeJobId);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("读取 prompt 失败");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function toggleFrame(name: string) {
    setSelectedFrames((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  }

  const lock = brief.skuLock;

  return (
    <section className="card listing-panel" style={{ marginTop: 16 }}>
      <h3>宣传图（Cursor · 9:16）</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        填库存锁 → 生成。系统把「预设提示词 + 商品信息 + 参考图」投递到任务目录 / 公司
        inbox；出图端把 jpg 写入 out/ 后，本页自动轮询回显审核。
        <strong>员工不用登录 Cursor。</strong>
      </p>

      <div
        className="listing-cols"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
      >
        <div className="noon-field">
          <label>品名</label>
          <ClearableInput
            className="input"
            value={brief.productName}
            onChange={(e) => setBrief({ ...brief, productName: e.target.value })}
            placeholder="可空，默认用标题/品牌"
          />
        </div>
        <div className="noon-field">
          <label>平台</label>
          <ClearableInput
            className="input"
            value={brief.platform}
            onChange={(e) => setBrief({ ...brief, platform: e.target.value })}
          />
        </div>
        <div className="noon-field">
          <label>颜色 ONLY（必填其一）</label>
          <ClearableInput
            className="input"
            value={lock.colorOnly}
            onChange={(e) =>
              setBrief({
                ...brief,
                skuLock: { ...lock, colorOnly: e.target.value },
              })
            }
            placeholder="如 Black"
          />
        </div>
        <div className="noon-field">
          <label>禁止颜色</label>
          <ClearableInput
            className="input"
            value={lock.forbidColors}
            onChange={(e) =>
              setBrief({
                ...brief,
                skuLock: { ...lock, forbidColors: e.target.value },
              })
            }
            placeholder="如 Pink, Purple"
          />
        </div>
        <div className="noon-field">
          <label>规格 ONLY（必填其一）</label>
          <ClearableInput
            className="input"
            value={lock.specOnly}
            onChange={(e) =>
              setBrief({
                ...brief,
                skuLock: { ...lock, specOnly: e.target.value },
              })
            }
            placeholder="如 4-layer thickened"
          />
        </div>
        <div className="noon-field">
          <label>禁止规格</label>
          <ClearableInput
            className="input"
            value={lock.forbidSpecs}
            onChange={(e) =>
              setBrief({
                ...brief,
                skuLock: { ...lock, forbidSpecs: e.target.value },
              })
            }
          />
        </div>
        <div className="noon-field">
          <label>尺码/适配</label>
          <ClearableInput
            className="input"
            value={lock.sizeFit}
            onChange={(e) =>
              setBrief({
                ...brief,
                skuLock: { ...lock, sizeFit: e.target.value },
              })
            }
            placeholder="如 35-45 trim to fit"
          />
        </div>
        <div className="noon-field">
          <label>效果数字</label>
          <ClearableInput
            className="input"
            value={lock.effectNumber}
            onChange={(e) =>
              setBrief({
                ...brief,
                skuLock: { ...lock, effectNumber: e.target.value },
              })
            }
            placeholder="如 Up to 6 cm"
          />
        </div>
      </div>

      <div className="noon-field" style={{ marginTop: 8 }}>
        <label>卖点（每行一条，可空则用文案 bullets）</label>
        <textarea
          className="input"
          rows={3}
          value={pointsText}
          onChange={(e) => setPointsText(e.target.value)}
        />
      </div>

      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() => void saveBrief()}
        >
          保存库存锁
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!!busy || !draft.ours.images.length}
          title={!draft.ours.images.length ? "请先上传本品图" : undefined}
          onClick={() => void startJob()}
        >
          生成宣传图
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy || !activeJobId}
          onClick={() => void ingest()}
        >
          扫目录回填
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy || !activeJobId}
          onClick={() => void copyPrompt()}
        >
          {promptCopied ? "已复制 prompt" : "复制 prompt.md"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy || !activeJobId || !job?.images.length}
          onClick={() => void approve()}
        >
          宣传图审核通过
        </button>
      </div>

      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        状态：<strong>{statusText}</strong>
        {job?.driverMode ? ` · 驱动 ${job.driverMode}` : ""}
      </p>
      {job?.inboxDirAbs && (
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          投递箱：<code>{job.inboxDirAbs}</code>
        </p>
      )}
      {job?.outDirAbs && (
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          出图写入：<code>{job.outDirAbs}</code>
        </p>
      )}
      {job?.error && (
        <p className="muted" style={{ color: "var(--danger)", marginTop: 4 }}>
          {job.error}
        </p>
      )}
      {err && (
        <p className="muted" style={{ color: "var(--danger)", marginTop: 4 }}>
          {err}
        </p>
      )}

      {job && job.images.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
            marginTop: 12,
          }}
        >
          {job.images.map((img) => {
            const checked = selectedFrames.includes(img.filename);
            return (
              <label
                key={img.filename}
                style={{
                  border: checked ? "2px solid var(--danger)" : "1px solid #ddd",
                  borderRadius: 8,
                  padding: 6,
                  cursor: "pointer",
                  display: "block",
                }}
              >
                <img
                  src={api.listingPromoImageUrl(draft.id, job.id, img.filename)}
                  alt={img.filename}
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFrame(img.filename)}
                  />{" "}
                  有问题 · {img.filename}
                  {img.width && img.height
                    ? ` · ${img.width}×${img.height}`
                    : ""}
                  {img.aspectOk === false ? " · 比例异常" : ""}
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div className="noon-field" style={{ marginTop: 12 }}>
        <label>修改意见（勾选有问题的图 + 说明）</label>
        <textarea
          className="input"
          rows={2}
          value={reviseNote}
          onChange={(e) => setReviseNote(e.target.value)}
          placeholder="例：第 6 张鞋跟假剖面，改成打开鞋口放垫"
        />
        <button
          type="button"
          className="btn"
          style={{ marginTop: 8 }}
          disabled={!!busy || !activeJobId || !reviseNote.trim()}
          onClick={() => void revise()}
        >
          按意见改图
        </button>
      </div>
    </section>
  );
}
