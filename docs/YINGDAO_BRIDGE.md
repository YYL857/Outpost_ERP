# 慧运营 × 门户导出桥接

Noon **Impex / 飞书** 仍走慧运营自动同步。必须点门户的报表改由 **Playwright 平台**（[`PW_RPA_PLATFORM.md`](./PW_RPA_PLATFORM.md)）。影刀仅保留市场情报/耗材。

## 契约（广告示例）

```
Playwright job ads（按店循环）导出「昨天」广告报表
  → D:\YingDao\Downloads\{shopId}\ + Exports\ads\{shopId}\
    → D:\outpost-data\shops\{shopId}\portal-imports\ads_sku_{Y}_{Y}.csv
  → 慧运营对该店 auto-ingest
  → Catalog 投产比
```

| 项 | 约定 |
|----|------|
| 工作区 | `D:\YingDao\` Downloads/Exports/Logs；脚本在仓库 `apps/api/scripts/noon-pw-platform` |
| 热目录（按店） | `D:\outpost-data\shops\{shopId}\portal-imports` |
| Ads 规范名 | `ads_sku_YYYY-MM-DD_YYYY-MM-DD.csv` |
| Sales 规范名 | `sales_export_{from}_{to}.csv`（三态清洗后） |
| 对接店 | `PRJ482387`、`PRJ396770`（`OUTPOST_YD_ADS_SHOPS`） |
| 隔离 | 禁止写入全局 `portal-imports` |
| 解析 | `apps/api/src/platforms/noon/portal/parsers.ts`（口径不改） |

## 谁做什么

| 空缺 | 现路径 |
|------|--------|
| Ads Campaign Overview | Playwright `ads`（不再写 pending、不再 spawn 影刀） |
| Seller Lab Sales（≠ Impex productviews） | Playwright `sales` |
| 登录态续期 | Playwright `keepalive` |
| FBN/Supermall 分仓 | **Impex Detailed** live `stock`；影刀 fbn-stock 下岗 |
| My Catalog Estimated Fees / FBN 尺寸 | 待业务点名；不新建爬虫 |
| Noon 沙特市场情报 / 耗材 Sold Recently | **仍影刀** `outpost_noon_sa_market_intel` |
| Seller Lab 菜单教学 | 归档 `outpost_noon_guide_capture` |
| SOP 失败兜底 | 归档 `outpost_inbox_deliver` |

### 门户 Sales

补货页「导出销量表」→ job `sales` → `sales_export_*.csv`。Impex `productviewsandsalesdata` 继续补洞，两套不混。

### FBN 分仓

Impex `ledgerdetailedview` 为 live 主路径。不要再跑影刀库存导出当生产。

## 本机 CLI

```bash
cd apps/api/scripts/noon-pw-platform
python main.py ads ui
python main.py sales ui
```

影刀 CLI（仅市场情报/手工）：

```bash
cd apps/api
node scripts/yingdao-run.mjs health
node scripts/yingdao-run.mjs run market-intel
node scripts/yingdao-run.mjs consumables --demo
```
