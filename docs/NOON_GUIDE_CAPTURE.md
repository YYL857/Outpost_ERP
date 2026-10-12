# Noon 卖家后台向导 · 任务交接（换窗口用）

> 更新：2026-10-07。Playwright 补链：FBP 11/11、Account Health、Vantage 已 confirmed。**Payments & Fees 5 项仍 pending**（猜链 404；汉堡在自动化里点不开）。

## 目标

做 Noon Seller Lab（`noon.partners`）操作教学：输入中文需求 → 给出**中英对照点击路径** + 落地页。  
英文 = 界面要点的原文；中文 = 给国内用户看。

## 已完成板块（全部 confirmed）

| 板块 | 关键入口 |
|------|----------|
| Home | Store Dashboard |
| Catalog | Add Product / My Catalog / Imports / Exports / noon Catalog / Brand Catalog / My Brands / Service Centers |
| Advertising | Ad Manager / External Ads Tracker / Brand Store |
| Promotions | Promotions Center / Deals / Coupons / Virtual Bundles |
| Fulfilled by noon | Create ASN / My ASN & Storage / My Inventory / My Returns / FBN Fees / Reports |
| Fulfilled by Partner | Directship / Picklists / Direct Delivery / Return Manifest / Delivery Returns / **Handover（原 Manifestation）** / Customer Returns / OOS / Packaging / Reports / Warehouse |
| Account Health | Reputation Management → `noon-reputation.noon.partners` |
| Vantage | `vantage.noon.partners` |

详细 URL 见下文各表。向导数据：`apps/web/src/lib/noon-seller-guide.ts` + `noon-guide-labels.ts`。  
前端页：慧运营侧栏 **Noon 后台向导**（`/noon-guide`）。

## 当前板块：Payments & Fees（仍 pending）

侧栏子项（英文原文）已知，**落地 URL 未证实**：

Statements · Statement Of Account · Invoices & Creditnotes · Transaction View · Exports

已试：

- `finance.noon.partners/en/?project=` → **Legal Entities**（能进，不是结算单）
- 猜 `/statements` `/invoices` `/transaction-view` `/exports` → **Next.js 404**（不是拦截）
- 汉堡菜单在 Playwright 里经常点不开；Ctrl+K 也未命中

**下一步（人工 1 分钟）**：登录 Seller Lab → 汉堡 → Payments & Fees → 逐点 5 项 → 把地址栏 URL 发回来即可写入 confirmed。

可跳过：Fulfilled by Partner Integration、Seller Logistics。

## Playwright 补链脚本（推荐）

```powershell
cd D:\Outpost_ERP\apps\api
$env:OUTPOST_YD_GUIDE_SHOP="PRJ396770"
$env:OUTPOST_YD_GUIDE_SECTION="payments"   # 或 all|fbp|health|vantage
python scripts/noon-guide-capture-pw/main.py
```

- 代码：`apps/api/scripts/noon-guide-capture-pw/`（**非** pw-rpa 第四 job）
- 默认 persistent profile：`D:\outpost-data\browser-profiles\noon-seller-pw`
- 落盘：`D:\outpost-data\noon-guide-capture\{shopId}\{section}\`
- 说明：见该目录 `README.md`

影刀旧流程 `outpost_noon_guide_capture` 仍可用，目录布局兼容。

## 关键落地域名速查

| 入口 | URL 模式 |
|------|----------|
| My Catalog 等 | `noon-catalog.noon.partners/en/...` |
| Ad Manager | `admanager.noon.partners/en-sa/home?project=&mpCode=noon&tab=campaigns` |
| External Ads Tracker | `utmtracker.noon.partners/en/?project=&x-locale=sa` |
| Brand Store | `store.noon.partners/en-sa/?project=`（可能 Missing Access） |
| Promotions Center | `promotions.noon.partners/en/?project=` |
| Deals | `deals.noon.partners/en/?project=` |
| Coupons | `coupons.noon.partners/en/?project=` |
| Virtual Bundles | `bundles.noon.partners/en/?project=`（仅 FBN SKU） |
| FBN 六入口 | `fbn.noon.partners/en-sa/...`（见下表） |
| FBP Directship / Picklist / OOS / Packing / Exports / Warehouse | `fbp.noon.partners/en-sa/...` |
| FBP Direct Delivery | `direct-delivery.noon.partners/en-sa` |
| FBP Handover（交运）/ Orders / Shipments | `directship.noon.partners/en/...` |
| FBP Return Manifestation | `lms.noon.partners/en-sa/direct-delivery/return-manifestation` |
| FBP Customer Returns | `mp-partners-fbp-returns.noon.partners/en-sa` |
| Account Health | `noon-reputation.noon.partners/en/` |
| Vantage | `vantage.noon.partners/en/` |
| Finance 根（法人） | `finance.noon.partners/en/` → Legal Entities（≠ Statements） |

## 双语规则

| 字段 | 用途 |
|------|------|
| `en` | 后台界面原文，点哪里以它为准 |
| `zh` | 给中国用户看的含义 |
| 展示 | `我的商品（My Catalog）` |
| `status` | `confirmed` / `pending` |

---

## Catalog 对齐明细

| 中文 | 英文 | 落地 |
|------|------|------|
| 首页 | Home | Store Dashboard |
| 添加商品 | Catalog → Add Product | `/catalog/create` |
| 我的商品 | My Catalog | `/catalog?tab=noon` |
| 导入 | Imports | `/imports?tab=noon_catalog_content` |
| 导出 | Exports | `/exports` |
| noon 公共目录 | noon Catalog | `/noon-catalog` |
| 品牌目录 | Brand Catalog | `/brand-catalog` |
| 我的品牌 | My Brands | `/brand-management` |
| 服务中心 | Service Centers | `/service-center-management` |

## Advertising 对齐明细

| 中文 | 英文 | 落地 |
|------|------|------|
| 广告管理后台 | Ad Manager | admanager…tab=campaigns |
| 站外广告追踪 | External Ads Tracker | utmtracker… |
| 品牌店铺 | Brand Store | store.noon.partners… |

## Promotions 对齐明细

| 中文 | 英文 | 落地 |
|------|------|------|
| 促销中心 | Promotions Center | promotions.noon.partners |
| 活动 Deal | Deals | deals.noon.partners |
| 优惠券 | Coupons | coupons.noon.partners |
| 虚拟组合装 | Virtual Bundles | bundles.noon.partners |

## Fulfilled by noon 对齐明细

| 中文 | 英文 | 落地 |
|------|------|------|
| 创建入仓单 | Create ASN | `fbn…/en-sa/asn/createasn?mp=noon&project=` |
| 入仓与仓容 | My ASN & Storage | `fbn…/en-sa/asn?project=` |
| 我的库存 | My Inventory | `fbn…/en-sa/inventory?project=` |
| 我的退货 | My Returns | `fbn…/en-sa/rtv/requests?project=` |
| FBN 费用 | FBN Fees | `fbn…/en-sa/fees?project=`（页眉 FBN Fees and Disputes） |
| FBN 报表 | Reports | `fbn…/en-sa/fbnreports?project=` |

## Fulfilled by Partner 对齐明细（2026-10-07 Playwright）

| 中文 | 英文 | 落地 |
|------|------|------|
| 直发 | Directship | `fbp…/en-sa/directship/?project=` |
| 直发拣货单 | Directship Picklists | `fbp…/en-sa/directship/picklist/?project=` |
| 直配送货 | Direct Delivery Shipments | `direct-delivery.noon.partners/en-sa?project=` |
| 退货交运 | Return Manifestation | `lms…/en-sa/direct-delivery/return-manifestation?project=` |
| 配送退货 | Delivery Returns | `fbp…/en-sa/?project=&tab=rtv` |
| 交运 | Manifestation → **Handover** | `directship.noon.partners/en/handovers?project=` |
| 客户退货 | Customer Returns | `mp-partners-fbp-returns.noon.partners/en-sa?project=` |
| 缺货记录 | Out of Stock Logs | `fbp…/en-sa/stocklog?project=` |
| 包材 | Packaging Material | `fbp…/en-sa/packing/orders/?project=`（勿猜 packaging-materials→404） |
| FBP 报表 | Reports | `fbp…/en-sa/exports?project=` |
| 仓库 | Warehouse | `fbp…/en-sa/onboarding/warehouse-list/?project=` |

## Account Health / Vantage（2026-10-07）

| 中文 | 英文 | 落地 |
|------|------|------|
| 声誉管理 | Reputation Management | `noon-reputation.noon.partners/en/?project=`（页眉 Account Health） |
| 经营分析 | Vantage Analytics | `vantage.noon.partners/en/?project=` |
