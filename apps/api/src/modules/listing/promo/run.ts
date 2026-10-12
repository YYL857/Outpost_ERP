import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ListingDraft } from "../types.js";
import { loadDraft, saveDraft } from "../store.js";
import { listingPaths, promoJobDir, promoJobOutDir } from "../paths.js";
import { buildPromoPromptPack, mergeBriefFromDraft } from "./build-prompt.js";
import { ingestPromoOutDir } from "./ingest.js";
import type { PromoBrief, PromoJob } from "./types.js";
import { emptyListingPromo } from "./types.js";
import { folderHandoffDriver, promoInboxRoot } from "./drivers/folder-handoff.js";
import { resolvePromoDriverId } from "./drivers/types.js";
import { sdkOptionalDriver } from "./drivers/sdk-optional.js";

const running = new Set<string>();
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();

function ensurePromo(draft: ListingDraft): ListingDraft {
  if (!draft.promo) draft.promo = emptyListingPromo();
  return draft;
}

function writeJobStatus(draftId: string, job: PromoJob) {
  const dir = promoJobDir(draftId, job.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "status.json"),
    JSON.stringify(
      {
        id: job.id,
        status: job.status,
        updatedAt: job.updatedAt,
        driverMode: job.driverMode,
        error: job.error,
        imageCount: job.images.length,
        outDirAbs: job.outDirAbs,
        inboxDirAbs: job.inboxDirAbs,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function upsertJob(draft: ListingDraft, job: PromoJob) {
  draft = ensurePromo(draft);
  const idx = draft.promo.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) draft.promo.jobs[idx] = job;
  else draft.promo.jobs.unshift(job);
  draft.promo.activeJobId = job.id;
  return draft;
}

export function patchPromoBrief(
  draftId: string,
  patch: Partial<PromoBrief>,
): ListingDraft | null {
  let draft = loadDraft(draftId);
  if (!draft) return null;
  draft = ensurePromo(draft);
  draft.promo.brief = mergeBriefFromDraft(draft, patch);
  return saveDraft(draft);
}

function applyIngestToJob(
  draftId: string,
  job: PromoJob,
): { complete: boolean; partial: boolean } {
  const outDir = promoJobOutDir(draftId, job.id);
  // inbox/out 有图时自动拷到草稿 out（出图端写哪边都行）
  const inboxOut = job.inboxDirAbs ? join(job.inboxDirAbs, "out") : null;
  if (inboxOut && existsSync(inboxOut)) {
    try {
      for (const name of readdirSync(inboxOut)) {
        if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
        const src = join(inboxOut, name);
        const dest = join(outDir, name);
        if (!existsSync(dest)) copyFileSync(src, dest);
      }
    } catch {
      /* ignore */
    }
  }
  const { images, missing } = ingestPromoOutDir({
    draftId,
    jobId: job.id,
    outDirAbs: outDir,
    frameCount: job.brief.frameCount,
  });
  job.images = images;
  job.updatedAt = new Date().toISOString();
  if (images.length >= job.brief.frameCount) {
    job.status = "needs_review";
    job.error = null;
    return { complete: true, partial: false };
  }
  if (images.length > 0) {
    job.status = "awaiting_images";
    job.error = `已收到 ${images.length}/${job.brief.frameCount}，缺: ${missing.slice(0, 4).join(", ")}`;
    return { complete: false, partial: true };
  }
  return { complete: false, partial: false };
}

function stopPoll(key: string) {
  const t = pollTimers.get(key);
  if (t) clearInterval(t);
  pollTimers.delete(key);
}

/** 轮询 out/ 直到齐图或超时 */
function startOutPoll(draftId: string, jobId: string) {
  const key = `${draftId}:${jobId}`;
  stopPoll(key);
  const started = Date.now();
  const timeoutMs = Number(process.env.LISTING_PROMO_POLL_TIMEOUT_MS || 45 * 60 * 1000);
  const intervalMs = Number(process.env.LISTING_PROMO_POLL_MS || 4000);

  const tick = () => {
    let draft = loadDraft(draftId);
    if (!draft?.promo) {
      stopPoll(key);
      return;
    }
    const job = draft.promo.jobs.find((j) => j.id === jobId);
    if (!job) {
      stopPoll(key);
      return;
    }
    if (job.status === "approved" || job.status === "failed") {
      stopPoll(key);
      return;
    }
    const { complete } = applyIngestToJob(draftId, job);
    draft = upsertJob(draft, job);
    saveDraft(draft);
    writeJobStatus(draftId, job);
    if (complete) {
      stopPoll(key);
      return;
    }
    if (Date.now() - started > timeoutMs) {
      job.status = "awaiting_images";
      job.error =
        (job.error ? job.error + "；" : "") +
        `轮询超时（仍可继续往 out 丢图，页面会自动刷新）`;
      job.updatedAt = new Date().toISOString();
      upsertJob(draft, job);
      saveDraft(draft);
      writeJobStatus(draftId, job);
      stopPoll(key);
    }
  };

  tick();
  pollTimers.set(key, setInterval(tick, intervalMs));
}

async function dispatchHandoff(
  draftId: string,
  jobId: string,
  kind: "generate" | "revise",
  reviseNote?: string,
  frameIndexes?: string[],
) {
  const key = `${draftId}:${jobId}`;
  if (running.has(key)) return;
  running.add(key);
  try {
    let draft = loadDraft(draftId);
    if (!draft) return;
    draft = ensurePromo(draft);
    let job = draft.promo.jobs.find((j) => j.id === jobId);
    if (!job) return;

    const jobDir = promoJobDir(draftId, jobId);
    const outDir = promoJobOutDir(draftId, jobId);
    const refsDir = join(jobDir, "refs");
    mkdirSync(outDir, { recursive: true });

    const promptPath =
      kind === "revise"
        ? join(jobDir, "prompt-revise.md")
        : join(jobDir, "prompt.md");

    if (kind === "revise") {
      const prompt = buildPromoPromptPack({
        draft,
        brief: job.brief,
        outDirAbs: outDir,
        reviseNote,
        frameIndexes,
      });
      writeFileSync(promptPath, prompt, "utf8");
    }

    const driverId = resolvePromoDriverId();
    job.driverMode = driverId === "sdk" ? "sdk" : "folder";
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    job.outDirAbs = outDir;
    draft = upsertJob(draft, job);
    saveDraft(draft);
    writeJobStatus(draftId, job);

    const payload = {
      draftId,
      jobId,
      jobDirAbs: jobDir,
      outDirAbs: outDir,
      promptPathAbs: promptPath,
      refsDirAbs: refsDir,
      frameCount: job.brief.frameCount,
      aspectRatio: job.brief.aspectRatio,
      kind,
      reviseNote,
    };

    if (driverId === "sdk") {
      const r = await sdkOptionalDriver.dispatch(payload, job);
      draft = loadDraft(draftId)!;
      job = draft.promo.jobs.find((j) => j.id === jobId)!;
      if (!r.ok) {
        // SDK 失败则降级 folder，不堵全公司
        const fh = await folderHandoffDriver.dispatch(payload, job);
        job.driverMode = "folder";
        job.inboxDirAbs = join(promoInboxRoot(), jobId);
        job.status = "awaiting_images";
        job.error = `SDK 不可用已降级文件夹投递：${r.error || ""} ${fh.message || ""}`;
      } else {
        applyIngestToJob(draftId, job);
        if (job.images.length >= job.brief.frameCount) {
          job.status = "needs_review";
          job.error = null;
        } else {
          job.status = "awaiting_images";
          job.inboxDirAbs = join(promoInboxRoot(), jobId);
          await folderHandoffDriver.dispatch(payload, job);
          job.error =
            job.error ||
            "SDK 已跑但 out 未齐图，已同步投递 inbox，继续轮询 out/";
        }
      }
      job.updatedAt = new Date().toISOString();
      draft = upsertJob(draft, job);
      saveDraft(draft);
      writeJobStatus(draftId, job);
      startOutPoll(draftId, jobId);
      return;
    }

    // —— 默认：文件夹投递 + 轮询 ——
    const fh = await folderHandoffDriver.dispatch(payload, job);
    draft = loadDraft(draftId)!;
    job = draft.promo.jobs.find((j) => j.id === jobId)!;
    job.driverMode = "folder";
    job.inboxDirAbs = join(promoInboxRoot(), jobId);
    job.status = "awaiting_images";
    job.error = fh.ok
      ? null
      : fh.error || "投递失败";
    job.updatedAt = new Date().toISOString();
    // 状态说明写进 status，UI 用 inbox/out 路径
    if (fh.message) {
      writeFileSync(join(jobDir, "dispatch.txt"), fh.message + "\n", "utf8");
    }
    draft = upsertJob(draft, job);
    saveDraft(draft);
    writeJobStatus(draftId, job);
    startOutPoll(draftId, jobId);
  } catch (e) {
    const draft = loadDraft(draftId);
    if (!draft?.promo) return;
    const job = draft.promo.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.status = "failed";
    job.error = e instanceof Error ? e.message : String(e);
    job.updatedAt = new Date().toISOString();
    upsertJob(draft, job);
    saveDraft(draft);
    writeJobStatus(draftId, job);
  } finally {
    running.delete(key);
  }
}

export function createPromoJob(draftId: string): {
  draft: ListingDraft;
  job: PromoJob;
} | null {
  let draft = loadDraft(draftId);
  if (!draft) return null;
  draft = ensurePromo(draft);
  if (!draft.ours.images.length) {
    throw new Error("请先上传本品参考图");
  }
  const brief = mergeBriefFromDraft(draft);
  if (!brief.skuLock.colorOnly && !brief.skuLock.specOnly) {
    throw new Error("请先填写库存锁（至少颜色 ONLY 或规格 ONLY）");
  }

  const jobId = `promo-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const outDir = promoJobOutDir(draftId, jobId);
  const jobDir = promoJobDir(draftId, jobId);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(jobDir, "refs"), { recursive: true });

  const root = listingPaths().root;
  for (const img of draft.ours.images.slice(0, 8)) {
    const abs = join(root, img.relativePath);
    if (!existsSync(abs)) continue;
    copyFileSync(abs, join(jobDir, "refs", `${img.id}-${img.filename}`));
  }

  const prompt = buildPromoPromptPack({
    draft,
    brief,
    outDirAbs: outDir,
  });
  writeFileSync(join(jobDir, "brief.json"), JSON.stringify(brief, null, 2), "utf8");
  writeFileSync(join(jobDir, "prompt.md"), prompt, "utf8");
  writeFileSync(
    join(outDir, "README.txt"),
    [
      `${brief.productName || draftId} · ${brief.platform} 宣传图 ${brief.aspectRatio}`,
      "",
      `把成品 jpg 写入本目录（${brief.frameCount} 张，9:16）`,
      `文件名: 01-main-hero-9x16.jpg … 09-feature-summary-9x16.jpg`,
      `Inbox: ${join(promoInboxRoot(), jobId)}`,
      "",
    ].join("\n"),
    "utf8",
  );

  const now = new Date().toISOString();
  const job: PromoJob = {
    id: jobId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    brief,
    images: [],
    userFeedback: [],
    error: null,
    outDirAbs: outDir,
    inboxDirAbs: join(promoInboxRoot(), jobId),
    driverMode: resolvePromoDriverId() === "sdk" ? "sdk" : "folder",
  };

  draft = upsertJob(draft, job);
  saveDraft(draft);
  writeJobStatus(draftId, job);

  void dispatchHandoff(draftId, jobId, "generate");
  return { draft: loadDraft(draftId)!, job };
}

export function revisePromoJob(
  draftId: string,
  jobId: string,
  note: string,
  frameIndexes?: string[],
): ListingDraft | null {
  let draft = loadDraft(draftId);
  if (!draft) return null;
  draft = ensurePromo(draft);
  const job = draft.promo.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("宣传图任务不存在");
  if (!note.trim()) throw new Error("请填写修改意见");

  job.userFeedback.push({
    at: new Date().toISOString(),
    note: note.trim(),
    frameIndexes,
  });
  job.status = "queued";
  job.error = null;
  job.updatedAt = new Date().toISOString();
  draft = upsertJob(draft, job);
  saveDraft(draft);
  writeJobStatus(draftId, job);

  void dispatchHandoff(draftId, jobId, "revise", note.trim(), frameIndexes);
  return loadDraft(draftId);
}

export function approvePromoJob(draftId: string, jobId: string): ListingDraft | null {
  let draft = loadDraft(draftId);
  if (!draft) return null;
  draft = ensurePromo(draft);
  const job = draft.promo.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("宣传图任务不存在");
  applyIngestToJob(draftId, job);
  if (!job.images.length) throw new Error("输出目录还没有图片，无法通过审核");
  job.status = "approved";
  job.updatedAt = new Date().toISOString();
  job.error = null;
  draft = upsertJob(draft, job);
  saveDraft(draft);
  writeJobStatus(draftId, job);
  stopPoll(`${draftId}:${jobId}`);
  return draft;
}

export function ingestPromoJob(draftId: string, jobId: string): ListingDraft | null {
  let draft = loadDraft(draftId);
  if (!draft) return null;
  draft = ensurePromo(draft);
  const job = draft.promo.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("宣传图任务不存在");
  applyIngestToJob(draftId, job);
  if (!job.images.length && job.status === "awaiting_images") {
    job.error = "输出目录尚无图片";
  }
  draft = upsertJob(draft, job);
  saveDraft(draft);
  writeJobStatus(draftId, job);
  return draft;
}

export function getPromoJob(
  draftId: string,
  jobId: string,
): { draft: ListingDraft; job: PromoJob } | null {
  const draft = loadDraft(draftId);
  if (!draft?.promo) return null;
  const job = draft.promo.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  if (
    job.status === "running" ||
    job.status === "awaiting_images" ||
    job.status === "awaiting_manual" ||
    job.status === "needs_review" ||
    job.status === "queued"
  ) {
    const before = job.images.length;
    applyIngestToJob(draftId, job);
    if (job.images.length !== before || job.status === "needs_review") {
      upsertJob(draft, job);
      saveDraft(draft);
      writeJobStatus(draftId, job);
    }
  }
  return { draft, job };
}
