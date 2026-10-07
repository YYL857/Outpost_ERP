import { runCollect } from "./collect.js";
import { loadConfig } from "./config.js";
import { runDiscover } from "./discover.js";
import type { JobLog } from "./types.js";

/** 正式闭环：发现（排空投递）→ 可选自动采集快照 */
export async function runDiscoverPipeline(opts?: {
  forceMock?: boolean;
  categoryIds?: string[];
  skipCollect?: boolean;
}): Promise<{ discover: JobLog; collect: JobLog | null }> {
  const cfg = loadConfig();
  const discover = await runDiscover({
    forceMock: opts?.forceMock,
    categoryIds: opts?.categoryIds,
  });
  if (!discover.ok || opts?.skipCollect || opts?.forceMock) {
    return { discover, collect: null };
  }
  if (!cfg.autoCollectAfterDiscover) {
    return { discover, collect: null };
  }
  const collect = await runCollect({
    limit: Math.max(cfg.topN * 5, 200),
  });
  return { discover, collect };
}
