/**
 * 只审 HUI / HFY：销量·订单·广告·库存·价库·费用 + 今日入库时效
 */
import { auditShopGaps } from "../src/modules/sync/gap-audit.js";
import { getShopState, runAsShop, saveShopState, runAsShopAsync } from "../src/shops/state-cache.js";
import {
  ingestLatestAdsFile,
  runAutoIngest,
} from "../src/platforms/noon/portal/auto-ingest.js";
import { pullDomain } from "../src/modules/sync/pipeline.js";
import { buildCatalogProvenance } from "../src/modules/catalog/provenance.js";

const SHOPS = [
  { id: "PRJ396770", name: "HUI Beauty" },
  { id: "PRJ482387", name: "HFY-KSA" },
] as const;

const DOMAIN_CN: Record<string, string> = {
  sales: "销量",
  orders: "订单",
  ads: "广告",
  catalog: "价库/Catalog",
  stock: "库存",
  fees: "平台费用",
};

function ageHours(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const h = (Date.now() - t) / 3600_000;
  return `${h.toFixed(1)}h前`;
}

async function main() {
  // 先扫 portal 广告入库（不打 Impex）
  for (const s of SHOPS) {
    await runAsShopAsync(s.id, async () => {
      const st = getShopState(s.id);
      await ingestLatestAdsFile(st);
      await runAutoIngest(st, { force: false });
      saveShopState(s.id, st);
    });
  }

  console.log("期望截止日 = 上海昨；库存/价库按快照新鲜度（库存≤6h、价库≤12h、费用≤24h）\n");

  let needStock: string[] = [];
  let needCatalog: string[] = [];
  let anyGap = false;

  for (const s of SHOPS) {
    runAsShop(s.id, () => {
      const st = getShopState(s.id);
      const a = auditShopGaps(s.id, s.name, st);
      const prov = buildCatalogProvenance(st);
      console.log(`======== ${s.name} (${s.id}) · complete=${a.complete} · 期望至 ${a.expectedEnd} ========`);
      for (const d of a.domains) {
        const cn = DOMAIN_CN[d.domain] ?? d.domain;
        const mark = d.ok ? "OK " : "GAP";
        if (!d.ok) anyGap = true;
        if (!d.ok && d.domain === "stock") needStock.push(s.id);
        if (!d.ok && d.domain === "catalog") needCatalog.push(s.id);
        console.log(
          `  [${mark}] ${cn.padEnd(12)} · ${d.channel.padEnd(12)} · ${d.message}`,
        );
      }
      console.log("  —— 今日入库（Catalog 同源时效）——");
      for (const slice of prov.slices ?? []) {
        if (!["sales", "stock", "catalog", "fees", "ads"].includes(slice.key) &&
            !/销量|库存|价|费用|广告/.test(slice.column)) {
          // 打印全部关键即可，provenance 本身已过滤
        }
        console.log(
          `  ${slice.syncedToday ? "今日" : "偏旧"} ${slice.column} · ${slice.source} · 入库 ${slice.syncedAt ?? "—"} · ${slice.dataNode}`,
        );
      }
      console.log(
        `  条数: sales=${st.salesFacts?.length ?? 0} orders=${st.orders?.length ?? 0} ads=${st.adsFacts?.length ?? 0} catalog=${st.catalog?.length ?? 0} stock=${st.stock?.length ?? 0}`,
      );
      console.log(
        `  游标: sales=${ageHours(st.cursors.salesSince)} stock=${ageHours(st.cursors.stockSince)} catalog=${ageHours(st.cursors.catalogSince)} orders=${ageHours(st.cursors.ordersSince)}\n`,
      );
    });
  }

  // 若库存/价库过期，现场拉一把（有凭证的 live 店）
  const refreshIds = [...new Set([...needStock, ...needCatalog])];
  if (refreshIds.length) {
    console.log("=== 缺口域 Impex 刷新 ===", refreshIds.join(","));
    for (const id of refreshIds) {
      await runAsShopAsync(id, async () => {
        const st = getShopState(id);
        const domains = [
          ...(needStock.includes(id) ? (["stock"] as const) : []),
          ...(needCatalog.includes(id) ? (["catalog"] as const) : []),
        ];
        for (const domain of domains) {
          try {
            console.log(`pull ${id} ${domain}...`);
            await pullDomain(st, domain);
            saveShopState(id, st);
            console.log(`  ok ${domain}`);
          } catch (e) {
            console.log(`  fail ${domain}:`, e instanceof Error ? e.message : e);
            saveShopState(id, st);
          }
        }
      });
    }
    console.log("\n=== 刷新后再审计 ===");
    for (const s of SHOPS.filter((x) => refreshIds.includes(x.id))) {
      runAsShop(s.id, () => {
        const st = getShopState(s.id);
        const a = auditShopGaps(s.id, s.name, st);
        const gaps = a.domains.filter((d) => !d.ok);
        console.log(
          `${s.name} complete=${a.complete}`,
          gaps.length
            ? gaps.map((d) => `${d.domain}:${d.message}`).join(" | ")
            : "全部 OK",
        );
        if (gaps.length) anyGap = true;
        else {
          // 若只剩这两店且都 ok，清 anyGap 需重算
        }
      });
    }
    // 重算总结果
    anyGap = false;
    for (const s of SHOPS) {
      runAsShop(s.id, () => {
        const a = auditShopGaps(s.id, s.name, getShopState(s.id));
        if (!a.complete) anyGap = true;
      });
    }
  }

  console.log(
    anyGap
      ? "\n结论: 两店仍有缺口（见上 GAP）"
      : "\n结论: HUI + HFY 相对期望截止日 · 销量/订单/广告/库存/价库/费用 全部齐全",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
