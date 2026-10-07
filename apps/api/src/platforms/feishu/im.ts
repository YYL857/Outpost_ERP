/**
 * 飞书 IM 发送（日报简报试点）。
 * 只发消息到指定 chat/open_id；不改电子表格元数据/单元格。
 */
import { FeishuError } from "./errors.js";
import { getTenantAccessToken } from "./http.js";
import type { FeishuCredentials } from "./types.js";

const OPEN_BASE = "https://open.feishu.cn/open-apis";

export type FeishuReceiveIdType = "chat_id" | "open_id" | "user_id" | "union_id" | "email";

export type SendFeishuMessageResult = {
  messageId: string;
  chatId?: string;
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
  msgType: "text" | "interactive";
  textLength?: number;
  truncated?: boolean;
};

/** @deprecated 使用 SendFeishuMessageResult */
export type SendFeishuTextResult = SendFeishuMessageResult;

/** 飞书 text 单条建议控制在 4000 字内 */
const TEXT_SOFT_LIMIT = 3800;

export function markdownToFeishuText(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/^>\s?/gm, "")
    .trim();
}

async function postImMessage(opts: {
  credentials: FeishuCredentials;
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
  msgType: "text" | "interactive";
  content: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<SendFeishuMessageResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const token = await getTenantAccessToken(opts.credentials, fetchImpl);
  const url = `${OPEN_BASE}/im/v1/messages?receive_id_type=${encodeURIComponent(opts.receiveIdType)}`;
  const body = {
    receive_id: opts.receiveId,
    msg_type: opts.msgType,
    content: JSON.stringify(opts.content),
  };

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new FeishuError(
      "飞书发消息网络失败",
      "API_HTTP",
      "im",
      { cause: e instanceof Error ? e.message : String(e), receiveId: opts.receiveId },
      "检查本机网络能否访问 open.feishu.cn",
    );
  }

  const raw = await res.text();
  let envelope: {
    code?: number;
    msg?: string;
    data?: { message_id?: string; chat_id?: string };
  };
  try {
    envelope = JSON.parse(raw) as typeof envelope;
  } catch {
    throw new FeishuError(
      "飞书发消息响应不是 JSON",
      "API_HTTP",
      "im",
      { httpStatus: res.status, bodyPreview: raw.slice(0, 400) },
    );
  }

  if (!res.ok || envelope.code !== 0) {
    throw new FeishuError(
      `飞书发消息失败: ${envelope.msg ?? res.statusText}`,
      envelope.code && envelope.code !== 0 ? "API_BIZ" : "API_HTTP",
      "im",
      {
        httpStatus: res.status,
        code: envelope.code,
        msg: envelope.msg,
        receiveId: opts.receiveId,
        receiveIdType: opts.receiveIdType,
        msgType: opts.msgType,
        bodyPreview: raw.slice(0, 400),
      },
      hintForImError(envelope.code, envelope.msg ?? ""),
    );
  }

  return {
    messageId: String(envelope.data?.message_id ?? ""),
    chatId: envelope.data?.chat_id ? String(envelope.data.chat_id) : undefined,
    receiveId: opts.receiveId,
    receiveIdType: opts.receiveIdType,
    msgType: opts.msgType,
  };
}

export async function sendFeishuTextMessage(opts: {
  credentials: FeishuCredentials;
  receiveId: string;
  receiveIdType?: FeishuReceiveIdType;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<SendFeishuMessageResult> {
  const receiveIdType = opts.receiveIdType ?? "chat_id";
  let text = opts.text.trim();
  let truncated = false;
  if (text.length > TEXT_SOFT_LIMIT) {
    text = `${text.slice(0, TEXT_SOFT_LIMIT)}\n\n…（已截断，完整版见本地 daily_brief_summary.md）`;
    truncated = true;
  }

  const result = await postImMessage({
    credentials: opts.credentials,
    receiveId: opts.receiveId,
    receiveIdType,
    msgType: "text",
    content: { text },
    fetchImpl: opts.fetchImpl,
  });
  return { ...result, textLength: text.length, truncated };
}

export async function sendFeishuInteractiveMessage(opts: {
  credentials: FeishuCredentials;
  receiveId: string;
  receiveIdType?: FeishuReceiveIdType;
  card: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<SendFeishuMessageResult> {
  return postImMessage({
    credentials: opts.credentials,
    receiveId: opts.receiveId,
    receiveIdType: opts.receiveIdType ?? "chat_id",
    msgType: "interactive",
    content: opts.card,
    fetchImpl: opts.fetchImpl,
  });
}

function hintForImError(code: number | undefined, msg: string): string {
  if (code === 230002 || /bot not in chat|不在|not in/i.test(msg)) {
    return "机器人不在该会话中：把应用机器人拉进目标群，或确认 chat_id 属于本应用";
  }
  if (code === 99991672 || /permission|权限/i.test(msg)) {
    return "检查应用是否开通「发送消息」权限且版本已发布；chat_id 场景需机器人在群内";
  }
  if (/receive_id|invalid/i.test(msg)) {
    return "核对 chat_id / open_id 是否正确，且与当前 App ID 同一企业";
  }
  return "对照开放平台错误码；确认机器人能力与可用范围已发布";
}
