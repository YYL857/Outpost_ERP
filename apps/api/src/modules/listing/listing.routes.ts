import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Router, type Request } from "express";
import type { AppState } from "../../common/types.js";
import type { AuthedRequest } from "../../auth/middleware.js";
import { runWithContext } from "../../auth/context.js";
import { findUserByUsername, toAuthUser } from "../../auth/users.js";
import { loadUserPrefs } from "../../auth/workspace.js";
import { getActiveShop, loadRegistry } from "../../shops/registry.js";
import { saveState } from "../../data/store.js";
import { runCompetitorOursAnalysis } from "./analyze.js";
import { runOursListingGenerate } from "./generate.js";
import { runContentGuardrails, enforceGtinFromUser } from "./guardrails.js";
import {
  draftImagesDir,
  ensureListingDirs,
  listingPaths,
  promoJobDir,
  promoJobOutDir,
} from "./paths.js";
import {
  approvePromoJob,
  createPromoJob,
  getPromoJob,
  ingestPromoJob,
  openPromoOutFolder,
  patchPromoBrief,
  revisePromoJob,
  uploadPromoOutImages,
} from "./promo/run.js";
import { buildPromoPackZip } from "./promo/pack-zip.js";
import { buildBrowserExtensionZip } from "../../common/browser-extensions.js";
import {
  deleteDraft,
  deleteDraftImageFile,
  listDraftSummaries,
  loadDraft,
  saveDraft,
} from "./store.js";
import {
  loadLatestCompetitorCapture,
  saveCompetitorCapture,
  type CompetitorCapture,
} from "./competitor-capture.js";
import { normalizeCompetitorPaste } from "./normalize-paste.js";
import { toPlainLongDescription } from "./plain-text.js";
import {
  createEmptyDraft,
  type CompetitorInput,
  type ListingDraft,
  type OursNoonContent,
} from "./types.js";
import { verifyArabicListing } from "./verify-ar.js";
import { runOursVision } from "./vision.js";
import { runOptimizeDiagnose } from "./optimize-analyze.js";
import {
  applyCsvOverrideToBundle,
  cleanListingPerfFromState,
  guessSkuFromListingUrl,
} from "./optimize-metrics.js";
import { runOptimizeRewrite } from "./optimize-rewrite.js";
import {
  deleteOptimizeJob,
  listOptimizeSummaries,
  loadOptimizeJob,
  saveOptimizeJob,
} from "./optimize-store.js";
import {
  createEmptyOptimizeJob,
  emptyCurrentContent,
  type OptimizeCurrentContent,
  type OptimizeJob,
} from "./optimize-types.js";

function asStr(v: unknown) {
  return String(v ?? "").trim();
}

/**
 * 已登录：写入当前用户 inbox。
 * 局域网扩展免登：须带 Outpost 用户名，写入该用户 inbox（避免写进管理员目录导致同事「导入」为空）。
 */
function runCompetitorCaptureForRequester<T>(
  req: Request,
  body: Record<string, unknown>,
  fn: () => T,
): T {
  const authed = (req as AuthedRequest).user;
  if (authed) {
    const prefs = loadUserPrefs(authed.id);
    const registry = loadRegistry();
    const shopId =
      registry.shops.find((s) => s.id === prefs.selectedShopId)?.id ??
      getActiveShop(registry).id;
    return runWithContext({ user: authed, shopId }, fn);
  }

  const username = asStr(body.username);
  if (!username) {
    throw new Error(
      "请在扩展里填写并保存你的 Outpost 用户名（与网页登录名相同），否则采集无法写入你的 Listing",
    );
  }
  const record = findUserByUsername(username);
  if (!record) {
    throw new Error(`Outpost 用户不存在：${username}`);
  }
  if (record.disabled) {
    throw new Error(`账号已停用：${username}`);
  }
  const user = toAuthUser(record);
  const prefs = loadUserPrefs(user.id);
  const registry = loadRegistry();
  const shopId =
    registry.shops.find((s) => s.id === prefs.selectedShopId)?.id ??
    getActiveShop(registry).id;
  return runWithContext({ user, shopId }, fn);
}

function parseCompetitors(raw: unknown): CompetitorInput[] {
  if (!Array.isArray(raw)) return [];
  const out: CompetitorInput[] = [];
  for (const row of raw.slice(0, 5)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const url = asStr(o.url);
    if (!url) continue;
    out.push({
      id: asStr(o.id) || `cmp-${randomUUID().slice(0, 8)}`,
      url,
      pastedTitle: asStr(o.pastedTitle),
      pastedPrice: asStr(o.pastedPrice),
      pastedBullets: asStr(o.pastedBullets),
      pastedDescription: asStr(o.pastedDescription),
    });
  }
  return out;
}

function applyDraftFields(draft: ListingDraft, body: Record<string, unknown>) {
  if ("notes" in body) draft.notes = asStr(body.notes);
  if ("ourPrice" in body) draft.ourPrice = asStr(body.ourPrice);
  if ("brandEn" in body) draft.brandEn = asStr(body.brandEn);
  if ("brandAr" in body) draft.brandAr = asStr(body.brandAr);
  if ("gtin" in body) draft.gtin = asStr(body.gtin);
  if ("numberOfPieces" in body) draft.numberOfPieces = asStr(body.numberOfPieces);
  if ("sizeUnit" in body) draft.sizeUnit = asStr(body.sizeUnit);
  if ("fulltypeHint" in body) draft.fulltypeHint = asStr(body.fulltypeHint);
  if ("reviewNote" in body) draft.reviewNote = asStr(body.reviewNote);
  if ("competitors" in body) draft.competitors = parseCompetitors(body.competitors);
  if (draft.ours.content && ("gtin" in body || "brandEn" in body || "brandAr" in body)) {
    draft.ours.content = enforceGtinFromUser(
      {
        ...draft.ours.content,
        brandEn: draft.brandEn || draft.ours.content.brandEn,
        brandAr: draft.brandAr || draft.ours.content.brandAr,
      },
      draft.gtin,
    );
  }
}

function patchContent(raw: unknown): OursNoonContent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const bulletsEn = Array.isArray(o.featureBulletsEn)
    ? o.featureBulletsEn.map((x) => asStr(x)).filter(Boolean).slice(0, 8)
    : [];
  const bulletsAr = Array.isArray(o.featureBulletsAr)
    ? o.featureBulletsAr.map((x) => asStr(x)).slice(0, bulletsEn.length || 8)
    : [];
  while (bulletsAr.length < bulletsEn.length) bulletsAr.push("");
  return {
    titleEn: asStr(o.titleEn).slice(0, 200),
    titleAr: asStr(o.titleAr).slice(0, 200),
    fulltype: asStr(o.fulltype).slice(0, 160),
    brandEn: asStr(o.brandEn).slice(0, 80),
    brandAr: asStr(o.brandAr).slice(0, 80),
    longDescriptionEn: toPlainLongDescription(asStr(o.longDescriptionEn)).slice(0, 4000),
    longDescriptionAr: toPlainLongDescription(asStr(o.longDescriptionAr)).slice(0, 4000),
    numberOfPieces: asStr(o.numberOfPieces).slice(0, 20),
    sizeUnit: asStr(o.sizeUnit).slice(0, 40),
    featureBulletsEn: bulletsEn,
    featureBulletsAr: bulletsAr.slice(0, bulletsEn.length),
    gtin: asStr(o.gtin).slice(0, 32),
  };
}

function mergeCaptureIntoDraft(draft: ListingDraft, capture: CompetitorCapture) {
  const matchIdx = draft.competitors.findIndex(
    (c) => c.url && capture.url && c.url.split("?")[0] === capture.url.split("?")[0],
  );
  const row: CompetitorInput = {
    id:
      matchIdx >= 0
        ? draft.competitors[matchIdx]!.id
        : `cmp-${randomUUID().slice(0, 8)}`,
    url: capture.url,
    pastedTitle: capture.pastedTitle,
    pastedPrice: capture.pastedPrice,
    pastedBullets: capture.pastedBullets,
    pastedDescription: capture.pastedDescription,
  };
  if (matchIdx >= 0) {
    draft.competitors[matchIdx] = row;
  } else if (
    draft.competitors.length === 1 &&
    !draft.competitors[0]!.url &&
    !draft.competitors[0]!.pastedTitle
  ) {
    draft.competitors[0] = { ...row, id: draft.competitors[0]!.id };
  } else if (draft.competitors.length < 5) {
    draft.competitors.push(row);
  } else {
    draft.competitors[0] = row;
  }
}

export function createListingRouter(getState: () => AppState) {
  const router = Router();
  ensureListingDirs();

  // —— 原有额度 / 假任务（保留，Home 等仍用）——
  router.get("/quota", (_req, res) => {
    const { listingUsed, listingQuota } = getState().store;
    res.json({
      data: {
        used: listingUsed,
        quota: listingQuota,
        remaining: Math.max(0, listingQuota - listingUsed),
      },
    });
  });

  router.get("/tasks", (_req, res) => {
    res.json({ data: getState().listings });
  });

  router.post("/tasks", (req, res) => {
    const state = getState();
    const partnerSku = String(req.body?.partnerSku ?? "");
    const title = String(req.body?.title ?? partnerSku);
    if (!partnerSku) {
      res.status(400).json({ error: "partnerSku 必填" });
      return;
    }
    if (state.store.listingUsed >= state.store.listingQuota) {
      res.status(409).json({ error: "本月上架额度已用尽" });
      return;
    }

    const task = {
      id: `list-${Date.now()}`,
      partnerSku,
      title,
      status: "queued" as const,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    state.listings.unshift(task);
    state.store.listingUsed += 1;
    saveState(state);

    setTimeout(() => {
      const latest = getState();
      const row = latest.listings.find((t) => t.id === task.id);
      if (!row) return;
      row.status = "success";
      row.finishedAt = new Date().toISOString();
      saveState(latest);
    }, 800);

    res.json({ data: task });
  });

  // —— AI Listing 草稿 ——
  router.get("/drafts", (_req, res) => {
    res.json({ data: listDraftSummaries() });
  });

  router.post("/drafts", (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const draft = createEmptyDraft();
    applyDraftFields(draft, body);
    if (!draft.competitors.length) {
      draft.competitors = [
        {
          id: `cmp-${randomUUID().slice(0, 8)}`,
          url: "",
          pastedTitle: "",
          pastedPrice: "",
          pastedBullets: "",
          pastedDescription: "",
        },
      ];
    }
    saveDraft(draft);
    res.json({ data: draft });
  });

  router.get("/drafts/:id", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    res.json({ data: draft });
  });

  router.patch("/drafts/:id", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    applyDraftFields(draft, (req.body || {}) as Record<string, unknown>);
    draft.lastError = null;
    saveDraft(draft);
    res.json({ data: draft });
  });

  router.delete("/drafts/:id", (req, res) => {
    const id = String(req.params.id);
    if (!deleteDraft(id)) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    res.json({ data: { id, deleted: true } });
  });

  /** 扩展：对手 PDP 采集 inbox（不混入本品）；按登录用户 / 扩展填写的用户名写入对应工作区 */
  router.post("/competitor-capture", (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const url = asStr(body.url || body.pageUrl);
    if (!url) {
      res.status(400).json({ error: "url 必填" });
      return;
    }
    const bulletsRaw = body.pastedBullets ?? body.bullets;
    let pastedBullets = "";
    if (Array.isArray(bulletsRaw)) {
      pastedBullets = bulletsRaw.map((x) => asStr(x)).filter(Boolean).join("\n");
    } else {
      pastedBullets = asStr(bulletsRaw);
    }

    const capturePayload = {
      url,
      pastedTitle: asStr(body.pastedTitle ?? body.title),
      pastedPrice: asStr(body.pastedPrice ?? body.price),
      pastedBullets,
      pastedDescription: asStr(body.pastedDescription ?? body.description),
      brand: asStr(body.brand) || undefined,
      source: "extension" as const,
      capturedAt: new Date().toISOString(),
      pageUrl: asStr(body.pageUrl) || url,
    };

    try {
      const capture = runCompetitorCaptureForRequester(req, body, () =>
        saveCompetitorCapture(capturePayload),
      );
      res.json({
        data: capture,
        message: "已写入对手采集 inbox（请回 Listing 点「导入扩展采集」）",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = /未登录|用户名|停用|不存在/.test(msg) ? 401 : 400;
      res.status(code).json({ error: msg });
    }
  });

  router.get("/competitor-capture/latest", (_req, res) => {
    const latest = loadLatestCompetitorCapture();
    if (!latest) {
      res.status(404).json({ error: "尚无扩展采集记录" });
      return;
    }
    res.json({ data: latest });
  });

  /** 兼容旧路径；新码请用 GET /api/extensions/listing.zip */
  router.get("/extension.zip", (_req, res) => {
    try {
      const pack = buildBrowserExtensionZip("listing");
      if (!pack) {
        res.status(404).json({ error: "扩展目录不存在（apps/listing-extension）" });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${pack.filename}"`,
      );
      res.setHeader("X-Outpost-Extension-Version", pack.version);
      res.send(pack.zip);
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** 把最近一次扩展采集合并进草稿的 competitors */
  router.post("/drafts/:id/import-competitor-capture", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const latest = loadLatestCompetitorCapture();
    if (!latest) {
      res.status(404).json({ error: "尚无扩展采集记录，请先在 Noon 商品页用 Listing 扩展采集" });
      return;
    }
    mergeCaptureIntoDraft(draft, latest);
    saveDraft(draft);
    res.json({ data: draft, message: "已导入对手采集" });
  });

  /** 整段粘贴 → 结构化对手字段（文本 LLM） */
  router.post("/drafts/:id/normalize-competitor-paste", async (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const competitorId = asStr(req.body?.competitorId);
    const rawText = asStr(req.body?.rawText);
    const idx = competitorId
      ? draft.competitors.findIndex((c) => c.id === competitorId)
      : 0;
    if (idx < 0 || !draft.competitors[idx]) {
      res.status(400).json({ error: "对手条目不存在" });
      return;
    }
    try {
      const norm = await normalizeCompetitorPaste({
        url: draft.competitors[idx]!.url,
        rawText:
          rawText ||
          [
            draft.competitors[idx]!.pastedTitle,
            draft.competitors[idx]!.pastedPrice,
            draft.competitors[idx]!.pastedBullets,
            draft.competitors[idx]!.pastedDescription,
          ]
            .filter(Boolean)
            .join("\n"),
      });
      draft.competitors[idx] = {
        ...draft.competitors[idx]!,
        pastedTitle: norm.pastedTitle || draft.competitors[idx]!.pastedTitle,
        pastedPrice: norm.pastedPrice || draft.competitors[idx]!.pastedPrice,
        pastedBullets: norm.pastedBullets || draft.competitors[idx]!.pastedBullets,
        pastedDescription:
          norm.pastedDescription || draft.competitors[idx]!.pastedDescription,
      };
      if (norm.brand && !draft.brandEn) {
        // 不自动写成我方品牌；仅当备注空时塞进 notes 提示
        if (!draft.notes.includes(norm.brand)) {
          draft.notes = [draft.notes, `对手品牌参考：${norm.brand}`]
            .filter(Boolean)
            .join("\n");
        }
      }
      saveDraft(draft);
      res.json({ data: draft, meta: { brand: norm.brand } });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/drafts/:id/images", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const filename = asStr(req.body?.filename) || "image.jpg";
    const mimeType = asStr(req.body?.mimeType) || "image/jpeg";
    const base64 = asStr(req.body?.base64).replace(/^data:[^;]+;base64,/, "");
    if (!base64) {
      res.status(400).json({ error: "base64 必填" });
      return;
    }
    if (draft.ours.images.length >= 8) {
      res.status(400).json({ error: "最多 8 张本品图" });
      return;
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(base64, "base64");
    } catch {
      res.status(400).json({ error: "base64 无效" });
      return;
    }
    if (buf.length > 8 * 1024 * 1024) {
      res.status(400).json({ error: "单张图片不超过 8MB" });
      return;
    }

    const imgDir = draftImagesDir(draft.id);
    if (!existsSync(imgDir)) mkdirSync(imgDir, { recursive: true });
    const id = `img-${randomUUID().slice(0, 8)}`;
    const safeName = filename.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 80) || "image.jpg";
    const diskName = `${id}-${safeName}`;
    writeFileSync(join(imgDir, diskName), buf);
    const relativePath = join("drafts", draft.id, "images", diskName).replace(/\\/g, "/");
    draft.ours.images.push({
      id,
      filename: safeName,
      mimeType,
      relativePath,
      sizeBytes: buf.length,
      createdAt: new Date().toISOString(),
    });
    draft.ours.visionNotes = null;
    if (draft.status === "vision_done" || draft.status === "analyzed" || draft.status === "generated") {
      draft.status = "draft";
    }
    saveDraft(draft);
    res.json({ data: draft });
  });

  router.delete("/drafts/:id/images/:imageId", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const imageId = String(req.params.imageId);
    const img = draft.ours.images.find((x) => x.id === imageId);
    if (!img) {
      res.status(404).json({ error: "图片不存在" });
      return;
    }
    deleteDraftImageFile(img.relativePath);
    draft.ours.images = draft.ours.images.filter((x) => x.id !== imageId);
    draft.ours.visionNotes = null;
    saveDraft(draft);
    res.json({ data: draft });
  });

  router.get("/drafts/:id/images/:imageId/file", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const img = draft.ours.images.find((x) => x.id === String(req.params.imageId));
    if (!img) {
      res.status(404).json({ error: "图片不存在" });
      return;
    }
    const abs = join(listingPaths().root, img.relativePath);
    if (!existsSync(abs)) {
      res.status(404).json({ error: "文件缺失" });
      return;
    }
    res.setHeader("Content-Type", img.mimeType || "application/octet-stream");
    res.sendFile(abs);
  });

  router.post("/drafts/:id/vision", async (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    try {
      draft.lastError = null;
      draft.ours.visionNotes = await runOursVision(draft.ours.images);
      draft.status = "vision_done";
      saveDraft(draft);
      res.json({ data: draft });
    } catch (e) {
      draft.lastError = e instanceof Error ? e.message : String(e);
      saveDraft(draft);
      res.status(500).json({ error: draft.lastError, data: draft });
    }
  });

  router.post("/drafts/:id/analyze", async (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const ready = draft.competitors.filter((c) => c.url && (c.pastedTitle || c.pastedBullets || c.pastedDescription));
    if (!ready.length) {
      res.status(400).json({
        error: "请填写对手链接，并粘贴标题/卖点/描述中至少一项",
      });
      return;
    }
    try {
      draft.lastError = null;
      const result = await runCompetitorOursAnalysis({
        competitors: ready,
        visionNotes: draft.ours.visionNotes,
        notes: draft.notes,
        ourPrice: draft.ourPrice,
        brandEn: draft.brandEn,
      });
      draft.competitorNormalized = result.competitorNormalized;
      draft.analysis = result.analysis;
      draft.status = "analyzed";
      saveDraft(draft);
      res.json({ data: draft });
    } catch (e) {
      draft.lastError = e instanceof Error ? e.message : String(e);
      saveDraft(draft);
      res.status(500).json({ error: draft.lastError, data: draft });
    }
  });

  router.post("/drafts/:id/generate", async (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    if (!draft.ours.images.length) {
      res.status(400).json({ error: "请先上传本品图片" });
      return;
    }

    const modeRaw = asStr(req.body?.mode);
    const forceOursOnly = modeRaw === "ours_only";
    const selectedIds = Array.isArray(req.body?.selectedEdgeIds)
      ? (req.body.selectedEdgeIds as unknown[]).map((x) => String(x))
      : null;

    try {
      draft.lastError = null;

      // 无视觉结论时先看图（凭本品生成的前提）
      if (!draft.ours.visionNotes) {
        draft.ours.visionNotes = await runOursVision(draft.ours.images);
        if (draft.status === "draft") draft.status = "vision_done";
        saveDraft(draft);
      }

      if (draft.analysis && selectedIds) {
        for (const edge of draft.analysis.ourEdges) {
          edge.selected = selectedIds.includes(edge.id);
        }
      }

      const selectedEdges = draft.analysis
        ? draft.analysis.ourEdges.filter((e) => e.selected)
        : [];

      const useEdges = !forceOursOnly && selectedEdges.length > 0;
      if (!forceOursOnly && draft.analysis && !selectedEdges.length) {
        // 有对标结果但未勾选 → 仍允许凭本品图生成（不卡死）
      }
      if (useEdges === false && !draft.ours.visionNotes) {
        res.status(400).json({ error: "未能从本品图片提取卖点，请重试「只分析本品图片」" });
        return;
      }

      const competitorReference = useEdges
        ? draft.competitors.map((c) => {
            const n = draft.competitorNormalized[c.id];
            const pts = draft.analysis?.competitorPoints.find(
              (p) => p.competitorId === c.id,
            );
            return {
              id: c.id,
              title: n?.title || c.pastedTitle,
              strengths: n?.strengths || pts?.strengths || [],
              points: pts?.points || n?.bullets || [],
            };
          })
        : [];

      const result = await runOursListingGenerate({
        visionNotes: draft.ours.visionNotes,
        analysis: useEdges ? draft.analysis : null,
        selectedEdges: useEdges ? selectedEdges : [],
        notes: draft.notes,
        ourPrice: draft.ourPrice,
        brandEn: draft.brandEn,
        brandAr: draft.brandAr,
        gtin: draft.gtin,
        numberOfPieces: draft.numberOfPieces,
        sizeUnit: draft.sizeUnit,
        fulltypeHint: draft.fulltypeHint,
        competitorReference,
        mode: useEdges ? "from_edges" : "ours_only",
      });
      draft.ours.content = result.content;
      draft.ours.brandSuggestion = result.brandSuggestion;
      draft.guardrails = result.guardrails;
      draft.status = result.guardrails.ok ? "ready_review" : "generated";
      saveDraft(draft);
      res.json({
        data: draft,
        meta: { model: result.model, mode: useEdges ? "from_edges" : "ours_only" },
      });
    } catch (e) {
      draft.lastError = e instanceof Error ? e.message : String(e);
      saveDraft(draft);
      res.status(500).json({ error: draft.lastError, data: draft });
    }
  });

  router.patch("/drafts/:id/content", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const content = patchContent(req.body?.content ?? req.body);
    if (!content) {
      res.status(400).json({ error: "content 无效" });
      return;
    }
    // GTIN：只允许用户草稿字段或显式同值，禁止凭空出现新码
    if (content.gtin && !draft.gtin) {
      draft.gtin = content.gtin;
    }
    content.gtin = draft.gtin || content.gtin;
    draft.ours.content = content;
    if (content.brandEn) draft.brandEn = content.brandEn;
    if (content.brandAr) draft.brandAr = content.brandAr;
    draft.guardrails = runContentGuardrails(content, { gtinFromUser: draft.gtin });
    draft.status = draft.guardrails.ok ? "ready_review" : "generated";
    saveDraft(draft);
    res.json({ data: draft });
  });

  router.post("/drafts/:id/edges", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft?.analysis) {
      res.status(400).json({ error: "尚无分析结果" });
      return;
    }
    const selectedIds = new Set(
      Array.isArray(req.body?.selectedEdgeIds)
        ? (req.body.selectedEdgeIds as unknown[]).map((x) => String(x))
        : [],
    );
    for (const edge of draft.analysis.ourEdges) {
      edge.selected = selectedIds.has(edge.id);
    }
    saveDraft(draft);
    res.json({ data: draft });
  });

  router.post("/drafts/:id/verify-ar", async (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const fromBody = patchContent(req.body?.content);
    const content = fromBody ?? draft.ours.content;
    if (!content) {
      res.status(400).json({ error: "尚无 Listing 内容" });
      return;
    }
    try {
      const result = await verifyArabicListing({
        content,
        sourceText: asStr(req.body?.sourceText),
        gtinFromUser: draft.gtin,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ data: result.data });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "阿语校验失败",
      });
    }
  });

  router.post("/drafts/:id/approve", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    if (!draft.ours.content) {
      res.status(400).json({ error: "尚无 Listing 内容" });
      return;
    }
    draft.reviewNote = asStr(req.body?.reviewNote) || draft.reviewNote;
    draft.status = "approved";
    saveDraft(draft);
    res.json({ data: draft });
  });

  router.post("/drafts/:id/reject", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    draft.reviewNote = asStr(req.body?.reviewNote) || draft.reviewNote;
    draft.status = "rejected";
    saveDraft(draft);
    res.json({ data: draft });
  });

  // —— Listing 宣传图（Cursor） ——
  router.patch("/drafts/:id/promo/brief", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const skuRaw =
        body.skuLock && typeof body.skuLock === "object"
          ? (body.skuLock as Record<string, unknown>)
          : {};
      const sellingPoints = Array.isArray(body.sellingPoints)
        ? body.sellingPoints.map((x) => asStr(x)).filter(Boolean).slice(0, 8)
        : undefined;
      const draft = patchPromoBrief(String(req.params.id), {
        platform: "platform" in body ? asStr(body.platform) : undefined,
        language: "language" in body ? asStr(body.language) : undefined,
        frameCount:
          "frameCount" in body
            ? Math.min(9, Math.max(1, Number(body.frameCount) || 9))
            : undefined,
        aspectRatio: "aspectRatio" in body ? asStr(body.aspectRatio) : undefined,
        productName: "productName" in body ? asStr(body.productName) : undefined,
        sellingPoints,
        extraNotes: "extraNotes" in body ? asStr(body.extraNotes) : undefined,
        skuLock: {
          colorOnly: "colorOnly" in skuRaw ? asStr(skuRaw.colorOnly) : undefined,
          forbidColors:
            "forbidColors" in skuRaw ? asStr(skuRaw.forbidColors) : undefined,
          specOnly: "specOnly" in skuRaw ? asStr(skuRaw.specOnly) : undefined,
          forbidSpecs:
            "forbidSpecs" in skuRaw ? asStr(skuRaw.forbidSpecs) : undefined,
          sizeFit: "sizeFit" in skuRaw ? asStr(skuRaw.sizeFit) : undefined,
          effectNumber:
            "effectNumber" in skuRaw ? asStr(skuRaw.effectNumber) : undefined,
        } as never,
      });
      if (!draft) {
        res.status(404).json({ error: "草稿不存在" });
        return;
      }
      res.json({ data: draft });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/drafts/:id/promo/jobs", (req, res) => {
    try {
      const browserOnLocalhost = Boolean(req.body?.browserOnLocalhost);
      const created = createPromoJob(String(req.params.id), {
        browserOnLocalhost,
      });
      if (!created) {
        res.status(404).json({ error: "草稿不存在" });
        return;
      }
      res.status(202).json({
        data: created.draft,
        meta: {
          jobId: created.job.id,
          browserOnLocalhost,
        },
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/drafts/:id/promo/jobs/:jobId", (req, res) => {
    const got = getPromoJob(String(req.params.id), String(req.params.jobId));
    if (!got) {
      res.status(404).json({ error: "任务不存在" });
      return;
    }
    res.json({ data: got.job, meta: { draftId: got.draft.id } });
  });

  router.post("/drafts/:id/promo/jobs/:jobId/ingest", (req, res) => {
    try {
      const draft = ingestPromoJob(String(req.params.id), String(req.params.jobId));
      if (!draft) {
        res.status(404).json({ error: "任务不存在" });
        return;
      }
      const job = draft.promo.jobs.find((j) => j.id === String(req.params.jobId));
      res.json({ data: draft, meta: { job } });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/drafts/:id/promo/jobs/:jobId/revise", (req, res) => {
    try {
      const note = asStr(req.body?.note);
      const frameIndexes = Array.isArray(req.body?.frameIndexes)
        ? req.body.frameIndexes.map((x: unknown) => asStr(x)).filter(Boolean)
        : undefined;
      const draft = revisePromoJob(
        String(req.params.id),
        String(req.params.jobId),
        note,
        frameIndexes,
        { browserOnLocalhost: Boolean(req.body?.browserOnLocalhost) },
      );
      if (!draft) {
        res.status(404).json({ error: "任务不存在" });
        return;
      }
      res.status(202).json({ data: draft });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/drafts/:id/promo/jobs/:jobId/approve", (req, res) => {
    try {
      const draft = approvePromoJob(String(req.params.id), String(req.params.jobId));
      if (!draft) {
        res.status(404).json({ error: "任务不存在" });
        return;
      }
      res.json({ data: draft });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.post("/drafts/:id/promo/jobs/:jobId/open-out", (req, res) => {
    try {
      const opened = openPromoOutFolder(
        String(req.params.id),
        String(req.params.jobId),
        { browserOnLocalhost: Boolean(req.body?.browserOnLocalhost) },
      );
      res.json({ data: opened });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/drafts/:id/promo/jobs/:jobId/images/:name", (req, res) => {
    const draft = loadDraft(String(req.params.id));
    if (!draft?.promo) {
      res.status(404).json({ error: "草稿不存在" });
      return;
    }
    const jobId = String(req.params.jobId);
    const name = String(req.params.name).replace(/[/\\]/g, "");
    const job = draft.promo.jobs.find((j) => j.id === jobId);
    if (!job) {
      res.status(404).json({ error: "任务不存在" });
      return;
    }
    const img = job.images.find((x) => x.filename === name);
    const abs = img
      ? join(listingPaths().root, img.relativePath)
      : join(promoJobOutDir(draft.id, jobId), name);
    if (!existsSync(abs)) {
      res.status(404).json({ error: "文件不存在" });
      return;
    }
    const lower = name.toLowerCase();
    const ct = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.sendFile(abs);
  });

  router.get("/drafts/:id/promo/jobs/:jobId/prompt", (req, res) => {
    const draftId = String(req.params.id);
    const jobId = String(req.params.jobId);
    const p = join(promoJobDir(draftId, jobId), "prompt.md");
    if (!existsSync(p)) {
      res.status(404).json({ error: "prompt 不存在" });
      return;
    }
    res.type("text/markdown").send(readFileSync(p, "utf8"));
  });

  /** 局域网客户端：下载 prompt+refs 到本机 Cursor 出图 */
  router.get("/drafts/:id/promo/jobs/:jobId/pack.zip", (req, res) => {
    try {
      const pack = buildPromoPackZip(
        String(req.params.id),
        String(req.params.jobId),
      );
      if (!pack) {
        res.status(404).json({ error: "任务包不存在（请先点生成宣传图）" });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${pack.filename}"`,
      );
      res.send(pack.zip);
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** 局域网客户端：本机出图后回传成品到服务器 out/ */
  router.post("/drafts/:id/promo/jobs/:jobId/upload-out", (req, res) => {
    try {
      const files = Array.isArray(req.body?.files) ? req.body.files : [];
      const draft = uploadPromoOutImages(
        String(req.params.id),
        String(req.params.jobId),
        files.map((x: { filename?: unknown; base64?: unknown }) => ({
          filename: asStr(x?.filename),
          base64: asStr(x?.base64),
        })),
      );
      const job = draft.promo?.jobs.find((j) => j.id === String(req.params.jobId));
      res.json({ data: draft, meta: { job } });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // —— Listing 优化 ——
  function parseCurrentContent(raw: unknown): OptimizeCurrentContent {
    const base = emptyCurrentContent();
    if (!raw || typeof raw !== "object") return base;
    const o = raw as Record<string, unknown>;
    return {
      title: asStr(o.title),
      price: asStr(o.price),
      brand: asStr(o.brand),
      bullets: asStr(o.bullets),
      description: asStr(o.description),
    };
  }

  function applyOptimizeFields(job: OptimizeJob, body: Record<string, unknown>) {
    if ("listingUrl" in body) job.listingUrl = asStr(body.listingUrl);
    if ("partnerSku" in body) job.partnerSku = asStr(body.partnerSku);
    if ("noonSku" in body) job.noonSku = asStr(body.noonSku);
    if ("notes" in body) job.notes = asStr(body.notes);
    if ("current" in body) job.current = parseCurrentContent(body.current);
  }

  router.get("/optimize/jobs", (_req, res) => {
    res.json({ data: listOptimizeSummaries() });
  });

  router.post("/optimize/jobs", (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const job = createEmptyOptimizeJob();
    applyOptimizeFields(job, body);
    if (!job.partnerSku && job.listingUrl) {
      job.partnerSku = guessSkuFromListingUrl(job.listingUrl);
    }
    saveOptimizeJob(job);
    res.json({ data: job });
  });

  router.get("/optimize/jobs/:id", (req, res) => {
    const job = loadOptimizeJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "优化任务不存在" });
      return;
    }
    res.json({ data: job });
  });

  router.patch("/optimize/jobs/:id", (req, res) => {
    const job = loadOptimizeJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "优化任务不存在" });
      return;
    }
    applyOptimizeFields(job, (req.body || {}) as Record<string, unknown>);
    job.lastError = null;
    saveOptimizeJob(job);
    res.json({ data: job });
  });

  router.delete("/optimize/jobs/:id", (req, res) => {
    const id = String(req.params.id);
    if (!deleteOptimizeJob(id)) {
      res.status(404).json({ error: "优化任务不存在" });
      return;
    }
    res.json({ data: { id, deleted: true } });
  });

  /** 从已同步导出表清洗绩效；可选 metricsCsv 覆盖广告窗口 */
  router.post("/optimize/jobs/:id/bind-metrics", (req, res) => {
    const job = loadOptimizeJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "优化任务不存在" });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    applyOptimizeFields(job, body);
    if (!job.partnerSku && job.listingUrl) {
      job.partnerSku = guessSkuFromListingUrl(job.listingUrl);
    }
    if (!job.partnerSku && !job.noonSku) {
      res.status(400).json({ error: "请填写 partnerSku / noonSku，或提供可解析的 Listing 链接" });
      return;
    }
    try {
      let metrics = cleanListingPerfFromState({
        state: getState(),
        partnerSku: job.partnerSku,
        noonSku: job.noonSku,
      });
      const csv = asStr(body.metricsCsv);
      if (csv) metrics = applyCsvOverrideToBundle(metrics, csv);
      if (metrics.partnerSku && !job.partnerSku) job.partnerSku = metrics.partnerSku;
      if (metrics.noonSku && !job.noonSku) job.noonSku = metrics.noonSku;
      if (!job.current.title && metrics.catalogTitle) {
        job.current.title = metrics.catalogTitle;
      }
      if (!job.current.price && metrics.price != null) {
        job.current.price = String(metrics.price);
      }
      job.metrics = metrics;
      job.status = "metrics_ready";
      job.lastError = null;
      saveOptimizeJob(job);
      res.json({ data: job });
    } catch (e) {
      job.lastError = e instanceof Error ? e.message : "绩效清洗失败";
      saveOptimizeJob(job);
      res.status(500).json({ error: job.lastError });
    }
  });

  router.post("/optimize/jobs/:id/analyze", async (req, res) => {
    const job = loadOptimizeJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "优化任务不存在" });
      return;
    }
    if (!job.metrics) {
      res.status(400).json({ error: "请先绑定绩效数据" });
      return;
    }
    if (!job.current.title && !job.current.bullets && !job.current.description) {
      res.status(400).json({ error: "请粘贴现有 Listing 标题或卖点/描述" });
      return;
    }
    try {
      job.diagnosis = await runOptimizeDiagnose({
        current: job.current,
        metrics: job.metrics,
        notes: job.notes,
      });
      job.status = "analyzed";
      job.lastError = null;
      saveOptimizeJob(job);
      res.json({ data: job });
    } catch (e) {
      job.lastError = e instanceof Error ? e.message : "诊断失败";
      saveOptimizeJob(job);
      res.status(500).json({ error: job.lastError });
    }
  });

  router.post("/optimize/jobs/:id/rewrite", async (req, res) => {
    const job = loadOptimizeJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "优化任务不存在" });
      return;
    }
    if (!job.metrics) {
      res.status(400).json({ error: "请先绑定绩效数据" });
      return;
    }
    if (!job.diagnosis) {
      res.status(400).json({ error: "请先完成诊断分析" });
      return;
    }
    try {
      const { content, guardrails } = await runOptimizeRewrite({
        current: job.current,
        metrics: job.metrics,
        diagnosis: job.diagnosis,
        notes: job.notes,
        brandEn: job.current.brand,
      });
      if (!guardrails.ok && guardrails.blockers.length) {
        res.status(422).json({
          error: guardrails.blockers.join("；"),
          data: { guardrails },
        });
        return;
      }
      job.optimized = content;
      job.status = "rewritten";
      job.lastError = null;
      saveOptimizeJob(job);
      res.json({ data: job, meta: { guardrails } });
    } catch (e) {
      job.lastError = e instanceof Error ? e.message : "改写失败";
      saveOptimizeJob(job);
      res.status(500).json({ error: job.lastError });
    }
  });

  return router;
}
