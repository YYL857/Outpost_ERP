import type { CategorySeed, DiscoveredProduct } from "../types.js";
import type { ChannelListResult, ListChannel } from "./types.js";

/** L0/L1 联调通道：保证发现→监控池闭环可演示；生产应关 allowMock */
export const mockChannel: ListChannel = {
  id: "mock",
  async listCategory(category, opts) {
    const n = Math.min(opts.topN, 20);
    const products: DiscoveredProduct[] = [];
    for (let i = 1; i <= n; i += 1) {
      const productKey = `mock-${category.id}-${String(i).padStart(3, "0")}`;
      products.push({
        productKey,
        url: `${opts.baseUrl}/${category.path}/${productKey}/p/`,
        title: `[MOCK][${category.title}] Sample product ${i}`,
        price: Math.round((49 + i * 3.7) * 100) / 100,
        currency: opts.currency,
        rating: Math.round((3.5 + (i % 15) / 10) * 10) / 10,
        reviewCount: 10 * i + (i % 7),
        imageUrl: null,
        categoryId: category.id,
      });
    }
    return {
      channel: "mock",
      products,
      raw: { mock: true, categoryId: category.id, count: products.length },
      message: `mock listed ${products.length} products for ${category.id}`,
    };
  },
};

export function mockDetailFromWatchitem(item: {
  productKey: string;
  url: string;
  title: string;
  categoryId: string;
  price: number | null;
  currency: string;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
}) {
  return {
    productKey: item.productKey,
    capturedAt: new Date().toISOString(),
    channel: "mock" as const,
    title: item.title,
    url: item.url,
    price: item.price,
    listPrice: item.price != null ? Math.round(item.price * 1.15 * 100) / 100 : null,
    currency: item.currency,
    rating: item.rating,
    reviewCount: item.reviewCount,
    bullets: [
      "Mock bullet: durable build for KSA climate",
      "Mock bullet: fast delivery eligible",
      "Mock bullet: 1 year warranty",
      "Mock bullet: Arabic + English packaging",
      "Mock bullet: sample differentiator",
    ],
    bundleText: null,
    fulfillment: "noon",
    availability: "in_stock",
    promoText: null,
    imageUrl: item.imageUrl,
    categoryId: item.categoryId,
  };
}

// silence unused import if tree-shaken oddly
void (null as unknown as CategorySeed);
