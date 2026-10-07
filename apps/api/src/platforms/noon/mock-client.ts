import type {
  NoonCatalogDto,
  NoonClient,
  NoonFeeDto,
  NoonOrderDto,
  NoonSalesDto,
  NoonStockDto,
} from "./types.js";
import type { NoonConnection } from "../../common/types.js";

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

/** 无真实 NOON 时的完整模拟数据，支撑本地业务模块联调 */
export class MockNoonClient implements NoonClient {
  readonly mode = "mock" as const;

  constructor(private readonly connection: NoonConnection) {}

  async validateCredentials() {
    if (!this.connection.enabled) {
      return { ok: false, message: "NOON 接入未启用" };
    }
    return {
      ok: true,
      message: "Mock 凭证校验通过（开发态，未连接真实 NOON）",
    };
  }

  async fetchOrdersSince(since: string | null): Promise<NoonOrderDto[]> {
    const base = since ? new Date(since).getTime() : Date.now() - 86400_000;
    return [
      {
        order_nr: `NR-MOCK-${Math.floor(base / 1000) % 100000}`,
        status: "confirmed",
        currency: "SAR",
        total_amount: 129.5,
        item_count: 2,
        placed_at: hoursAgo(3),
        updated_at: new Date().toISOString(),
      },
      {
        order_nr: "NR-MOCK-FIXED-001",
        status: "shipped",
        currency: "SAR",
        total_amount: 89,
        item_count: 1,
        placed_at: hoursAgo(26),
        updated_at: hoursAgo(1),
      },
      {
        order_nr: "NR-MOCK-FIXED-002",
        status: "delivered",
        currency: "SAR",
        total_amount: 210,
        item_count: 3,
        placed_at: hoursAgo(72),
        updated_at: hoursAgo(5),
      },
    ];
  }

  async fetchOrder(orderNr: string): Promise<NoonOrderDto | null> {
    return {
      order_nr: orderNr,
      status: "confirmed",
      currency: "SAR",
      total_amount: 99,
      item_count: 1,
      placed_at: hoursAgo(2),
      updated_at: new Date().toISOString(),
    };
  }

  async fetchStockSince(_since: string | null): Promise<NoonStockDto[]> {
    const ts = new Date().toISOString();
    return [
      {
        partner_sku: "SKU-DEMO-01",
        warehouse_code: "WH-SA-01",
        qty: 42,
        fulfillment: "fbn",
        in_transit_qty: 0,
        updated_at: ts,
      },
      {
        partner_sku: "SKU-DEMO-02",
        warehouse_code: "WH-SA-01",
        qty: 8,
        fulfillment: "fbp",
        in_transit_qty: 2,
        updated_at: ts,
      },
      {
        partner_sku: "SKU-DEMO-03",
        warehouse_code: "WH-SA-01",
        qty: 0,
        fulfillment: "unknown",
        in_transit_qty: 0,
        updated_at: ts,
      },
    ];
  }

  async fetchCatalogSince(_since: string | null): Promise<NoonCatalogDto[]> {
    const ts = new Date().toISOString();
    return [
      {
        partner_sku: "SKU-DEMO-01",
        title: "Ceramic Mug Set 4pcs",
        is_active: true,
        noon_sku: "Z-DEMO-01",
        image_url: "https://picsum.photos/seed/outpost-mug/96/96",
        price: 68.9,
        currency: "SAR",
        listing_type: "自建",
        updated_at: ts,
      },
      {
        partner_sku: "SKU-DEMO-02",
        title: "Silicone Kitchen Mat",
        is_active: true,
        noon_sku: "Z-DEMO-02",
        image_url: "https://picsum.photos/seed/outpost-mat/96/96",
        price: 29.5,
        currency: "SAR",
        listing_type: "自建",
        updated_at: ts,
      },
      {
        partner_sku: "SKU-DEMO-03",
        title: "Travel Bottle 500ml",
        is_active: false,
        noon_sku: "Z-DEMO-03",
        image_url: "",
        price: 19.9,
        currency: "SAR",
        listing_type: "目录",
        updated_at: ts,
      },
    ];
  }

  async fetchSalesSince(_since: string | null): Promise<NoonSalesDto[]> {
    const day = new Date().toISOString().slice(0, 10);
    const ts = new Date().toISOString();
    return [
      {
        partner_sku: "SKU-DEMO-01",
        date: day,
        units: 3,
        amount: 206.7,
        updated_at: ts,
      },
      {
        partner_sku: "SKU-DEMO-02",
        date: day,
        units: 1,
        amount: 29.5,
        updated_at: ts,
      },
    ];
  }

  async fetchFeesSince(_since: string | null): Promise<NoonFeeDto[]> {
    const ts = new Date().toISOString();
    return [
      {
        partner_sku: "SKU-DEMO-01",
        commission_rate: 0.15,
        outbound_fee: 7,
        tax_amount: 2.6,
        updated_at: ts,
      },
      {
        partner_sku: "SKU-DEMO-02",
        commission_rate: 0.12,
        outbound_fee: 5,
        tax_amount: 1.2,
        updated_at: ts,
      },
    ];
  }
}
