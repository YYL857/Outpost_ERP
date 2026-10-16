import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OUTPOST_ROOT } from "../../shops/registry.js";
import type { AuthUser } from "../../auth/types.js";
import type {
  TaskAttachment,
  TaskEvent,
  TaskEventType,
  TaskPerson,
  TaskPriority,
  TaskRecord,
  TasksRegistry,
  TaskStatus,
} from "./types.js";

const ROOT = join(OUTPOST_ROOT, "task-planning");
const REGISTRY_PATH = join(ROOT, "tasks.json");
const FILES_ROOT = join(ROOT, "files");

function nowIso() {
  return new Date().toISOString();
}

function ensureDirs() {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  if (!existsSync(FILES_ROOT)) mkdirSync(FILES_ROOT, { recursive: true });
}

export function taskPlanningRoot() {
  return ROOT;
}

export function taskFilesDir(taskId: string) {
  return join(FILES_ROOT, taskId);
}

export function attachmentAbsPath(att: TaskAttachment) {
  return join(ROOT, att.relativePath);
}

export function toPerson(u: AuthUser): TaskPerson {
  return { id: u.id, username: u.username, role: u.role };
}

export function loadTasksRegistry(): TasksRegistry {
  ensureDirs();
  if (!existsSync(REGISTRY_PATH)) {
    const empty: TasksRegistry = {
      version: 1,
      tasks: [],
      updatedAt: nowIso(),
    };
    writeFileSync(REGISTRY_PATH, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as TasksRegistry;
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map((t) => ({
    ...t,
    draftSubmitAttachments: t.draftSubmitAttachments ?? [],
    rejectNotifiedAt: t.rejectNotifiedAt ?? null,
    reviewNotifiedAt: t.reviewNotifiedAt ?? null,
  }));
  return {
    version: 1,
    tasks,
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

export function saveTasksRegistry(reg: TasksRegistry) {
  ensureDirs();
  const next: TasksRegistry = {
    version: 1,
    tasks: reg.tasks,
    updatedAt: nowIso(),
  };
  writeFileSync(REGISTRY_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function findTask(id: string): TaskRecord | undefined {
  return loadTasksRegistry().tasks.find((t) => t.id === id);
}

export function saveTask(task: TaskRecord): TaskRecord {
  const reg = loadTasksRegistry();
  const idx = reg.tasks.findIndex((t) => t.id === task.id);
  const next = { ...task, updatedAt: nowIso() };
  if (idx < 0) reg.tasks.unshift(next);
  else reg.tasks[idx] = next;
  saveTasksRegistry(reg);
  return next;
}

function pushEvent(
  task: TaskRecord,
  type: TaskEventType,
  by: TaskPerson,
  message?: string,
): TaskEvent {
  const ev: TaskEvent = {
    id: `ev-${randomUUID().slice(0, 8)}`,
    type,
    at: nowIso(),
    by,
    message,
  };
  task.events.push(ev);
  return ev;
}

export function createTask(input: {
  title: string;
  body: string;
  priority: TaskPriority;
  dueAt: string | null;
  createdBy: AuthUser;
  assignee: TaskPerson;
}): TaskRecord {
  const ts = nowIso();
  const createdBy = toPerson(input.createdBy);
  const task: TaskRecord = {
    id: `task-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
    title: input.title,
    body: input.body,
    priority: input.priority,
    dueAt: input.dueAt,
    status: "open",
    createdBy,
    assignee: input.assignee,
    attachments: [],
    draftSubmitAttachments: [],
    submission: null,
    review: null,
    events: [],
    createdAt: ts,
    updatedAt: ts,
    ackedAt: null,
    rejectNotifiedAt: null,
    reviewNotifiedAt: null,
  };
  pushEvent(task, "created", createdBy, `指派给 ${input.assignee.username}`);
  return saveTask(task);
}

export function ackTask(task: TaskRecord, user: AuthUser): TaskRecord {
  if (task.status !== "open") {
    throw new Error("仅待确认任务可确认收到");
  }
  task.ackedAt = nowIso();
  task.status = "in_progress";
  pushEvent(task, "acked", toPerson(user));
  return saveTask(task);
}

export function submitTask(
  task: TaskRecord,
  user: AuthUser,
  body: string,
): TaskRecord {
  if (task.status !== "in_progress" && task.status !== "rejected") {
    throw new Error("当前状态不可提交");
  }
  if (!body.trim() && !(task.draftSubmitAttachments?.length > 0)) {
    throw new Error("请填写提交说明或上传附件");
  }
  const person = toPerson(user);
  const draft = task.draftSubmitAttachments ?? [];
  task.submission = {
    body: body.trim(),
    attachments: draft,
    submittedAt: nowIso(),
    submittedBy: person,
  };
  task.draftSubmitAttachments = [];
  task.status = "submitted";
  task.review = null;
  task.reviewNotifiedAt = null;
  pushEvent(task, "submitted", person, body.trim().slice(0, 120) || undefined);
  return saveTask(task);
}

export function reviewTask(
  task: TaskRecord,
  user: AuthUser,
  decision: "approve" | "reject",
  comment: string,
): TaskRecord {
  if (task.status !== "submitted") {
    throw new Error("仅待验收任务可验收");
  }
  const person = toPerson(user);
  task.review = {
    decision,
    comment,
    reviewedAt: nowIso(),
    reviewedBy: person,
  };
  if (decision === "approve") {
    task.status = "done";
    pushEvent(task, "approved", person, comment || undefined);
  } else {
    task.status = "rejected";
    task.rejectNotifiedAt = null;
    pushEvent(task, "rejected", person, comment || undefined);
  }
  return saveTask(task);
}

export function cancelTask(task: TaskRecord, user: AuthUser): TaskRecord {
  const allowed: TaskStatus[] = ["open", "in_progress", "rejected"];
  if (!allowed.includes(task.status)) {
    throw new Error("当前状态不可取消");
  }
  task.status = "cancelled";
  pushEvent(task, "cancelled", toPerson(user));
  return saveTask(task);
}

export function markRejectSeen(task: TaskRecord): TaskRecord {
  task.rejectNotifiedAt = nowIso();
  return saveTask(task);
}

export function markReviewSeen(task: TaskRecord): TaskRecord {
  task.reviewNotifiedAt = nowIso();
  return saveTask(task);
}

export function isIncompleteStatus(status: TaskStatus) {
  return (
    status === "open" ||
    status === "in_progress" ||
    status === "submitted" ||
    status === "rejected"
  );
}

export function canViewTask(task: TaskRecord, user: AuthUser): boolean {
  if (user.role === "admin") return true;
  if (user.role === "ops_lead") {
    if (task.createdBy.id === user.id) return true;
    if (task.assignee.id === user.id && isIncompleteStatus(task.status)) {
      return true;
    }
    return false;
  }
  return task.assignee.id === user.id;
}

export function listTasksForUser(user: AuthUser): TaskRecord[] {
  return loadTasksRegistry().tasks.filter((t) => canViewTask(t, user));
}
