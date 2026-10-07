import { randomUUID } from "node:crypto";
import { getListChannel } from "./channels/index.js";
import { loadConfig } from "./config.js";
import { drainInboxKind } from "./inbox-drain.js";
import {
  upsertWatchlistFromDiscover,
  writeDiscoverRaw,
  writeJobLog,
} from "./store.js";
import type { CollectChannel, JobLog } from "./types.js";

async function runMockDiscover(
  cats: ReturnType<typeof loadConfig>["categories"],
  cfg: ReturnType<typeof loadConfig>,
) {
  const ch = getListChannel("mock");
  let added = 0;
  let updated = 0;
  let listed = 0;
  for (const category of cats) {
    const result = await ch.listCategory(category, {
      topN: category.topN ?? cfg.topN,
      currency: cfg.currency,
      baseUrl: cfg.baseUrl,
    });
    writeDiscoverRaw(category.id, result.raw, "mock");
    const up = upsertWatchlistFromDiscover(result.products, "mock");
    added += up.added;
    updated += up.updated;
    listed += result.products.length;
  }
  return { added, updated, listed };
}

/**
 * 正式发现：排空影刀/插件投递目录（不再 HTTP）。
 * forceMock：仅开发试跑。
 */
export async function runDiscover(opts?: {
  categoryIds?: string[];
  forceMock?: boolean;
}): Promise<JobLog> {
  const startedAt = new Date().toISOString();
  const id = randomUUID().slice(0, 8);
  const cfg = loadConfig();
  const errors: string[] = [];
  let added = 0;
  let updated = 0;
  let listed = 0;
  const channelsSeen = new Set<CollectChannel>();

  const cats = cfg.categories.filter((c) => {
    if (!c.enabled) return false;
    if (opts?.categoryIds?.length) return opts.categoryIds.includes(c.id);
    return true;
  });

  if (opts?.forceMock) {
    if (cats.length === 0) {
      const job: JobLog = {
        id,
        kind: "discover",
        market: "sa",
        startedAt,
        finishedAt: new Date().toISOString(),
        ok: false,
        channel: "mock",
        message: "no enabled categories",
        stats: {},
        errors: ["no enabled categories"],
      };
      writeJobLog(job);
      return job;
    }
    const m = await runMockDiscover(cats, cfg);
    const job: JobLog = {
      id,
      kind: "discover",
      market: "sa",
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: m.listed > 0,
      channel: "mock",
      message: `discover ok: listed=${m.listed} added=${m.added} updated=${m.updated}`,
      stats: {
        categories: cats.length,
        listed: m.listed,
        added: m.added,
        updated: m.updated,
      },
      errors: [],
    };
    writeJobLog(job);
    return job;
  }

  // 正式：按主备顺序排空投递目录（每种目录只 drain 一次）
  const order: CollectChannel[] = [cfg.primaryChannel, cfg.fallbackChannel]
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter((c) => c === "yingdao" || c === "extension" || c === "inbox");

  const kinds = order.map((c) => (c === "inbox" ? "yingdao" : c)) as Array<
    "yingdao" | "extension"
  >;
  const uniqueKinds = [...new Set(kinds)];

  for (const kind of uniqueKinds) {
    try {
      const drained = drainInboxKind(kind);
      if (drained.files === 0) {
        errors.push(`${kind}: inbox empty`);
        continue;
      }
      if (drained.products.length === 0) {
        errors.push(...drained.errors);
        errors.push(`${kind}: files=${drained.files} but 0 products`);
        continue;
      }
      const up = upsertWatchlistFromDiscover(drained.products, drained.channel);
      added += up.added;
      updated += up.updated;
      listed += drained.products.length;
      channelsSeen.add(drained.channel);
      if (drained.errors.length) errors.push(...drained.errors);
    } catch (e) {
      errors.push(`${kind}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (listed === 0 && cfg.allowMock && cats.length) {
    const m = await runMockDiscover(cats, cfg);
    added += m.added;
    updated += m.updated;
    listed += m.listed;
    if (m.listed > 0) channelsSeen.add("mock");
  }

  const channelUsed: CollectChannel | "multi" =
    channelsSeen.size === 1
      ? [...channelsSeen][0]!
      : channelsSeen.size > 1
        ? "multi"
        : order[0] ?? "yingdao";

  const job: JobLog = {
    id,
    kind: "discover",
    market: "sa",
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: listed > 0,
    channel: channelUsed,
    message: listed > 0
      ? `discover ok: listed=${listed} added=${added} updated=${updated}`
      : `discover failed: ${errors[0] ?? "no inbox payloads"}`,
    stats: {
      listed,
      added,
      updated,
      errorCount: errors.length,
    },
    errors: errors.slice(0, 40),
  };
  writeJobLog(job);
  return job;
}
