import { auditShopGaps } from "../src/modules/sync/gap-audit.js";
import { getShopState, runAsShop } from "../src/shops/state-cache.js";
import {
  ingestLatestAdsFile,
  runAutoIngest,
} from "../src/platforms/noon/portal/auto-ingest.js";
import { saveShopState, runAsShopAsync } from "../src/shops/state-cache.js";

const SHOPS = [
  { id: "PRJ396770", name: "HUI Beauty" },
  { id: "PRJ482387", name: "HFY-KSA" },
] as const;

async function main() {
  for (const s of SHOPS) {
    await runAsShopAsync(s.id, async () => {
      const st = getShopState(s.id);
      const latest = await ingestLatestAdsFile(st);
      await runAutoIngest(st, { force: false });
      saveShopState(s.id, st);
      console.log(
        s.id,
        "ads",
        latest.skipped
          ? `skip ${latest.reason}`
          : `ingested ${latest.fileName} rows=${latest.count}`,
      );
    });
  }

  console.log("\n=== 两店审计（期望截止=上海昨）===");
  let allOk = true;
  for (const s of SHOPS) {
    runAsShop(s.id, () => {
      const st = getShopState(s.id);
      const a = auditShopGaps(s.id, s.name, st);
      const gaps = a.domains.filter((d) => !d.ok);
      console.log(
        `\n${s.name} (${s.id}) complete=${a.complete} expectedEnd=${a.expectedEnd}`,
      );
      if (!gaps.length) {
        for (const d of a.domains) {
          console.log(`  OK ${d.domain}: ${d.message}`);
        }
      } else {
        allOk = false;
        for (const d of gaps) {
          console.log(`  GAP ${d.domain}: ${d.message} · ${d.channel}`);
        }
      }
      console.log(
        `  counts sales=${st.salesFacts?.length ?? 0} orders=${st.orders?.length ?? 0} ads=${st.adsFacts?.length ?? 0} catalog=${st.catalog?.length ?? 0} stock=${st.stock?.length ?? 0}`,
      );
    });
  }
  console.log(allOk ? "\nRESULT: 两店相对期望截止日齐全" : "\nRESULT: 仍有缺口");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
