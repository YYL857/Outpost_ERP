import type { AppState, NoonConnection } from "../../common/types.js";
import { saveState } from "../../data/store.js";
import { LiveNoonClient } from "./live-client.js";
import { MockNoonClient } from "./mock-client.js";
import { PortalNoonClient } from "./portal/portal-client.js";
import type { NoonClient } from "./types.js";

export function createNoonClient(stateOrConnection: AppState | NoonConnection): NoonClient {
  // 兼容：传入完整 state（推荐，portal 需要 cache）或仅 connection
  const isState = "noon" in stateOrConnection && "portalCache" in stateOrConnection;
  const state = isState ? (stateOrConnection as AppState) : null;
  const connection = isState
    ? (stateOrConnection as AppState).noon
    : (stateOrConnection as NoonConnection);

  if (connection.mode === "live") {
    return new LiveNoonClient(connection);
  }
  if (connection.mode === "portal") {
    if (!state) {
      throw new Error("portal 模式需要传入完整 AppState 以访问 portalCache");
    }
    return new PortalNoonClient(
      connection,
      () => state.portalCache,
      (cache) => {
        state.portalCache = cache;
        state.noon.portal.lastFetchAt = cache.updatedAt;
        saveState(state);
      },
    );
  }
  return new MockNoonClient(connection);
}

export type { NoonClient, NoonWebhookEnvelope, NoonOrderDto } from "./types.js";
export { MockNoonClient } from "./mock-client.js";
export { LiveNoonClient } from "./live-client.js";
export { PortalNoonClient } from "./portal/portal-client.js";
