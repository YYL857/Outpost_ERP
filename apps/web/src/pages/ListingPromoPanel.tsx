import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ListingDraft,
  type ListingPromoBrief,
  type ListingPromoJob,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import { copyText } from "../lib/clipboard";
import {
  isBackupNewerThan,
  listingPromoBriefBackupKey,
  readLocalBackup,
  writeLocalBackup,
} from "../lib/form-local-backup";

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "正在唤起本机 Cursor…",
  awaiting_images: "已发送，等待出图（自动轮询）",
  awaiting_manual: "待补图",
  succeeded: "已完成",
  failed: "失败",
  needs_review: "待审核",
  approved: "已通过",
};

const DRIVER_LABEL: Record<string, string> = {
  rpa: "本机键鼠唤起 Cursor",
  folder: "仅投递目录",
  sdk: "Cursor 接口",
  manual: "手动",
};

/** 用 localhost 打开页面才允许键鼠出图 / 打开本机文件夹（避免局域网误触服务器电脑） */
function isBrowserOnLocalhost(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function emptyBrief(): ListingPromoBrief {
  return {
    platform: "Noon 沙特",
    language: "仅英文（不要中文）",
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

type PromoBriefBackup = {
  brief: ListingPromoBrief;
  pointsText: string;
};

export function ListingPromoPanel(props: {
  draft: ListingDraft;
  onDraft: (d: ListingDraft | ((prev: ListingDraft) => ListingDraft)) => void;
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
  const [briefSaveHint, setBriefSaveHint] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const onLocalhost = isBrowserOnLocalhost();
  const hydratingBriefRef = useRef(false);
  const ignoreDirtyUntilRef = useRef(0);
  const dirtyBriefRef = useRef(false);
  const dirtyGenRef = useRef(0);
  const briefRef = useRef(brief);
  const pointsRef = useRef(pointsText);
  const autosaveTimerRef = useRef<number | null>(null);

  const activeJobId = draft.promo?.activeJobId || job?.id || null;

  function backupKey() {
    return listingPromoBriefBackupKey(draft.id);
  }

  function buildPayload(
    b: ListingPromoBrief,
    points: string,
  ): { brief: ListingPromoBrief; sellingPoints: string[] } {
    const sellingPoints = points
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    return { brief: { ...b, sellingPoints }, sellingPoints };
  }

  function writeBriefBackup(b: ListingPromoBrief, points: string) {
    writeLocalBackup<PromoBriefBackup>(backupKey(), {
      brief: b,
      pointsText: points,
    });
  }

  async function flushBriefAutosave() {
    if (!dirtyBriefRef.current || hydratingBriefRef.current) return;
    const gen = dirtyGenRef.current;
    const { brief: payload } = buildPayload(briefRef.current, pointsRef.current);
    setBriefSaveHint("宣传图资料保存中…");
    try {
      const r = await api.patchListingPromoBrief(draft.id, payload);
      if (gen !== dirtyGenRef.current) {
        setBriefSaveHint("有新修改，稍后继续保存…");
        scheduleBriefAutosave();
        return;
      }
      dirtyBriefRef.current = false;
      writeBriefBackup(briefRef.current, pointsRef.current);
      // 只合并 promo，避免父级整单替换冲掉其它正在编辑的字段
      onDraft((prev) => ({
        ...prev,
        promo: r.data.promo,
        updatedAt: r.data.updatedAt,
      }));
      setBriefSaveHint(`宣传图已自动保存 ${new Date().toLocaleTimeString()}`);
    } catch {
      writeBriefBackup(briefRef.current, pointsRef.current);
      setBriefSaveHint(
        "服务器暂不可用，宣传图填写已保存在本机；恢复后会自动同步",
      );
    }
  }

  function scheduleBriefAutosave() {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void flushBriefAutosave();
    }, 1200);
  }

  function applyBriefLocal(
    b: ListingPromoBrief,
    points: string,
    markDirty: boolean,
  ) {
    hydratingBriefRef.current = true;
    ignoreDirtyUntilRef.current = Date.now() + 200;
    dirtyBriefRef.current = false;
    setBrief(b);
    setPointsText(points);
    // 等 React useEffect 跑完再清，避免误标 dirty / 冲填写
    window.setTimeout(() => {
      hydratingBriefRef.current = false;
      if (markDirty) {
        dirtyBriefRef.current = true;
        dirtyGenRef.current += 1;
        scheduleBriefAutosave();
      }
    }, 50);
  }

  /** 仅在切换草稿时从服务器 / 本机备份灌入；勿监听整个 draft（会冲掉未保存填写） */
  useEffect(() => {
    hydratingBriefRef.current = true;
    dirtyBriefRef.current = false;
    const server = draft.promo?.brief || emptyBrief();
    const serverPoints = (server.sellingPoints || []).join("\n");
    const bak = readLocalBackup<PromoBriefBackup>(
      listingPromoBriefBackupKey(draft.id),
    );
    if (
      bak &&
      isBackupNewerThan(bak.savedAt, draft.updatedAt) &&
      bak.payload?.brief
    ) {
      applyBriefLocal(
        bak.payload.brief,
        bak.payload.pointsText ?? (bak.payload.brief.sellingPoints || []).join("\n"),
        true,
      );
      setBriefSaveHint("已从本机恢复宣传图填写，正在同步到服务器…");
    } else {
      applyBriefLocal(server, serverPoints, false);
      writeBriefBackup(server, serverPoints);
      setBriefSaveHint("");
    }
    const j =
      draft.promo?.jobs?.find((x) => x.id === draft.promo?.activeJobId) ||
      draft.promo?.jobs?.[0] ||
      null;
    setJob(j);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when draft switches
  }, [draft.id]);

  useEffect(() => {
    briefRef.current = brief;
    pointsRef.current = pointsText;
  }, [brief, pointsText]);

  useEffect(() => {
    if (hydratingBriefRef.current || Date.now() < ignoreDirtyUntilRef.current) {
      return;
    }
    dirtyBriefRef.current = true;
    dirtyGenRef.current += 1;
    writeBriefBackup(brief, pointsText);
    scheduleBriefAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, pointsText]);

  useEffect(() => {
    const retry = window.setInterval(() => {
      if (dirtyBriefRef.current) void flushBriefAutosave();
    }, 15000);
    return () => {
      window.clearInterval(retry);
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

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
      const { brief: payload } = buildPayload(brief, pointsText);
      const r = await api.patchListingPromoBrief(draft.id, payload);
      dirtyBriefRef.current = false;
      writeBriefBackup(brief, pointsText);
      onDraft((prev) => ({
        ...prev,
        promo: r.data.promo,
        updatedAt: r.data.updatedAt,
      }));
      setBriefSaveHint(`宣传图已保存 ${new Date().toLocaleTimeString()}`);
      return {
        ...draft,
        promo: r.data.promo,
        updatedAt: r.data.updatedAt,
      };
    } catch (e) {
      writeBriefBackup(brief, pointsText);
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
      const r = await api.startListingPromoJob(draft.id, {
        browserOnLocalhost: isBrowserOnLocalhost(),
      });
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
        browserOnLocalhost: isBrowserOnLocalhost(),
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

  async function openOutFolder() {
    if (!activeJobId) return;
    setBusy("open-out");
    setErr(null);
    try {
      const r = await api.openListingPromoOutFolder(draft.id, activeJobId, {
        browserOnLocalhost: isBrowserOnLocalhost(),
      });
      if (!r.data.opened) {
        const copied = await copyText(r.data.path);
        setErr(
          r.data.hint ||
            (copied
              ? `文件夹在服务器电脑上，已复制路径：${r.data.path}`
              : `文件夹在服务器电脑上，请手动复制路径：${r.data.path}`),
        );
      }
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
      if (!res.ok) throw new Error("读取提示词失败");
      const text = await res.text();
      const ok = await copyText(text);
      if (!ok) throw new Error("复制到剪贴板失败（请检查是否允许网页访问剪贴板）");
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadPack() {
    if (!activeJobId) return;
    setBusy("pack");
    setErr(null);
    try {
      const url = api.listingPromoPackUrl(draft.id, activeJobId);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let msg = "下载任务包失败（请先点生成宣传图）";
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `listing-promo-${activeJobId}.zip`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || "");
        const i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = () => reject(reader.error || new Error("读文件失败"));
      reader.readAsDataURL(file);
    });
  }

  async function onUploadOutFiles(fileList: FileList | null) {
    if (!activeJobId || !fileList?.length) return;
    setBusy("upload-out");
    setErr(null);
    try {
      const files: Array<{ filename: string; base64: string }> = [];
      for (const file of Array.from(fileList)) {
        if (!/\.(jpe?g|png|webp)$/i.test(file.name)) continue;
        files.push({
          filename: file.name,
          base64: await fileToBase64(file),
        });
      }
      if (!files.length) throw new Error("请选择 jpg/png/webp 成品图");
      const r = await api.uploadListingPromoOutImages(
        draft.id,
        activeJobId,
        files,
      );
      onDraft(r.data);
      const j = r.data.promo?.jobs.find((x) => x.id === activeJobId);
      if (j) setJob(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
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
      <h3>宣传图（竖版 9:16）</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {onLocalhost ? (
          <>
            填库存锁会<strong>自动保存到服务器</strong>（约 1
            秒）；刷新后应仍在。生成时拼接提示词与参考图，用键鼠唤起
            <strong>本机 Cursor</strong>
            ；成品写入输出目录后本页自动轮询。出图时尽量不要抢键盘。
          </>
        ) : (
          <>
            填库存锁会<strong>自动保存</strong>。然后：生成 →{" "}
            <strong>下载任务包</strong>到本机 Cursor 出图 →{" "}
            <strong>上传成品图</strong>。
          </>
        )}
      </p>
      {briefSaveHint && (
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          {briefSaveHint}
        </p>
      )}
      {!onLocalhost && (
        <p
          className="muted"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "color-mix(in srgb, #c47b16 12%, var(--surface-2))",
            borderLeft: "3px solid #c47b16",
            fontSize: 13,
          }}
        >
          当前是局域网地址 <code>{window.location.hostname}</code>
          。请：① 点「生成宣传图」落盘任务包 → ②「下载任务包」解压后用
          <strong>你电脑上的 Cursor</strong> 出图 → ③「上传成品图」回传。也可在本机用{" "}
          <code>http://localhost:5173</code> 打开以启用键鼠自动出图。
        </p>
      )}

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
          <label>颜色（与规格二选一必填）</label>
          <ClearableInput
            className="input"
            value={lock.colorOnly}
            onChange={(e) =>
              setBrief({
                ...brief,
                skuLock: { ...lock, colorOnly: e.target.value },
              })
            }
            placeholder="如 黑色"
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
            placeholder="如 粉色、紫色"
          />
        </div>
        <div className="noon-field">
          <label>规格（与颜色二选一必填）</label>
          <ClearableInput
            className="input"
            value={lock.specOnly}
            onChange={(e) =>
              setBrief({
                ...brief,
                skuLock: { ...lock, specOnly: e.target.value },
              })
            }
            placeholder="如 四层加厚"
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
            placeholder="如 35-45 可裁剪适配"
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
            placeholder="如 最高 6 cm"
          />
        </div>
      </div>

      <div className="noon-field" style={{ marginTop: 8 }}>
        <label>卖点（每行一条；可空则用文案卖点）</label>
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
          {promptCopied ? "已复制提示词" : "复制提示词"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy || !activeJobId}
          title="下载 prompt + 参考图到本机，用你电脑上的 Cursor 出图"
          onClick={() => void downloadPack()}
        >
          下载任务包
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy || !activeJobId}
          title="把本机 Cursor 生成的 jpg 上传回服务器"
          onClick={() => uploadInputRef.current?.click()}
        >
          上传成品图
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple
          style={{ display: "none" }}
          onChange={(e) => void onUploadOutFiles(e.target.files)}
        />
        <button
          type="button"
          className="btn"
          disabled={!!busy || !activeJobId || !job?.images.length}
          onClick={() => void approve()}
        >
          宣传图审核通过
        </button>
        {onLocalhost && (
          <button
            type="button"
            className="btn"
            disabled={!!busy || !activeJobId}
            title={job?.outDirAbs || "打开本机出图文件夹"}
            onClick={() => void openOutFolder()}
          >
            打开出图文件夹
          </button>
        )}
      </div>

      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        状态：<strong>{statusText}</strong>
        {job?.driverMode
          ? ` · ${DRIVER_LABEL[job.driverMode] || job.driverMode}`
          : ""}
      </p>
      {onLocalhost && job?.inboxDirAbs && (
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          投递箱：<code>{job.inboxDirAbs}</code>
        </p>
      )}
      {onLocalhost && job?.outDirAbs && (
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          出图写入：<code>{job.outDirAbs}</code>{" "}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "0 6px", verticalAlign: "baseline" }}
            disabled={!!busy || !activeJobId}
            onClick={() => void openOutFolder()}
          >
            打开
          </button>
        </p>
      )}
      {!onLocalhost && activeJobId && (
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          远程模式：任务包在服务器上，请用「下载任务包 / 上传成品图」在本机完成出图。
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
