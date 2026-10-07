# 慧运营 × 飞书「常用四表」桥接

原则与影刀一致：**拉取方只负责拿到可信原始件；入库走统一热目录契约**。  
本文件定义**模块边界**；跨模块只能依赖下列契约，禁止直接互相改内部状态。

---

## 模块边界（必须对齐）

| 模块 | 职责 | 输入 | 输出 | 禁止 |
|------|------|------|------|------|
| **M1 Config** | 解析链接、校验 `feishu.docs.json`、读凭证路径 | env + docs 文件 | `FeishuDocsConfig` | 调飞书 API、写盘 |
| **M2 Puller** | 鉴权、读表、落 raw 快照 + run manifest | `FeishuDocsConfig` + HTTP | `feishu-raw/...` + `FeishuPullRunManifest` | 规范化 CSV、写 `portal-imports`、改 `AppState` |
| **M3 Normalizer** | 表头映射、类型清洗、拒收坏行、行数骤降守卫 | raw 快照契约 | `feishu-normalized/...` 下 `feishu_local_cost_*.csv` / `feishu_dims_*.csv` + rejects | 调飞书 API、写 `portal-imports`、upsert 业务表 |
| **M4 Ingest** | 按 **partnerSku** upsert 本地域；写对齐报告；不删旧本地行 | M3 CSV | `AppState.skuLocalCosts` / `skuDims` + `align-reports/` | 覆盖 Noon catalog/stock/sales/fees/ads |

当前 M3 已实现：**product**（成本+尺寸）、**packing**（仅尺寸，`source=feishu:packing`）。汇总默认同步拉 `product` + `packing`。dims ingest：**已有非空尺寸不覆盖**（装箱/Noon 只补空字段）。

衔接只允许：

```
M1 → M2 →（磁盘 raw 契约）→ M3 →（CSV 文件名契约）→ M4 → assemble 引用本地域
```

---

## 磁盘契约（M2 → M3）

根目录默认：`{OUTPOST_ROOT}/feishu-raw`（可用 `OUTPOST_FEISHU_RAW_DIR` 覆盖）。

```
feishu-raw/
  runs/
    {runId}/
      manifest.json          # FeishuPullRunManifest
      {docId}/
        snapshot.json        # FeishuRawSnapshot v1
        meta.json            # 行数/sha1/耗时（便于人眼排查）
```

- **不丢数据**：raw 只追加；清理策略另定，Puller 不删历史 run。
- **防脏**：Puller 不做业务字段解释；行数骤降守卫留给 M3（或 M2 可选 guard，默认告警不阻断写 raw）。

---

## 环境变量

| 变量 | 含义 |
|------|------|
| `OUTPOST_FEISHU_APP_ID` | 企业自建应用 app_id |
| `OUTPOST_FEISHU_APP_SECRET` | app_secret |
| `OUTPOST_FEISHU_DOCS_FILE` | 四表映射 JSON（见 `apps/api/config/feishu.docs.example.json`） |
| `OUTPOST_FEISHU_RAW_DIR` | raw 根目录；默认 `{OUTPOST_ROOT}/feishu-raw` |
| `OUTPOST_ROOT` | 与店铺数据根一致，默认 `D:\outpost-data` |

---

## 错误定位

所有飞书错误统一为 `FeishuError`：`code` + `stage` + `hint` + `detail`。  
CLI / 日志打印 `toJSON()`，按 `stage` 快速判断是配置、鉴权、读表还是写盘。

---

## 与 Noon / 影刀

| 源 | 域 |
|----|-----|
| Noon Impex | catalog / stock / orders / sales / fees |
| 影刀 | ads → portal-imports |
| 飞书四表 | **仅本地域**（成本、尺寸、装箱、采购、现金、运营标签） |

飞书表内的在线价/佣金/FBN/广告列：**M3 必须丢弃**，不得覆盖官方域。

**币种**：飞书「采购单价」与到仓成本衍生的**头程**一律按 **人民币（CNY/RMB）** 入库；Catalog 拼装时用首页「回购汇率」`buybackRate`（SAR→CNY）换算为 SAR 再参与毛利。不得与 Noon 售价（SAR）直接相减。

---

## 磁盘契约（M3 → M4）

根目录默认：`{OUTPOST_ROOT}/feishu-normalized`（`OUTPOST_FEISHU_NORMALIZED_DIR` 可覆盖）。

```
feishu-normalized/
  last-normalize.json
  runs/{normRunId}/
    normalize-manifest.json
    feishu_local_cost_YYYY-MM-DD.csv   # partnerSku,purchaseCost,headhaul,preferAir,updatedAt,source
    feishu_dims_YYYY-MM-DD.csv         # partnerSku,lengthCm,widthCm,heightCm,weightKg,updatedAt,source
    product/rejects.jsonl
```

M4 只认上述文件名与列名；**不得**把飞书原价/佣金写入 catalog。

Puller 读表必须使用 `valueRenderOption=ToString`，否则 ARRAYFORMULA 列无法规范化。

---

## 命令

```powershell
cd apps/api
pnpm exec tsx src/platforms/feishu/config.test.ts
pnpm exec tsx src/platforms/feishu/puller.test.ts
pnpm exec tsx src/platforms/feishu/normalize/normalize.test.ts
pnpm exec tsx scripts/feishu-pull-raw.ts --doc product
pnpm exec tsx scripts/feishu-normalize.ts --run last --doc product
pnpm exec tsx scripts/feishu-ingest-local.ts
# 或前端 Catalog「入库飞书本地」→ POST /api/catalog/ingest-feishu-local
```

对齐键：**partnerSku（PSKU）**。入库写 `source` + `normalizeRunId`；对齐报告见 `feishu-normalized/align-reports/` 与 `last-align.json`。

---

## 汇总同步链（推荐）

```
影刀（先）→ shops/{shopId}/portal-imports/ads_sku_*.csv
                ↓
汇总同步 = Noon Impex → ads_ingest → 飞书 pull → normalize → ingest → Catalog
```

| 段 | 数据时效 | 说明 |
|----|----------|------|
| Noon Impex | 近实时 / 官方导出窗口 | 价库单销佣 |
| 影刀 Ads | **默认昨天**（from=to） | 投产比按「落在窗口内的报表」汇总；只有昨日报时，d7 列实质≈昨日广告 |
| 飞书本地 | 表内更新时间 | 成本/尺寸 |

**顺序**：影刀必须先跑完并落盘，再点「汇总同步」（汇总不启动影刀）。定时汇总前请保证影刀已定时导出，或接受沿用上一日 CSV。

广告权威源：每次汇总 `ads_ingest` **强制入库** `portal-imports` 下 **mtime 最新** 的 `ads_sku_*.csv`（同秒再比文件名 toDate），不依赖「全目录扫到哪算哪」。Catalog `meta.provenance.ads` 与该文件对齐。

Catalog 溯源（P0）：`GET /api/catalog` → `meta.provenance`（noon / ads / feishu 的 source、报表区间、文件路径、syncedAt）；投产比列标注「昨日·影刀」，悬停可看文件名与路径。

| 触发 | 入口 |
|------|------|
| 手动 | `POST /api/sync/assembly-sync` · Catalog「汇总同步」 |
| 定时 | `startAssemblySyncScheduler`（默认 6h，`OUTPOST_ASSEMBLY_SYNC_*`） |

状态：`GET /api/sync/assembly-sync/last` · `assembly-sync/last-assembly-sync.json`  
与 noon-poller 并列：poller 做轻量域轮询；汇总链负责「平台+广告+本地」整链刷新。
