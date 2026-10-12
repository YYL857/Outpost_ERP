/**
 * 日报简报 HTTP API：拉表 → 规范化 → LLM → 飞书卡片推送
 * 推送固定 interactive 卡片（彩色分区），不提供阉割版 text 作为默认。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { Router } from "express";
import { requireAdmin } from "../../auth/middleware.js";
import {
  buildDailyBriefCard,
  dailyDeepseekConfig,
  formatFeishuError,
  isFeishuError,
  loadDailyBriefFiltered,
  loadFeishuDocsConfig,
  normalizeDailyBriefRun,
  pullFeishuRaw,
  sendFeishuInteractiveMessage,
  summarizeDailyBriefFromFile,
  type DailyBriefLlmJudgment,
} from "../../platforms/feishu/index.js";
import {
  deleteRecipient,
  loadRecipients,
  recipientsFilePath,
  resolvePushTargets,
  upsertRecipient,
} from "./recipients.js";

const DEFAULT_CHAT =
  process.env.OUTPOST_FEISHU_DAILY_CHAT_ID?.trim() ||
  "oc_786937f01598e95bf278dd22cd7b4f7f";

type LastBriefMeta = {
  runId?: string;
  sourceRawRunId?: string;
  builtAt?: string;
  briefPath?: string;
  filteredPath?: string;
  rejectsPath?: string;
  manifestPath?: string;
  currentSheet?: string;
  previousSheet?: string | null;
  currentAccepted?: number;
  previousAccepted?: number;
  watchlistKept?: number;
  deltaCounts?: Record<string, number>;
};

function readLastBriefDirect(): LastBriefMeta | null {
  try {
    const fromEnv = process.env.OUTPOST_FEISHU_NORMALIZED_DIR?.trim();
    const root = fromEnv
      ? fromEnv
      : join(process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data", "feishu-normalized");
    const p = join(root, "last-daily-brief.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as LastBriefMeta;
  } catch {
    return null;
  }
}

function loadSummaryJudgment(filteredPath: string): {
  judgment: DailyBriefLlmJudgment | null;
  summaryPath: string | null;
  markdownPath: string | null;
} {
  const dir = dirname(filteredPath);
  const summaryPath = join(dir, "daily_brief_summary.json");
  const markdownPath = join(dir, "daily_brief_summary.md");
  if (!existsSync(summaryPath)) {
    return {
      judgment: null,
      summaryPath: null,
      markdownPath: existsSync(markdownPath) ? markdownPath : null,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(summaryPath, "utf8")) as {
      judgment?: DailyBriefLlmJudgment;
    };
    return {
      judgment: raw.judgment ?? null,
      summaryPath,
      markdownPath: existsSync(markdownPath) ? markdownPath : null,
    };
  } catch {
    return { judgment: null, summaryPath, markdownPath: null };
  }
}

function feishuErr(res: import("express").Response, e: unknown) {
  if (isFeishuError(e)) {
    return res.status(400).json({ error: e.message, detail: e.toJSON() });
  }
  return res.status(500).json({
    error: e instanceof Error ? e.message : String(e),
    detail: JSON.parse(formatFeishuError(e)),
  });
}

export function createDailyBriefRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get("/status", (_req, res) => {
    const last = readLastBriefDirect();
    const ds = dailyDeepseekConfig();
    const recipientsFile = loadRecipients();
    let judgmentPreview: DailyBriefLlmJudgment | null = null;
    let summaryPath: string | null = null;
    if (last?.filteredPath && existsSync(last.filteredPath)) {
      const s = loadSummaryJudgment(last.filteredPath);
      judgmentPreview = s.judgment;
      summaryPath = s.summaryPath;
    }
    const defaultTarget =
      recipientsFile.recipients.find((r) => r.enabled) ??
      recipientsFile.recipients[0] ??
      null;
    res.json({
      data: {
        defaultChatId: defaultTarget?.chatId ?? DEFAULT_CHAT,
        defaultRecipientId: defaultTarget?.id ?? null,
        pushFormat: "card" as const,
        deepseekConfigured: Boolean(ds.apiKey),
        deepseekModel: ds.model,
        recipientsPath: recipientsFilePath(),
        recipients: recipientsFile.recipients,
        last,
        summaryPath,
        judgmentPreview: judgmentPreview
          ? {
              headline: judgmentPreview.headline,
              confidence: judgmentPreview.confidence,
              highlights: judgmentPreview.highlights.length,
              risks: judgmentPreview.risks.length,
              actions: judgmentPreview.actions.length,
              caveats: judgmentPreview.caveats.length,
            }
          : null,
      },
    });
  });

  router.get("/recipients", (_req, res) => {
    const file = loadRecipients();
    res.json({
      data: {
        path: recipientsFilePath(),
        updatedAt: file.updatedAt,
        recipients: file.recipients,
      },
    });
  });

  router.post("/recipients", (req, res) => {
    try {
      const remark = String(req.body?.remark ?? "");
      const chatId = String(req.body?.chatId ?? "");
      const enabled =
        req.body?.enabled === undefined ? true : Boolean(req.body.enabled);
      const row = upsertRecipient({ remark, chatId, enabled });
      res.json({ data: row, message: `已添加「${row.remark}」` });
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.put("/recipients/:id", (req, res) => {
    try {
      const row = upsertRecipient({
        id: req.params.id,
        remark: String(req.body?.remark ?? ""),
        chatId: String(req.body?.chatId ?? ""),
        enabled:
          req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      });
      res.json({ data: row, message: `已更新「${row.remark}」` });
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.delete("/recipients/:id", (req, res) => {
    const ok = deleteRecipient(req.params.id);
    if (!ok) return res.status(404).json({ error: "接收人不存在" });
    res.json({ data: { removed: true }, message: "已删除" });
  });

  /** 拉取日报 raw（仅 daily）并规范化 + 规则精筛 */
  router.post("/normalize", async (req, res) => {
    try {
      const skipPull = req.body?.skipPull === true;
      const rawRunId =
        typeof req.body?.rawRunId === "string" && req.body.rawRunId.trim()
          ? req.body.rawRunId.trim()
          : undefined;

      let pulledRunId: string | undefined;
      if (!skipPull) {
        const cfg = loadFeishuDocsConfig({ requireCredentials: true });
        const manifest = await pullFeishuRaw(cfg, { docIds: ["daily"] });
        const daily = manifest.results.find((r) => r.docId === "daily");
        if (!daily?.ok) {
          return res.status(400).json({
            error: daily?.error?.message ?? "拉取日报失败",
            detail: daily?.error ?? null,
            runId: manifest.runId,
          });
        }
        pulledRunId = manifest.runId;
      }

      const result = normalizeDailyBriefRun({
        rawRunId: rawRunId ?? pulledRunId ?? "last",
      });
      res.json({
        data: {
          pulledRunId: pulledRunId ?? null,
          runId: result.runId,
          sourceRawRunId: result.sourceRawRunId,
          briefPath: result.briefPath,
          filteredPath: result.filteredPath,
          currentSheet: result.brief.current.meta.title,
          previousSheet: result.brief.previous?.meta.title ?? null,
          currentAccepted: result.brief.current.accepted,
          watchlistKept: result.filtered.watchlist.length,
          deltaCounts: result.filtered.deltaCounts,
        },
        message: `已规范化 ${result.brief.current.meta.title}${
          result.brief.previous
            ? ` vs ${result.brief.previous.meta.title}`
            : ""
        }，watchlist=${result.filtered.watchlist.length}`,
      });
    } catch (e) {
      return feishuErr(res, e);
    }
  });

  /** LLM 总结（读 last filtered） */
  router.post("/summarize", async (req, res) => {
    try {
      const filteredPath =
        typeof req.body?.filteredPath === "string" && req.body.filteredPath.trim()
          ? req.body.filteredPath.trim()
          : "last";
      const result = await summarizeDailyBriefFromFile({ filteredPath });
      res.json({
        data: {
          model: result.model,
          filteredPath: result.filteredPath,
          judgmentPath: result.outPaths.judgmentPath,
          markdownPath: result.outPaths.markdownPath,
          confidence: result.judgment.confidence,
          headline: result.judgment.headline,
          highlights: result.judgment.highlights.length,
          risks: result.judgment.risks.length,
          actions: result.judgment.actions.length,
          clampNotes: result.clampNotes,
        },
        message: result.judgment.headline,
      });
    } catch (e) {
      return feishuErr(res, e);
    }
  });

  /** 推送：固定彩色卡片；可按接收人 id 列表或 chatId */
  router.post("/push", async (req, res) => {
    try {
      const recipientIds = Array.isArray(req.body?.recipientIds)
        ? req.body.recipientIds.map((x: unknown) => String(x))
        : undefined;
      const chatId =
        typeof req.body?.chatId === "string" && req.body.chatId.trim()
          ? req.body.chatId.trim()
          : undefined;
      const targets = resolvePushTargets({ recipientIds, chatId });

      const last = readLastBriefDirect();
      const filteredPath =
        typeof req.body?.filteredPath === "string" && req.body.filteredPath.trim()
          ? req.body.filteredPath.trim()
          : last?.filteredPath;
      if (!filteredPath || !existsSync(filteredPath)) {
        return res.status(400).json({
          error: "找不到 daily_brief_filtered.json，请先规范化并生成简报",
        });
      }

      const summaryMeta = loadSummaryJudgment(filteredPath);
      if (!summaryMeta.judgment) {
        return res.status(400).json({
          error: "找不到 daily_brief_summary.json，请先生成简报",
        });
      }

      const filtered = loadDailyBriefFiltered(filteredPath);
      const card = buildDailyBriefCard({
        judgment: summaryMeta.judgment,
        filtered: {
          currentSheet: filtered.currentSheet,
          previousSheet: filtered.previousSheet,
          overview: filtered.overview,
          deltaCounts: filtered.deltaCounts,
        },
      });

      const cfg = loadFeishuDocsConfig({ requireCredentials: true });
      const results: Array<{
        remark: string;
        chatId: string;
        messageId: string;
        ok: boolean;
        error?: string;
      }> = [];

      for (const t of targets) {
        try {
          const receiveIdType = t.chatId.startsWith("ou_")
            ? "open_id"
            : "chat_id";
          const sent = await sendFeishuInteractiveMessage({
            credentials: cfg.credentials,
            receiveId: t.chatId,
            receiveIdType,
            card,
          });
          results.push({
            remark: t.remark,
            chatId: t.chatId,
            messageId: sent.messageId,
            ok: true,
          });
        } catch (e) {
          results.push({
            remark: t.remark,
            chatId: t.chatId,
            messageId: "",
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const okCount = results.filter((r) => r.ok).length;
      const names = results
        .filter((r) => r.ok)
        .map((r) => r.remark)
        .join("、");
      if (okCount === 0) {
        return res.status(400).json({
          error: results.map((r) => `${r.remark}: ${r.error}`).join("；") || "推送失败",
          data: { format: "card", results },
        });
      }
      res.json({
        data: {
          format: "card",
          results,
          header: `运营日报 · ${filtered.currentSheet}${
            filtered.previousSheet ? ` vs ${filtered.previousSheet}` : ""
          }`,
          headline: summaryMeta.judgment.headline,
        },
        message: `已推送卡片给 ${names}`,
      });
    } catch (e) {
      if (e instanceof Error && !isFeishuError(e)) {
        return res.status(400).json({ error: e.message });
      }
      return feishuErr(res, e);
    }
  });

  /**
   * 一键：pull → normalize → summarize → push(card)
   * body: { recipientIds?, chatId?, skipPull?, skipPush? }
   */
  router.post("/run", async (req, res) => {
    const steps: Array<{ step: string; ok: boolean; detail?: unknown }> = [];
    try {
      const skipPull = req.body?.skipPull === true;
      const skipPush = req.body?.skipPush === true;
      const recipientIds = Array.isArray(req.body?.recipientIds)
        ? req.body.recipientIds.map((x: unknown) => String(x))
        : undefined;
      const chatId =
        typeof req.body?.chatId === "string" && req.body.chatId.trim()
          ? req.body.chatId.trim()
          : undefined;

      let sourceRawRunId = "last";
      if (!skipPull) {
        const cfg = loadFeishuDocsConfig({ requireCredentials: true });
        const manifest = await pullFeishuRaw(cfg, { docIds: ["daily"] });
        const daily = manifest.results.find((r) => r.docId === "daily");
        if (!daily?.ok) {
          steps.push({ step: "pull", ok: false, detail: daily?.error });
          return res.status(400).json({
            error: daily?.error?.message ?? "拉取日报失败",
            steps,
          });
        }
        sourceRawRunId = manifest.runId;
        steps.push({ step: "pull", ok: true, detail: { runId: manifest.runId } });
      } else {
        steps.push({ step: "pull", ok: true, detail: { skipped: true } });
      }

      const norm = normalizeDailyBriefRun({ rawRunId: sourceRawRunId });
      steps.push({
        step: "normalize",
        ok: true,
        detail: {
          runId: norm.runId,
          currentSheet: norm.brief.current.meta.title,
          watchlist: norm.filtered.watchlist.length,
        },
      });

      const sum = await summarizeDailyBriefFromFile({
        filteredPath: norm.filteredPath,
      });
      steps.push({
        step: "summarize",
        ok: true,
        detail: {
          headline: sum.judgment.headline,
          confidence: sum.judgment.confidence,
        },
      });

      let pushDetail: unknown = { skipped: true };
      if (!skipPush) {
        const targets = resolvePushTargets({ recipientIds, chatId });
        const card = buildDailyBriefCard({
          judgment: sum.judgment,
          filtered: {
            currentSheet: norm.filtered.currentSheet,
            previousSheet: norm.filtered.previousSheet,
            overview: norm.filtered.overview,
            deltaCounts: norm.filtered.deltaCounts,
          },
        });
        const cfg = loadFeishuDocsConfig({ requireCredentials: true });
        const results: Array<{
          remark: string;
          chatId: string;
          messageId: string;
          ok: boolean;
          error?: string;
        }> = [];
        for (const t of targets) {
          try {
            const receiveIdType = t.chatId.startsWith("ou_")
              ? "open_id"
              : "chat_id";
            const sent = await sendFeishuInteractiveMessage({
              credentials: cfg.credentials,
              receiveId: t.chatId,
              receiveIdType,
              card,
            });
            results.push({
              remark: t.remark,
              chatId: t.chatId,
              messageId: sent.messageId,
              ok: true,
            });
          } catch (e) {
            results.push({
              remark: t.remark,
              chatId: t.chatId,
              messageId: "",
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        pushDetail = { format: "card", results };
        steps.push({ step: "push", ok: results.some((r) => r.ok), detail: pushDetail });
      } else {
        steps.push({ step: "push", ok: true, detail: pushDetail });
      }

      const pushedNames =
        pushDetail &&
        typeof pushDetail === "object" &&
        "results" in pushDetail
          ? (
              pushDetail as {
                results: Array<{ remark: string; ok: boolean }>;
              }
            ).results
              .filter((r) => r.ok)
              .map((r) => r.remark)
              .join("、")
          : "";

      res.json({
        data: {
          steps,
          headline: sum.judgment.headline,
          filteredPath: norm.filteredPath,
          judgmentPath: sum.outPaths.judgmentPath,
          push: pushDetail,
        },
        message: skipPush
          ? `简报已生成：${sum.judgment.headline}`
          : `简报已推送卡片${pushedNames ? ` → ${pushedNames}` : ""}：${sum.judgment.headline}`,
      });
    } catch (e) {
      steps.push({
        step: "error",
        ok: false,
        detail: isFeishuError(e) ? e.toJSON() : String(e),
      });
      if (isFeishuError(e)) {
        return res.status(400).json({ error: e.message, steps, detail: e.toJSON() });
      }
      return res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
        steps,
      });
    }
  });

  return router;
}
