import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type NoonSessionStatus } from "../api";

function formatRemaining(ms: number | null): string {
  if (ms == null) return "未知";
  if (ms <= 0) return "已过期";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} 分钟`;
  return `${h} 小时 ${m} 分钟`;
}

function dismissKey(expiresAt: string | null, health: string) {
  return `outpost.session.dismiss.${health}.${expiresAt ?? "none"}`;
}

/**
 * 全局监测 NOON 登录态失效时间；快过期 / 已过期时弹出明显提示。
 */
export function SessionExpiryGuard() {
  const [session, setSession] = useState<NoonSessionStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await api.getPortalSessionStatus();
        if (cancelled) return;
        const s = res.data;
        setSession(s);
        if (s.health === "warning" || s.health === "expired") {
          const key = dismissKey(s.expiresAt, s.health);
          if (sessionStorage.getItem(key) !== "1") {
            setOpen(true);
          }
        } else {
          setOpen(false);
        }
      } catch {
        /* API 未就绪时忽略 */
      }
    };

    void tick();
    const id = setInterval(() => void tick(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!session || !open) return null;
  if (session.health !== "warning" && session.health !== "expired") return null;

  const expired = session.health === "expired";
  const title = expired ? "NOON 登录态已过期" : "NOON 登录态即将过期";
  const detail = expired
    ? "当前登录态已失效，会话拉取会失败。请重新浏览器登录并保存登录态。"
    : `登录态将在约 ${formatRemaining(session.remainingMs)} 后失效${
        session.expiresAt
          ? `（${new Date(session.expiresAt).toLocaleString()}）`
          : ""
      }。建议尽快重新登录，以免同步中断。`;

  function dismiss() {
    if (session) {
      sessionStorage.setItem(dismissKey(session.expiresAt, session.health), "1");
    }
    setOpen(false);
  }

  return (
    <div className="session-modal-backdrop" role="dialog" aria-modal="true">
      <div className={`session-modal ${expired ? "danger" : "warn"}`}>
        <h2 className="session-modal-title">{title}</h2>
        <p className="session-modal-body">{detail}</p>
        {session.expiresSource === "estimated" && (
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            说明：部分 Cookie 无明确 Expires，失效时间按保存后估算，仅供参考。
          </p>
        )}
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button className="btn" type="button" onClick={dismiss}>
            稍后提醒
          </button>
          <Link className="btn btn-primary" to="/noon" onClick={dismiss}>
            去重新登录
          </Link>
        </div>
      </div>
    </div>
  );
}
