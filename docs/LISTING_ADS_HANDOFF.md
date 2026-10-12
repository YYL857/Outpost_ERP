# Listing × 影刀广告导出 · 窗口交接

> 更新：2026-09-23 · 上一窗口已落地四阶段代码；下一窗口做**两条实测**。

## 下一窗口实测目标

| # | 链路 | 目标 |
|---|------|------|
| **1（先做）** | **影刀表格导出** | Ad Manager → Export all → 规范 CSV → 店隔离 `portal-imports` |
| **2（后做）** | Listing 优化 | 绑定指标 → 漏斗/基线 → 诊断 → 改写（依赖链路 1 有数据） |

---

## 链路 1：影刀表格导出（实测清单）

### 前置

1. 本机浏览器已登录 [Ad Manager](https://admanager.noon.partners/en-sa/home)（从 Partners → Advertising 进，勿直开 advertising.noon.com）
2. 影刀应用目录已含最新脚本（本机改过，若用打包应用需重新导入/同步）：
   - `D:\YingDao\Flows\outpost_noon_ads_export\main.py`（含 Last 7 days）
   - `D:\YingDao\Flows\outpost_noon_ads_export\outpost_bridge.py`（含 **atc**）
   - `D:\YingDao\Flows\_lib\outpost_bridge.py`（同源）
3. 对接店：`PRJ482387`、`PRJ396770`

### 建议第一次怎么跑

**方案 A（推荐先跑 yesterday，验通路）**

| 变量 | 值 |
|------|-----|
| `OUTPOST_YD_ADS_MODE` | `ui`（默认） |
| `OUTPOST_YD_ADS_RANGE` | `yesterday` |
| `OUTPOST_YD_ADS_SHOPS` | `PRJ482387,PRJ396770`（或先单店 `PRJ482387`） |
| `OUTPOST_YD_BROWSER` | `cef` 或 `chrome`（以本机稳定登录为准） |

影刀运行 `outpost_noon_ads_export` → 看日志换店 / Export / 落盘。

**方案 B（为 Listing 优化备 7 日数据）**

| 变量 | 值 |
|------|-----|
| `OUTPOST_YD_ADS_RANGE` | `days` |
| `OUTPOST_YD_ADS_DAYS` | `7` |

应点选 **Last 7 days** 再 Export。

**方案 C（已有 xlsx，只规范投递）**

- 文件放到 `D:\YingDao\Downloads\{shopId}\` 或 Exports inbox  
- `OUTPOST_YD_ADS_MODE=inbox` + `OUTPOST_YD_ADS_SHOP=PRJxxxxx`

### 落盘验收（链路 1 成功标准）

按店检查（禁止只有全局 `portal-imports`）：

```
D:\YingDao\Downloads\{shopId}\          # 原始 OVERVIEW xlsx（可有）
D:\YingDao\Exports\ads\{shopId}\        # ads_sku_*.csv
D:\outpost-data\shops\{shopId}\portal-imports\ads_sku_*.csv   ← 关键
```

打开最新 `ads_sku_*.csv` 确认：

- 表头含：`sku,campaign_name,from_date,to_date,spend,revenue,orders,views,clicks,atc`
- 有真实 SKU 行（活动名常带 `N2SAKFJ003BLK - …`）
- `atc` 列有数或为 0（旧表无列时 bridge 写 0）

### 入库验收（同一链路收尾）

1. 慧运营 API 在跑，**切到对应店**
2. Catalog → **汇总同步**（含 ads_ingest）或「扫目录」
3. **广告管理**页有 facts；或 Catalog「投产比」列有数
4. 可选脚本：`apps/api` 下 `scripts/ingest-ads-once.mts`（按当前活跃店）

### 常见翻车点

| 现象 | 处理 |
|------|------|
| 登录页 / fault filter | 保活应用 `outpost_noon_ads_keepalive`；勿直开 advertising.noon.com |
| 只写了全局 portal-imports | 旧 bridge；确认用带 `shop_id=` 的 `_lib` / ads_export bridge |
| CSV 无 atc | 未同步新 bridge；或仍是旧 xlsx 直拷（须走 normalize） |
| 单店失败 | 日志里另一店可能仍 OK；先单店 `OUTPOST_YD_ADS_SHOPS=PRJ482387` 排障 |
| days 模式仍导昨天 | 确认环境变量生效；`main.py` 应调 `_select_last_n_days` |

### 文档入口

- `docs/ADS_AUTO_PIPELINE.md`
- `docs/YINGDAO_BRIDGE.md`
- `D:\YingDao\Flows\outpost_noon_ads_export\README.md`

---

## 链路 2：Listing 优化（链路 1 通过后再测）

### 入口

- 侧栏 **Listing** → Tab **Listing 优化**（`/listing?mode=optimize`）
- 日常：**绑定并清洗指标** = 只读已入库 `adsFacts`（优先复用凌晨昨日导出），**不**自动跑影刀  
- 按需：「检查广告数据」→ `POST /api/ads/ensure-export`（有昨日则 `reuse`；缺昨日才写 pending）  
- 兜底：「强制重拉」→ 同接口 `force=true` → pending → watcher  
  （需本机跑 `D:\YingDao\Flows\outpost_ads_export_watcher`；否则 pending 会一直挂）

### 步骤

1. 新建任务 → 填 **partnerSku**（或链接）+ 粘贴现有标题/卖点/描述  
2. 优先直接 **绑定并清洗指标**；缺数再「检查广告数据」/「强制重拉」→ watcher done → 汇总同步  
3. 看漏斗断点、店内基线、CTR/ATC/CVR  
4. **开始诊断** → **生成优化文案**（需 `DEEPSEEK_API_KEY`）

### 关键代码（勿逛改无关模块）

| 区域 | 路径 |
|------|------|
| 优化 API | `apps/api/src/modules/listing/optimize-*.ts`、`listing.routes.ts` |
| 清洗/漏斗/基线 | `optimize-metrics.ts` |
| ATC 类型/解析 | `common/types.ts` AdsFact.atc、`parsers.ts`、`assemble.ts` |
| 请求导出 | `ads/yingdao-request.ts`、`ads-freshness.ts`、`ads.routes.ts`（`/freshness` `/ensure-export`） |
| 前端 | `ListingPage.tsx`、`ListingOptimizePanel.tsx` |

---

## 本窗口已完成（勿重复造）

1. **ATC**：影刀 CSV + 入库 + AdsWindow 汇总  
2. **Listing 优化**：竞品生成 / 优化双 Tab；漏斗 + 店内中位基线 + LLM 诊断改写  
3. **双轨文档 + 影刀 Last 7 days 点击**  
4. **Requests 触发**：API + watcher 骨架 + Listing「拉取广告表」按钮  

模块改名：侧栏 **Listing**（不再叫「Listing 生成」）。

---

## 下一窗口开场建议（可直接粘贴）

```
按 docs/LISTING_ADS_HANDOFF.md 做实测。
先测链路 1：影刀 outpost_noon_ads_export 表格导出（建议先 yesterday 单店 PRJ482387），
验收 portal-imports 下 ads_sku_*.csv 含 atc 并能入库。
通过后再测链路 2：Listing 优化绑定指标。
```
