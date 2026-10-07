/**
 * DeepSeek Chat（OpenAI 兼容）。仅品牌审核调用。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND_INTEL_SYSTEM_PROMPT,
  buildBrandIntelUserPrompt,
} from "./prompts.js";
import type { BrandEvidenceItem, BrandIntelLlmJudgment } from "./types.js";

function monorepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
}

export function resolveDeepseekApiKey(): string | null {
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const keyFile = resolve(monorepoRoot(), "DS-key.txt");
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, "utf8").trim();
    if (raw) return raw;
  }
  return null;
}

export function deepseekConfig() {
  return {
    apiKey: resolveDeepseekApiKey(),
    baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(
      /\/$/,
      "",
    ),
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  };
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseJudgment(raw: unknown, allowedUrls: Set<string>): BrandIntelLlmJudgment {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fame = String(o.fameLevel || "unknown");
  const fameLevel =
    fame === "global" || fame === "mena_known" || fame === "niche" || fame === "unknown"
      ? fame
      : "unknown";
  const actionRaw = String(o.action || "needs_human");
  const action =
    actionRaw === "avoid_compete" ||
    actionRaw === "keep_candidate" ||
    actionRaw === "needs_human"
      ? actionRaw
      : "needs_human";
  const cited = Array.isArray(o.citedUrls)
    ? o.citedUrls
        .map((u) => String(u || "").trim())
        .filter((u) => allowedUrls.has(u))
    : [];
  const aliases = Array.isArray(o.aliases)
    ? o.aliases.map((a) => String(a || "").trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
  let existsInSaudiOrMena: boolean | null = null;
  if (typeof o.existsInSaudiOrMena === "boolean") {
    existsInSaudiOrMena = o.existsInSaudiOrMena;
  }
  return {
    canonicalName:
      typeof o.canonicalName === "string" && o.canonicalName.trim()
        ? o.canonicalName.trim().slice(0, 80)
        : null,
    aliases,
    existsInSaudiOrMena,
    fameLevel,
    isLocallyNotable: Boolean(o.isLocallyNotable),
    action,
    confidence: clamp01(Number(o.confidence)),
    reason: String(o.reason || "").slice(0, 200),
    citedUrls: cited.slice(0, 6),
  };
}

/** 无证据时禁止调模型；由调用方短路 */
export async function judgeBrandWithDeepseek(input: {
  token: string;
  examples: string[];
  evidence: BrandEvidenceItem[];
}): Promise<{ judgment: BrandIntelLlmJudgment; model: string; rawText: string }> {
  const cfg = deepseekConfig();
  if (!cfg.apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置（可用环境变量或仓库根 DS-key.txt）");
  }
  if (!input.evidence.length) {
    throw new Error("no_evidence");
  }

  const allowedUrls = new Set(input.evidence.map((e) => e.url));
  const body = {
    model: cfg.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: BRAND_INTEL_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildBrandIntelUserPrompt({
          token: input.token,
          examples: input.examples,
          evidence: input.evidence,
        }),
      },
    ],
  };

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DeepSeek HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = data.choices?.[0]?.message?.content || "";
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]!);
      } catch {
        parsed = {};
      }
    }
  }
  let judgment = parseJudgment(parsed, allowedUrls);

  // 代码侧二次钳制：无引用且宣称 avoid → 降为 needs_human
  if (
    judgment.action === "avoid_compete" &&
    judgment.citedUrls.length === 0 &&
    judgment.confidence >= 0.5
  ) {
    judgment = {
      ...judgment,
      action: "needs_human",
      confidence: Math.min(judgment.confidence, 0.4),
      reason: `${judgment.reason}（代码钳制：无有效 citedUrls）`.slice(0, 200),
    };
  }
  // 禁止模型把 keep 说成白牌确认——已在 schema 限制；再挡一层
  if (judgment.fameLevel === "unknown" && judgment.action === "avoid_compete") {
    judgment = {
      ...judgment,
      action: "needs_human",
      confidence: Math.min(judgment.confidence, 0.35),
    };
  }

  return { judgment, model: cfg.model, rawText };
}
