function productKeyFromUrl(href) {
  const u = href || location.href;
  const m =
    u.match(/\/([A-Z]{1,3}[A-Z0-9-]{5,})\//i) ||
    u.match(/[?&](?:o|sku|offer)=([A-Z0-9-]+)/i) ||
    u.match(/\/p\/([^/?#]+)/i);
  return m?.[1] ? String(m[1]) : null;
}

function extractFromPage() {
  const products = [];
  const next = document.getElementById("__NEXT_DATA__");
  if (next?.textContent) {
    try {
      const data = JSON.parse(next.textContent);
      const walk = (node, depth) => {
        if (!node || depth > 10 || products.length >= 80) return;
        if (Array.isArray(node)) {
          node.forEach((x) => walk(x, depth + 1));
          return;
        }
        if (typeof node !== "object") return;
        const sku = node.sku || node.offer_code || node.offerCode;
        const title = node.name || node.title;
        if (sku && title) {
          products.push({
            productKey: String(sku),
            title: String(title),
            url: node.url || node.product_url || location.href,
            price:
              typeof node.sale_price === "number"
                ? node.sale_price
                : typeof node.price === "number"
                  ? node.price
                  : node.price?.amount ?? null,
            currency: "SAR",
            rating: node.rating ?? node.average_rating ?? null,
            reviewCount: node.review_count ?? node.reviews_count ?? null,
            imageUrl: node.image_key || node.imageUrl || null,
          });
        }
        Object.values(node).forEach((v) => walk(v, depth + 1));
      };
      walk(data, 0);
    } catch (e) {
      return { error: String(e), products: [] };
    }
  }
  const pathMatch = location.pathname.match(/\/saudi-en\/([^/]+)/);
  return {
    categoryId: pathMatch?.[1] || "extension-capture",
    pageUrl: location.href,
    products,
  };
}

/** 商详轻量采价：优先 __NEXT_DATA__，回落 DOM */
function extractPdpPrice() {
  const page = extractFromPage();
  if (page.error) return { error: page.error };

  let best = null;
  const urlKey = productKeyFromUrl(location.href);
  if (page.products?.length) {
    best =
      (urlKey &&
        page.products.find(
          (p) =>
            String(p.productKey).toUpperCase() === String(urlKey).toUpperCase(),
        )) ||
      page.products.find((p) => p.price != null) ||
      page.products[0];
  }

  let price = best?.price ?? null;
  let title = best?.title ?? document.title?.replace(/\s*[|\-–].*$/, "").trim();
  let productKey = best?.productKey || urlKey;
  let parseMethod = best?.price != null ? "json_ld" : "dom";
  let promoText = null;

  if (price == null) {
    const priceEl =
      document.querySelector("[class*='priceNow']") ||
      document.querySelector("[data-qa='div-price-now']") ||
      document.querySelector("strong.amount, .price strong");
    const raw = priceEl?.textContent || "";
    const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    if (m) {
      price = Number(m[1]);
      parseMethod = "dom";
    }
  }

  const promoEl =
    document.querySelector("[class*='Offer']") ||
    document.querySelector("[class*='promo']") ||
    document.querySelector("[class*='MegaDeal']");
  if (promoEl?.textContent?.trim()) {
    promoText = promoEl.textContent.trim().slice(0, 120);
  }

  if (!productKey) {
    return { error: "无法解析 productKey（请打开商品详情页）" };
  }
  if (price == null) {
    return {
      error: "未解析到价格",
      productKey,
      title,
      url: location.href,
    };
  }

  return {
    productKey: String(productKey),
    title: title || String(productKey),
    url: location.href,
    price,
    currency: "SAR",
    promoText,
    inStock: null,
    parseMethod,
    source: "extension",
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CAPTURE") {
    sendResponse(extractFromPage());
  } else if (msg?.type === "CAPTURE_PDP_PRICE") {
    sendResponse(extractPdpPrice());
  }
  return true;
});

