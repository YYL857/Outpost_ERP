import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, type AuthUserPublic, type UserRole } from "../api";
import { ClearableInput } from "../components/ClearableInput";

const ROLE_OPTIONS: { value: UserRole; label: string; hint: string }[] = [
  { value: "admin", label: "超管", hint: "系统配置、同步、用户管理" },
  { value: "ops_lead", label: "运营主管", hint: "日常经营与协调" },
  { value: "ops", label: "运营", hint: "日常经营操作" },
  { value: "purchase", label: "采购", hint: "采购管理与到货确认" },
];

function roleLabel(role: UserRole) {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}

function formatTime(iso?: string) {
  return iso?.slice(0, 19).replace("T", " ") ?? "—";
}

function formatRelativeSeen(iso?: string | null) {
  if (!iso) return "暂无活跃";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "暂无活跃";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return formatTime(iso);
}

export function UsersPage() {
  const [users, setUsers] = useState<AuthUserPublic[]>([]);
  const [me, setMe] = useState<AuthUserPublic | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("ops");
  const [resetId, setResetId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [list, meRes] = await Promise.all([api.listUsers(), api.me()]);
    setUsers(list.data);
    setMe(meRes.data.user);
  }

  useEffect(() => {
    reload().catch((e) =>
      setError(e instanceof Error ? e.message : "加载用户失败"),
    );
    const timer = window.setInterval(() => {
      api
        .listUsers()
        .then((list) => setUsers(list.data))
        .catch(() => {
          /* 静默：轮询失败不打断页面 */
        });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(key) ||
        roleLabel(u.role).includes(key) ||
        u.role.includes(key) ||
        (key === "在线" && u.online) ||
        (key === "离线" && !u.online && !u.disabled),
    );
  }, [users, q]);

  const counts = useMemo(() => {
    const active = users.filter((u) => !u.disabled);
    return {
      total: users.length,
      admin: active.filter((u) => u.role === "admin").length,
      opsLead: active.filter((u) => u.role === "ops_lead").length,
      ops: active.filter((u) => u.role === "ops").length,
      disabled: users.filter((u) => u.disabled).length,
      online: users.filter((u) => u.online && !u.disabled).length,
    };
  }, [users]);

  async function run(action: () => Promise<string | undefined>) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const message = await action();
      if (message) setMsg(message);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await api.createUser({ username, password, role });
      setUsername("");
      setPassword("");
      setRole("ops");
      return res.message ?? `已创建 ${username}`;
    });
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    if (!resetId) return;
    await run(async () => {
      const res = await api.resetUserPassword(resetId, resetPassword);
      setResetPassword("");
      setResetId("");
      return res.message ?? "已重置密码";
    });
  }

  async function onRoleChange(id: string, next: UserRole) {
    await run(async () => {
      const res = await api.updateUser(id, { role: next });
      return res.message;
    });
  }

  async function onToggleDisabled(u: AuthUserPublic) {
    const next = !u.disabled;
    const tip = next
      ? `确认停用「${u.username}」？停用后无法登录。`
      : `确认启用「${u.username}」？`;
    if (!window.confirm(tip)) return;
    await run(async () => {
      const res = await api.updateUser(u.id, { disabled: next });
      return res.message;
    });
  }

  async function onDelete(u: AuthUserPublic) {
    if (!window.confirm(`确认删除「${u.username}」？此操作不可恢复。`)) return;
    await run(async () => {
      const res = await api.deleteUser(u.id);
      if (resetId === u.id) setResetId("");
      return res.message;
    });
  }

  return (
    <div>
      <h1 className="page-title">用户管理</h1>
      <p className="page-desc">
        仅超级管理员可管理账号。定位：超管 / 运营主管 / 运营。浏览数据共享，操作区按账号隔离。
      </p>

      {error && <p className="login-error">{error}</p>}
      {msg && <p className="ok-msg">{msg}</p>}

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>账号概况</h3>
          <p className="muted" style={{ margin: 0 }}>
            共 {counts.total} 人 · 停用 {counts.disabled}
          </p>
        </div>
        <div className="card">
          <h3>当前在线</h3>
          <p className="muted" style={{ margin: 0 }}>
            {counts.online} 人（近 5 分钟有操作）
          </p>
        </div>
        <div className="card">
          <h3>超管 / 主管 / 运营</h3>
          <p className="muted" style={{ margin: 0 }}>
            超管 {counts.admin} · 主管 {counts.opsLead} · 运营 {counts.ops}
          </p>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>账号列表</h3>
          <label className="field" style={{ minWidth: 220 }}>
            <span className="muted">搜索</span>
            <ClearableInput
              className="input"
              value={q}
              placeholder="用户名 / 定位 / 在线"
              onChange={(e) => setQ(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>定位</th>
              <th>在线</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const isSelf = me?.id === u.id;
              return (
                <tr key={u.id}>
                  <td>
                    {u.username}
                    {isSelf ? <span className="muted">（我）</span> : null}
                  </td>
                  <td>
                    <select
                      className="input"
                      value={u.role}
                      disabled={busy}
                      onChange={(e) =>
                        onRoleChange(u.id, e.target.value as UserRole)
                      }
                      style={{ minWidth: 120 }}
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {u.disabled ? (
                      <span className="muted">—</span>
                    ) : (
                      <span
                        className={`badge ${u.online ? "ok" : "idle"}`}
                        title={
                          u.lastSeenAt
                            ? `最近活跃：${formatTime(u.lastSeenAt)}`
                            : "登录后操作才会记活跃"
                        }
                      >
                        {u.online ? "在线" : "离线"}
                        <span className="muted" style={{ marginLeft: 6 }}>
                          {formatRelativeSeen(u.lastSeenAt)}
                        </span>
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.disabled ? "danger" : "ok"}`}>
                      {u.disabled ? "已停用" : "正常"}
                    </span>
                  </td>
                  <td>{formatTime(u.createdAt)}</td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => setResetId(u.id)}
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || isSelf}
                        onClick={() => onToggleDisabled(u)}
                      >
                        {u.disabled ? "启用" : "停用"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || isSelf}
                        onClick={() => onDelete(u)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  没有匹配的账号
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h3>新建用户</h3>
        <form className="form-row" onSubmit={onCreate}>
          <label>
            用户名
            <ClearableInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            初始密码
            <ClearableInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            定位
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              disabled={busy}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !username || password.length < 6}
          >
            创建
          </button>
        </form>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          {ROLE_OPTIONS.map((opt) => `${opt.label}：${opt.hint}`).join(" · ")}
        </p>
      </section>

      {resetId && (
        <section className="card">
          <h3>重置密码</h3>
          <p className="muted">
            用户：{users.find((u) => u.id === resetId)?.username ?? resetId}
          </p>
          <form className="form-row" onSubmit={onReset}>
            <label>
              新密码
              <ClearableInput
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || resetPassword.length < 6}
            >
              确认重置
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setResetId("")}
            >
              取消
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
