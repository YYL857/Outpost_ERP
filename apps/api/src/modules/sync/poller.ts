import type { AppState } from "../../common/types.js";
import { pullDomain } from "./pipeline.js";
import { runAutoSync } from "../../platforms/noon/portal/auto-sync.js";
import { runAutoIngest } from "../../platforms/noon/portal/auto-ingest.js";

/**
 * 全自动调度：
 * - live：Impex 约 30 分钟 2 次，禁止高频轮询三域。
 *   空 Catalog 时低频补目录；否则只低频拉 orders。Stock 靠 catalog 内嵌 hints。
 * - portal/mock：目录入库 + 按间隔 SOP auto-sync
 */
export function startNoonPoller(getState: () => AppState, intervalMs = 120_000) {
  let sopTicks = 0;
  let liveTicks = 0;
  let lastLimitAt = 0;
  const sopEveryN = Math.max(
    1,
    Number(process.env.OUTPOST_SOP_EVERY_N_TICKS ?? 30),
  );
  const disableSop = ["1", "true", "yes"].includes(
    String(process.env.OUTPOST_DISABLE_SOP ?? "").toLowerCase(),
  );
  /** live 下每隔 N 个 tick 才允许一次 Impex（默认 15 × 120s ≈ 30 分钟） */
  const liveEveryN = Math.max(
    1,
    Number(process.env.OUTPOST_LIVE_POLL_EVERY_N_TICKS ?? 15),
  );
  const limitCooldownMs = Number(
    process.env.OUTPOST_IMPEX_COOLDOWN_MS ?? 30 * 60 * 1000,
  );

  const tick = () => {
    const state = getState();
    if (!state.noon.enabled) return;

    if (state.noon.mode === "live") {
      liveTicks += 1;
      if (liveTicks % liveEveryN !== 0) return;
      if (Date.now() - lastLimitAt < limitCooldownMs) return;

      const needCatalog = state.catalog.length === 0;
      const domain = needCatalog ? "catalog" : "orders";
      void pullDomain(state, domain).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/export limit|限额/i.test(msg)) lastLimitAt = Date.now();
        console.error(`[noon-poller] live pull ${domain}`, err);
      });
      return;
    }

    sopTicks += 1;
    const runSop = !disableSop && sopTicks % sopEveryN === 0;

    void (async () => {
      try {
        if (runSop) {
          await runAutoSync(state, { skipSop: false });
        } else {
          await runAutoIngest(state);
        }
      } catch (err) {
        console.error("[noon-poller] auto-sync", err);
      }
    })();
  };

  const state0 = getState();
  if (state0.noon.mode === "live") {
    // 启动时不立刻打 Impex，避免与手动同步撞限；空 Catalog 留给用户/下一窗口手动「同步 SKU」
    console.log(
      `[noon-poller] live: skip initial Impex (catalog=${state0.catalog.length})`,
    );
  } else {
    void runAutoIngest(getState()).catch((err) =>
      console.error("[noon-poller] initial ingest", err),
    );
  }

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log(
    `[noon-poller] every ${intervalMs}ms mode=${state0.noon.mode} (liveEveryN=${liveEveryN}, SOP every ${sopEveryN}, disableSop=${disableSop})`,
  );
  return () => clearInterval(timer);
}
