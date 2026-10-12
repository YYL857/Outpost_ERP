/**
 * Agent Hub 运行时旋钮：偏高可用 / 控延迟，不做独立注册中心。
 */
export function agentHubRuntimeConfig() {
  const maxRounds = clampInt(process.env.AGENT_HUB_MAX_ROUNDS, 3, 1, 5);
  const maxToolsPerRound = clampInt(
    process.env.AGENT_HUB_MAX_TOOLS_PER_ROUND,
    3,
    1,
    5,
  );
  const toolTimeoutMs = clampInt(
    process.env.AGENT_HUB_TOOL_TIMEOUT_MS,
    12_000,
    2_000,
    60_000,
  );
  const llmTimeoutMs = clampInt(
    process.env.AGENT_HUB_LLM_TIMEOUT_MS,
    45_000,
    5_000,
    120_000,
  );
  const maxResultChars = clampInt(
    process.env.AGENT_HUB_MAX_RESULT_CHARS,
    6_000,
    800,
    30_000,
  );
  /** 滑动窗口：最近保留的原文轮次（user+assistant 合计） */
  const historyRecentTurns = clampInt(
    process.env.AGENT_HUB_HISTORY_RECENT_TURNS,
    6,
    2,
    16,
  );
  /** 超过此条数才压缩更早轮次 */
  const historyCompressAfter = clampInt(
    process.env.AGENT_HUB_HISTORY_COMPRESS_AFTER,
    6,
    2,
    24,
  );
  const historyMaxAccepted = clampInt(
    process.env.AGENT_HUB_HISTORY_MAX_ACCEPTED,
    24,
    4,
    40,
  );
  const loopbackBase =
    process.env.AGENT_HUB_LOOPBACK_BASE?.trim() ||
    `http://127.0.0.1:${process.env.PORT || "8787"}`;

  return {
    maxRounds,
    maxToolsPerRound,
    toolTimeoutMs,
    llmTimeoutMs,
    maxResultChars,
    historyRecentTurns,
    historyCompressAfter,
    historyMaxAccepted,
    loopbackBase: loopbackBase.replace(/\/$/, ""),
  };
}

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
