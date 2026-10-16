# 补货可售对齐门户 Active Net · 窗口交接

> 写于：2026-10-13 11:30（上海）· **2026-10-13 11:40 本窗已落地方案 B + 验收**  
> 旧文档 `FBN_STOCK_REPLENISH_HANDOFF.md`（影刀分仓）已过时，分仓主路径是 Impex；本交接只谈「一次同步写到补货展示」。

## 本窗落地结果（2026-10-13 11:40）

| 项 | 状态 |
|----|------|
| 方案 B：live stock/catalog 成功 → debounce rebuild | ✅ `after-stock-sync.ts` + `poller.ts` / `sync.routes.ts`；日更/按钮 `cancelDebounced` 后立即 rebuild |
| 一次链路复用 `rebuildReplenishAfterStockSync` | ✅ 日更 / `POST sync-stock-sales` / live debounce |
| HFY stock+catalog 重拉 + N2 表重写 | ✅ `N2-补货表.xlsx` mtime **11:39**；`scripts/_sync-hfy-replenish-once.mts` |
| 样例对齐门户约 94/96 | 🔬 **已诊断（2026-10-13）**：Catalog Export 仅有 `stock_fbn_net=63`（无其它≈96 库存列）；FBN Summary 分仓 closing 合计≠96；门户 UI Active Net FBN=**96** ≠ 任何现有 Impex 字段。链路读 Export 字段无误，缺口在 **Export≠Catalog 页** |
| API 进程加载 debounce | ⏳ **需重启 API** 后 poller 挂钩才生效 |

## 用户原话（验收）

> 合并一下，确保同步链路一次就可以同步完成，最后需要展示的效果是和官方展示的库存量一致。

验收口径：

| 位置 | 应对齐 |
|------|--------|
| Noon Catalog · **Active Net Stock · FBN** | 官方现网数 |
| Outpost 补货表 / 补货页 · **可售** | 与上列一致（同 SKU） |
| 补货表 · **FBN** 列 | 分仓 ledger 合计（对照用，允许 ≠ 可售） |
| supermall | 仅参考，不算可售 |

对照样例（用户截图 2026-10-13）：

| 源 | SKU（KAZA Screenless Fitness Tracker） | 数 |
|----|----------------------------------------|----|
| Noon Active Net FBN | `N2SAJ…`（图中约 `N2SAJQ0001BLK`） | **94** |
| 补货页可售（本地表） | 同品 | **63**（旧） |
| 补货页 FBN 列 | 同品 | **71**（分仓） |
| 本地表生成时间 | `D:\outpost-data\replenish\N2-补货表.xlsx` | **2026-10-12 14:06**（未重写） |

## 本窗要做（优先，按序）

1. **收敛成一条同步链路**  
   任一入口（定时日更、补货页「重加载库存/销量」、必要时 live Impex 在 stock/catalog 成功后）最终都走同一管道：

   ```
   Impex stock → Impex/Catalog（带 stock_fbn_net）→ saveShopState
     → clearCatalogAssembleCache → rebuildWorkbooks(该店 N 前缀)
     → 补货页读本地 xlsx / 刷新后「可售」= 门户 Active Net
   ```

2. **补缺口（当前未完全合并）**  
   - 已挂：`stock-scheduler`（沪 09:30 / 16:00）`stock→catalog→rebuildReplenishAfterStockSync`  
   - 已挂：`POST /replenish/sync-stock-sales` + 前端「重加载库存/销量」  
   - **未挂**：通用 live Impex 轮询里偶发 `pullDomain(stock|catalog)` **不会**自动重算补货表  
   - 上午人工补的是 **orders/sales**，没走日更链路 → xlsx 仍停在 10/12  

   下一窗决策（推荐）：  
   - **方案 A（稳）**：live 轮询仍不写 xlsx；但保证「日更 + 按钮」是唯一对外承诺的一次同步，并在文档/UI 写清。  
   - **方案 B（用户要的「合并」）**：在 `pipeline` / live 成功写入 **stock 或 catalog** 后，对涉及店铺 **debounce**（如 2–5 min）调用 `rebuildReplenishAfterStockSync`，避免每 tick 打爆磁盘。  
   - 用户明确要「一次同步完成且和官方一致」→ **优先 B + 按钮/日更复用同一 `after-stock-sync`**；catalog 失败则 可售只能回退 ledger，须在返回 `errors` 里可见。

3. **对齐数必须含 Catalog Active Net**  
   - `assemble.ts` 已优先 `item.stockFbnNet`（= Catalog Export `stock_fbn_net`）  
   - `workbook/build.ts`：`可售 = inventory.fbn`（Active Net），`FBN列 = ledger.fbn`  
   - 只拉 stock、不拉 catalog → 可售仍可能是旧 net 或 ledger，**对不齐 94**  
   - 合并链路里 **catalog 与 stock 同属必拉**（sales 可跳过）。

4. **落地验证**  
   - 重启 API（否则新 scheduler / 路由可能未加载）  
   - 对 HFY（N2）跑一次完整同步（按钮或等价 API）  
   - 确认 `N2-补货表.xlsx` mtime 更新；该 SKU **可售 ≈ Noon 94**  
   - HUI（N1）同样跑一轮或确认日更会覆盖  
   - 看板「有库存/在库」已改 Active Net 口径，顺带目视即可，勿扩 scope。

## 已完成（勿重做）

| 项 | 位置 |
|----|------|
| stock stale 默认 14h；订单落后优先 poll | `live-impex-domains.ts` |
| 沪 09:30/16:00 库存日更 + catalog + rebuild | `stock-scheduler.ts`，`index.ts` → `startStockScheduler` |
| 补货可售 = Active Net；FBN 列 = 分仓 | `workbook/build.ts` / `types.ts` |
| 同步后清缓存重算 xlsx | `replenish/after-stock-sync.ts` |
| `POST /replenish/sync-stock-sales` | `replenish.routes.ts` |
| 前端「重加载库存/销量」 | `ReplenishPage.tsx` → `api.syncReplenishStockSales` |
| 看板 Active Net + 昨日销下午 caveat | `dashboard.routes.ts` / `HomePage.tsx` |

## 关键路径

```
apps/api/src/modules/replenish/after-stock-sync.ts
apps/api/src/modules/replenish/workbook/build.ts
apps/api/src/modules/replenish/replenish.routes.ts   # sync-stock-sales
apps/api/src/modules/sync/stock-scheduler.ts
apps/api/src/modules/sync/pipeline.ts               # live 成功回调挂 debounce 的候选点
apps/api/src/modules/catalog/assemble.ts            # stock_fbn_net → inventory.fbn
apps/web/src/pages/ReplenishPage.tsx
D:\outpost-data\replenish\N1-补货表.xlsx
D:\outpost-data\replenish\N2-补货表.xlsx
```

## 范围约束

- 只动：补货同步链路、stock/catalog 成功后的 rebuild 挂钩、必要时 UI 提示文案  
- **不要**顺手改广告、影刀、市场情报、飞书、订单 backfill  
- 不改 git config；未要求则不 commit  

## 下一窗口开场白（可直接贴）

请按 `docs/REPLENISH_ACTIVE_NET_SYNC_HANDOFF.md`：把库存/Catalog/补货表重算收成一条同步链路（含 live 成功后的 debounce rebuild），验收补货「可售」与 Noon Catalog Active Net FBN 一致（样例 N2 Fitness Tracker 门户约 94）。
