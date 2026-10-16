import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUTPOST_ROOT } from "../../shops/registry.js";
import { existsSync, mkdirSync } from "node:fs";
import { AGENT_TOOLS, ANTI_HALLUCINATION } from "./catalog.js";
import type { AgentHubManifest } from "./types.js";

export function agentHubDir(): string {
  const dir = join(OUTPOST_ROOT, "agent-hub");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function buildAgentHubManifest(): AgentHubManifest {
  return {
    version: 1,
    title: "Outpost 中枢 Agent 工具清单",
    principle:
      "先选工具再说话；事实必须可追溯到工具证据。系统骨架看 /api/system-map/agent-preload；Wiki preload 只负责表怎么连，不负责充当库存/财务真相。",
    protocolPath: "/api/agent-hub/protocol",
    preloadPath: "/api/wiki-graph/agent-preload",
    tools: AGENT_TOOLS,
    antiHallucination: ANTI_HALLUCINATION,
  };
}

export function manifestToMarkdown(m: AgentHubManifest): string {
  const lines: string[] = [
    `# ${m.title}`,
    "",
    m.principle,
    "",
    "## 反幻觉硬规则",
    ...m.antiHallucination.hardRules.map((r) => `- ${r}`),
    "",
    "## 回答契约 HubAnswer",
    m.antiHallucination.answerContract.description,
    `必填：${m.antiHallucination.answerContract.requiredFields.join(", ")}`,
    "",
    "## 工具清单",
  ];
  for (const t of m.tools) {
    lines.push(
      "",
      `### ${t.name} (\`${t.id}\`) [${t.kind}]`,
      `- when: ${t.when}`,
      `- call: \`${t.method} ${t.path}\``,
      `- required: ${t.required.length ? t.required.join(", ") : "(无)"}`,
      `- onMiss: ${t.onMiss}`,
      `- neverInvent: ${t.neverInvent.length ? t.neverInvent.join(", ") : "(无)"}`,
    );
  }
  lines.push(
    "",
    "## 推荐决策顺序",
    "1. 看框架 hub.system_map；查表 hub.preload；选工具 hub.manifest",
    "2. 有键 → wiki.context_pack",
    "3. 要现状数字 → catalog / purchase / sales / finance / shipping / replenish",
    "4. 要判断建议 → ops.interpret（并保留 caveats）",
    "5. 输出 HubAnswer；无 evidence 不得报单号与金额",
  );
  return lines.join("\n");
}

export function persistAgentHubManifest(): {
  jsonPath: string;
  mdPath: string;
  manifest: AgentHubManifest;
} {
  const manifest = buildAgentHubManifest();
  const dir = agentHubDir();
  const jsonPath = join(dir, "manifest.json");
  const mdPath = join(dir, "manifest.md");
  writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(mdPath, manifestToMarkdown(manifest), "utf8");
  return { jsonPath, mdPath, manifest };
}
