# 货代门户 / 物流管理 — 任务交接

**状态（截至本窗口）**：亦邦 + 飞坦 + 汉沙 + 亚优汇 + 义特 + 安时达 + **起克** 查轨迹已全部接通物流管理页。

不要一上来铺开新货代；一家链路跑通再复制。

---

## 0. 本窗口做了什么（换窗必读）

| 项 | 说明 |
|----|------|
| 起克 | **独立** `adapters/chicexpress.ts`；登录 → B2B报表 → 入仓号=装箱物流编号 |
| 正确路由 | `#/erp/orders/B2BReport`（`#/B2B/report` 会白屏） |
| 实测 | `HPMYKSA04004-2` → 已送仓 · 空运特快线 |
| 禁止回写飞书 | 查件只落 `D:\outpost-data\forwarder-portals\` |

---

## 1. 已完成货代一览

| 货代 | 查件键 | 适配器 | API |
|------|--------|--------|-----|
| 亦邦 | 物流编号 | yundaomen | `/track/yibang` |
| 飞坦 | 票号（分海空运） | fleetan | `/track/feitan` |
| 汉沙 | 票号 | nextsls | `/track/hansha` |
| 亚优汇 | 票号 | nextsls | `/track/yayouhui` |
| 义特 | 物流编号去 U 后缀 | nextsls | `/track/yite` |
| 安时达 | 票号→中国单订单号 | ontask | `/track/anshida` |
| **起克** | **物流编号→入仓号** | **chicexpress** | `/track/qike` |

### 起克 `qike` / `chicexpress`
| 项 | 值 |
|----|-----|
| 查件键 | 装箱「**物流编号**」= B2B报表「入仓号」 |
| 链路 | `/#/login` → `/#/erp/orders/B2BReport` → 填入仓号 → 搜索 → 抓采购单状态 |
| API | `POST /api/shipping-ops/track/qike` `{ logisticsNo }` |
| CLI | `pnpm exec tsx scripts/qike-track.ts --headless --no <物流编号>` |
| 实测 | `HPMYKSA04004-2` → 已送仓 |
| origin | `https://erp.chicexpressglobal.com` |
| 注意 | 侧栏折叠时菜单文字不可见，导航用 force 或直链；勿用 `#/B2B/report` |

### 物流管理前端
- **全部已启用**：亦邦 / 飞坦 / 汉沙 / 亚优汇 / 义特 / 安时达 / 起克
- 切换货代时自动清空单号输入框
- 装箱在途一键查：起克→物流编号

### 关键文件
| 路径 | 作用 |
|------|------|
| `adapters/chicexpress.ts` | 起克适配器 |
| `packing-keys.ts` | `listQikeLogisticsNos` |
| `shipping.routes.ts` | `track/qike` |
| `scripts/qike-track.ts` | CLI |

---

## 2. 只读边界

- 飞书业务表**只 GET**，禁止回写
- 查件结果只落 `D:\outpost-data\forwarder-portals\`
- 遵守 `touch-only-task-scope`

---

## 3. 凭据

`D:\outpost-data\forwarder-portals\credentials.json`（含 `qike` 等，勿提交 Git）

---

## 4. 下一窗口

货代查轨迹本轮已齐。若有新货代：确认查件键 → 独立适配器 → API → 前端；飞书只读。

---

*交接更新：2026-09-22（本窗口：起克 chicexpress 接入）*
