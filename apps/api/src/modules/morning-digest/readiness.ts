/**
 * 晨报门禁：硬条件熔断、软条件降级标注。
 */
import type { AppState } from "../../common/types.js";
import {
  buildAdsProvenance,
  buildCatalogProvenance,
  findLatestAdsImportFile,
} from "../catalog/provenance.js";
import { loadWatchlist, listRecentJobs } from "../market-intel/store.js";
import {
  shanghaiParts,
  shanghaiYesterday,
  type ShanghaiParts,
} from "./clock.js";

export type StoreReadiness = {
  hardOk: boolean;
  softNotes: string[];
  hardReasons: string[];
  ads: {
    fileName: string | null;
    fileMtimeDay: string | null;
    reportTo: string | null;
    factsCount: number;
  };
  today: string;
  expectedAdsReportTo: string;
};

export type MiReadiness = {
  hardOk: boolean;
  hardReasons: string[];
  softNotes: string[];
  today: string;
  freshItemCount: number;
  watchlistUpdatedDay: string | null;
  recentJobDay: string | null;
};

function dayOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return shanghaiParts(new Date(iso)).day;
  } catch {
    return null;
  }
}

export function checkStoreReadiness(
  state: AppState,
  now: Date = new Date(),
): StoreReadiness {
  const parts = shanghaiParts(now);
  const yesterday = shanghaiYesterday(now);
  const softNotes: string[] = [];
  const hardReasons: string[] = [];

  const file = findLatestAdsImportFile();
  const adsProv = buildAdsProvenance(state);
  const fileDay = file ? dayOfIso(file.fileMtime) : null;
  const reportTo = file?.reportTo ?? adsProv.reportTo ?? null;

  if (!file) {
    hardReasons.push("缺少 ads_sku_*.csv（影刀广告未落盘）");
  } else if (fileDay !== parts.day) {
    hardReasons.push(
      `广告 CSV 不是今日文件（mtime 日=${fileDay ?? "?"}，期望 ${parts.day}）`,
    );
  }

  // 广告默认导「昨天」：reportTo 应对齐昨天；不对齐只软降级，避免时区/跨店偶发卡死
  if (file && reportTo && reportTo !== yesterday) {
    softNotes.push(
      `广告报表日=${reportTo}（期望昨日报 ${yesterday}），仍推送但请核对`,
    );
  }

  if ((state.adsFacts?.length ?? 0) === 0 && file) {
    softNotes.push("广告 CSV 已在盘但 adsFacts 为空：请确认汇总同步已入库");
  }

  const prov = buildCatalogProvenance(state);
  for (const slice of prov.slices) {
    if (
      (slice.key === "sales" || slice.key === "stock") &&
      !slice.syncedToday &&
      slice.count > 0
    ) {
      softNotes.push(`${slice.column}未在今日同步（${slice.syncedAt ?? "无时间"}）`);
    }
  }

  return {
    hardOk: hardReasons.length === 0,
    softNotes,
    hardReasons,
    ads: {
      fileName: file?.fileName ?? null,
      fileMtimeDay: fileDay,
      reportTo,
      factsCount: state.adsFacts?.length ?? 0,
    },
    today: parts.day,
    expectedAdsReportTo: yesterday,
  };
}

export function checkMiReadiness(now: Date = new Date()): MiReadiness {
  const parts = shanghaiParts(now);
  const softNotes: string[] = [];
  const hardReasons: string[] = [];

  let watchlistUpdatedDay: string | null = null;
  let freshItemCount = 0;
  try {
    const wl = loadWatchlist();
    watchlistUpdatedDay = dayOfIso(wl.updatedAt);
    for (const item of wl.items) {
      const seen =
        dayOfIso(item.lastSeenAt) === parts.day ||
        dayOfIso(item.discoveredAt) === parts.day ||
        dayOfIso(item.lastSnapshotAt) === parts.day;
      if (seen) freshItemCount += 1;
    }
  } catch (e) {
    hardReasons.push(
      `读取 watchlist 失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let recentJobDay: string | null = null;
  try {
    const job = listRecentJobs(20).find(
      (j) => j.ok && (j.kind === "discover" || j.kind === "collect" || j.kind === "ingest"),
    );
    recentJobDay = job ? dayOfIso(job.finishedAt || job.startedAt) : null;
  } catch {
    /* ignore */
  }

  const hasFresh =
    freshItemCount > 0 ||
    watchlistUpdatedDay === parts.day ||
    recentJobDay === parts.day;

  if (!hasFresh) {
    hardReasons.push("今日无市场情报新投递/新信号，跳过完整简报");
  }

  if (freshItemCount === 0 && watchlistUpdatedDay === parts.day) {
    softNotes.push("watchlist 今日有写入但无单品 lastSeen/discovered 落在今日");
  }

  return {
    hardOk: hardReasons.length === 0,
    hardReasons,
    softNotes,
    today: parts.day,
    freshItemCount,
    watchlistUpdatedDay,
    recentJobDay,
  };
}

export type { ShanghaiParts };
