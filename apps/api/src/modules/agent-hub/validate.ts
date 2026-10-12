import type { HubAnswer, HubAnswerEvidence } from "./types.js";

const ID_LIKE =
  /\b(N[0-9A-Z]{6,}[A-Z0-9]*|[0-9]{4}-[0-9]{1,3}-[A-Z0-9-]+|HPMY[A-Z0-9-]+)\b/gi;

/**
 * 轻量校验：无证据却含疑似单号/SKU → 判定违规（供后续 LLM 网关或自检）。
 * 不替代业务正确性，只挡「空口报号」。
 */
export function validateHubAnswer(answer: HubAnswer): {
  ok: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  if (!answer.verdict?.trim()) {
    violations.push("missing_verdict");
  }
  if (!Array.isArray(answer.evidence)) {
    violations.push("missing_evidence_array");
  }
  if (!Array.isArray(answer.toolsUsed)) {
    violations.push("missing_toolsUsed");
  }

  const hasEvidence = (answer.evidence?.length ?? 0) > 0;
  const idHits = answer.verdict?.match(ID_LIKE) ?? [];

  if (idHits.length > 0 && !hasEvidence) {
    violations.push(
      `ungrounded_ids_in_verdict:${[...new Set(idHits)].slice(0, 5).join(",")}`,
    );
  }

  if (
    (answer.confidence === "high" || answer.confidence === "medium") &&
    !hasEvidence
  ) {
    violations.push("confidence_without_evidence");
  }

  if (hasEvidence) {
    for (const [i, e] of answer.evidence.entries()) {
      if (!e.toolId?.trim()) violations.push(`evidence[${i}].missing_toolId`);
      if (!e.excerpt?.trim()) violations.push(`evidence[${i}].missing_excerpt`);
      if (!e.source?.trim()) violations.push(`evidence[${i}].missing_source`);
    }
  }

  if (
    answer.toolsUsed?.length &&
    hasEvidence &&
    !answer.evidence.every((e) => answer.toolsUsed.includes(e.toolId))
  ) {
    violations.push("evidence_toolId_not_in_toolsUsed");
  }

  return { ok: violations.length === 0, violations };
}

export function emptyHubAnswer(verdict: string): HubAnswer {
  return {
    verdict,
    confidence: "none",
    evidence: [],
    openQuestions: [],
    toolsUsed: [],
  };
}

export function evidenceFromTool(
  toolId: string,
  source: string,
  excerpt: string,
  key?: string,
): HubAnswerEvidence {
  return {
    toolId,
    source,
    key,
    excerpt: excerpt.slice(0, 240),
  };
}
