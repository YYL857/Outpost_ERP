import type {
  AppState,
  InboxEvent,
  InboxSource,
  SyncDomain,
} from "../../common/types.js";
import { saveState } from "../../data/store.js";

export function enqueueInbox(
  state: AppState,
  input: {
    eventId: string;
    source: InboxSource;
    domain: SyncDomain;
    entityKey: string;
    payload: unknown;
  },
): { event: InboxEvent; duplicate: boolean } {
  const existing = state.inbox.find((e) => e.eventId === input.eventId);
  if (existing) {
    existing.status = "duplicate";
    saveState(state);
    return { event: existing, duplicate: true };
  }

  const event: InboxEvent = {
    id: `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventId: input.eventId,
    source: input.source,
    domain: input.domain,
    entityKey: input.entityKey,
    payload: input.payload,
    status: "pending",
    receivedAt: new Date().toISOString(),
    processedAt: null,
    error: null,
    attempts: 0,
  };
  state.inbox.unshift(event);
  trimInbox(state);
  bumpJobBacklog(state, input.domain);
  saveState(state);
  return { event, duplicate: false };
}

/** 优先丢掉已处理/重复事件，绝不丢 pending（否则大目录会被 orders/stock 挤掉） */
function trimInbox(state: AppState, softCap = 2000) {
  if (state.inbox.length <= softCap) return;
  const pending = state.inbox.filter((e) => e.status === "pending");
  const keep = state.inbox.filter((e) => e.status !== "pending");
  const room = Math.max(0, softCap - pending.length);
  state.inbox = [...pending, ...keep.slice(0, room)];
}

function bumpJobBacklog(state: AppState, domain: SyncDomain) {
  const job = state.syncJobs.find((j) => j.domain === domain);
  if (!job) return;
  job.backlog = state.inbox.filter(
    (e) => e.domain === domain && e.status === "pending",
  ).length;
}

export function listInbox(state: AppState, limit = 50) {
  return state.inbox.slice(0, limit);
}
