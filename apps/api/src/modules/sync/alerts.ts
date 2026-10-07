import type { AppState, SyncAlert } from "../../common/types.js";
import { saveState } from "../../data/store.js";

export function pushAlert(
  state: AppState,
  input: Omit<SyncAlert, "id" | "createdAt" | "acknowledged">,
) {
  const alert: SyncAlert = {
    id: `alert-${Date.now()}`,
    createdAt: new Date().toISOString(),
    acknowledged: false,
    ...input,
  };
  state.syncAlerts.unshift(alert);
  if (state.syncAlerts.length > 200) state.syncAlerts.length = 200;
  saveState(state);
  return alert;
}
