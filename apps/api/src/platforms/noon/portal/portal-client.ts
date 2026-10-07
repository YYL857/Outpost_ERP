import type { NoonConnection, PortalCache } from "../../../common/types.js";
import type {
  NoonCatalogDto,
  NoonClient,
  NoonFeeDto,
  NoonOrderDto,
  NoonSalesDto,
  NoonStockDto,
} from "../types.js";

/**
 * 门户模式客户端：
 * - 读 portalCache（手工/影刀 CSV 导入写入）
 * - 不再使用浏览器登录态或会话拉取
 */
export class PortalNoonClient implements NoonClient {
  readonly mode = "portal" as const;

  constructor(
    private readonly connection: NoonConnection,
    private readonly getCache: () => PortalCache,
    private readonly setCache: (cache: PortalCache) => void,
  ) {
    void this.setCache;
  }

  async validateCredentials() {
    if (!this.connection.enabled) {
      return { ok: false, message: "NOON 接入未启用" };
    }
    const cache = this.getCache();
    const hasCache =
      cache.orders.length +
        cache.catalog.length +
        cache.stock.length +
        (cache.sales?.length ?? 0) +
        (cache.fees?.length ?? 0) +
        (cache.ads?.length ?? 0) >
      0;
    if (hasCache) {
      return {
        ok: true,
        message: `门户缓冲可用：订单 ${cache.orders.length} / 商品 ${cache.catalog.length} / 库存 ${cache.stock.length}`,
      };
    }
    return {
      ok: false,
      message:
        "门户缓冲为空。请将导出 CSV 放入 portal-imports，或改用 live（Partner API）",
    };
  }

  async fetchOrdersSince(_since: string | null): Promise<NoonOrderDto[]> {
    return this.requireDomain("orders") as NoonOrderDto[];
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
    return this.requireDomain("stock") as NoonStockDto[];
  }

  async fetchCatalogSince(_since: string | null): Promise<NoonCatalogDto[]> {
    return this.requireDomain("catalog") as NoonCatalogDto[];
  }

  async fetchSalesSince(_since: string | null): Promise<NoonSalesDto[]> {
    const cache = this.getCache();
    if ((cache.sales?.length ?? 0) > 0) return cache.sales;
    throw new Error(
      "门户缓冲无 sales 数据。请导入 Sales 导出，或改用 live Impex / 影刀 inbox 投递",
    );
  }

  async fetchFeesSince(_since: string | null): Promise<NoonFeeDto[]> {
    const cache = this.getCache();
    if ((cache.fees?.length ?? 0) > 0) return cache.fees;
    throw new Error(
      "门户缓冲无 fees 数据。请导入 Transaction View，或改用 live Impex / 影刀 inbox 投递",
    );
  }

  private requireDomain(domain: "orders" | "catalog" | "stock") {
    const cache = this.getCache();
    const current = cache[domain];
    if (current.length > 0) return current;
    throw new Error(
      `门户缓冲无 ${domain} 数据。请将导出文件放入 portal-imports 或手工导入`,
    );
  }
}
