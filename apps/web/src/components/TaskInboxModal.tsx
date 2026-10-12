import type { TaskInboxItem } from "../api";

type Props = {
  item: TaskInboxItem | null;
  remaining: number;
  busy?: boolean;
  onAck: () => void;
  onGo: () => void;
  onDismissReject: () => void;
  onSkip: () => void;
};

function typeTitle(type: TaskInboxItem["type"]) {
  if (type === "new_assignment") return "新任务";
  if (type === "pending_review") return "待验收";
  return "任务已退回";
}

export function TaskInboxModal({
  item,
  remaining,
  busy,
  onAck,
  onGo,
  onDismissReject,
  onSkip,
}: Props) {
  if (!item) return null;

  return (
    <div className="task-modal-backdrop" role="dialog" aria-modal="true">
      <div className="task-modal">
        <div className="task-modal-head">
          <span className="badge warn">{typeTitle(item.type)}</span>
          {remaining > 1 && (
            <span className="muted">还有 {remaining - 1} 条</span>
          )}
        </div>
        <h2>{item.title}</h2>
        <p className="muted">{item.summary}</p>
        <div className="row task-modal-actions">
          {item.type === "new_assignment" && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={onAck}
              >
                知道了
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onGo}
              >
                去处理
              </button>
            </>
          )}
          {item.type === "pending_review" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={onGo}
            >
              去验收
            </button>
          )}
          {item.type === "rejected" && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={onDismissReject}
              >
                继续处理
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onGo}
              >
                打开任务
              </button>
            </>
          )}
          {remaining > 1 && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={onSkip}
            >
              下一条
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
