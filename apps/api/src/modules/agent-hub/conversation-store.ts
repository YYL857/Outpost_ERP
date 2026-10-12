/**
 * 小慧助手会话落盘：按 userId + shopId 强隔离。
 * 路径只由服务端鉴权上下文拼出，禁止信任客户端传入的 userId/shopId。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ensureUserWorkspace,
  userRoot,
} from "../../auth/workspace.js";
import type { ConversationTurn } from "./conversation-context.js";

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  keys?: string[];
  createdAt: string;
  toolsUsed?: string[];
  confidence?: string;
};

export type StoredConversation = {
  version: 1;
  userId: string;
  shopId: string;
  updatedAt: string;
  messages: StoredChatMessage[];
};

const MAX_STORED_MESSAGES = 40;

export function assertTenantId(kind: "userId" | "shopId", value: string): string {
  const v = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(v)) {
    throw new Error(`非法${kind}`);
  }
  return v;
}

export function userAgentHubDir(userId: string): string {
  const uid = assertTenantId("userId", userId);
  return join(userRoot(uid), "agent-hub");
}

export function conversationFilePath(userId: string, shopId: string): string {
  const uid = assertTenantId("userId", userId);
  const sid = assertTenantId("shopId", shopId);
  return join(userAgentHubDir(uid), "conversations", `${sid}.json`);
}

function emptyConversation(userId: string, shopId: string): StoredConversation {
  return {
    version: 1,
    userId,
    shopId,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

function ensureConversationDir(userId: string) {
  ensureUserWorkspace(userId);
  const dir = join(userAgentHubDir(userId), "conversations");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 读取当前用户在指定店铺下的会话。
 * 若文件内 userId/shopId 与请求不一致，视为脏数据并返回空会话（防串读）。
 */
export function loadConversation(
  userId: string,
  shopId: string,
): StoredConversation {
  const uid = assertTenantId("userId", userId);
  const sid = assertTenantId("shopId", shopId);
  const path = conversationFilePath(uid, sid);
  if (!existsSync(path)) return emptyConversation(uid, sid);
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredConversation>;
    if (raw.userId !== uid || raw.shopId !== sid) {
      return emptyConversation(uid, sid);
    }
    const messages = Array.isArray(raw.messages)
      ? raw.messages
          .filter(
            (m): m is StoredChatMessage =>
              !!m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          )
          .map((m) => ({
            id: String(m.id || `${m.createdAt}-${m.role}`),
            role: m.role,
            content: String(m.content).slice(0, 2000),
            keys: Array.isArray(m.keys)
              ? m.keys.map(String).filter(Boolean).slice(0, 20)
              : undefined,
            createdAt: String(m.createdAt || new Date().toISOString()),
            toolsUsed: Array.isArray(m.toolsUsed)
              ? m.toolsUsed.map(String).slice(0, 20)
              : undefined,
            confidence:
              typeof m.confidence === "string" ? m.confidence : undefined,
          }))
          .slice(-MAX_STORED_MESSAGES)
      : [];
    return {
      version: 1,
      userId: uid,
      shopId: sid,
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
      messages,
    };
  } catch {
    return emptyConversation(uid, sid);
  }
}

export function saveConversation(conv: StoredConversation): StoredConversation {
  const uid = assertTenantId("userId", conv.userId);
  const sid = assertTenantId("shopId", conv.shopId);
  ensureConversationDir(uid);
  const next: StoredConversation = {
    version: 1,
    userId: uid,
    shopId: sid,
    updatedAt: new Date().toISOString(),
    messages: conv.messages.slice(-MAX_STORED_MESSAGES),
  };
  writeFileSync(
    conversationFilePath(uid, sid),
    JSON.stringify(next, null, 2),
    "utf8",
  );
  return next;
}

export function clearConversation(
  userId: string,
  shopId: string,
): { cleared: boolean; path: string } {
  const uid = assertTenantId("userId", userId);
  const sid = assertTenantId("shopId", shopId);
  const path = conversationFilePath(uid, sid);
  if (existsSync(path)) {
    unlinkSync(path);
    return { cleared: true, path };
  }
  return { cleared: false, path };
}

export function conversationToHistory(
  conv: StoredConversation,
): ConversationTurn[] {
  return conv.messages.map((m) => ({
    role: m.role,
    content: m.content,
    keys: m.keys,
  }));
}

function newMsgId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 追加一轮问答到该用户店铺会话（只写调用方传入的 tenant） */
export function appendConversationTurn(input: {
  userId: string;
  shopId: string;
  question: string;
  answer: string;
  keys?: string[];
  toolsUsed?: string[];
  confidence?: string;
}): StoredConversation {
  const uid = assertTenantId("userId", input.userId);
  const sid = assertTenantId("shopId", input.shopId);
  const conv = loadConversation(uid, sid);
  const now = new Date().toISOString();
  const q = String(input.question ?? "").trim().slice(0, 2000);
  const a = String(input.answer ?? "").trim().slice(0, 2000);
  if (q) {
    conv.messages.push({
      id: newMsgId(),
      role: "user",
      content: q,
      createdAt: now,
    });
  }
  if (a) {
    conv.messages.push({
      id: newMsgId(),
      role: "assistant",
      content: a,
      keys: input.keys?.map(String).filter(Boolean).slice(0, 20),
      toolsUsed: input.toolsUsed?.map(String).slice(0, 20),
      confidence: input.confidence,
      createdAt: now,
    });
  }
  return saveConversation(conv);
}
