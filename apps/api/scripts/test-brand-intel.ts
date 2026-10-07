import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(root, ".env") });

const { reviewPendingBrands, brandIntelStatus } = await import(
  "../src/modules/market-intel/brand-intel/index.ts"
);

console.log("status", brandIntelStatus());
const r = await reviewPendingBrands({
  tokens: ["armfit", "robotgcc", "byintek"],
  limit: 3,
  force: true,
  autoApply: true,
});
console.log(
  JSON.stringify(
    {
      llm: r.llmCalls,
      search: r.searchCalls,
      applied: r.appliedAvoid,
      errors: r.errors,
      reviewed: r.reviewed.map((x) => ({
        token: x.token,
        action: x.action,
        fame: x.fameLevel,
        conf: x.confidence,
        skip: x.skipReason,
        applied: x.applied,
        reason: x.reason,
        cites: x.citedUrls?.length,
        evidenceCount: x.evidenceCount,
      })),
    },
    null,
    2,
  ),
);
