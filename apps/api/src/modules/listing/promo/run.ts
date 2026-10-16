import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ListingDraft } from "../types.js";
import { loadDraft, saveDraft } from "../store.js";
import { listingPaths, promoJobDir, promoJobOutDir } from "../paths.js";
import { buildPromoPromptPack, mergeBriefFromDraft } from "./build-prompt.js";
import { ingestPromoOutDir } from "./ingest.js";
import type { PromoBrief, PromoJob } from "./types.js";
import { emptyListingPromo } from "./types.js";
import { folderHandoffDriver, promoInboxRoot } from "./drivers/folder-handoff.js";
import { cursorRpaDriver } from "./drivers/cursor-rpa.js";
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

export type PromoDispatchOpts = {
  /**
   * 浏览器是否用 localhost/127.0.0.1 打开页面。
   * false = 连的是别的电脑上的 API：禁止键鼠 RPA / 禁止在服务器开资源管理器。
   */
  browserOnLocalhost?: boolean;
};

async function dispatchHandoff(
  draftId: string,
  jobId: string,
  kind: "generate" | "revise",
  reviseNote?: string,
  frameIndexes?: string[],
  opts?: PromoDispatchOpts,
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
    job.driverMode =
      driverId === "sdk" ? "sdk" : driverId === "rpa" ? "rpa" : "folder";
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

    // —— folder 落盘（rpa 与 folder 共用）——
    const fh = await folderHandoffDriver.dispatch(payload, job);
    draft = loadDraft(draftId)!;
    job = draft.promo.jobs.find((j) => j.id === jobId)!;
    job.inboxDirAbs = join(promoInboxRoot(), jobId);
    if (fh.message) {
      writeFileSync(join(jobDir, "dispatch.txt"), fh.message + "\n", "utf8");
    }

    if (driverId === "rpa") {
      const allowRemote =
        (process.env.LISTING_PROMO_RPA_ALLOW_REMOTE || "").trim() === "1";
      const onLocalBrowser = opts?.browserOnLocalhost === true;

      if (!onLocalBrowser && !allowRemote) {
        // 别人连你的 API：绝不能在你电脑上弹 Cursor
        job.driverMode = "folder";
        job.status = "awaiting_images";
        job.error =
          "你正在通过局域网访问其它电脑上的 Outpost。键鼠出图只会在跑 API 的那台电脑执行，已禁止远程触发。" +
          "请点「下载任务包」到你自己电脑，用本机 Cursor 出图后「上传成品图」；或在本机用 localhost 打开 Outpost 再生成。";
        job.updatedAt = new Date().toISOString();
        draft = upsertJob(draft, job);
        saveDraft(draft);
        writeJobStatus(draftId, job);
        startOutPoll(draftId, jobId);
        return;
      }

      job.driverMode = "rpa";
      job.status = "running";
      job.error = null;
      job.updatedAt = new Date().toISOString();
      draft = upsertJob(draft, job);
      saveDraft(draft);
      writeJobStatus(draftId, job);

      const rpa = await cursorRpaDriver.dispatch(payload, job);
      draft = loadDraft(draftId)!;
      job = draft.promo.jobs.find((j) => j.id === jobId)!;
      job.driverMode = "rpa";
      job.status = "awaiting_images";
      if (!rpa.ok) {
        job.error = `本机唤起 Cursor 失败：${rpa.error || "未知错误"}。任务包已写好，可手动打开任务目录用 Cursor 出图，或点「扫目录回填」。`;
      } else {
        job.error = null;
        if (rpa.message) {
          writeFileSync(
            join(jobDir, "rpa-dispatch.txt"),
            rpa.message + "\n",
            "utf8",
          );
        }
      }
      job.updatedAt = new Date().toISOString();
      draft = upsertJob(draft, job);
      saveDraft(draft);
      writeJobStatus(draftId, job);
      startOutPoll(draftId, jobId);
      return;
    }

    // —— 仅 folder：投递 + 轮询（不唤起 Cursor）——
    job.driverMode = "folder";
    job.status = "awaiting_images";
    job.error = fh.ok ? null : fh.error || "投递失败";
    job.updatedAt = new Date().toISOString();
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

export function createPromoJob(
  draftId: string,
  opts?: PromoDispatchOpts,
): {
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
    throw new Error("请先填写库存锁（至少颜色或规格填一项）");
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
    driverMode: (() => {
      const d = resolvePromoDriverId();
      if (d === "sdk") return "sdk";
      if (d === "rpa") return "rpa";
      return "folder";
    })(),
  };

  draft = upsertJob(draft, job);
  saveDraft(draft);
  writeJobStatus(draftId, job);

  void dispatchHandoff(draftId, jobId, "generate", undefined, undefined, opts);
  return { draft: loadDraft(draftId)!, job };
}

export function revisePromoJob(
  draftId: string,
  jobId: string,
  note: string,
  frameIndexes?: string[],
  opts?: PromoDispatchOpts,
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

  void dispatchHandoff(
    draftId,
    jobId,
    "revise",
    note.trim(),
    frameIndexes,
    opts,
  );
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

/**
 * LAN / 非本机：把用户本机 Cursor 出的图回传到服务器 out/，再 ingest。
 */
export function uploadPromoOutImages(
  draftId: string,
  jobId: string,
  files: Array<{ filename: string; base64: string }>,
): ListingDraft {
  let draft = loadDraft(draftId);
  if (!draft) throw new Error("草稿不存在");
  draft = ensurePromo(draft);
  const job = draft.promo.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("宣传图任务不存在");
  if (!files.length) throw new Error("请至少上传一张成品图");

  const outDir = promoJobOutDir(draftId, jobId);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  let written = 0;
  for (const f of files) {
    const rawName = String(f.filename || "").replace(/[/\\]/g, "").trim();
    if (!rawName || !/\.(jpe?g|png|webp)$/i.test(rawName)) continue;
    const safe =
      rawName.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120) || "frame.jpg";
    const b64 = String(f.base64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!b64) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      continue;
    }
    if (!buf.length || buf.length > 12 * 1024 * 1024) continue;
    writeFileSync(join(outDir, safe), buf);
    written++;
  }
  if (!written) throw new Error("没有有效的图片文件（需 jpg/png/webp，单张≤12MB）");

  applyIngestToJob(draftId, job);
  if (!job.images.length) {
    job.status = "awaiting_images";
    job.error = `已写入 ${written} 张到 out/，但未能识别为宣传图文件名（请用 01-…-9x16.jpg 等）`;
  } else if (job.status !== "needs_review") {
    job.error = null;
  }
  job.updatedAt = new Date().toISOString();
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

/** 本机资源管理器打开宣传图 out 目录（仅允许该 job 的 out 路径） */
export function openPromoOutFolder(
  draftId: string,
  jobId: string,
  opts?: PromoDispatchOpts,
): { path: string; opened: boolean; hint?: string } {
  const draft = loadDraft(draftId);
  if (!draft?.promo) throw new Error("草稿不存在");
  const job = draft.promo.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("宣传图任务不存在");

  const expected = resolve(promoJobOutDir(draftId, jobId));
  const fromJob = job.outDirAbs ? resolve(job.outDirAbs) : expected;
  // 只打开本任务 out，防任意路径
  const target =
    fromJob.toLowerCase() === expected.toLowerCase() ? fromJob : expected;

  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }

  const allowRemote =
    (process.env.LISTING_PROMO_RPA_ALLOW_REMOTE || "").trim() === "1";
  const onLocalBrowser = opts?.browserOnLocalhost === true || allowRemote;

  if (!onLocalBrowser) {
    return {
      path: target,
      opened: false,
      hint:
        "当前不是本机 localhost：文件夹在跑 API 的那台电脑上，已禁止远程打开。请用「下载任务包」到本机出图，再「上传成品图」。",
    };
  }

  if (process.platform === "win32") {
    spawn("explorer.exe", [target], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
  }
  return { path: target, opened: true };
}
