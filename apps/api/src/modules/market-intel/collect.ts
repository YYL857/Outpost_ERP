import { randomUUID } from "node:crypto";
import { mockDetailFromWatchitem } from "./channels/mock.js";
import { loadConfig } from "./config.js";
import { loadWatchlist, writeJobLog, writeSnapshot } from "./store.js";
import type { JobLog, ProductSnapshot } from "./types.js";

/**
 * L1 采集：对监控池内商品写详情快照。
 * - 正式：只用监控池里已有真实字段写快照（来自 http/inbox），不编造五点/促销。
 * - 开发：forceMock 或 sourceChannel=mock 的条目可用 mock 详情便于联调。
 */
export async function runCollect(opts?: {
  limit?: number;
  forceMock?: boolean;
}): Promise<JobLog> {
  const startedAt = new Date().toISOString();
  const id = randomUUID().slice(0, 8);
  const cfg = loadConfig();
  const wl = loadWatchlist();
  const watching = wl.items.filter((i) => i.status === "watching");
  const limit = opts?.limit ?? Math.min(watching.length, cfg.topN);
  const targets = watching.slice(0, limit);
  const errors: string[] = [];
  let written = 0;
  let skippedMock = 0;

  for (const item of targets) {
    try {
      const useMockDetail =
        opts?.forceMock === true ||
        (item.sourceChannel === "mock" && (opts?.forceMock || cfg.allowMock));

      // 正式采集：跳过纯 mock 监控项，避免假数据进入业务快照
      if (
        !opts?.forceMock &&
        !cfg.allowMock &&
        item.sourceChannel === "mock"
      ) {
        skippedMock += 1;
        continue;
      }

      let snap: ProductSnapshot;
      if (useMockDetail) {
        snap = mockDetailFromWatchitem(item);
      } else {
        snap = {
          productKey: item.productKey,
          capturedAt: new Date().toISOString(),
          channel: item.sourceChannel,
          title: item.title,
          url: item.url,
          price: item.price,
          listPrice: null,
          currency: item.currency,
          rating: item.rating,
          reviewCount: item.reviewCount,
          bullets: [],
          bundleText: null,
          fulfillment: null,
          availability: null,
          promoText: null,
          imageUrl: item.imageUrl,
          categoryId: item.categoryId,
        };
      }
      writeSnapshot(snap);
      written += 1;
    } catch (e) {
      errors.push(
        `${item.productKey}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const job: JobLog = {
    id,
    kind: "collect",
    market: "sa",
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: written > 0,
    channel: opts?.forceMock ? "mock" : "multi",
    message:
      written > 0
        ? `collect wrote ${written}/${targets.length} snapshots` +
          (skippedMock ? ` (skipped mock=${skippedMock})` : "")
        : skippedMock === targets.length && targets.length > 0
          ? `collect skipped all ${skippedMock} mock items (live mode; run real discover first)`
          : `collect wrote 0/${targets.length}`,
    stats: {
      targets: targets.length,
      written,
      watching: watching.length,
      skippedMock,
      errorCount: errors.length,
    },
    errors: errors.slice(0, 40),
  };
  writeJobLog(job);
  return job;
}
