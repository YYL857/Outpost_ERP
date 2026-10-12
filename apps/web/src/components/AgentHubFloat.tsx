import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, type AgentHubAskResult, type AgentHubConversation } from "../api";

type ChatMessage =
  | { id: string; role: "human"; text: string }
  | { id: string; role: "bot"; text: string; ask?: AgentHubAskResult }
  | { id: string; role: "error"; text: string };

const ASSISTANT_NAME = "小慧助手";
const QUICK_PROMPT_COUNT = 4;

/** 对齐 agent-hub 已有工具链路的预设问法；每次打开随机抽 4 条 */
const QUICK_PROMPT_POOL = [
  "当前店销量汇总怎么样？",
  "今日销量和昨日比怎么样？",
  "最近卖得最好的 SKU 有哪些？",
  "店铺整体经营概况怎么样？",
  "广告对销量的贡献大概怎样？",
  "在途装箱大概有多少箱？",
  "各货代在途箱量对比怎么样？",
  "装箱看板概况如何？",
  "有没有紧急需要补货的？",
  "哪些 SKU 可售天数偏低？",
  "补货计划里优先处理什么？",
  "财务概览：营收和利润大概多少？",
  "平台费用大概有多少？",
  "主营收和利润大概什么水平？",
  "采购在途大概怎么样？",
  "最近采购订单概况如何？",
  "Catalog 里库存偏低的有哪些？",
  "FBN 商品大概有多少？",
];

function pickQuickPrompts(count = QUICK_PROMPT_COUNT): string[] {
  const pool = [...QUICK_PROMPT_POOL];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function openStorageKey(userId: string) {
  return `outpost.agentHub.floatOpen.${userId}`;
}

function welcomeMessage(): ChatMessage {
  return {
    id: "welcome",
    role: "bot",
    text: `你好，我是${ASSISTANT_NAME}。可问箱号、销量、补货、财务、在途装箱——先查工具再答，不编造单号与金额。`,
  };
}

function storedToUi(conv: AgentHubConversation): ChatMessage[] {
  const out: ChatMessage[] = [welcomeMessage()];
  for (const m of conv.messages) {
    if (m.role === "user") {
      out.push({ id: m.id, role: "human", text: m.content });
      continue;
    }
    out.push({
      id: m.id,
      role: "bot",
      text: m.content,
      ask: {
        ok: true,
        model: "",
        answer: {
          verdict: m.content,
          confidence:
            m.confidence === "high" ||
            m.confidence === "medium" ||
            m.confidence === "low" ||
            m.confidence === "none"
              ? m.confidence
              : "none",
          evidence: (m.keys ?? []).map((key) => ({
            toolId: "history",
            source: "stored-conversation",
            key,
            excerpt: key,
          })),
          openQuestions: [],
          toolsUsed: m.toolsUsed ?? [],
        },
        validation: { ok: true, violations: [] },
        toolsInvoked: [],
        unavailableTools: [],
        rounds: 0,
        timings: { totalMs: 0, llmMs: 0, toolMs: 0 },
      },
    });
  }
  return out;
}

function confidenceLabel(c: AgentHubAskResult["answer"]["confidence"]) {
  if (c === "high") return "高置信";
  if (c === "medium") return "中置信";
  if (c === "low") return "低置信";
  return "无证据";
}

function splitReadable(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const byBreak = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？；])\s*/))
    .map((s) => s.trim())
    .filter(Boolean);
  if (byBreak.length > 1) return byBreak;
  return [raw];
}

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function BotAnswerCard({
  text,
  ask,
}: {
  text: string;
  ask?: AgentHubAskResult;
}) {
  const paragraphs = splitReadable(text);
  const openQs = (ask?.answer.openQuestions ?? [])
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 5);
  const tools =
    ask?.toolsInvoked?.filter((t) => t.ok).map((t) => t.toolId) ??
    ask?.answer.toolsUsed ??
    [];
  const evidence = (ask?.answer.evidence ?? []).filter(
    (e) => e.toolId !== "history",
  );

  return (
    <div className="agent-msg-bubble agent-answer-card">
      <div className="agent-answer-body">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {openQs.length > 0 && (
        <div className="agent-answer-followups">
          <div className="agent-answer-label">待确认</div>
          <ul>
            {openQs.map((q, i) => (
              <li key={i}>{q.replace(/^待确认[:：]\s*/, "")}</li>
            ))}
          </ul>
        </div>
      )}

      {ask && (
        <div className="agent-answer-meta">
          <span className={`agent-pill agent-pill-${ask.answer.confidence}`}>
            {confidenceLabel(ask.answer.confidence)}
          </span>
          {ask.timings?.totalMs != null && ask.timings.totalMs > 0 && (
            <span className="agent-pill">{formatMs(ask.timings.totalMs)}</span>
          )}
          {tools.slice(0, 4).map((t) => (
            <span key={t} className="agent-pill agent-pill-tool">
              {t}
            </span>
          ))}
        </div>
      )}

      {evidence.length > 0 && (
        <details className="agent-msg-evidence">
          <summary>证据 {evidence.length} 条</summary>
          <ul>
            {evidence.map((e, i) => (
              <li key={`${e.toolId}-${i}`}>
                <div className="agent-evidence-head">
                  <code>{e.toolId}</code>
                  {e.key ? <span>{e.key}</span> : null}
                </div>
                <p>{e.excerpt}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type AgentHubFloatProps = {
  /** 登录用户 id；未登录不展示助手 */
  userId?: string | null;
  /** 当前店铺；与 userId 共同构成会话租户键 */
  shopId?: string | null;
};

/**
 * 右下角悬浮小慧助手。
 * 会话落在服务端 users/{userId}/agent-hub/conversations/{shopId}.json，按用户×店铺隔离。
 */
export function AgentHubFloat({ userId, shopId }: AgentHubFloatProps) {
  const panelId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const tenantKey = userId && shopId ? `${userId}::${shopId}` : "";

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [quickPrompts, setQuickPrompts] = useState<string[]>(() =>
    pickQuickPrompts(),
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    welcomeMessage(),
  ]);

  // 切换用户/店铺：重置并拉取该租户会话
  useEffect(() => {
    if (!tenantKey || !userId || !shopId) {
      setMessages([welcomeMessage()]);
      setOpen(false);
      return;
    }
    try {
      setOpen(localStorage.getItem(openStorageKey(userId)) === "1");
    } catch {
      setOpen(false);
    }
    setDraft("");
    setBusy(false);
    setLoadingHistory(true);
    setMessages([welcomeMessage()]);
    let cancelled = false;
    api
      .agentHubConversation()
      .then((res) => {
        if (cancelled) return;
        const data = res.data;
        // 防串：响应租户必须匹配当前上下文
        if (data.userId !== userId || data.shopId !== shopId) {
          setMessages([welcomeMessage()]);
          return;
        }
        setMessages(storedToUi(data));
      })
      .catch(() => {
        if (!cancelled) setMessages([welcomeMessage()]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantKey, userId, shopId]);

  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(openStorageKey(userId), open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open, userId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    setQuickPrompts(pickQuickPrompts());
    const t = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!userId || !shopId) return null;

  async function sendQuestion(raw: string) {
    const question = raw.trim();
    if (!question || busy || loadingHistory) return;

    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "human", text: question },
    ]);
    setBusy(true);

    try {
      // 历史由服务端按鉴权 user×shop 加载，客户端不再传 history
      const res = await api.agentHubAsk({ question });
      const data = res.data;
      if (
        data.tenant &&
        (data.tenant.userId !== userId || data.tenant.shopId !== shopId)
      ) {
        throw new Error("会话租户不匹配，已拒绝展示");
      }
      const verdict = data.answer?.verdict?.trim() || "未能形成结论";

      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "bot",
          text: verdict,
          ask: data,
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "请求失败";
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "error",
          text: `调用失败：${msg}。请确认已登录，且 DeepSeek 已配置。`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function clearConversation() {
    if (busy || loadingHistory) return;
    if (!window.confirm("清空当前店铺下的小慧对话记录？")) return;
    setBusy(true);
    try {
      await api.agentHubClearConversation();
      setMessages([welcomeMessage()]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "清空失败";
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "error", text: `清空失败：${msg}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendQuestion(draft);
    }
  }

  const hasRealTurns = messages.some(
    (m) => m.role === "human" || (m.role === "bot" && m.id !== "welcome"),
  );

  return (
    <div className={`agent-float${open ? " is-open" : ""}`}>
      {open && (
        <section
          className="agent-float-panel"
          id={panelId}
          role="dialog"
          aria-label={ASSISTANT_NAME}
        >
          <header className="agent-float-head">
            <div className="agent-float-brand">
              <span className="agent-float-avatar" aria-hidden>
                <span className="agent-float-avatar-eye" />
                <span className="agent-float-avatar-eye" />
              </span>
              <div>
                <strong>{ASSISTANT_NAME}</strong>
                <p>查工具 · 带证据 · 不瞎编</p>
              </div>
            </div>
            <div className="agent-float-head-actions">
              {hasRealTurns && (
                <button
                  type="button"
                  className="agent-float-icon-btn"
                  aria-label="清空本店对话"
                  title="清空本店对话"
                  disabled={busy || loadingHistory}
                  onClick={() => void clearConversation()}
                >
                  清
                </button>
              )}
              <button
                type="button"
                className="agent-float-icon-btn"
                aria-label={`收起${ASSISTANT_NAME}`}
                onClick={() => setOpen(false)}
              >
                −
              </button>
            </div>
          </header>

          <div className="agent-float-body">
            <div className="agent-float-messages" ref={listRef}>
              {messages.map((m) => {
                if (m.role === "human") {
                  return (
                    <div key={m.id} className="agent-msg agent-msg-human">
                      <div className="agent-msg-bubble">
                        <p>{m.text}</p>
                      </div>
                    </div>
                  );
                }
                if (m.role === "error") {
                  return (
                    <div key={m.id} className="agent-msg agent-msg-bot">
                      <span className="agent-msg-face" aria-hidden>
                        ◈
                      </span>
                      <div className="agent-msg-bubble agent-msg-error">
                        <p>{m.text}</p>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="agent-msg agent-msg-bot">
                    <span className="agent-msg-face" aria-hidden>
                      ◈
                    </span>
                    <BotAnswerCard text={m.text} ask={m.ask} />
                  </div>
                );
              })}

              {(busy || loadingHistory) && (
                <div className="agent-msg agent-msg-bot">
                  <span className="agent-msg-face" aria-hidden>
                    ◈
                  </span>
                  <div
                    className="agent-msg-bubble agent-msg-typing"
                    aria-live="polite"
                  >
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </div>

            {!busy && !loadingHistory && messages.length <= 2 && (
              <div className="agent-float-actions">
                {quickPrompts.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="agent-chip"
                    onClick={() => void sendQuestion(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <footer className="agent-float-composer">
              <textarea
                ref={inputRef}
                rows={2}
                value={draft}
                disabled={busy || loadingHistory}
                placeholder="例如：箱号 2508-01-N1-K 什么状态？"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <button
                type="button"
                className="btn btn-primary agent-float-send"
                disabled={busy || loadingHistory || !draft.trim()}
                onClick={() => void sendQuestion(draft)}
              >
                发送
              </button>
            </footer>
          </div>
        </section>
      )}

      <button
        type="button"
        className={`agent-float-ball${busy ? " is-busy" : ""}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? `收起${ASSISTANT_NAME}` : `打开${ASSISTANT_NAME}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agent-float-ball-face" aria-hidden>
          <span />
          <span />
        </span>
        {!open && busy && <span className="agent-float-ball-ring" aria-hidden />}
      </button>
    </div>
  );
}
