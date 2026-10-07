import { mockChannel } from "./mock.js";
import type { ListChannel } from "./types.js";
import type { CollectChannel } from "../types.js";

/**
 * 正式发现已改为 discover.ts 内 drainInboxKind。
 * 此处仅保留 mock（开发试跑）；yingdao/extension 占位避免旧调用崩溃。
 */
const unsupported = (id: CollectChannel): ListChannel => ({
  id,
  async listCategory() {
    throw new Error(
      `channel ${id}: use runDiscover() inbox drain (HTTP removed; do not call listCategory)`,
    );
  },
});

const registry: Partial<Record<CollectChannel, ListChannel>> = {
  mock: mockChannel,
  yingdao: unsupported("yingdao"),
  extension: unsupported("extension"),
  inbox: unsupported("inbox"),
};

export function getListChannel(id: CollectChannel): ListChannel {
  const ch = registry[id];
  if (!ch) throw new Error(`unknown channel: ${id}`);
  return ch;
}

export { mockChannel };
