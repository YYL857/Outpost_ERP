/**
 * 店内晨报流水线：汇总同步 → 门禁（可重试）→ 模型 → 飞书卡片。
 */
import type { AppState } from "../../common/types.js";
import { getActiveShop } from "../../shops/registry.js";
import {
  isAssemblySyncRunning,
  runAssemblySync,
} from "../sync/assembly-sync.js";
import { buildDigestCard } from "./card.js";
import { loadMorningDigestConfig } from "./config.js";
import { summarizeStoreDigest } from "./llm.js";
import { saveLastRun, type DigestLastRun } from "./persist.js";
import { pushDigestCard } from "./push.js";
import { checkStoreReadiness } from "./readiness.js";
import { buildStoreDigestPayload } from "./store-payload.js";

let running = false;

export function isStoreDigestRunning(): boolean {
  return running;
}

export type RunStoreDigestOpts = {
  triggeredBy: "schedule" | "manual";
  /** 跳过汇总同步（调试） */
  skipAssembly?: boolean;
  /** 强制忽略硬门禁（仅手动排障） */
  force?: boolean;
  /** 覆盖重试次数；手动默认 0 次额外重试 */
  gateRetryMax?: number;
  recipientIds?: string[];
  chatId?: string;
  /** 墙钟消费日 */
  scheduledDay?: string;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runStoreMorningDigest(
  getState: () => AppState,
  opts: RunStoreDigestOpts,
): Promise<DigestLastRun> {
  if (running) {
    return {
      channel: "store",
      ok: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      message: "店内晨报已在执行中",
      triggeredBy: opts.triggeredBy,
      scheduledDay: opts.scheduledDay ?? null,
    };
  }

  running = true;
  const startedAt = new Date().toISOString();
  const cfg = loadMorningDigestConfig();
  const sleep = opts.sleep ?? defaultSleep;
  const retryMax =
    opts.gateRetryMax ??
    (opts.triggeredBy === "manual" ? 0 : cfg.gateRetryMax);

  try {
    if (!opts.skipAssembly) {
      if (isAssemblySyncRunning()) {
        // 等正在跑的汇总结束（最多 ~10 分钟）
        for (let i = 0; i < 60; i++) {
          if (!isAssemblySyncRunning()) break;
          await sleep(10_000);
        }
        if (isAssemblySyncRunning()) {
          throw new Error("汇总同步占用过久，店内晨报中止");
        }
      } else {
        const state = getState();
        const assembly = await runAssemblySync(state, {
          triggeredBy: opts.triggeredBy === "schedule" ? "schedule" : "manual",
        });
        if (!assembly.ok) {
          // 软失败：仍尝试门禁；把原因记 soft
          console.warn(
            `[morning-digest/store] assembly not ok: ${assembly.message}`,
          );
        }
      }
    }

    let readiness = checkStoreReadiness(getState());
    for (let attempt = 0; !readiness.hardOk && attempt < retryMax; attempt++) {
      console.log(
        `[morning-digest/store] gate fail attempt=${attempt + 1}/${retryMax}: ${readiness.hardReasons.join("; ")}`,
      );
      await sleep(cfg.gateRetryMs);
      readiness = checkStoreReadiness(getState());
    }

    if (!readiness.hardOk && !opts.force) {
      // 熔断：只记日志/落盘，不推飞书（含告警卡）
      const msg = `门禁熔断：${readiness.hardReasons.join("；")}`;
      console.warn(
        `[morning-digest/store] ${msg}; ads=${readiness.ads.fileName ?? "无"}`,
      );
      const run: DigestLastRun = {
        channel: "store",
        ok: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        message: msg,
        triggeredBy: opts.triggeredBy,
        scheduledDay: opts.scheduledDay ?? null,
        detail: readiness,
      };
      saveLastRun(run);
      return run;
    }

    if (!readiness.hardOk && opts.force) {
      readiness = {
        ...readiness,
        softNotes: [
          ...readiness.softNotes,
          `已强制跳过门禁：${readiness.hardReasons.join("；")}`,
        ],
        hardReasons: [],
        hardOk: true,
      };
    }

    const payload = buildStoreDigestPayload(getState(), readiness);
    const llm = await summarizeStoreDigest(payload);
    const degraded = readiness.softNotes.length > 0;
    if (degraded) {
      llm.judgment.caveats = [
        ...readiness.softNotes,
        ...llm.judgment.caveats,
      ];
    }

    const shop = getActiveShop();
    const card = buildDigestCard({
      channel: "store",
      titleDay: readiness.today,
      shopOrMarket: shop.name,
      judgment: llm.judgment,
      softNotes: readiness.softNotes,
      degraded,
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
      channel: "store",
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      message: `已推送店内晨报给 ${names}${degraded ? "（部分数据延迟）" : ""}`,
      triggeredBy: opts.triggeredBy,
      scheduledDay: opts.scheduledDay ?? null,
      degraded,
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
      channel: "store",
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      message: e instanceof Error ? e.message : String(e),
      triggeredBy: opts.triggeredBy,
      scheduledDay: opts.scheduledDay ?? null,
    };
    saveLastRun(run);
    return run;
  } finally {
    running = false;
  }
}
