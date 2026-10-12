import { deepseekConfig } from "../market-intel/brand-intel/deepseek.js";

export async function callOpsJson(input: {
  system: string;
  user: string;
}): Promise<{ model: string; parsed: unknown }> {
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
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
  });
  const rawBody = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek HTTP ${res.status}: ${rawBody.slice(0, 300)}`);
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
  return { model: cfg.model, parsed: parseJsonObject(content) };
}

function parseJsonObject(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      return JSON.parse(m[0]!);
    } catch {
      return {};
    }
  }
}
