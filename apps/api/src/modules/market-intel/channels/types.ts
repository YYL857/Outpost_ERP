import type { CategorySeed, CollectChannel, DiscoveredProduct } from "../types.js";

export type ChannelListResult = {
  channel: CollectChannel;
  products: DiscoveredProduct[];
  raw: unknown;
  message: string;
};

export type ListChannel = {
  id: CollectChannel;
  listCategory: (
    category: CategorySeed,
    opts: { topN: number; currency: string; baseUrl: string },
  ) => Promise<ChannelListResult>;
};
