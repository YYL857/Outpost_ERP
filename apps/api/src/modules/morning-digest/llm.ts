/**
 * 晨报 LLM：店内 / 市场情报两套提示词，共用 judgment 形状。
 */
import { deepseekConfig } from "../market-intel/brand-intel/deepseek.js";
import type { MiDigestPayload } from "./mi-payload.js";
import type { StoreDigestPayload } from "./store-payload.js";

export type DigestItem = {
  id: string;
  name: string;
  point: string;
  evidence: string;
};

export type DigestAction = {
  id: string;
  name: string;
  priority: "P0" | "P1" | "P2";
  action: string;
  why: string;
};

export type DigestJudgment = {
  headline: string;
  highlights: DigestItem[];
  risks: DigestItem[];
  actions: DigestAction[];
  caveats: string[];
  confidence: "high" | "medium" | "low";
};

export type DigestLlmResult = {
  model: string;
  builtAt: string;
  judgment: DigestJudgment;
  rawText: string;
};

const STORE_SYSTEM = `你是 Outpost 店内运营晨报助手。唯一信息来源是用户 JSON（overview / topSales / urgentReplenish / adsWatch / softNotes）。
输出严格 JSON：
{
  "headline": string,
  "highlights": [{"id":"partnerSku","name":"标题","point":"...","evidence":"..."}],
  "risks": [{"id":"...","name":"...","point":"...","evidence":"..."}],
  "actions": [{"id":"...","name":"...","priority":"P0|P1|P2","action":"...","why":"..."}],
  "caveats": string[],
  "confidence": "high|medium|low"
}
规则：
1. 只依据 JSON 里出现的 partnerSku / 数字，禁止编造 SKU 或销量。
2. highlights≤5，risks≤5，actions≤5；priority 用 P0/P1/P2。
3. softNotes 必须反映到 caveats（可改写，不可忽略硬缺口以外的延迟说明）。
4. 简体中文；面向早上快速扫一眼的运营同事；冷静可执行。
5. 广告数据若标注为昨日报，勿写成「近 7 日累计广告」。`;

const MI_SYSTEM = `你是 Outpost 市场情报晨报助手。唯一信息来源是用户 JSON（overview / freshTop / bestSellers / softNotes）。
输出严格 JSON（字段同店内晨报；id 用 productKey，name 优先 titleZh 否则 title）。
规则：
1. 只谈 JSON 中的商品，禁止编造链接或销量。
2. highlights≤5，risks≤5，actions≤5。
3. 关注：高销量新品、Best Seller、可白牌空间（brandTier）、广告位干扰。
4. softNotes 写入 caveats。
5. 简体中文；与店内运营简报分开，不要提本店库存/广告花费。`;

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n);
}

function asPriority(v: unknown): "P0" | "P1" | "P2" {
  const s = String(v || "").toUpperCase();
  if (s === "P0" || s === "P1" || s === "P2") return s;
  return "P2";
}

function asConfidence(v: unknown): "high" | "medium" | "low" {
  const s = String(v || "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function parseJsonObject(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]!);
      } catch {
        return {};
      }
    }
    return {};
  }
}

function parseItems(raw: unknown, max: number): DigestItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DigestItem[] = [];
  for (const row of raw.slice(0, max)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = clip(String(o.id || o.partnerSku || o.productKey || ""), 64);
    if (!id) continue;
    out.push({
      id,
      name: clip(String(o.name || o.title || id), 80),
      point: clip(String(o.point || ""), 160),
      evidence: clip(String(o.evidence || ""), 160),
    });
  }
  return out;
}

function parseActions(raw: unknown, max: number): DigestAction[] {
  if (!Array.isArray(raw)) return [];
  const out: DigestAction[] = [];
  for (const row of raw.slice(0, max)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = clip(String(o.id || o.partnerSku || o.productKey || ""), 64);
    if (!id) continue;
    out.push({
      id,
      name: clip(String(o.name || o.title || id), 80),
      priority: asPriority(o.priority),
      action: clip(String(o.action || ""), 160),
      why: clip(String(o.why || ""), 160),
    });
  }
  return out;
}

export function clampDigestJudgment(raw: unknown): DigestJudgment {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const caveats = Array.isArray(o.caveats)
    ? o.caveats.map((c) => clip(String(c || ""), 200)).filter(Boolean).slice(0, 8)
    : [];
  return {
    headline: clip(String(o.headline || "晨报（模型未给出总览）"), 120),
    highlights: parseItems(o.highlights, 5),
    risks: parseItems(o.risks, 5),
    actions: parseActions(o.actions, 5),
    caveats,
    confidence: asConfidence(o.confidence),
  };
}

async function callDeepseek(system: string, user: string): Promise<DigestLlmResult> {
  const cfg = deepseekConfig();
  if (!cfg.apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置（环境变量或仓库根 DS-key.txt）");
  }
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek HTTP ${res.status}: ${rawText.slice(0, 300)}`);
  }
  let content = "";
  try {
    const envelope = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    content = envelope.choices?.[0]?.message?.content ?? "";
  } catch {
    content = rawText;
  }
  const judgment = clampDigestJudgment(parseJsonObject(content));
  return {
    model: cfg.model,
    builtAt: new Date().toISOString(),
    judgment,
    rawText: content,
  };
}

export async function summarizeStoreDigest(
  payload: StoreDigestPayload,
): Promise<DigestLlmResult> {
  const user = [
    "请根据下列店内经营快照生成晨报 JSON。",
    "```json",
    JSON.stringify(payload),
    "```",
  ].join("\n");
  return callDeepseek(STORE_SYSTEM, user);
}

export async function summarizeMiDigest(
  payload: MiDigestPayload,
): Promise<DigestLlmResult> {
  const user = [
    "请根据下列市场情报快照生成晨报 JSON。",
    "```json",
    JSON.stringify(payload),
    "```",
  ].join("\n");
  return callDeepseek(MI_SYSTEM, user);
}
