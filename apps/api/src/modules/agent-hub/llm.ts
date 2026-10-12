import { deepseekConfig } from "../market-intel/brand-intel/deepseek.js";
import { agentHubRuntimeConfig } from "./config.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatCompletionResult = {
  model: string;
  message: ChatMessage;
  finishReason: string;
  ms: number;
};

export function assertDeepseekReady() {
  const cfg = deepseekConfig();
  if (!cfg.apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置（环境变量或仓库根 DS-key.txt）");
  }
  return cfg;
}

/** DeepSeek OpenAI 兼容 chat；支持 tools 或 json_object */
export async function deepseekChat(input: {
  messages: ChatMessage[];
  tools?: unknown[];
  toolChoice?: "auto" | "none";
  jsonObject?: boolean;
  temperature?: number;
}): Promise<ChatCompletionResult> {
  const cfg = assertDeepseekReady();
  const rt = agentHubRuntimeConfig();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), rt.llmTimeoutMs);
  const started = Date.now();

  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: input.temperature ?? 0.1,
    messages: input.messages,
  };
  if (input.tools?.length) {
    body.tools = input.tools;
    body.tool_choice = input.toolChoice ?? "auto";
  }
  if (input.jsonObject) {
    body.response_format = { type: "json_object" };
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`DeepSeek HTTP ${res.status}: ${raw.slice(0, 400)}`);
    }
    const envelope = JSON.parse(raw) as {
      model?: string;
      choices?: Array<{
        finish_reason?: string;
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: ToolCall[];
        };
      }>;
    };
    const choice = envelope.choices?.[0];
    const msg = choice?.message;
    return {
      model: envelope.model || cfg.model,
      finishReason: choice?.finish_reason ?? "stop",
      ms: Date.now() - started,
      message: {
        role: "assistant",
        content: msg?.content ?? null,
        tool_calls: msg?.tool_calls,
      },
    };
  } catch (e) {
    if (e instanceof Error && /abort/i.test(e.message)) {
      throw new Error(`DeepSeek 超时（>${rt.llmTimeoutMs}ms）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonObject(rawText: string): unknown {
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
