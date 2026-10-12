/**
 * 市场情报晨报：门禁 → 模型 → 飞书卡片（默认通道关闭，可随时启用）。
 */
import { buildDigestCard } from "./card.js";
import { loadMorningDigestConfig } from "./config.js";
import { summarizeMiDigest } from "./llm.js";
import { saveLastRun, type DigestLastRun } from "./persist.js";
import { pushDigestCard, pushDigestText } from "./push.js";
import { checkMiReadiness } from "./readiness.js";
import { buildMiDigestPayload } from "./mi-payload.js";

let running = false;

export function isMiDigestRunning(): boolean {
  return running;
}

export type RunMiDigestOpts = {
  triggeredBy: "schedule" | "manual";
  force?: boolean;
  recipientIds?: string[];
  chatId?: string;
  scheduledDay?: string;
};

export async function runMiMorningDigest(
  opts: RunMiDigestOpts,
): Promise<DigestLastRun> {
  if (running) {
    return {
      channel: "market-intel",
      ok: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      message: "市场情报晨报已在执行中",
      triggeredBy: opts.triggeredBy,
      scheduledDay: opts.scheduledDay ?? null,
    };
  }

  running = true;
  const startedAt = new Date().toISOString();
  const cfg = loadMorningDigestConfig();

  try {
    const readiness = checkMiReadiness();
    if (!readiness.hardOk && !opts.force) {
      const msg = readiness.hardReasons.join("；") || "无新增情报";
      if (cfg.miNotifyEmpty) {
        try {
          await pushDigestText({
            text: `市场情报晨报：${msg}（${readiness.today}）`,
            recipientIds: opts.recipientIds,
            chatId: opts.chatId,
          });
        } catch {
          /* optional */
        }
      }
      const run: DigestLastRun = {
        channel: "market-intel",
        ok: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        message: `已跳过完整简报：${msg}`,
        triggeredBy: opts.triggeredBy,
        scheduledDay: opts.scheduledDay ?? null,
        detail: readiness,
      };
      saveLastRun(run);
      return run;
    }

    const payload = buildMiDigestPayload(
      opts.force && !readiness.hardOk
        ? {
            ...readiness,
            hardOk: true,
            hardReasons: [],
            softNotes: [
              ...readiness.softNotes,
              `强制推送：${readiness.hardReasons.join("；")}`,
            ],
          }
        : readiness,
    );

    if (
      payload.overview.freshItemCount === 0 &&
      !opts.force &&
      payload.freshTop.length === 0
    ) {
      const run: DigestLastRun = {
        channel: "market-intel",
        ok: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        message: "今日无新鲜情报条目，跳过",
        triggeredBy: opts.triggeredBy,
        scheduledDay: opts.scheduledDay ?? null,
        detail: readiness,
      };
      saveLastRun(run);
      return run;
    }

    const llm = await summarizeMiDigest(payload);
    const card = buildDigestCard({
      channel: "market-intel",
      titleDay: readiness.today,
      shopOrMarket: payload.market.toUpperCase(),
      judgment: llm.judgment,
      softNotes: payload.softNotes,
      degraded: payload.softNotes.length > 0,
    });

    const pushed = await pushDigestCard({
      card,
      recipientIds: opts.recipientIds,
      chatId: opts.chatId,
    });
    if (pushed.okCount === 0) {
      throw new Error(
        pushed.results.map((r) => `${r.remark}:${r.error}`).join("；") ||
          "飞书推送失败",
      );
    }

    const names = pushed.results
      .filter((r) => r.ok)
      .map((r) => r.remark)
      .join("、");
    const run: DigestLastRun = {
      channel: "market-intel",
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      message: `已推送市场情报晨报给 ${names}`,
      triggeredBy: opts.triggeredBy,
      scheduledDay: opts.scheduledDay ?? null,
      detail: {
        readiness,
        overview: payload.overview,
        headline: llm.judgment.headline,
        push: pushed.results,
      },
    };
    saveLastRun(run);
    return run;
  } catch (e) {
    const run: DigestLastRun = {
      channel: "market-intel",
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      message: e instanceof Error ? e.message : String(e),
      triggeredBy: opts.triggeredBy,
      scheduledDay: opts.scheduledDay ?? null,
    };
    saveLastRun(run);
    console.warn(`[morning-digest/mi] fail (no Feishu alert): ${run.message}`);
    return run;
  } finally {
    running = false;
  }
}
