/**
 * 飞书日报推送接收人：chat_id ↔ 备注名（公司暂无群，靠固定会话推送）
 * 落盘：{OUTPOST_ROOT}/feishu-daily-brief/recipients.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type FeishuDailyRecipient = {
  id: string;
  /** 显示备注，如「慧慧」 */
  remark: string;
  /** 飞书会话 chat_id（oc_）或个人 open_id（ou_） */
  chatId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FeishuDailyRecipientsFile = {
  version: 1;
  updatedAt: string;
  recipients: FeishuDailyRecipient[];
};

const SEED_HUIHUI: Omit<FeishuDailyRecipient, "id" | "createdAt" | "updatedAt"> = {
  remark: "慧慧",
  chatId: "oc_786937f01598e95bf278dd22cd7b4f7f",
  enabled: true,
};

function rootDir(): string {
  const fromEnv = process.env.OUTPOST_FEISHU_DAILY_BRIEF_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  const outpost = process.env.OUTPOST_ROOT?.trim() || "D:\\outpost-data";
  return resolve(outpost, "feishu-daily-brief");
}

export function recipientsFilePath(): string {
  return join(rootDir(), "recipients.json");
}

function emptyFile(): FeishuDailyRecipientsFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    recipients: [
      {
        id: randomUUID(),
        ...SEED_HUIHUI,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function loadRecipients(): FeishuDailyRecipientsFile {
  const path = recipientsFilePath();
  if (!existsSync(path)) {
    const seeded = emptyFile();
    saveRecipients(seeded);
    return seeded;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as FeishuDailyRecipientsFile;
    if (!raw || !Array.isArray(raw.recipients)) return emptyFile();
    return {
      version: 1,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      recipients: raw.recipients.map((r) => ({
        id: String(r.id || randomUUID()),
        remark: String(r.remark || "").trim() || "未命名",
        chatId: String(r.chatId || "").trim(),
        enabled: r.enabled !== false,
        createdAt: r.createdAt || new Date().toISOString(),
        updatedAt: r.updatedAt || new Date().toISOString(),
      })),
    };
  } catch {
    return emptyFile();
  }
}

export function saveRecipients(file: FeishuDailyRecipientsFile): void {
  const dir = rootDir();
  mkdirSync(dir, { recursive: true });
  const next: FeishuDailyRecipientsFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    recipients: file.recipients,
  };
  writeFileSync(recipientsFilePath(), JSON.stringify(next, null, 2) + "\n", "utf8");
}

function assertChatId(chatId: string): string {
  const id = chatId.trim();
  if (!id.startsWith("oc_") && !id.startsWith("ou_")) {
    throw new Error("会话 ID 需以 oc_（会话）或 ou_（个人）开头");
  }
  return id;
}

export function listRecipients(): FeishuDailyRecipient[] {
  return loadRecipients().recipients;
}

export function upsertRecipient(input: {
  id?: string;
  remark: string;
  chatId: string;
  enabled?: boolean;
}): FeishuDailyRecipient {
  const remark = input.remark.trim();
  if (!remark) throw new Error("备注不能为空");
  const chatId = assertChatId(input.chatId);
  const file = loadRecipients();
  const now = new Date().toISOString();

  if (input.id) {
    const idx = file.recipients.findIndex((r) => r.id === input.id);
    if (idx < 0) throw new Error("接收人不存在");
    const dup = file.recipients.find(
      (r) => r.chatId === chatId && r.id !== input.id,
    );
    if (dup) throw new Error(`会话 ID 已绑定「${dup.remark}」`);
    const prev = file.recipients[idx]!;
    const next: FeishuDailyRecipient = {
      ...prev,
      remark,
      chatId,
      enabled: input.enabled ?? prev.enabled,
      updatedAt: now,
    };
    file.recipients[idx] = next;
    saveRecipients(file);
    return next;
  }

  const dup = file.recipients.find((r) => r.chatId === chatId);
  if (dup) throw new Error(`会话 ID 已绑定「${dup.remark}」`);
  const created: FeishuDailyRecipient = {
    id: randomUUID(),
    remark,
    chatId,
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };
  file.recipients.push(created);
  saveRecipients(file);
  return created;
}

export function deleteRecipient(id: string): boolean {
  const file = loadRecipients();
  const before = file.recipients.length;
  file.recipients = file.recipients.filter((r) => r.id !== id);
  if (file.recipients.length === before) return false;
  saveRecipients(file);
  return true;
}

export function resolvePushTargets(opts: {
  recipientIds?: string[];
  chatId?: string;
}): FeishuDailyRecipient[] {
  const all = listRecipients();
  if (opts.recipientIds?.length) {
    const set = new Set(opts.recipientIds);
    const hit = all.filter((r) => set.has(r.id) && r.enabled);
    if (!hit.length) throw new Error("未选中有效接收人（或已禁用）");
    return hit;
  }
  if (opts.chatId?.trim()) {
    const chatId = assertChatId(opts.chatId);
    const known = all.find((r) => r.chatId === chatId);
    return [
      known ?? {
        id: "adhoc",
        remark: "临时会话",
        chatId,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }
  const enabled = all.filter((r) => r.enabled);
  if (!enabled.length) {
    throw new Error("没有启用的接收人，请先在用户管理中添加");
  }
  // 默认只推第一个启用的，避免误群发；显式多选再多人
  return [enabled[0]!];
}
