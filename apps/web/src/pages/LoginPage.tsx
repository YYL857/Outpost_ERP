import { FormEvent, useState } from "react";
import { api } from "../api";
import outpostMark from "../assets/outpost-mark.png";
import { ClearableInput } from "../components/ClearableInput";
import { ThemeToggle } from "../components/ThemeToggle";

type Props = {
  onLoggedIn: () => void;
  notice?: string;
};

export function LoginPage({ onLoggedIn, notice }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(username.trim(), password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-theme-slot">
        <ThemeToggle />
      </div>

      <div className="login-stage" aria-hidden>
        <div className="login-aurora login-aurora-a" />
        <div className="login-aurora login-aurora-b" />
        <div className="login-aurora login-aurora-c" />
        <div className="login-ray" />
        <div className="login-crystal login-crystal-lg" />
        <div className="login-crystal login-crystal-md" />
        <div className="login-crystal login-crystal-sm" />
        <div className="login-crystal login-crystal-xs" />
        <div className="login-sparkles">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="login-vignette" />
        <div className="login-noise" />
      </div>

      <div className="login-content">
        <section className="login-hero">
          <p className="login-kicker">
            <span className="login-kicker-line" />
            OUTPOST ERP
          </p>
          <div className="login-mark-wrap">
            <span className="login-mark-halo" />
            <img
              className="login-mark"
              src={outpostMark}
              alt=""
              width={88}
              height={88}
              aria-hidden
            />
          </div>
          <h1 className="login-title">
            <span>慧</span>
            <span>运</span>
            <span>营</span>
          </h1>
          <p className="login-tag">跨境经营台</p>
          <p className="login-lead">
            从货架到经营决策
            <br />
            一张台面看清全局
          </p>
        </section>

        <form className="login-form" onSubmit={onSubmit}>
          <div className="login-form-glow" aria-hidden />
          <header className="login-form-head">
            <p className="login-form-eyebrow">SECURE ACCESS</p>
            <h2>进入工作台</h2>
          </header>

          {notice && <p className="login-error">{notice}</p>}

          <label className="login-field">
            <span>用户名</span>
            <ClearableInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={busy}
              placeholder="输入账号"
            />
          </label>

          <label className="login-field">
            <span>密码</span>
            <span className="login-password-wrap">
              <ClearableInput
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
                placeholder="输入密码"
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                tabIndex={-1}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </span>
          </label>

          {error && <p className="login-error">{error}</p>}

          <button
            type="submit"
            className="login-submit"
            disabled={busy || !username.trim() || !password}
          >
            <span className="login-submit-text">
              {busy ? "登录中…" : "立即登录"}
            </span>
            <span className="login-submit-shine" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
