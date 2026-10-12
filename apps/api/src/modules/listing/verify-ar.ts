/**
 * 阿语校验：先跑现有护栏，再对照原稿列出问题。不改草稿。
 */
import { callListingTextLlm } from "./llm.js";
import { runContentGuardrails } from "./guardrails.js";
import type { GuardrailResult, OursNoonContent } from "./types.js";

export type ArIssue = {
  severity: "blocker" | "warning";
  field: string;
  point: string;
  suggestion: string;
};

export type ArVerifyResult = {
  guardrails: GuardrailResult;
  issues: ArIssue[];
  model: string | null;
  checkedAt: string;
};

const SYSTEM = `你是 Noon 阿语营销文案校验助手，面向沙特及海湾市场。只审稿，不重写整篇 Listing。
输出严格 JSON：
{ "issues": [{ "severity": "blocker"|"warning", "field": string, "point": string, "suggestion": string }] }
规则：
1. 对照 sourceText 与阿语字段，指出译走样、用词错误、文化或宗教不恰当。
2. field 只能是 titleAr、longDescriptionAr、featureBulletsAr、brandAr、general。
3. 没有问题就返回 { "issues": [] }。不要编造原稿里没有的卖点，也不要输出新的完整文案。
4. 医疗功效夸大、酒类猪肉等敏感品、绝对化承诺用 blocker。不确定的用词用 warning。
5. point 和 suggestion 用简体中文，各不超过 80 字。`;

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n);
}

function hasArabic(content: OursNoonContent): boolean {
  return Boolean(
    content.titleAr.trim() ||
      content.longDescriptionAr.trim() ||
      content.brandAr.trim() ||
      content.featureBulletsAr.some((b) => b.trim()),
  );
}

function parseIssues(raw: unknown): ArIssue[] {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(o.issues) ? o.issues : [];
  const out: ArIssue[] = [];
  for (const row of rows.slice(0, 12)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const point = clip(String(item.point || ""), 160);
    if (!point) continue;
    const severity = item.severity === "blocker" ? "blocker" : "warning";
    const field = clip(String(item.field || "general"), 40) || "general";
    out.push({
      severity,
      field,
      point,
      suggestion: clip(String(item.suggestion || ""), 160),
    });
  }
  return out;
}

export async function verifyArabicListing(input: {
  content: OursNoonContent;
  sourceText: string;
  gtinFromUser: string;
}): Promise<{ ok: true; data: ArVerifyResult } | { ok: false; status: number; error: string }> {
  const sourceText = input.sourceText.trim();
  if (!sourceText) {
    return { ok: false, status: 400, error: "请填写中文或英文原稿" };
  }
  const guardrails = runContentGuardrails(input.content, {
    gtinFromUser: input.gtinFromUser,
  });
  const checkedAt = new Date().toISOString();
  if (!hasArabic(input.content)) {
    return {
      ok: true,
      data: {
        guardrails,
        model: null,
        checkedAt,
        issues: [
          {
            severity: "blocker",
            field: "general",
            point: "阿语文案为空，未做对照校验",
            suggestion: "先填写或生成阿语标题、描述或卖点",
          },
        ],
      },
    };
  }

  const llm = await callListingTextLlm({
    system: SYSTEM,
    user: [
      "请对照原稿检查阿语文案，只返回问题列表。",
      "```json",
      JSON.stringify({
        sourceText: clip(sourceText, 6000),
        arabic: {
          titleAr: input.content.titleAr,
          brandAr: input.content.brandAr,
          longDescriptionAr: clip(input.content.longDescriptionAr, 4000),
          featureBulletsAr: input.content.featureBulletsAr,
        },
        englishHint: {
          titleEn: input.content.titleEn,
          longDescriptionEn: clip(input.content.longDescriptionEn, 1500),
        },
      }),
      "```",
    ].join("\n"),
    temperature: 0.1,
  });

  return {
    ok: true,
    data: {
      guardrails,
      issues: parseIssues(llm.parsed),
      model: llm.model,
      checkedAt,
    },
  };
}
