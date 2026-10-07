# 市场情报（Noon 沙特）· 项目交接

> 更新：2026-09-18 · **白牌热销 + 品类适销结论**（名录积累 + 未知才调模型仍保留）

## 最终目的

热品类里找**真正白板小牌**热销货 → 判断**品类适不适合做** → 店铺/评论作策略参考。  
**避开**：全球大牌 + 沙特/中东有名气或半知名品牌。

前端主问题：

1. 这个品类值不值得做？（建议跟 / 观望 / 不建议）
2. 该类目哪些白牌在热卖？（短名单）
3. 牌子定性仍是支撑能力（筛大牌、积累名录）

## 编排（关键）

```
类目页抽列表（含 Sold Recently / Best Seller / Ad / 评分）
  → 查 brand-registry（shared + 当前品类索引）
      命中 avoid → 不深采
      命中 white → 深采
      未命中 → POST /api/market-intel/brands/resolve
                （搜证走代码；有证据才 DeepSeek）
                → 知名则写入「该品类」autoAvoid
                → 否则 white_candidate 可深采 / pending
  → 白牌深采（商详→卖家→评论）→ 投递 inbox（products + hotList）
  → 慧运营 drain → watchlist
  → GET /api/market-intel/category-fitness → 品类结论 + 短名单
```

**积累效应**：同品类跑得越多，索引越全，调模型越少。

## 品类适销（一期）

接口：`GET /api/market-intel/category-fitness`（可选 `?categoryId=`）

粗算三角（**不做真实货源成本**）：

| 维度 | 含义 | 默认阈值（`config.fitness`） |
|------|------|------------------------------|
| 热度 | 白牌 `soldRecently` 中位数 | `soldRecentlyFloor` = 50 |
| 客单 | 白牌价格是否落在甜区 | `aspMin/aspMax` = 80–350 SAR |
| 竞争 | 热销位白牌占比 | `whiteShareSweetMin/Max` = 15%–55% |

结论三档：

- **建议跟 (go)**：有量 + 客单在甜区 + 白牌竞争可控
- **观望 (watch)**：缺 Sold Recently、样本少、或信号打架 / 偏卷
- **不建议 (skip)**：几乎全大牌，或客单离谱且无热度等

缺 Sold Recently **不会**瞎给「建议跟」。

阈值写入 `market-imports/noon/sa/config.json` 的 `fitness` 字段；**一键正式模式不覆盖**这些阈值。  
也可 `PUT /api/market-intel/config` 带 `fitness` 局部更新。

列表字段（影刀 → inbox → watchlist）：

- `soldRecently` / `soldRecentlyText`
- `isBestSeller` / `isAd`
- `rating` / `reviewCount`（尽量从卡片补）

入库时会合并 `products` 与 `hotList`（仅 hot 的类目热度投递也会进监控池，用于适销统计）。

## 标题中英对照

- 短名单 / 监控池展示：**上中文、下英文原文**
- `POST /api/market-intel/titles/zh`：用 DeepSeek 翻译并缓存到 `watchlist.titleZh`
- 打开类目自动补译缺失项；「重新翻译本页」可 `force` 重译
- 需已配置 `DEEPSEEK_API_KEY` 或仓库根 `DS-key.txt`

## 品牌定性样例增强

人工判牌时优先看：

- **Noon 链接**（可点跳转）
- **商品图**（列表页 CDN 图，比整页截图更轻）
- **卡片标签**（Sold Recently / Lowest price… / Best Seller / Ad 等，影刀从 DOM 抽取）

名录字段：`pendingReview[].exampleRefs[{ title, url, imageUrl, productKey, tags }]`  
滚动位若 DOM 同一时刻只渲染一条，只能采到当前可见标签；比 OCR 稳。整卡截图仅作后续可选兜底。

## 名录结构（单文件软隔离）

`D:\outpost-data\market-imports\noon\sa\brand-registry.json`

- `shared`：跨品类（国际大牌 + 中东常见）
- `categories[electronics-and-mobiles|…]`：该品类自己的 avoid/白牌/pending/aiReviews

物理仍是一张表；逻辑按品类分桶，查表更快、互不污染。

## AI

- Key：`DEEPSEEK_API_KEY` 或 `DS-key.txt`
- 影刀需慧运营 API 在跑（默认 `http://127.0.0.1:8787`）
- `OUTPOST_YD_MI_RESOLVE_LLM`：每类目最多新审几个牌（默认 8）
- 模型只自动写 **autoAvoid（不竞争）**；**确认白板必须人工**

## 原则

未确认白板不能当策略结论。Mock 等深采字段合格后再删。
