import { loadWatchlist, saveWatchlist } from "./store.js";

const TEST_KEY_RE = /^(MANUAL-TEST-|TEST-SKU-|mock-)/i;

/** 清除开发/联调测试条目（mock 通道或测试 SKU） */
export function purgeTestWatchlist() {
  const wl = loadWatchlist();
  const kept = wl.items.filter(
    (i) => i.sourceChannel !== "mock" && !TEST_KEY_RE.test(i.productKey),
  );
  const removed = wl.items.length - kept.length;
  const next = saveWatchlist({
    version: 1,
    market: "sa",
    updatedAt: new Date().toISOString(),
    items: kept,
  });
  return { removed, remaining: next.items.length };
}

export function getOpsSummary() {
  const wl = loadWatchlist();
  const real = wl.items.filter((i) => i.sourceChannel !== "mock");
  const withSnap = real.filter((i) => i.lastSnapshotAt).length;
  const stale = real.filter((i) => !i.lastSnapshotAt).length;
  return {
    realCount: real.length,
    mockCount: wl.items.length - real.length,
    withSnapshot: withSnap,
    missingSnapshot: stale,
    byChannel: {
      yingdao: real.filter((i) => i.sourceChannel === "yingdao").length,
      extension: real.filter((i) => i.sourceChannel === "extension").length,
      other: real.filter(
        (i) => i.sourceChannel !== "yingdao" && i.sourceChannel !== "extension",
      ).length,
    },
  };
}
