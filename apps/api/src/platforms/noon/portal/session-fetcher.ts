import type { PortalConfig } from "../../../common/types.js";
import {
  parseCatalogContent,
  parseOrdersContent,
  parseStockContent,
} from "./parsers.js";
import { readSavedCookieHeader } from "./browser-collector.js";
import type {
  NoonCatalogDto,
  NoonOrderDto,
  NoonStockDto,
} from "../types.js";

export type PortalFetchResult = {
  orders: NoonOrderDto[];
  catalog: NoonCatalogDto[];
  stock: NoonStockDto[];
  warnings: string[];
};

function resolveCookie(portal: PortalConfig): string {
  return readSavedCookieHeader() || portal.cookie?.trim() || "";
}

/**
 * 使用本地登录态文件中的 Cookie，请求配置的数据 URL。
 */
export async function fetchPortalBySession(
  portal: PortalConfig,
): Promise<PortalFetchResult> {
  const warnings: string[] = [];
  const orders: NoonOrderDto[] = [];
  const catalog: NoonCatalogDto[] = [];
  const stock: NoonStockDto[] = [];
  const cookie = resolveCookie(portal);

  if (!cookie) {
    throw new Error(
      "未找到本地登录态文件。请先点「浏览器登录并保存登录态」完成登录",
    );
  }

  async function pull(
    label: string,
    url: string,
    parse: (text: string) => unknown[],
  ) {
    if (!url) {
      warnings.push(`未配置 ${label} URL，已跳过`);
      return [] as unknown[];
    }
    let origin = portal.portalUrl || "https://login.noon.partners/";
    try {
      origin = new URL(portal.portalUrl || url).origin;
    } catch {
      /* keep default */
    }
    const res = await fetch(url, {
      headers: {
        Cookie: cookie,
        Accept: "application/json,text/csv,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: portal.portalUrl || url,
        Origin: origin,
      },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `${label} 被重定向（HTTP ${res.status}），登录态多半已失效，请重新「浏览器登录」`,
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `${label} 拉取失败 HTTP ${res.status}: ${text.slice(0, 180)}`,
      );
    }
    try {
      return parse(text);
    } catch (err) {
      throw new Error(
        `${label} 解析失败：${err instanceof Error ? err.message : String(err)}。请确认 URL 返回 CSV/JSON`,
      );
    }
  }

  orders.push(
    ...(await pull("orders", portal.ordersUrl, (t) =>
      parseOrdersContent(t, "auto"),
    )) as NoonOrderDto[],
  );
  catalog.push(
    ...(await pull("catalog", portal.catalogUrl, (t) =>
      parseCatalogContent(t, "auto"),
    )) as NoonCatalogDto[],
  );
  stock.push(
    ...(await pull("stock", portal.stockUrl, (t) =>
      parseStockContent(t, "auto"),
    )) as NoonStockDto[],
  );

  if (!orders.length && !catalog.length && !stock.length) {
    throw new Error(
      "会话拉取未得到任何数据。请检查登录态是否有效，以及 orders/catalog/stock URL 是否正确",
    );
  }

  return { orders, catalog, stock, warnings };
}
