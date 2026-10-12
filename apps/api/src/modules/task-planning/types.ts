import type { UserRole } from "../../auth/types.js";

export type TaskPriority = "normal" | "high" | "urgent";

export type TaskStatus =
  | "open"
  | "in_progress"
  | "submitted"
  | "done"
  | "rejected"
  | "cancelled";

export type TaskPerson = {
  id: string;
  username: string;
  role: UserRole;
};

export type TaskAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  relativePath: string;
  sizeBytes: number;
  createdAt: string;
  /** publish | submit */
  kind: "publish" | "submit";
};

export type TaskEventType =
  | "created"
  | "acked"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled";

export type TaskEvent = {
  id: string;
  type: TaskEventType;
  at: string;
  by: TaskPerson;
  message?: string;
};

export type TaskSubmission = {
  body: string;
  attachments: TaskAttachment[];
  submittedAt: string;
  submittedBy: TaskPerson;
};

export type TaskReview = {
  decision: "approve" | "reject";
  comment: string;
  reviewedAt: string;
  reviewedBy: TaskPerson;
};

export type TaskRecord = {
  id: string;
  title: string;
  body: string;
  priority: TaskPriority;
  dueAt: string | null;
  status: TaskStatus;
  createdBy: TaskPerson;
  assignee: TaskPerson;
  attachments: TaskAttachment[];
  /** 提交前暂存的成果附件 */
  draftSubmitAttachments: TaskAttachment[];
  submission: TaskSubmission | null;
  review: TaskReview | null;
  events: TaskEvent[];
  createdAt: string;
  updatedAt: string;
  ackedAt: string | null;
  /** 被指派人是否已看过退回通知 */
  rejectNotifiedAt: string | null;
};

export type TasksRegistry = {
  version: 1;
  tasks: TaskRecord[];
  updatedAt: string;
};

export type TaskInboxItem = {
  id: string;
  taskId: string;
  type: "new_assignment" | "pending_review" | "rejected";
  title: string;
  summary: string;
  createdAt: string;
};

export const MAX_ATTACHMENTS_PER_TASK = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
