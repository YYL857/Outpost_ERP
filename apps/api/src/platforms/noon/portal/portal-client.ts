import type { NoonConnection, PortalCache } from "../../../common/types.js";
import type {
  NoonCatalogDto,
  NoonClient,
  NoonOrderDto,
  NoonStockDto,
} from "../types.js";
import { readSavedCookieHeader } from "./browser-collector.js";
import { fetchPortalBySession } from "./session-fetcher.js";

/**
 * 门户模式客户端：
 * - 优先读 portalCache（文件导入 / 会话抓取写入）
 * - 若 cache 空且配置了 URL+本地登录态，则现场拉取
 */
export class PortalNoonClient implements NoonClient {
  readonly mode = "portal" as const;

  constructor(
    private readonly connection: NoonConnection,
    private readonly getCache: () => PortalCache,
    private readonly setCache: (cache: PortalCache) => void,
  ) {}

  async validateCredentials() {
    if (!this.connection.enabled) {
      return { ok: false, message: "NOON 接入未启用" };
    }
    const portal = this.connection.portal;
    const cache = this.getCache();
    const hasCache =
      cache.orders.length + cache.catalog.length + cache.stock.length > 0;
    if (hasCache) {
      return {
        ok: true,
        message: `门户缓冲可用：订单 ${cache.orders.length} / 商品 ${cache.catalog.length} / 库存 ${cache.stock.length}`,
      };
    }
    const hasSession = Boolean(readSavedCookieHeader() || portal.cookie);
    if (
      hasSession &&
      (portal.ordersUrl || portal.catalogUrl || portal.stockUrl)
    ) {
      return {
        ok: true,
        message: "已检测到本地登录态与采集 URL，可执行「会话拉取」",
      };
    }
    if (!hasSession) {
      return {
        ok: false,
        message: "门户模式未就绪：请先「浏览器登录并保存登录态」",
      };
    }
    return {
      ok: false,
      message: "已有登录态，请再配置订单/商品/库存数据 URL，或导入导出文件",
    };
  }

  async fetchOrdersSince(_since: string | null): Promise<NoonOrderDto[]> {
    return (await this.ensureDomain("orders")) as NoonOrderDto[];
  }

  async fetchOrder(orderNr: string): Promise<NoonOrderDto | null> {
    const list = await this.fetchOrdersSince(null);
    return list.find((o) => o.order_nr === orderNr) ?? {
      order_nr: orderNr,
      status: "imported",
      currency: "SAR",
      total_amount: 0,
      item_count: 1,
      placed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async fetchStockSince(_since: string | null): Promise<NoonStockDto[]> {
    return (await this.ensureDomain("stock")) as NoonStockDto[];
  }

  async fetchCatalogSince(_since: string | null): Promise<NoonCatalogDto[]> {
    return (await this.ensureDomain("catalog")) as NoonCatalogDto[];
  }

  private async ensureDomain(domain: "orders" | "catalog" | "stock") {
    const cache = this.getCache();
    const current = cache[domain];
    if (current.length > 0) return current;

    const portal = this.connection.portal;
    if (!readSavedCookieHeader() && !portal.cookie) {
      throw new Error(
        `门户缓冲无 ${domain} 数据。请先「浏览器登录」或导入导出文件`,
      );
    }

    const fetched = await fetchPortalBySession(portal);
    const prev = this.getCache();
    const next: PortalCache = {
      orders: fetched.orders,
      catalog: fetched.catalog,
      stock: fetched.stock,
      sales: prev.sales ?? [],
      fees: prev.fees ?? [],
      updatedAt: new Date().toISOString(),
    };
    this.setCache(next);
    return next[domain];
  }
}
