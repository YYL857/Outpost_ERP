/**
 * 从 Noon 商品详情页抽取对手标题/价格/卖点/描述。
 * 严禁用全页 ul li（会把导航、广告里的 iPhone 等扫进来）。
 */
function uniq(arr) {
  return [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))];
}

function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

/** 从当前 URL 尽量抽出 sku / slug，用于对齐 __NEXT_DATA__ 里的真正主商品 */
function pageProductHints() {
  const path = location.pathname || "";
  // .../some-slug/N12345678V/p 或 /N12345678A/p/
  const skuMatch = path.match(/\/(N[A-Z0-9]+)(?:\/p)?\/?$/i) || path.match(/\/(N[A-Z0-9]+)\//i);
  const sku = skuMatch?.[1] || "";
  const slugParts = path.split("/").filter(Boolean);
  // saudi-en / slug / Nxxx / p
  const slug =
    slugParts.find((p) => p !== "saudi-en" && !/^N[A-Z0-9]+$/i.test(p) && p !== "p") || "";
  return { sku: sku.toUpperCase(), slug: slug.toLowerCase() };
}

function looksLikeNavNoise(text) {
  const t = text.trim();
  if (!t || t.length < 12) return true;
  if (t.length > 240) return true;
  // 导航/品类/系列广告常见短标
  if (/^(iphone|galaxy|huawei|samsung|xiaomi|oppo|vivo)\b/i.test(t) && t.length < 40) {
    return true;
  }
  if (/\biphone\s*\d+/i.test(t) && t.length < 60) return true;
  if (/mobiles?\s*&?\s*accessories/i.test(t)) return true;
  if (/^(home|electronics|television|shop by)/i.test(t) && t.length < 50) return true;
  if (/neo qled|qn\d+h|series\s*\d{4}/i.test(t) && t.length < 80) return true;
  // 纯类目面包屑
  if (/^[A-Za-z0-9 &\-/>]+$/.test(t) && (t.match(/\b&\b/g) || []).length >= 1 && t.length < 40) {
    return true;
  }
  return false;
}

function filterBullets(list, productTitle) {
  return uniq(list)
    .filter((t) => !looksLikeNavNoise(t))
    .filter((t) => {
      const lower = t.toLowerCase();
      const titleLower = String(productTitle || "").toLowerCase();
      const titleIsTv =
        /\btv\b|television|monitor|screen|portable smart/i.test(titleLower);
      if (titleIsTv && /\biphone|huawei pura|galaxy ai\b/i.test(lower)) return false;
      return true;
    })
    .slice(0, 12);
}

function productRoot() {
  return (
    document.querySelector("[data-qa='product-page']") ||
    document.querySelector("main") ||
    document.querySelector("#__next") ||
    document.body
  );
}

function extractDomHints() {
  const root = productRoot();
  const title =
    textOf(root.querySelector("[data-qa='product-name']")) ||
    textOf(root.querySelector("h1")) ||
    document.title.replace(/\s*\|\s*noon.*$/i, "").trim();

  const priceEl =
    root.querySelector("[data-qa='div-price-now']") ||
    root.querySelector("[class*='priceNow']") ||
    root.querySelector("[class*='PriceNow']");
  const price = textOf(priceEl);

  // 只在「卖点/亮点」容器内取 li，禁止全页 ul li
  const highlightRoots = [
    ...root.querySelectorAll(
      [
        "[data-qa='product-highlights']",
        "[data-qa='product-overview']",
        "[data-qa='key-features']",
        "[data-qa*='highlight']",
        "[data-qa*='feature']",
        "[class*='HighlightList']",
        "[class*='highlightList']",
        "[class*='keyFeature']",
        "[class*='KeyFeature']",
        "[class*='productHighlights']",
      ].join(","),
    ),
  ];

  let bulletNodes = [];
  for (const box of highlightRoots) {
    bulletNodes.push(...box.querySelectorAll("li"));
  }
  // 仍没有时：在 h2/h3 含 Overview / Highlights / Features 的区块内找 li
  if (!bulletNodes.length) {
    const heads = [...root.querySelectorAll("h2, h3, h4")];
    for (const h of heads) {
      const label = textOf(h).toLowerCase();
      if (!/(overview|highlight|feature|key\s*feature|规格|卖点)/i.test(label)) continue;
      let sib = h.nextElementSibling;
      for (let i = 0; i < 4 && sib; i += 1) {
        bulletNodes.push(...sib.querySelectorAll("li"));
        sib = sib.nextElementSibling;
      }
    }
  }

  const bullets = filterBullets(
    bulletNodes.map(textOf),
    title,
  );

  const descEl =
    root.querySelector("[data-qa='product-description']") ||
    root.querySelector("[data-qa*='description']") ||
    root.querySelector("#product-description");
  let description = textOf(descEl).slice(0, 4000);
  // 避免把整页 description 类导航扫进来：只要明确容器
  if (!description) {
    const overview = [...root.querySelectorAll("section, div")].find((el) => {
      const qa = (el.getAttribute("data-qa") || "").toLowerCase();
      const cls = (el.className || "").toString().toLowerCase();
      return qa.includes("description") || cls.includes("productdescription");
    });
    description = textOf(overview).slice(0, 4000);
  }

  const brand =
    textOf(root.querySelector("[data-qa='product-brand']")) ||
    textOf(root.querySelector("a[href*='/brand/']"));

  return { title, price, bullets, description, brand };
}

function scoreProductNode(node, hints) {
  const title = String(node.name || node.title || node.product_title || "");
  const sku = String(
    node.sku || node.offer_code || node.offerCode || node.sku_config || "",
  ).toUpperCase();
  const url = String(node.url || node.product_url || "");
  let score = 0;
  if (hints.sku && sku && sku === hints.sku) score += 50;
  if (hints.sku && url.toUpperCase().includes(hints.sku)) score += 40;
  if (hints.slug && url.toLowerCase().includes(hints.slug.slice(0, 24))) score += 20;
  if (hints.slug && title.toLowerCase().includes(hints.slug.split("-")[0])) score += 5;

  const bullets = []
    .concat(node.feature_bullets || [])
    .concat(node.highlights || [])
    .concat(node.key_features || [])
    .map((x) => (typeof x === "string" ? x : x?.text || x?.title || ""))
    .filter(Boolean);
  const description = String(
    node.long_description || node.description || node.product_description || "",
  );
  if (bullets.length) score += Math.min(bullets.length, 5);
  if (description.length > 40) score += 2;
  if (sku) score += 1;
  return { score, title, sku, url, bullets, description };
}

function extractFromNextData() {
  const next = document.getElementById("__NEXT_DATA__");
  if (!next?.textContent) return null;
  const hints = pageProductHints();
  try {
    const data = JSON.parse(next.textContent);
    let best = null;
    const walk = (node, depth) => {
      if (!node || depth > 14) return;
      if (Array.isArray(node)) {
        node.forEach((x) => walk(x, depth + 1));
        return;
      }
      if (typeof node !== "object") return;
      const title = node.name || node.title || node.product_title;
      const sku = node.sku || node.offer_code || node.offerCode || node.sku_config;
      if (title && (sku || node.long_description || node.feature_bullets || node.highlights)) {
        const ranked = scoreProductNode(node, hints);
        const price =
          typeof node.sale_price === "number"
            ? `${node.sale_price} SAR`
            : typeof node.price === "number"
              ? `${node.price} SAR`
              : node.price?.amount != null
                ? `${node.price.amount} ${node.price.currency || "SAR"}`
                : "";
        if (!best || ranked.score > best.score) {
          best = {
            score: ranked.score,
            title: ranked.title,
            price,
            bullets: ranked.bullets,
            description: ranked.description.slice(0, 4000),
            brand: String(node.brand || node.brand_name || ""),
            url: ranked.url || location.href,
            sku: ranked.sku,
          };
        }
      }
      Object.values(node).forEach((v) => walk(v, depth + 1));
    };
    walk(data, 0);
    // 没有 URL/sku 对齐时，分数通常很低：宁可不用 NEXT 的 bullets，避免广告商品
    if (best && hints.sku && best.sku && best.sku !== hints.sku && best.score < 40) {
      return null;
    }
    return best;
  } catch (e) {
    return { error: String(e) };
  }
}

function extractPdp() {
  const fromNext = extractFromNextData();
  const dom = extractDomHints();
  if (fromNext?.error) {
    return { error: fromNext.error };
  }

  const title = fromNext?.title || dom.title || "";
  const price = fromNext?.price || dom.price || "";
  const brand = fromNext?.brand || dom.brand || "";

  // 卖点：优先「与当前 URL 对齐」的 NEXT 数据；否则只用 DOM 限定容器
  // 绝不把 DOM 导航 li 与 NEXT 广告卖点无脑合并
  let bullets = [];
  const nextOk =
    fromNext &&
    fromNext.score >= 40 &&
    Array.isArray(fromNext.bullets) &&
    fromNext.bullets.length > 0;
  if (nextOk) {
    bullets = filterBullets(fromNext.bullets, title);
  }
  if (!bullets.length) {
    bullets = filterBullets(dom.bullets, title);
  }

  const description =
    (fromNext?.description && fromNext.score >= 40 ? fromNext.description : "") ||
    dom.description ||
    "";

  if (!title && !bullets.length && !description) {
    return {
      error: "未解析到商品内容（请确认在单个商品详情页，而非类目列表）",
    };
  }
  return {
    url: location.href,
    pageUrl: location.href,
    title,
    price,
    bullets,
    description,
    brand,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CAPTURE_LISTING_PDP") {
    sendResponse(extractPdp());
  }
  return true;
});
