import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  api,
  type AuthUserPublic,
  type TaskAssigneeOption,
  type TaskAttachment,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from "../api";
import { ClearableInput } from "../components/ClearableInput";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const i = result.indexOf(",");
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function statusLabel(s: TaskStatus) {
  switch (s) {
    case "open":
      return "待确认";
    case "in_progress":
      return "进行中";
    case "submitted":
      return "待验收";
    case "done":
      return "已完成";
    case "rejected":
      return "已退回";
    case "cancelled":
      return "已取消";
    default:
      return s;
  }
}

function statusTone(s: TaskStatus): "ok" | "warn" | "danger" | "idle" {
  if (s === "done") return "ok";
  if (s === "submitted" || s === "in_progress") return "warn";
  if (s === "rejected" || s === "cancelled") return "danger";
  return "idle";
}

function priorityLabel(p: TaskPriority) {
  if (p === "urgent") return "紧急";
  if (p === "high") return "重要";
  return "普通";
}

function formatTime(iso?: string | null) {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

type TabKey = "mine" | "assigned" | "done";

type Props = {
  focusTaskId?: string | null;
  onFocusConsumed?: () => void;
};

export function TaskPlanningPage({ focusTaskId, onFocusConsumed }: Props) {
  const [me, setMe] = useState<AuthUserPublic | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [assignees, setAssignees] = useState<TaskAssigneeOption[]>([]);
  const [showAllAssignees, setShowAllAssignees] = useState(false);
  const [tab, setTab] = useState<TabKey>("mine");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueAt, setDueAt] = useState("");
  const [publishFiles, setPublishFiles] = useState<File[]>([]);

  const [submitBody, setSubmitBody] = useState("");
  const [submitFiles, setSubmitFiles] = useState<File[]>([]);
  const [reviewComment, setReviewComment] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);

  const canAssign = me?.role === "admin" || me?.role === "ops_lead";

  async function reload() {
    const [meRes, list] = await Promise.all([api.me(), api.listTasks()]);
    setMe(meRes.data.user);
    setTasks(list.data);
    return meRes.data.user;
  }

  async function loadAssignees(user: AuthUserPublic, showAll: boolean) {
    if (user.role !== "admin" && user.role !== "ops_lead") {
      setAssignees([]);
      return;
    }
    const res = await api.listTaskAssignees(showAll);
    setAssignees(res.data);
    setAssigneeId((prev) => {
      if (prev && res.data.some((a) => a.id === prev && !a.disabled)) return prev;
      const first = res.data.find((a) => !a.disabled);
      return first?.id ?? "";
    });
  }

  useEffect(() => {
    reload()
      .then((user) => {
        loadAssignees(user, false);
        if (user.role === "admin" || user.role === "ops_lead") {
          setComposerOpen(true);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  useEffect(() => {
    if (!me || !canAssign) return;
    loadAssignees(me, showAllAssignees).catch((e) =>
      setError(e instanceof Error ? e.message : "加载指派人失败"),
    );
  }, [showAllAssignees, me?.id, canAssign]);

  useEffect(() => {
    if (!focusTaskId) return;
    setSelectedId(focusTaskId);
    const t = tasks.find((x) => x.id === focusTaskId);
    if (t) {
      if (t.createdBy.id === me?.id) setTab("assigned");
      else if (t.status === "done" || t.status === "cancelled") setTab("done");
      else setTab("mine");
    }
    onFocusConsumed?.();
  }, [focusTaskId, tasks, me?.id, onFocusConsumed]);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  const counts = useMemo(() => {
    if (!me) return { ack: 0, work: 0, review: 0 };
    return {
      ack: tasks.filter(
        (t) => t.assignee.id === me.id && t.status === "open",
      ).length,
      work: tasks.filter(
        (t) =>
          t.assignee.id === me.id &&
          (t.status === "in_progress" || t.status === "rejected"),
      ).length,
      review: tasks.filter(
        (t) => t.createdBy.id === me.id && t.status === "submitted",
      ).length,
    };
  }, [tasks, me]);

  const filtered = useMemo(() => {
    if (!me) return [];
    if (tab === "mine") {
      return tasks.filter(
        (t) =>
          t.assignee.id === me.id &&
          t.status !== "done" &&
          t.status !== "cancelled",
      );
    }
    if (tab === "assigned") {
      return tasks.filter((t) => t.createdBy.id === me.id);
    }
    return tasks.filter(
      (t) =>
        (t.assignee.id === me.id || t.createdBy.id === me.id) &&
        (t.status === "done" || t.status === "cancelled"),
    );
  }, [tasks, me, tab]);

  async function run(action: () => Promise<string | undefined>) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const message = await action();
      if (message) setMsg(message);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!canAssign) return;
    await run(async () => {
      const res = await api.createTask({
        title,
        body,
        assigneeId,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      let task = res.data;
      for (const file of publishFiles) {
        const base64 = await fileToBase64(file);
        const up = await api.uploadTaskAttachment(task.id, {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
          kind: "publish",
        });
        task = up.data;
      }
      setTitle("");
      setBody("");
      setPriority("normal");
      setDueAt("");
      setPublishFiles([]);
      setTab("assigned");
      setSelectedId(task.id);
      setComposerOpen(false);
      return res.message ?? `已通知 ${task.assignee.username}`;
    });
  }

  async function onAck(task: TaskRecord) {
    await run(async () => {
      const res = await api.ackTask(task.id);
      setSelectedId(task.id);
      return res.message;
    });
  }

  async function onSubmit(task: TaskRecord) {
    await run(async () => {
      let latest = task;
      for (const file of submitFiles) {
        const base64 = await fileToBase64(file);
        const up = await api.uploadTaskAttachment(latest.id, {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
          kind: "submit",
        });
        latest = up.data;
      }
      const res = await api.submitTask(latest.id, submitBody);
      setSubmitBody("");
      setSubmitFiles([]);
      return res.message;
    });
  }

  async function onReview(task: TaskRecord, decision: "approve" | "reject") {
    await run(async () => {
      const res = await api.reviewTask(task.id, {
        decision,
        comment: reviewComment,
      });
      setReviewComment("");
      return res.message;
    });
  }

  async function onCancel(task: TaskRecord) {
    if (!window.confirm(`确认取消「${task.title}」？`)) return;
    await run(async () => {
      const res = await api.cancelTask(task.id);
      return res.message;
    });
  }

  function AttachmentList({
    taskId,
    items,
  }: {
    taskId: string;
    items: TaskAttachment[];
  }) {
    if (!items.length) return <p className="muted">无附件</p>;
    return (
      <ul className="task-att-list">
        {items.map((a) => {
          const url = api.taskAttachmentUrl(taskId, a.id);
          return (
            <li key={a.id} className="task-att-item">
              {isImage(a.mimeType) ? (
                <a href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt={a.filename} className="task-att-thumb" />
                </a>
              ) : (
                <a href={url} target="_blank" rel="noreferrer">
                  {a.filename}
                </a>
              )}
              <span className="muted">{formatSize(a.sizeBytes)}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="task-page">
      <header className="task-head">
        <div className="task-head-main">
          <h1 className="page-title">任务规划</h1>
          <div className="task-pill-row">
            <button type="button" className="task-pill" onClick={() => setTab("mine")}>
              待确认 <b>{counts.ack}</b>
            </button>
            <button type="button" className="task-pill" onClick={() => setTab("mine")}>
              待处理 <b>{counts.work}</b>
            </button>
            <button
              type="button"
              className="task-pill"
              onClick={() => setTab(canAssign ? "assigned" : "mine")}
            >
              待验收 <b>{counts.review}</b>
            </button>
          </div>
        </div>
        {canAssign && (
          <button
            type="button"
            className={`btn ${composerOpen ? "" : "btn-primary"}`}
            onClick={() => setComposerOpen((v) => !v)}
          >
            {composerOpen ? "收起发布" : "发布任务"}
          </button>
        )}
      </header>

      <p className="page-desc task-head-desc">
        超管可向全员派发；运营主管可向运营派发。确认后提交，由创建者验收。
      </p>

      {error && <p className="login-error">{error}</p>}
      {msg && <p className="ok-msg">{msg}</p>}

      {canAssign && composerOpen && (
        <section className="card task-composer-card">
          <form className="task-composer" onSubmit={onCreate}>
            <div className="task-composer-grid">
              <label className="field task-span-2">
                <span>标题</span>
                <ClearableInput
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  required
                  placeholder="一句话说清要做什么"
                />
              </label>
              <label className="field task-span-2">
                <span>说明</span>
                <textarea
                  className="input task-textarea"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={busy}
                  rows={2}
                  placeholder="步骤、验收标准、注意事项…"
                />
              </label>
              <label className="field">
                <span>指派给</span>
                <select
                  className="input"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  disabled={busy}
                  required
                >
                  {assignees.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.disabled}>
                      {a.username}
                      {a.role === "admin"
                        ? " · 超管"
                        : a.role === "ops_lead"
                          ? " · 主管"
                          : " · 运营"}
                      {a.disabled ? " · 已停用" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>优先级</span>
                <select
                  className="input"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  disabled={busy}
                >
                  <option value="normal">普通</option>
                  <option value="high">重要</option>
                  <option value="urgent">紧急</option>
                </select>
              </label>
              <label className="field">
                <span>截止日期</span>
                <ClearableInput
                  className="input"
                  type="date"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>附件</span>
                <label className="task-file">
                  <input
                    type="file"
                    multiple
                    disabled={busy}
                    onChange={(e) =>
                      setPublishFiles(Array.from(e.target.files ?? []))
                    }
                  />
                  <span>
                    {publishFiles.length > 0
                      ? `已选 ${publishFiles.length} 个`
                      : "图片 / 文件"}
                  </span>
                </label>
              </label>
            </div>
            <div className="task-composer-foot">
              {me?.role === "admin" && (
                <label className="row task-check">
                  <input
                    type="checkbox"
                    checked={showAllAssignees}
                    onChange={(e) => setShowAllAssignees(e.target.checked)}
                    disabled={busy}
                  />
                  <span>显示全部账号（含停用）</span>
                </label>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !title.trim() || !assigneeId}
              >
                发布并通知
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card task-board">
        <div className="row task-tabs">
          <button
            type="button"
            className={`btn-ghost${tab === "mine" ? " is-on" : ""}`}
            onClick={() => setTab("mine")}
          >
            待我处理
          </button>
          {canAssign && (
            <button
              type="button"
              className={`btn-ghost${tab === "assigned" ? " is-on" : ""}`}
              onClick={() => setTab("assigned")}
            >
              我分配的
            </button>
          )}
          <button
            type="button"
            className={`btn-ghost${tab === "done" ? " is-on" : ""}`}
            onClick={() => setTab("done")}
          >
            已完成
          </button>
        </div>

        <div className={`task-split${filtered.length === 0 ? " is-empty" : ""}`}>
          <div className="task-list">
            {filtered.length === 0 && (
              <div className="task-empty">
                <strong>暂无任务</strong>
                <span className="muted">
                  {canAssign
                    ? "点上方「发布任务」派一条，或等别人指派给你。"
                    : "有新任务时会出现在这里。"}
                </span>
                {canAssign && !composerOpen && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setComposerOpen(true)}
                  >
                    发布任务
                  </button>
                )}
              </div>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`task-row${selectedId === t.id ? " active" : ""}`}
                onClick={() => setSelectedId(t.id)}
              >
                <div className="task-row-top">
                  <strong>{t.title}</strong>
                  <span className={`badge ${statusTone(t.status)}`}>
                    {statusLabel(t.status)}
                  </span>
                </div>
                <div className="task-row-meta muted">
                  <span className={`task-priority task-priority-${t.priority}`}>
                    {priorityLabel(t.priority)}
                  </span>
                  <span>
                    {tab === "assigned"
                      ? `→ ${t.assignee.username}`
                      : `← ${t.createdBy.username}`}
                  </span>
                  <span>截止 {formatTime(t.dueAt)}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="task-detail">
            {!selected && (
              <div className="task-empty">
                <strong>任务详情</strong>
                <span className="muted">从左侧选一条查看说明、附件和验收。</span>
              </div>
            )}
            {selected && me && (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>{selected.title}</h3>
                  <span className={`badge ${statusTone(selected.status)}`}>
                    {statusLabel(selected.status)}
                  </span>
                </div>
                <p className="muted">
                  创建 {selected.createdBy.username} · 指派{" "}
                  {selected.assignee.username} ·{" "}
                  {priorityLabel(selected.priority)} · 截止{" "}
                  {formatTime(selected.dueAt)}
                </p>
                <div className="task-body">
                  {selected.body || (
                    <span className="muted">（无文字说明）</span>
                  )}
                </div>
                <h4>发布附件</h4>
                <AttachmentList
                  taskId={selected.id}
                  items={selected.attachments}
                />

                {selected.submission && (
                  <>
                    <h4>提交内容</h4>
                    <div className="task-body">
                      {selected.submission.body || (
                        <span className="muted">（无文字）</span>
                      )}
                    </div>
                    <AttachmentList
                      taskId={selected.id}
                      items={selected.submission.attachments}
                    />
                  </>
                )}

                {selected.review && (
                  <>
                    <h4>
                      验收结果：
                      {selected.review.decision === "approve"
                        ? "通过"
                        : "退回"}
                    </h4>
                    <p>{selected.review.comment || "（无评语）"}</p>
                  </>
                )}

                <h4>时间线</h4>
                <ul className="task-timeline">
                  {selected.events.map((ev) => (
                    <li key={ev.id}>
                      <span className="muted">{formatTime(ev.at)}</span>{" "}
                      {ev.by.username} · {ev.type}
                      {ev.message ? ` — ${ev.message}` : ""}
                    </li>
                  ))}
                </ul>

                <div className="row" style={{ marginTop: 12 }}>
                  {selected.assignee.id === me.id &&
                    selected.status === "open" && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => onAck(selected)}
                      >
                        确认收到并开始
                      </button>
                    )}

                  {selected.createdBy.id === me.id &&
                    (selected.status === "open" ||
                      selected.status === "in_progress" ||
                      selected.status === "rejected") && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => onCancel(selected)}
                      >
                        取消任务
                      </button>
                    )}
                </div>

                {selected.assignee.id === me.id &&
                  (selected.status === "in_progress" ||
                    selected.status === "rejected") && (
                    <div className="task-submit-box">
                      <h4>提交成果</h4>
                      {(selected.draftSubmitAttachments?.length ?? 0) > 0 && (
                        <>
                          <p className="muted">已暂存附件</p>
                          <AttachmentList
                            taskId={selected.id}
                            items={selected.draftSubmitAttachments}
                          />
                        </>
                      )}
                      <label className="field">
                        <span>说明</span>
                        <textarea
                          className="input task-textarea"
                          rows={3}
                          value={submitBody}
                          onChange={(e) => setSubmitBody(e.target.value)}
                          disabled={busy}
                          placeholder="完成情况、链接、备注…"
                        />
                      </label>
                      <label className="field">
                        <span>附件</span>
                        <input
                          type="file"
                          multiple
                          disabled={busy}
                          onChange={(e) =>
                            setSubmitFiles(Array.from(e.target.files ?? []))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => onSubmit(selected)}
                      >
                        提交验收
                      </button>
                    </div>
                  )}

                {selected.createdBy.id === me.id &&
                  selected.status === "submitted" && (
                    <div className="task-submit-box">
                      <h4>验收</h4>
                      <label className="field">
                        <span>评语</span>
                        <textarea
                          className="input task-textarea"
                          rows={2}
                          value={reviewComment}
                          onChange={(e) => setReviewComment(e.target.value)}
                          disabled={busy}
                          placeholder="通过说明或退回原因"
                        />
                      </label>
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy}
                          onClick={() => onReview(selected, "approve")}
                        >
                          通过
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => onReview(selected, "reject")}
                        >
                          退回
                        </button>
                      </div>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
