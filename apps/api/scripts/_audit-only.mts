import {
  auditAllShopGaps,
  runDataBackfill,
} from "../src/modules/sync/data-backfill.js";
import { getShopState, saveShopState, runAsShopAsync } from "../src/shops/state-cache.js";
import { listEligibleSyncShops } from "../src/modules/sync/multi-shop-sync.js";
import {
  ingestLatestAdsFile,
  runAutoIngest,
} from "../src/platforms/noon/portal/auto-ingest.js";

async function ingestAdsAll() {
  for (const s of listEligibleSyncShops()) {
    await runAsShopAsync(s.id, async () => {
      const st = getShopState(s.id);
      const latest = await ingestLatestAdsFile(st);
      await runAutoIngest(st, { force: false });
      saveShopState(s.id, st);
      console.log(
        s.id,
        latest.skipped
          ? `skip ${latest.reason} ${latest.fileName ?? ""}`
          : `ingested ${latest.fileName} rows=${latest.count}`,
      );
    });
  }
}

function printAudit(tag: string) {
  const audits = auditAllShopGaps(90);
  console.log(`\n=== ${tag} ===`);
  for (const a of audits) {
    const gaps = a.domains
      .filter((d) => !d.ok)
      .map((d) => `${d.domain}:${d.maxDate ?? "无"}→${d.expectedEnd}`);
    console.log(
      `${a.shopId} complete=${a.complete} ${gaps.length ? gaps.join(" | ") : "OK"}`,
    );
  }
  return audits;
}

async function main() {
  printAudit("BEFORE");
  console.log("\n=== ingest ads ===");
  await ingestAdsAll();
  let audits = printAudit("AFTER ADS INGEST");

  const needNoon = audits.filter((a) =>
    a.domains.some(
      (d) =>
        !d.ok && (d.channel === "noon-impex" || d.channel === "snapshot"),
    ),
  );
  if (needNoon.length) {
    const shopIds = needNoon.map((a) => a.shopId);
    console.log("\n=== backfill Noon/feishu (skip ads PW) shops=", shopIds.join(","));
    const bf = await runDataBackfill({
      triggeredBy: "manual",
      shopIds,
      skipYingdao: true,
      maxImpexTotal: 6,
      maxImpexPerShop: 3,
    });
    console.log(bf.message);
    for (const a of bf.actions) {
      console.log(
        `[${a.ok ? "ok" : a.skipped ? "skip" : "fail"}] ${a.shopId} ${a.domain}: ${a.message}`,
      );
    }
  }

  printAudit("FINAL");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
