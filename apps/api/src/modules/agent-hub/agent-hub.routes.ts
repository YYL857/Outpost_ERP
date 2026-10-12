import { Router } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../../auth/middleware.js";
import { hasCapability } from "../../auth/permissions.js";
import { setAuditDetail } from "../audit/detail.js";
import { askAgentHub } from "./ask.js";
import { AGENT_TOOLS, ANTI_HALLUCINATION } from "./catalog.js";
import { agentHubRuntimeConfig } from "./config.js";
import {
  appendConversationTurn,
  clearConversation,
  conversationToHistory,
  loadConversation,
} from "./conversation-store.js";
import {
  buildAgentHubManifest,
  manifestToMarkdown,
  persistAgentHubManifest,
} from "./manifest.js";
import { emptyHubAnswer, validateHubAnswer } from "./validate.js";
import type { HubAnswer } from "./types.js";

function requireTenant(req: AuthedRequest):
  | { ok: true; userId: string; shopId: string }
  | { ok: false; status: number; error: string } {
  const userId = req.user?.id;
  const shopId = req.shopId;
  if (!userId) return { ok: false, status: 401, error: "未登录" };
  if (!shopId) return { ok: false, status: 400, error: "未选择店铺" };
  return { ok: true, userId, shopId };
}

export function createAgentHubRouter() {
  const router = Router();

  router.get("/manifest", (req, res) => {
    const format = String(req.query.format ?? "json");
    const persist = String(req.query.persist ?? "") === "1";
    const { manifest } = persist
      ? persistAgentHubManifest()
      : { manifest: buildAgentHubManifest() };
    if (format === "md" || format === "markdown") {
      res.type("text/markdown").send(manifestToMarkdown(manifest));
      return;
    }
    res.json({ ok: true, data: manifest });
  });

  router.get("/protocol", (_req, res) => {
    res.json({ ok: true, data: ANTI_HALLUCINATION });
  });

  router.get("/tools", (req, res) => {
    const kind = req.query.kind ? String(req.query.kind) : null;
    const tools = kind
      ? AGENT_TOOLS.filter((t) => t.kind === kind)
      : AGENT_TOOLS;
    res.json({ ok: true, data: tools });
  });

  /** 自检：提交一份 HubAnswer，返回是否违规（给网关/评测用） */
  router.post("/validate-answer", (req, res) => {
    const body = z
      .object({
        verdict: z.string(),
        confidence: z.enum(["high", "medium", "low", "none"]),
        evidence: z.array(
          z.object({
            toolId: z.string(),
            source: z.string(),
            key: z.string().optional(),
            excerpt: z.string(),
          }),
        ),
        openQuestions: z.array(z.string()),
        toolsUsed: z.array(z.string()),
        inferences: z.array(z.string()).optional(),
        notFound: z.array(z.string()).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ ok: false, error: body.error.flatten() });
      return;
    }
    const answer = body.data as HubAnswer;
    const result = validateHubAnswer(answer);
    res.status(result.ok ? 200 : 422).json({
      ok: result.ok,
      data: result,
      exampleEmpty: emptyHubAnswer("未调用工具前不得给出业务单号或金额。"),
    });
  });

  /** 落盘 manifest，方便 Agent 读本地文件 */
  router.post("/persist", (_req, res) => {
    const out = persistAgentHubManifest();
    res.json({ ok: true, data: out });
  });

  /** 运行时旋钮（不含密钥） */
  router.get("/runtime", (_req, res) => {
    res.json({ ok: true, data: agentHubRuntimeConfig() });
  });

  /**
   * 当前登录用户 × 当前店铺 的会话（多租户隔离，只读自己的）。
   * shopId/userId 一律取自鉴权上下文，忽略 query 伪造。
   */
  router.get("/conversation", (req, res) => {
    const tenant = requireTenant(req as AuthedRequest);
    if (!tenant.ok) {
      res.status(tenant.status).json({ ok: false, error: tenant.error });
      return;
    }
    const data = loadConversation(tenant.userId, tenant.shopId);
    res.json({ ok: true, data });
  });

  /** 清空当前用户 × 当前店铺会话 */
  router.delete("/conversation", (req, res) => {
    const tenant = requireTenant(req as AuthedRequest);
    if (!tenant.ok) {
      res.status(tenant.status).json({ ok: false, error: tenant.error });
      return;
    }
    const out = clearConversation(tenant.userId, tenant.shopId);
    setAuditDetail(req, {
      summary: `清空小慧会话 shop=${tenant.shopId}`,
      entityType: "agent-hub",
      entityId: "conversation",
      detail: { shopId: tenant.shopId, cleared: out.cleared },
    });
    res.json({ ok: true, data: out });
  });

  /**
   * DeepSeek 轻量编排：自动选工具 → loopback 执行 → HubAnswer → validate
   * 历史以服务端该用户×店铺会话为准（防脏数据/串租户）；body.history 忽略。
   */
  router.post("/ask", async (req, res) => {
    const user = (req as AuthedRequest).user;
    const tenant = requireTenant(req as AuthedRequest);
    if (!tenant.ok) {
      res.status(tenant.status).json({ ok: false, error: tenant.error });
      return;
    }
    const body = z
      .object({
        question: z.string().min(1).max(4000),
        allowMutate: z.boolean().optional(),
        allowNavigate: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ ok: false, error: body.error.flatten() });
      return;
    }
    const allowMutate =
      Boolean(body.data.allowMutate) &&
      hasCapability(user?.role, "agent.mutate");
    const qPreview = body.data.question.slice(0, 200);
    try {
      const stored = loadConversation(tenant.userId, tenant.shopId);
      const history = conversationToHistory(stored);
      const result = await askAgentHub({
        question: body.data.question,
        history,
        allowMutate,
        allowNavigate: body.data.allowNavigate,
        cookieHeader: req.headers.cookie,
        authorization: req.headers.authorization,
        role: user?.role ?? "ops",
      });

      const keys = [
        ...new Set(
          (result.answer.evidence ?? [])
            .map((e) => e.key?.trim())
            .filter((k): k is string => Boolean(k)),
        ),
      ];
      const persisted = appendConversationTurn({
        userId: tenant.userId,
        shopId: tenant.shopId,
        question: body.data.question,
        answer: result.answer.verdict || "未能形成结论",
        keys,
        toolsUsed: result.answer.toolsUsed,
        confidence: result.answer.confidence,
      });

      setAuditDetail(req, {
        summary: `Agent 问答：${qPreview}${body.data.question.length > 200 ? "…" : ""}`,
        entityType: "agent-hub",
        entityId: "ask",
        detail: {
          role: user?.role,
          shopId: tenant.shopId,
          toolsInvoked: result.toolsInvoked.map((t) => t.toolId),
          ok: result.ok,
          rounds: result.rounds,
          validationOk: result.validation.ok,
          historyTurns: history.length,
          conversation: result.conversation,
          storedMessages: persisted.messages.length,
        },
      });
      res.status(result.error && !result.toolsInvoked.length ? 503 : 200).json({
        ok: result.ok,
        data: {
          ...result,
          tenant: { userId: tenant.userId, shopId: tenant.shopId },
        },
      });
    } catch (e) {
      setAuditDetail(req, {
        summary: `Agent 问答失败：${qPreview}`,
        entityType: "agent-hub",
        entityId: "ask",
        detail: {
          role: user?.role,
          shopId: tenant.shopId,
          error: e instanceof Error ? e.message : String(e),
        },
      });
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
