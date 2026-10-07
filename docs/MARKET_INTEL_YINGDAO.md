# 影刀 → 慧运营市场情报投递

目标：**白牌卖家情报**（非类目大牌堆砌）。

目录：`D:\YingDao\Flows\outpost_noon_sa_market_intel`

```
类目页（热度信号，可含大牌）
  → 过滤白牌
  → 商详拿卖家链接
  → 卖家页：评分 / 90天客户 / 评论
  → inbox/yingdao/*.json
  → 慧运营监控池 + sellers/ + reviews/
```

| 变量 | 默认 | 说明 |
|------|------|------|
| `OUTPOST_YD_MI_MODE` | `ui` | `ui` 真采 / `demo` 样例 |
| `OUTPOST_YD_BROWSER` | `edge` | Edge + 影刀插件 |
| `OUTPOST_YD_MI_ONLY` | 空 | 如 `electronics-and-mobiles` |
| `OUTPOST_YD_MI_TOP_N` | `50` | 类目热度列表 |
| `OUTPOST_YD_MI_SELLER_N` | `5` | 每类目深采白牌数 |
| `OUTPOST_YD_MI_REVIEW_K` | `15` | 每店评论样本 |

投递目录：

```
D:\outpost-data\market-imports\noon\sa\inbox\yingdao\
```

## JSON 主字段

```json
{
  "source": "yingdao",
  "intent": "white_label_seller_intel",
  "categoryId": "electronics-and-mobiles",
  "hotList": [{ "productKey": "...", "brandTier": "big_brand" }],
  "products": [
    {
      "productKey": "Z...",
      "title": "...",
      "url": "https://www.noon.com/saudi-en/.../p/",
      "brandTier": "white_label",
      "price": 169,
      "seller": {
        "sellerId": "p-68901",
        "sellerName": "Armfit",
        "sellerRating": 4.6,
        "sellerPositivePct": 94,
        "sellerCustomers90d": "2K+",
        "sellerSince": "March, 2023"
      },
      "reviews": [{ "text": "سرعة التوصيل", "language": "ar", "rating": 5 }]
    }
  ]
}
```
