import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AuthUser } from "../../auth/types.js";
import { findUserById, loadUsersRegistry } from "../../auth/users.js";
import type { TaskAttachment, TaskPerson, TaskRecord } from "./types.js";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
} from "./types.js";
import {
  attachmentAbsPath,
  canViewTask,
  saveTask,
  taskFilesDir,
  taskPlanningRoot,
} from "./store.js";

export function listAssignableUsers(
  actor: AuthUser,
  showAll = false,
): Array<TaskPerson & { disabled: boolean }> {
  const users = loadUsersRegistry().users;
  const mapped = users.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: Boolean(u.disabled),
  }));

  if (actor.role === "admin") {
    if (showAll) return mapped;
    return mapped.filter((u) => !u.disabled);
  }
  if (actor.role === "ops_lead") {
    return mapped.filter((u) => u.role === "ops" && !u.disabled);
  }
  return [];
}

export function resolveAssignee(
  actor: AuthUser,
  assigneeId: string,
): TaskPerson {
  const record = findUserById(assigneeId);
  if (!record) throw new Error("指派对象不存在");
  if (record.disabled) throw new Error("不能指派已停用账号");

  if (actor.role === "admin") {
    return {
      id: record.id,
      username: record.username,
      role: record.role,
    };
  }
  if (actor.role === "ops_lead") {
    if (record.role !== "ops") {
      throw new Error("运营主管只能向运营分配任务");
    }
    return {
      id: record.id,
      username: record.username,
      role: record.role,
    };
  }
  throw new Error("当前角色不能分配任务");
}

export function assertCanAssign(actor: AuthUser) {
  if (actor.role !== "admin" && actor.role !== "ops_lead") {
    throw new Error("仅超管或运营主管可分配任务");
  }
}

function countAttachments(task: TaskRecord) {
  const submitCount = task.submission?.attachments.length ?? 0;
  const draft = task.draftSubmitAttachments?.length ?? 0;
  return task.attachments.length + submitCount + draft;
}

export function addAttachmentToTask(
  task: TaskRecord,
  user: AuthUser,
  input: {
    filename: string;
    mimeType: string;
    base64: string;
    kind: "publish" | "submit";
  },
): { task: TaskRecord; attachment: TaskAttachment } {
  if (!canViewTask(task, user)) {
    throw new Error("无权操作该任务");
  }
  if (input.kind === "publish") {
    if (task.createdBy.id !== user.id) {
      throw new Error("仅创建者可添加发布附件");
    }
    if (task.status !== "open" && task.status !== "in_progress") {
      throw new Error("当前状态不可添加发布附件");
    }
  } else {
    if (task.assignee.id !== user.id) {
      throw new Error("仅被指派人可添加提交附件");
    }
    if (task.status !== "in_progress" && task.status !== "rejected") {
      throw new Error("当前状态不可添加提交附件");
    }
  }

  if (countAttachments(task) >= MAX_ATTACHMENTS_PER_TASK) {
    throw new Error(`单个任务最多 ${MAX_ATTACHMENTS_PER_TASK} 个附件`);
  }

  const base64 = input.base64.replace(/^data:[^;]+;base64,/, "");
  if (!base64) throw new Error("base64 必填");
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    throw new Error("base64 无效");
  }
  if (buf.length > MAX_ATTACHMENT_BYTES) {
    throw new Error("单个附件不超过 20MB");
  }

  const dir = taskFilesDir(task.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = `att-${randomUUID().slice(0, 8)}`;
  const safeName =
    input.filename.replace(/[^\w.\-()+ \u4e00-\u9fff]+/g, "_").slice(0, 120) ||
    "file.bin";
  const diskName = `${id}-${safeName}`;
  writeFileSync(join(dir, diskName), buf);
  const relativePath = join("files", task.id, diskName).replace(/\\/g, "/");
  const attachment: TaskAttachment = {
    id,
    filename: safeName,
    mimeType: input.mimeType || "application/octet-stream",
    relativePath,
    sizeBytes: buf.length,
    createdAt: new Date().toISOString(),
    kind: input.kind,
  };

  if (!task.draftSubmitAttachments) task.draftSubmitAttachments = [];

  if (input.kind === "publish") {
    task.attachments.push(attachment);
  } else {
    task.draftSubmitAttachments.push(attachment);
  }
  return { task: saveTask(task), attachment };
}

export function findAttachment(
  task: TaskRecord,
  attachmentId: string,
): TaskAttachment | undefined {
  const fromPublish = task.attachments.find((a) => a.id === attachmentId);
  if (fromPublish) return fromPublish;
  const fromDraft = (task.draftSubmitAttachments ?? []).find(
    (a) => a.id === attachmentId,
  );
  if (fromDraft) return fromDraft;
  return task.submission?.attachments.find((a) => a.id === attachmentId);
}

export { attachmentAbsPath, taskPlanningRoot };
