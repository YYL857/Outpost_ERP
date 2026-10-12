# 市场情报 / 选品 · 项目交接

> 更新：2026-10-06 14:21 · 买家商城前台**仍走影刀**（市场情报 / 耗材）。Playwright 不替换这条。成功标准仍是 inbox JSON → 现有 drain。

> 2026-09-23 15:50 · **本窗口收尾**：咖啡机 Amazon.sa 入场判断+桌面 PDF；Noon 耗材新店选品（Amazon 证据）；影刀 CLI Agent 工具已通；**真采卡在 Edge 影刀插件**。

## 换窗口先看（2026-09-23）

### 三件事并行状态

| 课题 | 结论/进度 | 产物 | 下一闸门 |
|------|-----------|------|----------|
| **咖啡机垂类入场（沙特）** | 有条件入场：锥刀 180–350 + 半自动 350–700；不做全品类 | 桌面 PDF；Canvas `amazon-sa-coffee-entry-decision` / `amazon-sa-coffee-market` | OEM 实样 + FBN 实测尺寸重量算净利（渠道未用） |
| **Noon 新店 · 耗材** | 易捞钱：密封袋/保鲜膜/垃圾袋/铝箔/化妆棉；咖啡协同：滤纸+除垢 | Canvas `sa-consumables-easy-money`；原始 JSON `apps/api/scripts/_out/` | **影刀真采 Sold Recently**（插件修好后）；FBN 泡重算价 |
| **影刀自动化（Agent 可跑）** | CLI 链路通；`demo` 投递已验；**真采 Edge 插件失败** | `yingdao-run.mjs` + skill `yingdao-pc-cli` | 用户启用 Edge 影刀扩展 → Agent 再 `consumables` |

### 本窗口已做（勿重做）

| 项 | 状态 |
|----|------|
| Amazon 有头可抓验证 | 通（畅销/搜索/PDP）；冷启动首页可能验证码 |
| Amazon.sa 咖啡机深采 | 有头：类目 CTE p1–4 + 细分搜索 + 18 PDP；去重≈183；报告 PDF 已落桌面 |
| Amazon.sa 耗材抓取 | 有头≈415 列表 / 耗材语义≈254；Noon.sa 有头 403→未吃透也封 |
| 耗材易赚钱排序 | 优先日耗白牌轻货；避洗衣凝珠/婴儿湿巾大牌/泡货纸巾/正统胶囊 |
| 影刀 search 模式 | `outpost_noon_sa_market_intel` 支持 MODE=search + 消费 `mi_consumables_*.json` |
| 影刀耗材应用/监视器 | `outpost_noon_sa_consumables`、`outpost_mi_consumables_watcher` |
| 慧运营 API | `POST /api/market-intel/request-consumables-scrape` |
| Agent 跑影刀 | `apps/api/scripts/yingdao-run.mjs`（health/sync-mi/consumables/run/status/logs） |
| sync-mi | Flows `main.py` → 已安装应用目录，去掉旧 `main.pybx` |

### 当前阻塞（真采）

```
检测不到有效的插件进程，影刀无法与 Microsoft Edge 建立连接
```

- 任务例：`f1db19a2-…` / `56002a45-…` → `faulted`
- `demo` 不写网页 → 成功写 inbox
- 社区版 CLI **每日运行次数有限**（曾提示剩余 1 次）
- 保活应用用的是 **CEF + Ad Manager**，不能代替 Noon 前台 Edge 插件

**用户需做一次**：Edge → 启用影刀扩展 → 打开 `https://www.noon.com/saudi-en/` → 告知 Agent「好了」→  
`cd apps/api && node scripts/yingdao-run.mjs consumables`

### 下一窗口建议顺序

1. **修 Edge 插件 → 跑通耗材 Sold Recently**（影刀渠，耗材课题未封「真采」）
2. 用 Sold Recently 复核「易捞钱」品类排序，必要时改首发 SKU
3. **FBN/货代实测泡重**（垃圾袋/纸巾必算）— 渠道未用
4. 咖啡机：OEM 实样对标 Stilosa/DOSCHER 带 + 成本闸门（勿再抓 Amazon.sa）
5. **不要**：补抓已封存的 Amazon.sa / Noon.sa（咖啡或耗材课题）；无点名别重开

### 关键路径

| 用途 | 路径 |
|------|------|
| Agent 影刀 CLI | `apps/api/scripts/yingdao-run.mjs` |
| 应用 ID 表 | `apps/api/config/yingdao-apps.json` |
| Cursor 技能 | `.cursor/skills/yingdao-pc-cli/SKILL.md` |
| 影刀 Flows | `D:\YingDao\Flows\outpost_noon_sa_market_intel\`（含 search） |
| 投递 inbox | `D:\outpost-data\market-imports\noon\sa\inbox\yingdao\` |
| 请求 pending | `D:\YingDao\Requests\pending\mi_consumables_*.json` |
| 耗材/咖啡原始抓取 | `apps/api/scripts/_out\` |
| 桌面 PDF | `桌面\沙特咖啡机垂类入场分析_Amazon.sa_2026-09-23.pdf` |
| 渠道封存表 | `.cursor/rules/market-intel-source-once.mdc`（咖啡 + 耗材两表） |
| 影刀桥文档 | `docs/YINGDAO_BRIDGE.md`、`docs/MARKET_INTEL_YINGDAO.md` |

### 渠道（摘要）

- **咖啡**：Amazon.sa 等已封；未用：OEM 实样、货代/FBN 实测  
- **耗材**：Amazon.sa / Noon.sa（前台）已封；影刀 Sold Recently = **链路通、真采待插件**；未用：FBN 实测、OEM  

---

## 历史：白牌类目情报主线（2026-09-20 前，仍有效）

**目标**：Noon SA 找白牌热销 → 品类适销 → 短名单。确认白板**只人工**。慧运营不爬 Noon。

**进度粗判**：主链路约 70–80%；`confirmedWhite=0`。旧影刀日志：`D:\YingDao\Logs\market_intel_sa_20260920_113710.json`。

**旧下一闸门**：人工审 electronics pending；勿为抬 Sold Recently 空跑。  
**怎么验（类目白牌）**：影刀「前哨-Noon沙特-市场情报投递」或 `yingdao-run.mjs run market-intel`（需 Edge 插件）。

---

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

粗算三角（**不做真实货源成本**；FBN 估算是短名单辅助）：

| 维度 | 含义 | 默认阈值（`config.fitness`） |
|------|------|------------------------------|
| 热度 | 白牌 `soldRecently` 中位数 | `soldRecentlyFloor` = 50 |
| 客单 | 白牌价格是否落在甜区 | `aspMin/aspMax` = 80–350 SAR |
| 竞争 | 热销位白牌占比 | `whiteShareSweetMin/Max` = 15%–55% |

结论三档：建议跟 / 观望 / 不建议。缺 Sold Recently **不会**瞎给「建议跟」。

## FBN 单件毛利（选品辅助，2026-09-20）

对齐表「15%普货 / 25%时尚」：

`毛利 = 售价 − (货源+上架+拣货+操作+头程+落地配+佣金+VAT+仓储) − CPC×点击假设`

- 代码：`apps/api/src/modules/market-intel/fbn-profit.ts`（前端镜像 `apps/web/src/lib/fbn-profit.ts`）
- 短名单假设条：佣金档 / 货源 / 头程 / 落地配 / CPC / 点击 / 仓储
- CSV：`GET /export/shortlist.csv` 带分项；兼容旧 `costSar`/`shipSar`
- 默认：`GET /fbn-profit/defaults`
- 当前采集通常只有售价 → UI 标「估算」

## 标题中英对照

- 短名单 / 监控池：**上中文、下英文原文**
- `POST /api/market-intel/titles/zh`；需 `DEEPSEEK_API_KEY` 或 `DS-key.txt`

## 品牌定性

- **白板只人工**（前端「确认白板」）
- AI 只可自动写 **autoAvoid**
- pending 可「不竞争」/「删除」（不进名录）/「清理脏 token」

名录：`D:\outpost-data\market-imports\noon\sa\brand-registry.json`

## AI

- Key：`DEEPSEEK_API_KEY` 或 `DS-key.txt`
- 影刀需慧运营 API（默认 `http://127.0.0.1:8787`）
- `OUTPOST_YD_MI_RESOLVE_LLM`：每类目最多新审几个牌（默认 8）

### 耗材 Sold Recently（2026-09-23 完善）

- 影刀：`outpost_noon_sa_consumables`（MODE=search）+ `outpost_mi_consumables_watcher`
- API：`POST /api/market-intel/request-consumables-scrape`
- 文档：`docs/MARKET_INTEL_YINGDAO.md`

## 2026-09-19～20 已落地（勿重做）

影刀 `D:\YingDao\Flows\outpost_noon_sa_market_intel\main.py`：

- 价格 / 品牌 token / Mega Deal / 店名清洗（此前）
- `findProductCard` + `_extract_via_js_scrolled`（Sold Recently）
- `_BRAND_TOKEN_SKIP` 含店名/UI 脏词 + `technology`/`ict`

慧运营 `apps/api/src/modules/market-intel/`：

- `signal-quality` / `white-label` prune+discard / `fbn-profit` / `category-fitness`（促销卡出样本）
- `parse-products`：`cardTags` 回落销量
- 前端：FBN 假设 + 品牌删除/清脏

## 关键路径

| 层 | 路径 |
|---|---|
| 影刀 | `D:\YingDao\Flows\outpost_noon_sa_market_intel\` |
| API | `apps/api/src/modules/market-intel/` |
| 前端 | `apps/web/src/pages/MarketIntelPage.tsx` |
| 交接 | `docs/MARKET_INTEL_HANDOFF.md` |
| 数据 | `D:\outpost-data\market-imports\noon\sa\` |
| 核算表 | `NOON平台的成本与利润核算表.xlsx`（FBN 已对齐公式，未接细类佣金表） |

## 原则

未确认白板不能当策略结论。  
**先不铺美妆/家居正式适销，也不做 OCR。**  
后续功能规划以**人工确认白板之后**为主闸门。
