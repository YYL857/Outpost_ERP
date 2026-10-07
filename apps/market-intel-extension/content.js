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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CAPTURE") {
    sendResponse(extractFromPage());
  }
  return true;
});
