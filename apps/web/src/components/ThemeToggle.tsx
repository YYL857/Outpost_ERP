import { useEffect, useState } from "react";
import {
  cycleThemePreference,
  readThemePreference,
  resolveTheme,
  subscribeTheme,
  themeButtonLabel,
  themeLabel,
  type ThemePreference,
  type ResolvedTheme,
} from "../theme";

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>(() => readThemePreference());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme());

  useEffect(() => {
    return subscribeTheme(() => {
      setPref(readThemePreference());
      setResolved(resolveTheme());
    });
  }, []);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        const next = cycleThemePreference();
        setPref(next);
        setResolved(resolveTheme(next));
      }}
      title={`主题：${themeLabel(pref)}（当前界面${resolved === "dark" ? "黑夜" : "白天"}）。点击切换，每次会改变页面明暗。`}
      aria-label={`切换主题，当前${themeLabel(pref)}，界面为${resolved === "dark" ? "黑夜" : "白天"}`}
    >
      {themeButtonLabel(pref, resolved)}
    </button>
  );
}
