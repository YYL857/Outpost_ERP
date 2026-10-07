import type { AppState, SyncAlert } from "../../common/types.js";
import { saveState } from "../../data/store.js";

/** 同类未确认告警合并，避免限额等错误刷屏 */
function alertFingerprint(input: {
  title: string;
  detail: string;
}): string {
  const core = input.detail.replace(/^[^:\n]+:\s*/, "").trim();
  if (/export limit|限额|冷却中|exports in the last/i.test(`${input.title} ${core}`)) {
    return `${input.title}::impex-limit`;
  }
  return `${input.title}::${core.slice(0, 160)}`;
}

function withOccurrenceCount(detail: string, count: number): string {
  const base = detail.replace(/\s*\(×\d+\)\s*$/, "").trimEnd();
  return count > 1 ? `${base} (×${count})` : base;
}

export function pushAlert(
  state: AppState,
  input: Omit<SyncAlert, "id" | "createdAt" | "acknowledged">,
) {
  const fingerprint = alertFingerprint(input);
  const existing = state.syncAlerts.find(
    (a) => !a.acknowledged && alertFingerprint(a) === fingerprint,
  );
  if (existing) {
    const prevCount = Number(/\(×(\d+)\)\s*$/.exec(existing.detail)?.[1] ?? 1);
    existing.level = input.level;
    existing.detail = withOccurrenceCount(input.detail, prevCount + 1);
    existing.createdAt = new Date().toISOString();
    saveState(state);
    return existing;
  }

  const alert: SyncAlert = {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    acknowledged: false,
    ...input,
  };
  state.syncAlerts.unshift(alert);
  if (state.syncAlerts.length > 200) state.syncAlerts.length = 200;
  saveState(state);
  return alert;
}
