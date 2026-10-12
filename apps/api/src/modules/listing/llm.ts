/**
 * Listing 文本 LLM（不对图片）。视觉见 vision.ts。
 */
import { deepseekConfig } from "../market-intel/brand-intel/deepseek.js";

export function listingTextModel(): string {
  return (
    process.env.LISTING_TEXT_MODEL?.trim() ||
    process.env.DEEPSEEK_MODEL?.trim() ||
    "deepseek-flash"
  );
}

export function listingVisionModel(): string {
  return (
    process.env.LISTING_VISION_MODEL?.trim() || "deepseek-v4-flash-vision-exp"
  );
}

export function parseJsonObject(rawText: string): unknown {
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

export async function callListingTextLlm(input: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<{ model: string; rawText: string; parsed: unknown }> {
  const cfg = deepseekConfig();
  if (!cfg.apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置（环境变量或仓库根 DS-key.txt）");
  }
  const model = listingTextModel();
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: input.temperature ?? 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
  });
  const rawBody = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek text HTTP ${res.status}: ${rawBody.slice(0, 300)}`);
  }
  let content = "";
  try {
    const envelope = JSON.parse(rawBody) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    content = envelope.choices?.[0]?.message?.content ?? "";
  } catch {
    content = rawBody;
  }
  return { model, rawText: content, parsed: parseJsonObject(content) };
}
