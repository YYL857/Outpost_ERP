/**
 * Agent 预加载卡：从 Schema Map 压缩而来，控制 token。
 * 默认只含 agentFocus 字段 + 关联路径 + 一条关键 pitfalls。
 */
import {
  OUTPOST_SCHEMA_MAP,
  type SchemaMap,
} from "./schema-catalog.js";

export type AgentPreloadCard = {
  version: 1;
  title: string;
  principle: string;
  /** 预估字符数（中英混合粗算） */
  charCount: number;
  protocol: string[];
  keys: Array<{ keyType: string; meaning: string }>;
  tables: Array<{
    id: string;
    label: string;
    purpose: string;
    /** 仅焦点字段，不列全表 */
    focus: string[];
  }>;
  joins: Array<{
    path: string;
    yields: string;
    key?: string;
    card?: string;
    api?: string;
    watch?: string;
  }>;
  /** 可直接塞进 prompt 的短文 */
  markdown: string;
};

export function buildAgentPreloadCard(
  map: SchemaMap = OUTPOST_SCHEMA_MAP,
): AgentPreloadCard {
  const protocol = [
    "先 GET /api/agent-hub/manifest 选工具；事实必须带 evidence。",
    "再读本卡（字段焦点+关联），勿通读飞书/CSV 全文。",
    "有箱号/票号/物流号/PSKU/订单号 → GET /api/wiki-graph/context-pack。",
    "再按 join.api / 工具清单调业务接口；输出 HubAnswer，未查到勿编造。",
  ];

  const keys = map.keyTypes.map((k) => ({
    keyType: k.keyType,
    meaning: k.meaning,
  }));

  const tables = map.tables.map((t) => ({
    id: t.id,
    label: t.label,
    purpose: t.purpose,
    focus: t.agentFocus,
  }));

  const joins = map.joins.map((j) => ({
    path: `${j.fromTable}.${j.fromField} → ${j.toTable}.${j.toField}`,
    yields: j.yields,
    key: j.viaKeyType,
    card: j.cardinality,
    api: j.preferredApi,
    watch: j.pitfalls?.[0],
  }));

  const markdown = toPreloadMarkdown({
    version: 1,
    title: "Outpost Agent Preload",
    principle: map.principle,
    charCount: 0,
    protocol,
    keys,
    tables,
    joins,
    markdown: "",
  });

  return {
    version: 1,
    title: "Outpost Agent Preload",
    principle: map.principle,
    charCount: markdown.length,
    protocol,
    keys,
    tables,
    joins,
    markdown,
  };
}

function toPreloadMarkdown(card: AgentPreloadCard): string {
  const lines: string[] = [
    `# ${card.title}`,
    "",
    card.principle,
    "",
    "## Protocol",
    ...card.protocol.map((p, i) => `${i + 1}. ${p}`),
    "",
    "## Keys",
    ...card.keys.map((k) => `- \`${k.keyType}\` — ${k.meaning}`),
    "",
    "## Tables (focus only)",
  ];
  for (const t of card.tables) {
    lines.push(`- **${t.label}** (\`${t.id}\`): ${t.purpose}`);
    lines.push(`  - focus: ${t.focus.join(" · ")}`);
  }
  lines.push("", "## Joins");
  for (const j of card.joins) {
    const meta = [
      j.key ? `key=${j.key}` : null,
      j.card ? j.card : null,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`- ${j.path}${meta ? ` (${meta})` : ""}`);
    lines.push(`  → ${j.yields}`);
    if (j.api) lines.push(`  → api: ${j.api}`);
    if (j.watch) lines.push(`  → watch: ${j.watch}`);
  }
  return lines.join("\n");
}

/** 粗算：约 1 token ≈ 2 汉字或 4 英文字符；给 Agent 参考 */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 2.5);
}
