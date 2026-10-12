/**
 * 一次性：审计缺口 → 扫 portal 广告入库 → 触发补洞（Noon/飞书；广告 PW 按需）
 * 用法：cd apps/api && npx tsx scripts/_audit-and-sync-now.mts
 */
import { auditAllShopGaps, runDataBackfill } from "../src/modules/sync/data-backfill.js";
import { auditShopGaps } from "../src/modules/sync/gap-audit.js";
import { getShopState, saveShopState, runAsShopAsync } from "../src/shops/state-cache.js";
import { listEligibleSyncShops } from "../src/modules/sync/multi-shop-sync.js";
import {
  ingestLatestAdsFile,
  runAutoIngest,
} from "../src/platforms/noon/portal/auto-ingest.js";

function summarize(audits: ReturnType<typeof auditAllShopGaps>) {
  const rows: Array<{
    shopId: string;
    complete: boolean;
    gaps: string[];
  }> = [];
  for (const a of audits) {
    const gaps = a.domains
      .filter((d) => !d.ok)
      .map(
        (d) =>
          `${d.domain}(${d.maxDate ?? "无"}→${d.expectedEnd};${d.missingDates.length}d;${d.channel})`,
      );
    rows.push({ shopId: a.shopId, complete: a.complete, gaps });
  }
  return rows;
}

async function ingestAdsAll() {
  const shops = listEligibleSyncShops();
  const out: Array<{ shopId: string; ok: boolean; message: string }> = [];
  for (const s of shops) {
    await runAsShopAsync(s.id, async () => {
      const st = getShopState(s.id);
      const latest = await ingestLatestAdsFile(st);
      await runAutoIngest(st, { force: false });
      saveShopState(s.id, st);
      out.push({
        shopId: s.id,
        ok: Boolean(latest.ok),
        message: latest.skipped
          ? `skip ${latest.reason ?? ""} ${latest.fileName ?? ""}`
          : `ingested ${latest.fileName ?? ""} rows=${latest.count ?? "?"}`,
      });
    });
  }
  return out;
}

async function main() {
  console.log("=== BEFORE audit ===");
  const before = auditAllShopGaps(90);
  console.log(JSON.stringify(summarize(before), null, 2));

  console.log("\n=== ingest portal ads ===");
  const adsIn = await ingestAdsAll();
  console.log(JSON.stringify(adsIn, null, 2));

  console.log("\n=== after ads ingest audit ===");
  const mid = auditAllShopGaps(90);
  console.log(JSON.stringify(summarize(mid), null, 2));

  const stillAds = mid.some((a) =>
    a.domains.some((d) => d.domain === "ads" && !d.ok),
  );
  const stillOther = mid.some((a) =>
    a.domains.some((d) => d.domain !== "ads" && !d.ok),
  );

  if (stillOther || stillAds) {
    console.log("\n=== runDataBackfill ===");
    const bf = await runDataBackfill({
      triggeredBy: "manual",
      // 广告：仍缺则触发 PW；Noon/飞书照常
      maxImpexTotal: 6,
      maxImpexPerShop: 3,
    });
    console.log(
      JSON.stringify(
        {
          ok: bf.ok,
          message: bf.message,
          actions: bf.actions.map((a) => ({
            shopId: a.shopId,
            domain: a.domain,
            ok: a.ok,
            skipped: a.skipped,
            message: a.message,
          })),
        },
        null,
        2,
      ),
    );
  }

  console.log("\n=== AFTER audit ===");
  const after = auditAllShopGaps(90);
  console.log(JSON.stringify(summarize(after), null, 2));
  const incomplete = after.filter((a) => !a.complete).length;
  console.log(
    `\nDONE incompleteShops=${incomplete}/${after.length} expectedEnd=${after[0]?.expectedEnd ?? "?"}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
