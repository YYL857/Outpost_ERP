const STORAGE_KEY = "outpost-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const LISTENERS = new Set<() => void>();

/** localStorage 不可用时（隐私模式/企业策略）仍靠内存保证当次会话可切换 */
let memoryPref: ThemePreference | null = null;

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function readStoredPreference(): ThemePreference | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return null;
}

function writeStoredPreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

export function readThemePreference(): ThemePreference {
  if (memoryPref) return memoryPref;
  const stored = readStoredPreference();
  if (stored) {
    memoryPref = stored;
    return stored;
  }
  return "system";
}

export function resolveTheme(pref: ThemePreference = readThemePreference()): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

export function applyTheme(pref: ThemePreference = readThemePreference()): ResolvedTheme {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(resolved === "dark" ? "theme-dark" : "theme-light");
  return resolved;
}

export function setThemePreference(pref: ThemePreference): ResolvedTheme {
  memoryPref = pref;
  writeStoredPreference(pref);
  const resolved = applyTheme(pref);
  LISTENERS.forEach((fn) => fn());
  return resolved;
}

/**
 * 循环：跟随系统 → 白天 → 黑夜。
 * 若下一档是显式「白天/黑夜」且观感与当前相同（常见：系统已是浅色再点「白天」），
 * 自动再跳一档，避免用户觉得没反应。落到「跟随系统」时即使观感不变也保留（按钮文案会变）。
 */
export function cycleThemePreference(): ThemePreference {
  const order: ThemePreference[] = ["system", "light", "dark"];
  const cur = readThemePreference();
  const curResolved = resolveTheme(cur);
  const start = Math.max(0, order.indexOf(cur));

  let next = order[(start + 1) % order.length]!;
  if (next !== "system" && resolveTheme(next) === curResolved) {
    next = order[(start + 2) % order.length]!;
  }

  setThemePreference(next);
  return next;
}

export function themeLabel(pref: ThemePreference): string {
  if (pref === "system") return "跟随系统";
  if (pref === "light") return "白天";
  return "黑夜";
}

/** 按钮主文案：偏好 + 当前实际明暗，避免「点了没变色」的错觉 */
export function themeButtonLabel(pref: ThemePreference, resolved: ResolvedTheme): string {
  const look = resolved === "dark" ? "夜" : "昼";
  if (pref === "system") return `系统·${look}`;
  if (pref === "light") return "白天";
  return "黑夜";
}

export function subscribeTheme(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => LISTENERS.delete(listener);
}

function bindMediaChange(mq: MediaQueryList, onChange: () => void): () => void {
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
  // 旧 Chromium / 企业定制浏览器
  const legacy = mq as MediaQueryList & {
    addListener?: (cb: () => void) => void;
    removeListener?: (cb: () => void) => void;
  };
  legacy.addListener?.(onChange);
  return () => legacy.removeListener?.(onChange);
}

/** 系统主题变化时，若偏好为 system 则重算 */
export function bindSystemThemeListener(): () => void {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemePreference() === "system") {
        applyTheme("system");
        LISTENERS.forEach((fn) => fn());
      }
    };
    return bindMediaChange(mq, onChange);
  } catch {
    return () => {};
  }
}
