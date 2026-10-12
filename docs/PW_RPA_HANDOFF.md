# Playwright 爬虫平台 · 窗口交接

> 更新：2026-10-12 · 增加邮箱 OTP 无人值守（IMAP）

**按 `docs/PW_RPA_HANDOFF.md` 继续：不要动 Impex/飞书；不要用脚本爬 Noon 买家商城。市场情报走影刀。**

---

## 下一窗先记住（硬约束）

- **Playwright 只扛卖家后台三条**：`ads` / `sales` / `keepalive`。不要加第四条 job。
- **销量下载必须点文件旁 `<a>`**（`sales_export_…` 右侧下载链）。Playwright 原生 `locator.click`，配合 `expect_download`。
- **禁止** `page.evaluate` / JS `el.click()` 点下载——收不到 `download` 事件（本窗两店因此超时）。
- **买家商城市场情报仍走影刀**。不要再接 Playwright 前台爬虫（`www.noon.com` Access Denied；`jobs/front.py` 已删，pyc 残留勿复活）。
- **不要动** Noon Impex、飞书、Catalog 拼装。

---

## 谁换了 / 谁没换

| 原影刀 | 现在 | 说明 |
|--------|------|------|
| ads-export | Playwright `ads` | Ad Manager → adsFacts，导完自动入库 |
| sales-export | Playwright `sales` | Seller Lab → salesFacts，导完自动入库 |
| noon-keepalive | Playwright `keepalive` | 只续 Ad Manager + Seller Lab cookie |
| fbn-stock | Impex Detailed（不是爬虫） | 分仓库存 |
| **market-intel / consumables** | **仍影刀** | 买家商城 `www.noon.com`；Akamai；见 [`MARKET_INTEL_HANDOFF.md`](./MARKET_INTEL_HANDOFF.md) |

爬虫只换影刀里的**卖家后台导出**。Impex、飞书、Catalog 拼装不动。

---

## 替换后闭环（卖家后台）

影刀 ads/sales/keepalive 的生产效果 = Playwright 导出落盘 **并且** 进 `adsFacts`/`salesFacts`。

| 环节 | 现在 |
|------|------|
| 导出 | 补货 / 广告 / Studio「开始跑」→ `python main.py <job> ui`。`shopIds` 经 `OUTPOST_YD_ADS_SHOPS` + 店名 `OUTPOST_YD_ADS_SHOP_LABELS` 传入；每店打开 `?project=` 后用账号切换器核对，对不上就该店失败 |
| 导完 | `ingestPortalAfterPwJob`：只灌**本次跑之后**新落到 portal-imports 的表；部分店失败仍入库成功店 |
| live 重加载 | `runAutoSync` 先 portal 入库再拉 Impex 库存 |
| 本窗已灌 | 两店 `sales_export_2026-07-09_2026-10-06.csv` → facts 482=1304 / 770=3894，maxDate=2026-10-05 |

`apply-portal-replenish-exports.mts` 会用 9 月底 FBN 覆盖库存，**不要盲跑**。

买家商城（`www.noon.com` 货架 / Sold Recently / 白牌卖家）= **市场情报链路，影刀**（`market-intel` / `consumables`）。

---

## 下一窗口可做

1. 广告若要覆盖今天：广告页「导出广告表」。
2. 市场情报真采：修好 Edge 影刀插件后 `yingdao-run.mjs consumables`（见 [`MARKET_INTEL_HANDOFF.md`](./MARKET_INTEL_HANDOFF.md)）。
3. 若改销量点击：只动 `_click_download_icon`，**优先 `xpath=following::a[1]`**，不要改回 JS click，不要先点 `<button>`。
4. **不要**做：用 Playwright 爬买家商城；改 Impex / 飞书 / `parseAdsContent`。

---

## 已完成（勿重做）

统一平台：`apps/api/scripts/noon-pw-platform` + Node `apps/api/src/modules/pw-rpa/`。  
生产 spawn `python main.py <job> ui`，**不再** `yingdao-run.mjs` ads-export / sales-export / noon-keepalive。

```powershell
cd D:\Outpost_ERP\apps\api\scripts\noon-pw-platform
python main.py ads login    # Ad Manager cookie（可自动 OTP）
python main.py sales login  # Seller Lab cookie（与 ads 共用统一登录）
python main.py ads ui
python main.py sales ui
python main.py keepalive ui
```

### 邮箱 OTP 无人值守（可选）

cookie 过期时统一登录会停在 Noon 邮箱验证码页。配好本机 `.env` 后，脚本可自动填邮箱并从网易 IMAP 取码回填（仍弹有头 Chrome，但不必人肉看邮件）：

1. 163 网页开启 IMAP，生成**客户端授权码**（不是网页密码）。
2. 根目录 `.env`（勿提交）：

```env
OUTPOST_NOON_OTP_AUTO=1
OUTPOST_NOON_LOGIN_EMAIL=17727538283@163.com
OUTPOST_NOON_OTP_IMAP_HOST=imap.163.com
OUTPOST_NOON_OTP_IMAP_USER=17727538283@163.com
OUTPOST_NOON_OTP_IMAP_PASS=你的授权码
```

3. 验收：`python main.py keepalive login`（或 `ads login`）。日志应出现 `[otp-auto]` / `[otp-imap]`，并双写 ads+seller `storage_state`。

导出撞登录墙时本期仍直接失败；需先跑上述 login。广告定时失败连环自动重登未做。

| job | 入口 | 落盘 |
|-----|------|------|
| ads | 广告页「导出广告表」；补洞缺 ads；`POST /api/pw-rpa/ads/run` | `ads_sku_{from}_{to}.csv` |
| sales | 补货页「导出销量表」 | `sales_export_{from}_{to}.csv` |
| keepalive | **定时已下线**；`GET /api/pw-rpa/session-status` 读 cookie 过期并提示；需时手工/自动 OTP 登录 | 刷新两套 cookie |

Cookie：**分站点**  
- Ad Manager：`D:\outpost-data\browser-profiles\noon-ads-pw\storage_state.json`  
- Seller Lab：`D:\outpost-data\browser-profiles\noon-seller-pw\storage_state.json`  
禁止混用。导出必须 `launch + storage_state`（不要 persistent_context）。

FBN：Impex Detailed 主路径；影刀 `fbn-stock` 已标 deprecated。归档见 [`YINGDAO_ARCHIVE.md`](./YINGDAO_ARCHIVE.md)。平台说明 [`PW_RPA_PLATFORM.md`](./PW_RPA_PLATFORM.md)。

---

## 销量点击链（踩过的坑，禁止再改回去）

Seller Lab Sales：

1. 深链日期（**不点 Status**）
2. 页头 **Export** → 弹窗 Export File
3. **New export** 重新生成
4. 等文件名 `sales_export_…csv` 出现
5. **点文件名右侧下载 `<a>`**（`file_loc.locator("xpath=following::a[1]")` + Playwright `click` + `expect_download`）
6. `outpost_bridge` 投递各店 portal-imports，**就地清洗**只留 Delivered/Processing/Shipped

**禁止**：`page.evaluate` 里 JS `click` 下载。  
**注意**：当前 `_click_download_icon` 仍先试 `following::button[1]` 再试 `following::a[1]`。下一窗若再碰到点不中 / 无 download 事件，把 `<a>` 提到第一位即可，不要扩写前台 job。

---

## 本机已验（2026-10-06）

**广告**（原 ads-pw 脚本，平台转调）  
- probe 通：Export campaigns 可见、未 418  
- 昨日报已在盘：`ads_sku_2026-10-05_2026-10-05.csv`；parse 有钱行 482=31 / 770=119

**销量**（本窗真跑 `python main.py sales ui`）

| 店 | 文件 | kept / dropped | parse facts |
|----|------|----------------|-------------|
| PRJ482387 | `…/portal-imports/sales_export_2026-07-09_2026-10-06.csv` | 1522 / 219 | 957 · ≈109962 SAR |
| PRJ396770 | 同上文件名 | 3866 / 521 | 2666 · ≈183962 SAR |

慧运营 `detectDomainFromFilename` = `sales`。**2026-10-06 13:57 已入库**：`.ingested.json` 有该文件；`salesFacts` 482=1304 / 770=3894，maxDate=**2026-10-05**（CSV 内无 10-06 行）。

---

## 明确不要动

- Noon Impex、飞书、Catalog 拼装、`parseAdsContent` 丢 0 花费行
- 市场情报 / 耗材影刀（买家商城；**禁止再开 Playwright 前台 job**）
- 不要为 Brand 广告、catalog_est_fees、fbn_dims 新建爬虫

---

## 关键路径

| 路径 | 用途 |
|------|------|
| `apps/api/scripts/noon-pw-platform/main.py` | 入口；仅 ads / sales / keepalive |
| `…/jobs/sales.py` | 销量；下载在 `_click_download_icon`（必须点文件旁 `<a>`） |
| `…/jobs/ads.py` | 转调 `noon-ads-export-pw` |
| `apps/api/src/modules/pw-rpa/` | spawn + HTTP + keepalive；`ingest-after.ts` 导完入库 |
| `apps/api/src/platforms/noon/portal/auto-sync.ts` | live 也扫 portal-imports |
| `apps/web/src/pages/ReplenishPage.tsx` | 「导出销量表」 |
| `apps/web/src/pages/AdsPage.tsx` | 「导出广告表」 |
| `docs/MARKET_INTEL_HANDOFF.md` | 市场情报 / 耗材影刀 |

---

## 已消耗渠道（本课题）

本窗不是市场分析课题；买家商城 Playwright 试抓已失败并封口。市场情报渠道表仍以 [`.cursor/rules/market-intel-source-once.mdc`](../.cursor/rules/market-intel-source-once.mdc) 为准，**禁止补抓 Noon.sa 前台**。
