/**
 * Playwright 登录态定时续期已下线（弹窗无实际收益）。
 * 手动 `python main.py keepalive ui` / PwStudio 仍可用；此处永不启 timer。
 */

export function getPwKeepaliveSchedulerStatus() {
  return {
    enabled: false,
    timerActive: false,
    everyMs: 0,
    running: false,
    lastRunAt: null as string | null,
    lastMessage: "已下线：不再定时保活",
    lastOk: null as boolean | null,
  };
}

export function stopPwKeepaliveScheduler() {
  /* no-op：无 timer */
}

export function startPwKeepaliveScheduler(_opts?: { enabled?: boolean }) {
  stopPwKeepaliveScheduler();
}

export function setPwKeepaliveEnabled(_on: boolean) {
  stopPwKeepaliveScheduler();
}

export function envPwKeepaliveDefaultEnabled() {
  return false;
}
