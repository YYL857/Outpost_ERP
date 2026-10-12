import {
  ingestLatestAdsFile,
  ingestLatestSalesFile,
} from "../../platforms/noon/portal/auto-ingest.js";
import { listEligibleSyncShops } from "../sync/multi-shop-sync.js";
import {
  getShopState,
  runAsShopAsync,
  saveShopState,
} from "../../shops/state-cache.js";

/**
 * 导出结束后（成功或失败）把本次新落到 portal-imports 的表灌进店态。
 * 文件 mtime 早于本次启动的视为旧表，不入库。
 */
export async function ingestPortalAfterPwJob(
  job: "ads" | "sales" | "keepalive",
  shopIds?: string[],
  startedAt?: string | null,
): Promise<string> {
  if (job !== "ads" && job !== "sales") return "";
  const ids = (
    shopIds?.length ? shopIds : listEligibleSyncShops().map((s) => s.id)
  ).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  const notBeforeMs = Number.isFinite(startedMs)
    ? startedMs - 60_000
    : undefined;

  const bits: string[] = [];
  for (const id of ids) {
    try {
      const note = await runAsShopAsync(id, async () => {
        const st = getShopState(id);
        const opts = notBeforeMs != null ? { notBeforeMs } : undefined;
        if (job === "ads") {
          const r = await ingestLatestAdsFile(st, opts);
          saveShopState(id, st);
          return r.skipped
            ? `${id}:跳过${r.reason ? `(${r.reason})` : ""}`
            : `${id}:${r.fileName}×${r.count ?? 0}`;
        }
        const r = await ingestLatestSalesFile(st, opts);
        saveShopState(id, st);
        return r.skipped
          ? `${id}:跳过${r.reason ? `(${r.reason})` : ""}`
          : `${id}:${r.fileName}×${r.count ?? 0}`;
      });
      bits.push(note);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      bits.push(`${id}:fail(${msg.slice(0, 80)})`);
    }
  }
  return bits.join(" · ");
}
