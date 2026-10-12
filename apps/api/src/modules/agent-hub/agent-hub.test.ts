/**
 * agent-hub smoke：manifest + 反幻觉校验 + 工具名映射
 * npx tsx src/modules/agent-hub/agent-hub.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AGENT_TOOLS, ANTI_HALLUCINATION } from "./catalog.js";
import { agentHubRuntimeConfig } from "./config.js";
import {
  buildAgentHubManifest,
  persistAgentHubManifest,
} from "./manifest.js";
import {
  fnNameToToolId,
  toolIdToFnName,
  toolsForAsk,
  toOpenAiTools,
} from "./openai-tools.js";
import { emptyHubAnswer, validateHubAnswer } from "./validate.js";

assert.ok(AGENT_TOOLS.length >= 8, "tools");
assert.equal(AGENT_TOOLS.some((t) => t.id === "dashboard.overview"), true);
assert.ok(ANTI_HALLUCINATION.hardRules.length >= 5);

const m = buildAgentHubManifest();
assert.equal(m.tools.length, AGENT_TOOLS.length);

assert.equal(toolIdToFnName("wiki.context_pack"), "wiki__context_pack");
assert.equal(fnNameToToolId("wiki__context_pack"), "wiki.context_pack");

const autoTools = toolsForAsk({ allowMutate: false, role: "admin" });
assert.ok(!autoTools.some((t) => t.id === "wiki.rebuild"));
assert.ok(!autoTools.some((t) => t.kind === "navigate"));
assert.equal(
  toolsForAsk({ allowNavigate: true, role: "admin" }).filter(
    (t) => t.kind === "navigate",
  ).length,
  2,
);
assert.ok(toOpenAiTools(autoTools).every((t) => t.type === "function"));

const opsOnly = toolsForAsk({ role: "ops", allowMutate: false });
assert.ok(!opsOnly.some((t) => t.id === "finance.query"));
assert.ok(opsOnly.some((t) => t.id === "dashboard.overview"));
assert.ok(ANTI_HALLUCINATION.hardRules.some((r) => r.includes("系统提示")));

const rt = agentHubRuntimeConfig();
assert.ok(rt.maxRounds >= 1 && rt.toolTimeoutMs >= 2000);
assert.ok(rt.historyRecentTurns >= 2 && rt.historyMaxAccepted >= 4);

const bad = validateHubAnswer({
  verdict: "箱号 2508-01-N1-K 已到仓，运费 1200",
  confidence: "high",
  evidence: [],
  openQuestions: [],
  toolsUsed: [],
});
assert.equal(bad.ok, false, "ungrounded ids must fail");
assert.ok(bad.violations.some((v) => v.startsWith("ungrounded_ids")));

const good = validateHubAnswer({
  verdict: "箱号 2508-01-N1-K 摘要显示已入库",
  confidence: "high",
  evidence: [
    {
      toolId: "wiki.context_pack",
      source: "/api/wiki-graph/context-pack",
      key: "boxNo=2508-01-N1-K",
      excerpt: "2508-01-N1-K · 已入库",
    },
  ],
  openQuestions: [],
  toolsUsed: ["wiki.context_pack"],
});
assert.equal(good.ok, true, JSON.stringify(good.violations));

const empty = emptyHubAnswer("尚未调用工具");
assert.equal(validateHubAnswer(empty).ok, true);

const { mdPath, jsonPath } = persistAgentHubManifest();
assert.ok(existsSync(mdPath));
assert.ok(existsSync(jsonPath));
assert.ok(readFileSync(mdPath, "utf8").includes("反幻觉"));

console.log("[agent-hub] tools", AGENT_TOOLS.length);
console.log("[agent-hub] autoTools", autoTools.length);
console.log("[agent-hub] persisted", mdPath);
console.log("[agent-hub] smoke ok");
