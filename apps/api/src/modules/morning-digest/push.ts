/**
 * 晨报推送：复用日报收件人登记。
 */
import {
  loadFeishuDocsConfig,
  sendFeishuInteractiveMessage,
  sendFeishuTextMessage,
} from "../../platforms/feishu/index.js";
import { resolvePushTargets } from "../daily-brief/recipients.js";

export type PushResultRow = {
  remark: string;
  chatId: string;
  messageId: string;
  ok: boolean;
  error?: string;
};

export async function pushDigestCard(opts: {
  card: Record<string, unknown>;
  recipientIds?: string[];
  chatId?: string;
}): Promise<{ results: PushResultRow[]; okCount: number }> {
  const targets = resolvePushTargets({
    recipientIds: opts.recipientIds,
    chatId: opts.chatId,
  });
  const cfg = loadFeishuDocsConfig({ requireCredentials: true });
  const results: PushResultRow[] = [];

  for (const t of targets) {
    try {
      const receiveIdType = t.chatId.startsWith("ou_") ? "open_id" : "chat_id";
      const sent = await sendFeishuInteractiveMessage({
        credentials: cfg.credentials,
        receiveId: t.chatId,
        receiveIdType,
        card: opts.card,
      });
      results.push({
        remark: t.remark,
        chatId: t.chatId,
        messageId: sent.messageId,
        ok: true,
      });
    } catch (e) {
      results.push({
        remark: t.remark,
        chatId: t.chatId,
        messageId: "",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { results, okCount: results.filter((r) => r.ok).length };
}

export async function pushDigestText(opts: {
  text: string;
  recipientIds?: string[];
  chatId?: string;
}): Promise<{ results: PushResultRow[]; okCount: number }> {
  const targets = resolvePushTargets({
    recipientIds: opts.recipientIds,
    chatId: opts.chatId,
  });
  const cfg = loadFeishuDocsConfig({ requireCredentials: true });
  const results: PushResultRow[] = [];
  for (const t of targets) {
    try {
      const receiveIdType = t.chatId.startsWith("ou_") ? "open_id" : "chat_id";
      const sent = await sendFeishuTextMessage({
        credentials: cfg.credentials,
        receiveId: t.chatId,
        receiveIdType,
        text: opts.text,
      });
      results.push({
        remark: t.remark,
        chatId: t.chatId,
        messageId: sent.messageId,
        ok: true,
      });
    } catch (e) {
      results.push({
        remark: t.remark,
        chatId: t.chatId,
        messageId: "",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { results, okCount: results.filter((r) => r.ok).length };
}
