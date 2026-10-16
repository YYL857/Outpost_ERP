import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api,
  type ListingCompetitorInput,
  type ListingDraft,
  type ListingDraftSummary,
  type ListingOursNoonContent,
  type ArVerifyResult,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";
import { ExtensionDownloadBtn } from "../components/ExtensionDownloadBtn";
import { copyText } from "../lib/clipboard";
import {
  clearLocalBackup,
  isBackupNewerThan,
  listingBackupKey,
  readLocalBackup,
  writeLocalBackup,
  type LocalBackupEnvelope,
} from "../lib/form-local-backup";
import { ListingOptimizePanel } from "./ListingOptimizePanel";
import { ListingPromoPanel } from "./ListingPromoPanel";

type ListingFormBackup = {
  step: "input" | "analysis" | "content";
  notes: string;
  ourPrice: string;
  brandEn: string;
  brandAr: string;
  gtin: string;
  numberOfPieces: string;
  sizeUnit: string;
  fulltypeHint: string;
  competitors: ListingCompetitorInput[];
  content: ListingOursNoonContent;
};

function emptyCompetitor(
  seed?: Partial<ListingCompetitorInput>,
): ListingCompetitorInput {
  return {
    id: `cmp-${Math.random().toString(36).slice(2, 8)}`,
    url: "",
    pastedTitle: "",
    pastedPrice: "",
    pastedBullets: "",
    pastedDescription: "",
    ...seed,
  };
}

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
    featureBulletsEn: ["", "", "", "", ""],
    featureBulletsAr: ["", "", "", "", ""],
    gtin: "",
  };
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function CopyField(props: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  multiline?: boolean;
  dir?: "ltr" | "rtl";
  readOnly?: boolean;
  hint?: string;
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
          title="复制"
          onClick={async () => {
            const ok = await copyText(props.value);
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {props.hint && (
        <p className="muted" style={{ margin: "0 0 6px", fontSize: 12 }}>
          {props.hint}
        </p>
      )}
      {props.multiline ? (
        <textarea
          dir={props.dir}
          value={props.value}
          readOnly={props.readOnly}
          rows={5}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
      ) : (
        <ClearableInput
          className="input"
          dir={props.dir}
          value={props.value}
          readOnly={props.readOnly}
          clearable={!props.readOnly}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
      )}
    </div>
  );
}

const ANGLE_LABEL: Record<string, string> = {
  appearance: "外观",
  function: "功能",
  price: "价格",
  packaging: "包装",
  battery: "续航",
  other: "其他",
};

export function ListingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const modeParam = searchParams.get("mode");
  const mode: "create" | "optimize" =
    modeParam === "optimize" ? "optimize" : "create";
  const seedHandled = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const oursDragDepth = useRef(0);
  const hydratingRef = useRef(false);
  const dirtyRef = useRef(false);
  const dirtyGenRef = useRef(0);
  const draftRef = useRef<ListingDraft | null>(null);
  const contentRef = useRef<ListingOursNoonContent>(emptyContent());
  const stepRef = useRef<"input" | "analysis" | "content">("input");
  const autosaveTimerRef = useRef<number | null>(null);
  const [oursDragOver, setOursDragOver] = useState(false);
  const [summaries, setSummaries] = useState<ListingDraftSummary[]>([]);
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [content, setContent] = useState<ListingOursNoonContent>(emptyContent());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [step, setStep] = useState<"input" | "analysis" | "content">("input");
  const [arSource, setArSource] = useState("");
  const [arCheck, setArCheck] = useState<ArVerifyResult | null>(null);
  const [saveHint, setSaveHint] = useState("");
  const [pendingRestore, setPendingRestore] = useState<LocalBackupEnvelope<ListingFormBackup> | null>(
    null,
  );

  function setMode(next: "create" | "optimize") {
    const nextParams = new URLSearchParams(searchParams);
    if (next === "optimize") nextParams.set("mode", "optimize");
    else nextParams.delete("mode");
    setSearchParams(nextParams, { replace: true });
  }

  function backupKeyFor(draftId: string) {
    return listingBackupKey(undefined, draftId);
  }

  function buildFormBackup(
    d: ListingDraft,
    c: ListingOursNoonContent,
    s: "input" | "analysis" | "content",
  ): ListingFormBackup {
    return {
      step: s,
      notes: d.notes || "",
      ourPrice: d.ourPrice || "",
      brandEn: d.brandEn || "",
      brandAr: d.brandAr || "",
      gtin: d.gtin || "",
      numberOfPieces: d.numberOfPieces || "",
      sizeUnit: d.sizeUnit || "",
      fulltypeHint: d.fulltypeHint || "",
      competitors: d.competitors || [],
      content: c,
    };
  }

  function writeBackupNow(
    d: ListingDraft,
    c: ListingOursNoonContent,
    s: "input" | "analysis" | "content",
  ) {
    writeLocalBackup(backupKeyFor(d.id), buildFormBackup(d, c, s));
  }

  /** 须在 React useEffect 之后再清，避免 queueMicrotask 过早导致「脏循环」冲掉填写 */
  function beginHydrating() {
    hydratingRef.current = true;
    dirtyRef.current = false;
  }

  function endHydrating() {
    window.setTimeout(() => {
      hydratingRef.current = false;
    }, 0);
  }

  function contentHasUserText(c: ListingOursNoonContent): boolean {
    return (
      Boolean(c.titleEn?.trim()) ||
      Boolean(c.titleAr?.trim()) ||
      Boolean(c.longDescriptionEn?.trim()) ||
      Boolean(c.longDescriptionAr?.trim()) ||
      c.featureBulletsEn.some((x) => x.trim()) ||
      c.featureBulletsAr.some((x) => x.trim())
    );
  }

  async function flushAutosave() {
    const src = draftRef.current;
    const c = contentRef.current;
    if (!src || !dirtyRef.current || hydratingRef.current) return;
    const gen = dirtyGenRef.current;
    setSaveHint("正在自动保存到服务器…");
    try {
      await api.patchListingDraft(src.id, {
        notes: src.notes,
        ourPrice: src.ourPrice,
        brandEn: src.brandEn,
        brandAr: src.brandAr,
        gtin: src.gtin,
        numberOfPieces: src.numberOfPieces,
        sizeUnit: src.sizeUnit,
        fulltypeHint: src.fulltypeHint,
        competitors: src.competitors,
      });
      // 仅当文案区真有内容才回写；勿因草稿里已有旧 content 就用空表单盖掉服务器
      if (contentHasUserText(c)) {
        await api.patchListingDraftContent(src.id, {
          ...c,
          gtin: src.gtin || c.gtin,
        });
      }
      // 保存期间用户又改了：保留 dirty，勿动表单 state
      if (gen !== dirtyGenRef.current) {
        setSaveHint("有新修改，稍后继续自动保存…");
        scheduleAutosave();
        return;
      }
      dirtyRef.current = false;
      writeBackupNow(src, c, stepRef.current);
      setSaveHint(`草稿字段已自动保存 ${new Date().toLocaleTimeString()}`);
    } catch {
      writeBackupNow(src, c, stepRef.current);
      setSaveHint(
        "服务器暂不可用（可能在重启），草稿已保存在本机浏览器；恢复后会自动同步",
      );
    }
  }

  function scheduleAutosave() {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void flushAutosave();
    }, 2500);
  }

  function applyLocalBackup(bak: LocalBackupEnvelope<ListingFormBackup>) {
    const src = draftRef.current;
    if (!src) return;
    const p = bak.payload;
    beginHydrating();
    const next: ListingDraft = {
      ...src,
      notes: p.notes,
      ourPrice: p.ourPrice,
      brandEn: p.brandEn,
      brandAr: p.brandAr,
      gtin: p.gtin,
      numberOfPieces: p.numberOfPieces,
      sizeUnit: p.sizeUnit,
      fulltypeHint: p.fulltypeHint,
      competitors: p.competitors?.length ? p.competitors : src.competitors,
    };
    setDraft(next);
    setContent(p.content || emptyContent());
    setStep(p.step || "input");
    setPendingRestore(null);
    endHydrating();
    window.setTimeout(() => {
      dirtyRef.current = true;
      dirtyGenRef.current += 1;
      void flushAutosave();
    }, 50);
  }

  /** 服务端整单写回（打开草稿 / 模型结果）；自动保存勿走这里 */
  function applyServerDraft(
    d: ListingDraft,
    opts?: {
      content?: ListingOursNoonContent;
      step?: "input" | "analysis" | "content";
    },
  ) {
    beginHydrating();
    setDraft(d);
    const c = opts?.content ?? d.ours.content ?? contentRef.current;
    if (opts?.content !== undefined || d.ours.content) {
      setContent(opts?.content ?? d.ours.content ?? emptyContent());
    }
    if (opts?.step) setStep(opts.step);
    writeBackupNow(d, c, opts?.step ?? stepRef.current);
    endHydrating();
  }

  async function refreshList() {
    const r = await api.listListingDrafts();
    setSummaries(r.data);
  }

  async function openDraft(id: string) {
    beginHydrating();
    setPendingRestore(null);
    const r = await api.getListingDraft(id);
    setDraft(r.data);
    const c = r.data.ours.content ?? emptyContent();
    setContent(c);
    setArSource("");
    setArCheck(null);
    let nextStep: "input" | "analysis" | "content" = "input";
    if (r.data.ours.content) nextStep = "content";
    else if (r.data.analysis) nextStep = "analysis";
    setStep(nextStep);
    const bak = readLocalBackup<ListingFormBackup>(backupKeyFor(id));
    if (bak && isBackupNewerThan(bak.savedAt, r.data.updatedAt)) {
      setPendingRestore(bak);
      setSaveHint("发现本机有更新的未同步填写，可恢复");
    } else {
      writeBackupNow(r.data, c, nextStep);
      setSaveHint("");
    }
    endHydrating();
  }

  async function createNew(seed?: {
    competitorUrl?: string;
    competitorTitle?: string;
    competitorPrice?: string;
  }) {
    setBusy("create");
    setError("");
    try {
      const competitor = emptyCompetitor({
        url: seed?.competitorUrl || "",
        pastedTitle: seed?.competitorTitle || "",
        pastedPrice: seed?.competitorPrice || "",
      });
      const r = await api.createListingDraft({
        competitors: [competitor],
      } as Partial<ListingDraft>);
      applyServerDraft(r.data, { content: emptyContent(), step: "input" });
      setArSource("");
      setArCheck(null);
      await refreshList();
      return r.data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
      return null;
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    refreshList().catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    draftRef.current = draft;
    contentRef.current = content;
    stepRef.current = step;
  }, [draft, content, step]);

  useEffect(() => {
    if (!draft || hydratingRef.current) return;
    dirtyRef.current = true;
    dirtyGenRef.current += 1;
    writeBackupNow(draft, content, step);
    scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: backup on form state change
  }, [draft, content, step]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    const retry = window.setInterval(() => {
      if (dirtyRef.current) void flushAutosave();
    }, 15000);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearInterval(retry);
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (seedHandled.current) return;
    const competitorUrl = searchParams.get("competitorUrl")?.trim();
    if (!competitorUrl) return;
    seedHandled.current = true;
    const competitorTitle = searchParams.get("competitorTitle")?.trim() || "";
    const competitorPrice = searchParams.get("competitorPrice")?.trim() || "";
    void (async () => {
      await createNew({ competitorUrl, competitorTitle, competitorPrice });
      setSearchParams({}, { replace: true });
    })();
  }, [searchParams, setSearchParams]);

  async function saveInputs(from?: ListingDraft): Promise<ListingDraft | null> {
    const src = from ?? draft;
    if (!src) return null;
    setBusy("save");
    setError("");
    try {
      await api.patchListingDraft(src.id, {
        notes: src.notes,
        ourPrice: src.ourPrice,
        brandEn: src.brandEn,
        brandAr: src.brandAr,
        gtin: src.gtin,
        numberOfPieces: src.numberOfPieces,
        sizeUnit: src.sizeUnit,
        fulltypeHint: src.fulltypeHint,
        competitors: src.competitors,
      });
      dirtyRef.current = false;
      writeBackupNow(src, contentRef.current, stepRef.current);
      setSaveHint(`已保存 ${new Date().toLocaleTimeString()}`);
      // 不把服务器整单 setDraft 回来，避免冲掉正在输入的焦点/未同步字段
      return src;
    } catch (e) {
      writeBackupNow(src, contentRef.current, stepRef.current);
      setError(
        e instanceof Error
          ? `${e.message}（本机已备份，服务器恢复后会自动同步）`
          : "保存失败（本机已备份）",
      );
      return null;
    } finally {
      setBusy("");
    }
  }

  async function onUpload(files: FileList | null) {
    if (!draft || !files?.length) return;
    setBusy("upload");
    setError("");
    try {
      let latest = draft;
      for (const file of Array.from(files).slice(0, 8)) {
        const base64 = await fileToBase64(file);
        const r = await api.uploadListingDraftImage(latest.id, {
          filename: file.name,
          mimeType: file.type || "image/jpeg",
          base64,
        });
        latest = r.data;
      }
      applyServerDraft(latest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy("");
    }
  }

  /**
   * vision / analyze / generate / ours_generate / all
   * - ours_generate：无对手也可，看本品图后直接写上架文案
   * - all：视觉+对标（停在勾选优势，不自动生成）
   */
  async function runPipeline(
    kind: "vision" | "analyze" | "generate" | "ours_generate" | "all",
  ) {
    if (!draft) return;
    setError("");
    try {
      const saved = await saveInputs(draft);
      if (!saved) return;
      let current = saved;
      if (kind === "vision" || kind === "all" || kind === "ours_generate") {
        setBusy("vision");
        const r = await api.runListingVision(current.id);
        current = r.data;
        applyServerDraft(current);
      }
      if (kind === "analyze" || kind === "all") {
        setBusy("analyze");
        const r = await api.runListingAnalyze(current.id);
        current = r.data;
        applyServerDraft(current, { step: "analysis" });
      }
      if (kind === "generate" || kind === "ours_generate") {
        setBusy("generate");
        const oursOnly =
          kind === "ours_generate" ||
          !current.analysis ||
          !current.analysis.ourEdges.some((e) => e.selected);
        if (!oursOnly && current.analysis) {
          const selectedIds = current.analysis.ourEdges
            .filter((e) => e.selected)
            .map((e) => e.id);
          await api.setListingEdges(current.id, selectedIds);
        }
        const selected = oursOnly
          ? []
          : (current.analysis?.ourEdges.filter((e) => e.selected).map((e) => e.id) ??
            []);
        const r = await api.runListingGenerate(
          current.id,
          selected,
          oursOnly ? "ours_only" : "from_edges",
        );
        current = r.data;
        applyServerDraft(current, {
          content: current.ours.content ?? emptyContent(),
          step: "content",
        });
      }
      await refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "模型调用失败");
      if (draft) {
        try {
          const r = await api.getListingDraft(draft.id);
          applyServerDraft(r.data);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy("");
    }
  }

  async function saveContent() {
    if (!draft) return;
    setBusy("content");
    setError("");
    try {
      await api.patchListingDraftContent(draft.id, {
        ...content,
        gtin: draft.gtin || content.gtin,
      });
      dirtyRef.current = false;
      writeBackupNow(draft, content, stepRef.current);
      setSaveHint(`文案已保存 ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      writeBackupNow(draft, content, stepRef.current);
      setError(
        e instanceof Error
          ? `${e.message}（本机已备份）`
          : "保存文案失败（本机已备份）",
      );
    } finally {
      setBusy("");
    }
  }

  async function verifyArabic() {
    if (!draft) return;
    const source =
      arSource.trim() ||
      [content.titleEn, content.longDescriptionEn, ...content.featureBulletsEn]
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n");
    setBusy("verify-ar");
    setError("");
    try {
      const r = await api.verifyListingArabic(draft.id, {
        sourceText: source,
        content,
      });
      setArCheck(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "阿语校验失败");
    } finally {
      setBusy("");
    }
  }

  async function applyBrandSuggestion() {
    if (!draft?.ours.brandSuggestion) return;
    const { en, ar } = draft.ours.brandSuggestion;
    const brandEn = en || draft.brandEn;
    const brandAr = ar || draft.brandAr;
    const nextContent = {
      ...content,
      brandEn: en || content.brandEn,
      brandAr: ar || content.brandAr,
    };
    setDraft({ ...draft, brandEn, brandAr });
    setContent(nextContent);
    try {
      await api.patchListingDraft(draft.id, { brandEn, brandAr });
      if (draft.ours.content) {
        const r = await api.patchListingDraftContent(draft.id, {
          ...nextContent,
          gtin: draft.gtin || nextContent.gtin,
        });
        setDraft(r.data);
        setContent(r.data.ours.content ?? nextContent);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "填入品牌失败");
    }
  }

  function updateCompetitor(i: number, patch: Partial<ListingCompetitorInput>) {
    if (!draft) return;
    const competitors = draft.competitors.map((c, idx) =>
      idx === i ? { ...c, ...patch } : c,
    );
    setDraft({ ...draft, competitors });
  }

  async function toggleEdge(id: string) {
    if (!draft?.analysis) return;
    const ourEdges = draft.analysis.ourEdges.map((e) =>
      e.id === id ? { ...e, selected: !e.selected } : e,
    );
    const next = {
      ...draft,
      analysis: { ...draft.analysis, ourEdges },
    };
    setDraft(next);
    try {
      await api.setListingEdges(
        draft.id,
        ourEdges.filter((e) => e.selected).map((e) => e.id),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "勾选同步失败");
    }
  }

  const STATUS_LABEL: Record<string, string> = {
    draft: "填写资料中",
    vision_done: "图片已看完",
    analyzed: "已找出优势，待勾选",
    generated: "文案已出，请检查",
    ready_review: "待你审核",
    approved: "已通过",
    rejected: "已打回",
  };

  const BUSY_LABEL: Record<string, string> = {
    create: "正在新建",
    save: "正在保存",
    upload: "正在上传图片",
    vision: "正在看本品图片",
    analyze: "正在对比对手",
    generate: "正在写上架文案",
    delete: "正在删除",
    import: "正在导入采集",
    normalize: "正在整理粘贴内容",
    content: "正在保存文案",
  };

  function suggestedNext(): { tip: string; action?: () => void; label?: string } {
    if (!draft) return { tip: "" };
    if (!draft.ours.images.length) {
      return { tip: "先在左侧上传本品图片。没有对手也能直接生成上架文案。" };
    }
    const hasComp = draft.competitors.some(
      (c) => c.url && (c.pastedTitle || c.pastedBullets || c.pastedDescription),
    );
    if (!draft.ours.content && !hasComp) {
      return {
        tip: "已有本品图：可直接看图写标题/卖点/长描述，不必先找对手。",
        label: "凭本品图生成文案",
        action: () => void runPipeline("ours_generate"),
      };
    }
    if (hasComp && (!draft.ours.visionNotes || !draft.analysis)) {
      return {
        tip: "有对手信息时：可看图并对比，找出优势后再生成。",
        label: "看图并对比对手",
        action: () => void runPipeline("all"),
      };
    }
    if (!draft.ours.content && draft.analysis) {
      return {
        tip: "可去「② 哪里能赢」勾选优势后生成；或直接凭本品图生成。",
        label: "凭本品图生成文案",
        action: () => void runPipeline("ours_generate"),
      };
    }
    if (!draft.ours.content) {
      return {
        tip: "点主按钮，根据本品图片生成 Noon 上架文案。",
        label: "凭本品图生成文案",
        action: () => void runPipeline("ours_generate"),
      };
    }
    return {
      tip: "文案已生成，可在「③ 上架文案」里检查、修改、分字段复制。",
      label: "查看文案",
      action: () => setStep("content"),
    };
  }

  const statusLabel = STATUS_LABEL[draft?.status ?? ""] || draft?.status || "—";
  const busyLabel = busy ? BUSY_LABEL[busy] || busy : "";
  const nextHint = suggestedNext();

  return (
    <div className="listing-page">
      <h1 className="page-title">上架文案</h1>
      <div className="listing-mode-tabs" role="tablist" aria-label="上架文案功能">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "create"}
          className={`listing-mode-tab${mode === "create" ? " active" : ""}`}
          onClick={() => setMode("create")}
        >
          竞品生成
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "optimize"}
          className={`listing-mode-tab${mode === "optimize" ? " active" : ""}`}
          onClick={() => setMode("optimize")}
        >
          文案优化
        </button>
      </div>
      <p className="page-desc">
        {mode === "optimize"
          ? "四步：① 填自有链接与现有文案 → ② 从后台导出表清洗点击率/转化率 → ③ 诊断点击/转化问题 → ④ 生成优化文案。"
          : "两条路：① 只上传本品图 → 凭图片生成标题/卖点/长描述；② 可选填对手 → 对比找优势后再生成。文案可复制到 Noon。"}
      </p>
      {mode === "create" && (
        <div style={{ marginBottom: 12 }}>
          <ExtensionDownloadBtn
            extId="listing"
            onError={(msg) => setError(msg)}
          />
        </div>
      )}
      {pendingRestore && draft && (
        <div
          className="muted"
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            background: "color-mix(in srgb, #2a7a4b 12%, var(--surface-2))",
            borderLeft: "3px solid #2a7a4b",
            fontSize: 13,
          }}
        >
          本机有未同步的填写（{new Date(pendingRestore.savedAt).toLocaleString()}
          ），可能因服务器重启未写上。
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginLeft: 8 }}
            onClick={() => applyLocalBackup(pendingRestore)}
          >
            恢复本机填写
          </button>
          <button
            type="button"
            className="btn"
            style={{ marginLeft: 6 }}
            onClick={() => {
              clearLocalBackup(backupKeyFor(draft.id));
              setPendingRestore(null);
              setSaveHint("");
            }}
          >
            丢弃本机备份
          </button>
        </div>
      )}

      {mode === "optimize" ? (
        <ListingOptimizePanel />
      ) : (
      <>
      {error && (
        <p className="listing-error" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div className="listing-layout">
        <aside className="listing-sidebar card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>草稿</h3>
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
            {summaries.length === 0 && <li className="muted">暂无草稿</li>}
            {summaries.map((s) => (
              <li key={s.id} className="listing-draft-item">
                <button
                  type="button"
                  className={draft?.id === s.id ? "active" : ""}
                  onClick={() => openDraft(s.id).catch((e: Error) => setError(e.message))}
                >
                  <span className="listing-draft-title">{s.titleHint}</span>
                  <span className="muted">
                    {s.status} · 图{s.imageCount} · 对手{s.competitorCount}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost listing-draft-del"
                  disabled={!!busy}
                  title="删除草稿"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`删除草稿「${s.titleHint}」？`)) return;
                    setBusy("delete");
                    setError("");
                    try {
                      await api.deleteListingDraft(s.id);
                      if (draft?.id === s.id) {
                        setDraft(null);
                        setContent(emptyContent());
                      }
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
          {!draft && (
            <div className="card">
              <p className="muted">请新建或选择左侧草稿。</p>
            </div>
          )}

          {draft && (
            <>
              <div className="card listing-toolbar">
                <div className="listing-steps">
                  <button
                    type="button"
                    className={`listing-step${step === "input" ? " active" : ""}`}
                    disabled={!!busy}
                    onClick={() => setStep("input")}
                  >
                    <span className="listing-step-num">1</span>
                    填资料
                  </button>
                  <span className="listing-step-arrow" aria-hidden>
                    →
                  </span>
                  <button
                    type="button"
                    className={`listing-step${step === "analysis" ? " active" : ""}`}
                    disabled={!!busy || !draft.analysis}
                    onClick={() => setStep("analysis")}
                  >
                    <span className="listing-step-num">2</span>
                    哪里能赢
                  </button>
                  <span className="listing-step-arrow" aria-hidden>
                    →
                  </span>
                  <button
                    type="button"
                    className={`listing-step${step === "content" ? " active" : ""}`}
                    disabled={!!busy || !draft.ours.content}
                    onClick={() => setStep("content")}
                  >
                    <span className="listing-step-num">3</span>
                    上架文案
                  </button>
                  <span className="cat-tag idle" style={{ marginLeft: 8 }}>
                    {statusLabel}
                  </span>
                  {busyLabel && <span className="muted">{busyLabel}…</span>}
                </div>

                <p className="listing-next-tip">
                  <strong>接下来：</strong>
                  {nextHint.tip}
                  {nextHint.action && nextHint.label && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ marginLeft: 10 }}
                      disabled={!!busy}
                      onClick={nextHint.action}
                    >
                      {nextHint.label}
                    </button>
                  )}
                </p>

                <div className="listing-actions">
                  <button type="button" className="btn" disabled={!!busy} onClick={() => void saveInputs()}>
                    保存
                  </button>
                  {saveHint && (
                    <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                      {saveHint}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busy || !draft.ours.images.length}
                    title="只分析左侧本品图片里看得见的外观和功能"
                    onClick={() => void runPipeline("vision")}
                  >
                    只分析本品图片
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!busy || !draft.ours.images.length}
                    title="不需要对手：看本品图后直接写标题/卖点/长描述"
                    onClick={() => void runPipeline("ours_generate")}
                  >
                    凭本品图生成文案
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busy}
                    title="根据对手信息和本品图片结论，找出你能打的点（可选）"
                    onClick={() => void runPipeline("analyze")}
                  >
                    对比对手找优势
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={
                      !!busy ||
                      (!draft.ours.images.length && !draft.analysis)
                    }
                    title="有勾选优势则按优势写；否则按本品图写"
                    onClick={() => void runPipeline("generate")}
                  >
                    生成上架文案
                  </button>
                </div>
                <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
                  没有对手时点「凭本品图生成文案」即可；有对手再点「对比对手找优势」。右侧对手区为可选项。
                </p>
                {draft.lastError && (
                  <p className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>
                    出错了：{draft.lastError}
                  </p>
                )}
              </div>

              <ListingPromoPanel draft={draft} onDraft={setDraft} />

              {step === "input" && (
                <div className="listing-cols">
                  <section className="card listing-panel listing-panel-ours">
                    <h3>本品（我们要卖的）</h3>
                    <p className="muted">上传实拍图；品牌可空着让系统建议；条码请自己填，系统不会瞎编。</p>
                    <div className="noon-field">
                      <label>本品图片（可多张）</label>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={!!busy}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          void onUpload(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      <div
                        className={[
                          "listing-drop",
                          oursDragOver ? "listing-drop-active" : "",
                          busy ? "listing-drop-busy" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!busy) imageInputRef.current?.click();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (!busy) imageInputRef.current?.click();
                          }
                        }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          oursDragDepth.current += 1;
                          setOursDragOver(true);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "copy";
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          oursDragDepth.current = Math.max(0, oursDragDepth.current - 1);
                          if (oursDragDepth.current === 0) setOursDragOver(false);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          oursDragDepth.current = 0;
                          setOursDragOver(false);
                          if (busy) return;
                          const files = Array.from(e.dataTransfer.files || []).filter(
                            (f) =>
                              f.type.startsWith("image/") ||
                              /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name),
                          );
                          if (!files.length) {
                            setError("请拖入图片文件");
                            return;
                          }
                          const dt = new DataTransfer();
                          for (const f of files) dt.items.add(f);
                          void onUpload(dt.files);
                        }}
                      >
                        <strong>
                          {oursDragOver ? "松开即可上传" : "拖拽图片到此处上传"}
                        </strong>
                        <span className="muted">支持多张；也可点击选择文件</span>
                      </div>
                    </div>
                    <div className="listing-thumbs">
                      {draft.ours.images.map((img) => (
                        <div key={img.id} className="listing-thumb">
                          <img
                            src={api.listingDraftImageUrl(draft.id, img.id)}
                            alt={img.filename}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={!!busy}
                            onClick={async () => {
                              const r = await api.deleteListingDraftImage(draft.id, img.id);
                              setDraft(r.data);
                            }}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="noon-bilingual">
                      <CopyField
                        label="品牌（英文）"
                        value={draft.brandEn}
                        onChange={(v) => setDraft({ ...draft, brandEn: v })}
                      />
                      <CopyField
                        label="品牌（阿拉伯文）"
                        value={draft.brandAr}
                        dir="rtl"
                        onChange={(v) => setDraft({ ...draft, brandAr: v })}
                      />
                    </div>
                    <CopyField
                      label="条码（人工填写，系统不编造）"
                      value={draft.gtin}
                      onChange={(v) => setDraft({ ...draft, gtin: v })}
                    />
                    <div className="noon-bilingual">
                      <CopyField
                        label="目标价 / 我方价格"
                        value={draft.ourPrice}
                        onChange={(v) => setDraft({ ...draft, ourPrice: v })}
                      />
                      <CopyField
                        label="商品类型提示"
                        value={draft.fulltypeHint}
                        onChange={(v) => setDraft({ ...draft, fulltypeHint: v })}
                      />
                    </div>
                    <div className="noon-bilingual">
                      <CopyField
                        label="件数"
                        value={draft.numberOfPieces}
                        onChange={(v) => setDraft({ ...draft, numberOfPieces: v })}
                      />
                      <CopyField
                        label="尺寸单位"
                        value={draft.sizeUnit}
                        onChange={(v) => setDraft({ ...draft, sizeUnit: v })}
                      />
                    </div>
                    <CopyField
                      label="本品备注（真实卖点/差异，供生成文案）"
                      value={draft.notes}
                      multiline
                      onChange={(v) => setDraft({ ...draft, notes: v })}
                    />
                    {draft.ours.visionNotes && (
                      <div className="listing-vision-box">
                        <h4>从图里看出的要点</h4>
                        <p className="muted">已看完图片</p>
                        <p>
                          <strong>外观</strong>：{draft.ours.visionNotes.appearance.join("；") || "—"}
                        </p>
                        <p>
                          <strong>功能</strong>：{draft.ours.visionNotes.features.join("；") || "—"}
                        </p>
                        <p>
                          <strong>包装</strong>：{draft.ours.visionNotes.packaging.join("；") || "—"}
                        </p>
                        {draft.ours.visionNotes.caveats.length > 0 && (
                          <p className="muted">
                            不确定：{draft.ours.visionNotes.caveats.join("；")}
                          </p>
                        )}
                      </div>
                    )}
                  </section>

                  <section className="card listing-panel listing-panel-comp">
                    <h3>对手（可选，要对比时再填）</h3>
                    <p className="muted">
                      可选。没有对手也能左侧上传图后点「凭本品图生成文案」。有对手时再填链接/卖点，或用 Listing
                      扩展采集后点「导入扩展采集」（扩展里须填写与当前登录相同的用户名）。扩展可在本页顶部下载。
                    </p>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!!busy}
                        onClick={async () => {
                          setBusy("import");
                          setError("");
                          try {
                            await saveInputs(draft);
                            const r = await api.importCompetitorCapture(draft.id);
                            applyServerDraft(r.data);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "导入失败");
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        导入扩展采集
                      </button>
                      <ExtensionDownloadBtn
                        extId="listing"
                        compact
                        onError={(msg) => setError(msg)}
                      />
                    </div>
                    {draft.competitors.map((c, i) => (
                      <div key={c.id} className="listing-comp-block">
                        <CopyField
                          label={`对手链接 #${i + 1}`}
                          value={c.url}
                          onChange={(v) => updateCompetitor(i, { url: v })}
                        />
                        <CopyField
                          label="粘贴标题"
                          value={c.pastedTitle}
                          onChange={(v) => updateCompetitor(i, { pastedTitle: v })}
                        />
                        <CopyField
                          label="粘贴价格"
                          value={c.pastedPrice}
                          onChange={(v) => updateCompetitor(i, { pastedPrice: v })}
                        />
                        <CopyField
                          label="粘贴卖点条文（可多行）"
                          value={c.pastedBullets}
                          multiline
                          onChange={(v) => updateCompetitor(i, { pastedBullets: v })}
                        />
                        <CopyField
                          label="粘贴描述摘要"
                          value={c.pastedDescription}
                          multiline
                          onChange={(v) => updateCompetitor(i, { pastedDescription: v })}
                        />
                        <button
                          type="button"
                          className="btn"
                          disabled={!!busy}
                          onClick={async () => {
                            setBusy("normalize");
                            setError("");
                            try {
                              await saveInputs(draft);
                              const r = await api.normalizeCompetitorPaste(draft.id, {
                                competitorId: c.id,
                              });
                              setDraft(r.data);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "结构化失败");
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          整理杂乱粘贴
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          competitors: [...draft.competitors, emptyCompetitor()].slice(0, 5),
                        })
                      }
                    >
                      + 加对手
                    </button>
                  </section>
                </div>
              )}

              {step === "analysis" && draft.analysis && (
                <div className="listing-cols">
                  <section className="card listing-panel listing-panel-comp">
                    <h3>对手有什么</h3>
                    {draft.analysis.competitorPoints.map((cp) => {
                      const norm = draft.competitorNormalized[cp.competitorId];
                      const meta = draft.competitors.find((c) => c.id === cp.competitorId);
                      return (
                        <div key={cp.competitorId} className="listing-comp-block">
                          <p>
                            <a href={meta?.url} target="_blank" rel="noreferrer">
                              {norm?.title || meta?.pastedTitle || cp.competitorId}
                            </a>
                          </p>
                          {norm?.price && <p className="muted">价格：{norm.price}</p>}
                          <p>
                            <strong>卖点</strong>
                          </p>
                          <ul>
                            {cp.points.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                          <p>
                            <strong>优势</strong>
                          </p>
                          <ul>
                            {(cp.strengths.length ? cp.strengths : norm?.strengths || []).map(
                              (p) => (
                                <li key={p}>{p}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      );
                    })}
                    {draft.analysis.risks.length > 0 && (
                      <div>
                        <h4>风险</h4>
                        <ul>
                          {draft.analysis.risks.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>

                  <section className="card listing-panel listing-panel-ours">
                    <h3>我们哪里能赢（请勾选后再生成文案）</h3>
                    <ul className="listing-edges">
                      {draft.analysis.ourEdges.map((e) => (
                        <li key={e.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={e.selected}
                              onChange={() => toggleEdge(e.id)}
                            />
                            <span className="cat-tag idle">
                              {ANGLE_LABEL[e.angle] || e.angle}
                            </span>
                            <strong>{e.claim}</strong>
                            <span className="muted"> — {e.evidence}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {draft.analysis.attackAngles.length > 0 && (
                      <div>
                        <h4>进攻角度摘要</h4>
                        <ul>
                          {draft.analysis.attackAngles.map((a) => (
                            <li key={a.angle + a.summary}>
                              <strong>{ANGLE_LABEL[a.angle] || a.angle}</strong>：{a.summary}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {step === "content" && (
                <section className="card noon-basic-content">
                  <div className="noon-basic-head">
                    <div>
                      <h2>Product Content · Basic Content</h2>
                      <p className="muted">布局对齐 Noon Partner；每个字段单独复制。</p>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button type="button" className="btn" disabled={!!busy} onClick={saveContent}>
                        保存修改
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!!busy}
                        onClick={async () => {
                          const r = await api.approveListingDraft(draft.id);
                          setDraft(r.data);
                        }}
                      >
                        审核通过
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={!!busy}
                        onClick={async () => {
                          const r = await api.rejectListingDraft(draft.id);
                          setDraft(r.data);
                        }}
                      >
                        打回
                      </button>
                    </div>
                  </div>

                  {draft.guardrails && (
                    <div
                      className={`noon-qc ${draft.guardrails.ok ? "ok" : "bad"}`}
                    >
                      <div>
                        <strong>自检</strong>：{draft.guardrails.ok ? "可通过人审" : "需修订"}
                      </div>
                      {draft.guardrails.blockers.map((b) => (
                        <div key={b}>阻断：{b}</div>
                      ))}
                      {draft.guardrails.warnings.map((w) => (
                        <div key={w}>提示：{w}</div>
                      ))}
                    </div>
                  )}

                  <div className="field" style={{ margin: "12px 0" }}>
                    <label>中文或英文原稿（留空则用当前英文标题、描述和卖点）</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={arSource}
                      onChange={(e) => setArSource(e.target.value)}
                    />
                    <div className="row" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={!!busy}
                        onClick={verifyArabic}
                      >
                        {busy === "verify-ar" ? "校验中…" : "校验阿语"}
                      </button>
                    </div>
                    {arCheck && (
                      <div className={`noon-qc ${arCheck.issues.some((i) => i.severity === "blocker") || !arCheck.guardrails.ok ? "bad" : "ok"}`} style={{ marginTop: 8 }}>
                        <div>
                          <strong>阿语校验</strong>
                          {arCheck.model ? "" : " · 未调用模型"}
                        </div>
                        {arCheck.guardrails.blockers.map((b) => (
                          <div key={`g-${b}`}>护栏阻断：{b}</div>
                        ))}
                        {arCheck.guardrails.warnings.map((w) => (
                          <div key={`gw-${w}`}>护栏提示：{w}</div>
                        ))}
                        {arCheck.issues.length === 0 ? (
                          <div>对照原稿未发现额外问题</div>
                        ) : (
                          arCheck.issues.map((issue) => (
                            <div key={`${issue.field}-${issue.point}`}>
                              {issue.severity === "blocker" ? "问题" : "提示"}（{issue.field}）：{issue.point}
                              {issue.suggestion ? ` — ${issue.suggestion}` : ""}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {draft.ours.brandSuggestion && (
                    <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                      <p className="muted" style={{ margin: 0 }}>
                        品牌建议：{draft.ours.brandSuggestion.en} /{" "}
                        {draft.ours.brandSuggestion.ar}
                      </p>
                      <button
                        type="button"
                        className="btn"
                        onClick={applyBrandSuggestion}
                      >
                        填入品牌
                      </button>
                    </div>
                  )}

                  <div className="noon-bilingual">
                    <CopyField
                      label="标题（英文）"
                      value={content.titleEn}
                      onChange={(v) => setContent({ ...content, titleEn: v })}
                    />
                    <CopyField
                      label="标题（阿拉伯文）"
                      value={content.titleAr}
                      dir="rtl"
                      onChange={(v) => setContent({ ...content, titleAr: v })}
                    />
                  </div>

                  <CopyField
                    label="商品类型"
                    value={content.fulltype}
                    onChange={(v) => setContent({ ...content, fulltype: v })}
                  />

                  <div className="noon-bilingual">
                    <CopyField
                      label="品牌（英文）"
                      value={content.brandEn}
                      onChange={(v) => setContent({ ...content, brandEn: v })}
                    />
                    <CopyField
                      label="品牌（阿拉伯文）"
                      value={content.brandAr}
                      dir="rtl"
                      onChange={(v) => setContent({ ...content, brandAr: v })}
                    />
                  </div>

                  <div className="noon-bilingual">
                    <CopyField
                      label="长描述（英文）"
                      value={content.longDescriptionEn}
                      multiline
                      onChange={(v) => setContent({ ...content, longDescriptionEn: v })}
                    />
                    <CopyField
                      label="长描述（阿拉伯文）"
                      value={content.longDescriptionAr}
                      multiline
                      dir="rtl"
                      onChange={(v) => setContent({ ...content, longDescriptionAr: v })}
                    />
                  </div>

                  <div className="noon-bilingual">
                    <CopyField
                      label="件数"
                      value={content.numberOfPieces}
                      onChange={(v) => setContent({ ...content, numberOfPieces: v })}
                    />
                    <CopyField
                      label="尺寸单位"
                      value={content.sizeUnit}
                      onChange={(v) => setContent({ ...content, sizeUnit: v })}
                    />
                  </div>

                  <div className="noon-bullets">
                    <h4>卖点条文</h4>
                    {(content.featureBulletsEn.length
                      ? content.featureBulletsEn
                      : ["", "", "", "", ""]
                    ).map((en, i) => (
                      <div key={i} className="noon-bilingual noon-bullet-row">
                        <CopyField
                          label={`#${i + 1} 英文`}
                          value={en}
                          onChange={(v) => {
                            const featureBulletsEn = [...content.featureBulletsEn];
                            while (featureBulletsEn.length <= i) featureBulletsEn.push("");
                            featureBulletsEn[i] = v;
                            const featureBulletsAr = [...content.featureBulletsAr];
                            while (featureBulletsAr.length < featureBulletsEn.length) {
                              featureBulletsAr.push("");
                            }
                            setContent({ ...content, featureBulletsEn, featureBulletsAr });
                          }}
                        />
                        <CopyField
                          label={`#${i + 1} 阿拉伯文`}
                          value={content.featureBulletsAr[i] || ""}
                          dir="rtl"
                          onChange={(v) => {
                            const featureBulletsAr = [...content.featureBulletsAr];
                            while (featureBulletsAr.length <= i) featureBulletsAr.push("");
                            featureBulletsAr[i] = v;
                            setContent({ ...content, featureBulletsAr });
                          }}
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setContent({
                          ...content,
                          featureBulletsEn: [...content.featureBulletsEn, ""],
                          featureBulletsAr: [...content.featureBulletsAr, ""],
                        })
                      }
                    >
                      + 新增一条
                    </button>
                  </div>

                  <CopyField
                    label="条码"
                    value={draft.gtin || content.gtin}
                    onChange={(v) => {
                      setDraft({ ...draft, gtin: v });
                      setContent({ ...content, gtin: v });
                    }}
                  />

                  <div className="noon-images-slot">
                    <h4>图片（本品已上传，请在 Noon 后台另行上传）</h4>
                    <div className="listing-thumbs">
                      {draft.ours.images.map((img) => (
                        <div key={img.id} className="listing-thumb">
                          <img
                            src={api.listingDraftImageUrl(draft.id, img.id)}
                            alt={img.filename}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost noon-copy-btn"
                            onClick={() => copyText(api.listingDraftImageUrl(draft.id, img.id))}
                          >
                            复制图片 URL
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
      </>
      )}
    </div>
  );
}
