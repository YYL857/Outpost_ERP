---
name: yingdao-flow-build
description: >-
  Build Outpost YingDao (影刀) RPA flows fast and reliably: scaffold, MODE
  demo/inbox/ui, CEF clicks, Ant date pickers, deliver to portal-imports.
  Use when creating or fixing 影刀自动化, ShadowBot flows, Noon portal export
  RPA, or outpost_noon_* apps under D:\YingDao\Flows.
---

# 影刀自动化链路 · 搭建标准（Outpost）

**目标**：新链路一次按标准落地，禁止从零摸索、禁止叠无效兜底把已通路径改坏。

**对照实现（已跑通，优先复制）**

| 类型 | 目录 | 学什么 |
|------|------|--------|
| 门户导出+点击 | `D:\YingDao\Flows\outpost_noon_ads_export` | xpath 文案点击、按店循环、落盘 |
| 门户筛选+日历+下载 | `D:\YingDao\Flows\outpost_noon_fbn_stock_export` | 模态 combobox、Ant 日期点两次、新开页、禁旧表 |
| 页面抽取 | `D:\YingDao\Flows\outpost_noon_sa_market_intel` | `function (element,input)` 抽 DOM |
| 桥接/落盘 | `D:\YingDao\Flows\_lib\outpost_bridge.py` | shop 目录、deliver |
| 能力矩阵 | `D:\YingDao\Flows\GAP_MATRIX.md`、`docs/YINGDAO_BRIDGE.md` | 该不该用影刀 |

CLI 跑应用见 `.cursor/skills/yingdao-pc-cli/SKILL.md`（本 skill 管**怎么建**，那个管**怎么跑**）。

---

## 0. 先判要不要影刀

1. **能走 Partner Impex / live API → 不要建影刀**（库存分仓可用 Impex Detailed；销量/订单等同理）。
2. 影刀只补：**无 Impex、Akamai 挡脚本、必须真人点门户** 的洞。
3. 新应用写入 `GAP_MATRIX.md` 一行；落盘必须 `D:\outpost-data\shops\{shopId}\…`，禁止全局串店。

---

## 1. 脚手架（30 分钟内搭齐，先通 demo）

```
D:\YingDao\Flows\outpost_noon_<name>\
  main.py          # 业务主逻辑（影刀 runpy 指向这里）
  SNIPPET.py       # 影刀「插入代码段」整段粘贴
  README.md        # MODE / 点击顺序 / 成功判据
  package.json     # 可选打包
```

**强制三档 MODE**（环境变量，默认先 demo）：

| MODE | 作用 | 何时才进下一档 |
|------|------|----------------|
| `demo` | 不碰网页，写样例+deliver | 目录/命名/解析 OK |
| `inbox` | 读已下载文件→规范名→portal-imports | 人工表能 ingest |
| `ui` | 真点门户 | inbox 已通且登录 CEF |

**SNIPPET 模板**：

```python
import os
os.environ.setdefault("OUTPOST_YD_<X>_MODE", "demo")  # 再改 inbox → ui
os.environ.setdefault("OUTPOST_YD_ADS_SHOPS", "PRJ482387,PRJ396770")
os.environ.setdefault("OUTPOST_YD_BROWSER", "cef")
import runpy
runpy.run_path(r"D:\\YingDao\\Flows\\outpost_noon_<name>\\main.py", run_name="__main__")
```

复用 `outpost_bridge`：`parse_shop_ids` / `shop_download_dir` / `deliver_to_portal` / `wait_for_new_file`。

---

## 2. 浏览器与页面（ui 硬规则）

1. **浏览器默认 `cef`**（影刀自带）；Chrome 插件易掉线。
2. **每次 ui 运行 `web.create` 新开目标 URL**，禁止 `get_active` 复用卡在模态/日历的旧页。
3. **禁止连环打断加载**：create 后不要立刻同 URL `navigate` + `location` 硬刷；超时只静等，不二次刷新。
4. **等页就绪**：静等关键按钮可见（如页头 `Generate Report`），再点；中途不 `browser.refresh()`。
5. 密码不入库；需已登录 Partners。health 失败才让用户开影刀。

---

## 3. 点击标准（按优先级，已验证）

### 3.1 首选：影刀 xpath 点可见文案/控件

对齐 ads / fbn 成功路径：

```python
el = browser.find_by_xpath(xp, timeout=…)
el.click()
```

优先选择器：

- 按钮：`//button[normalize-space(.)='…']`
- 模态内第 N 个下拉：`//*[@role='dialog']//*[@role='combobox'][n]`
- 选项：`//*[@role='option' and normalize-space(.)='…']` / `MuiMenuItem`

**一次只用已跑通的那条 xpath**；不要先 JS 乱点再 Tab×N+Esc（Esc 会关模态）。

### 3.2 JS：必须 `function (element, input) { … }`

- **禁止裸 IIFE** → 影刀报 `_uia_temp_function`。
- 点击用 mousedown/mouseup/click；日历格用 `getBoundingClientRect` + `elementFromPoint`（本机 **无** `win32.click_mouse`）。

### 3.3 成功以页面状态为准，不以「函数返回了 ok」为准

| 步骤 | 成功判据（例子） |
|------|------------------|
| 开模态 | 出现 `Generate New Report` / `Select a category`（diag 真有文案） |
| 选类别 | **占位消失**（不再有 `Select a category`），不必强求探针读到 `Inventory` 二字 |
| 选报表 | 不再有 `Select a report` |
| 日期 | 输入框为 `Y→Y`，日历**自动关闭**，模态 **Generate 非 disabled** |
| 下载 | **新**文件（mtime/新 EXP），有数据行；禁止点列表旧 Download 冒充成功 |

探针假阳性常见坑：

- `body.innerText` 含导航栏 `Inventory` → 不能当菜单已开。
- `ok-contains:` 匹配到后台整表 → 禁止当 option 点中。
- Ant 下拉关掉后 DOM 仍在 → 看 `display`/`hidden`，别只看 `Last 31 days` 字符串。

### 3.4 Ant Design 日期范围（FBN 已通）

```
点开日期框 → 点「昨天」1 次（开始）→ 再点「昨天」1 次（结束）
→ 等日历自己关 → 点模态蓝色 Generate Report
```

- 格子优先 `td[title='YYYY-MM-DD']`（左月 in-view）。
- **不要**只写 `input.value`（按钮一直灰）。
- **不要**在两次点击之间 Enter/点标题打断。

### 3.5 下载

- Generate **之前**快照 EXP 码；只下**新码**行的 Download。
- 空表（仅表头）最多 2 次即停；**默认禁止** `ALLOW_EXISTING` 点旧行。
- 等新报表时用静等轮询，**禁止 refresh 刷屏**。

---

## 4. 搭建顺序（成功一次的节奏）

```
① 定目标 URL + 人工点一遍，记下每步可见文案
② 脚手架 + demo 落盘
③ inbox：用户导出一份真表 → 解析/deliver
④ ui：只实现「最短已验证点击链」（先开页→关键控件）
⑤ 每步加 [probe]/状态断言；失败早停、报真实原因
⑥ 两店循环；填 yingdao-apps.json appId（可选接 yingdao-run）
⑦ 更新 GAP_MATRIX + 应用 README（MODE/成功判据）
```

**排障约定**：先问用户实测结论 + 贴 `[diag]`/`[probe]` 几行，再改点击；**不要**重做已通的 Impex/解析/inbox。

报错只说真实原因（如「模态未出现」）；不要裹「未开旧表兜底」等与业务无关的话术。

---

## 5. 明确禁止（本会话踩过的坑）

1. 复用卡在模态的旧 CEF 页 → 找不到 Generate。  
2. create 后同址反复 navigate/location/refresh → 页面永远加载不完。  
3. 假成功：没筛选项却点列表旧 Download / 空 Country 表。  
4. 校验过严：页面已是 Inventory 仍因 `inv` 探针失败而退出。  
5. 键盘 Tab×N 一轮失败就 Esc → 把模态关掉，越试越差。  
6. 为「完整」叠 5 套打开下拉的方法，打乱已通的 combobox xpath。  
7. 顺手改无关模块（遵守 `touch-only-task-scope`）。

---

## 6. 新链路开工检查清单

- [ ] 已确认不能用 Impex / 或影刀是并行验数  
- [ ] 目录 + SNIPPET + demo/inbox/ui  
- [ ] 对照复制 ads 或 fbn 的点击/JS/落盘，不从零发明  
- [ ] ui：每次新开页；静等就绪；xpath 短路径  
- [ ] 状态断言 + 新文件判据；禁旧表默认兜底  
- [ ] README 写清点击顺序与成功日志特征  
- [ ] GAP_MATRIX / YINGDAO_BRIDGE 补一行  

---

## 7. FBN 库存链路（2026-09-28 已通，作日历+模态范本）

```
web.create(fbnreports?project=…)
→ 页头 Generate Report（确认模态出现）
→ dialog combobox[1] → Inventory
→ combobox[2] → FBN Inventory Ledger Report - Summary View
→ 日期框 → 昨天 title 点 2 次 → 日历自关
→ 模态蓝色 Generate → 等新 EXP → Download
→ deliver portal-imports + fbn_vs_supermall_*.csv
```

真表列：`fulfillment_type`（fbn/supermall/transit）+ `closing_stock` + `pbarcode` + `warehouse_code`。

**正式落盘（同步）**：`D:\outpost-data\shops\{shopId}\portal-imports\fbn_inventory_ledger_summary_{Y}.csv` + `fbn_vs_supermall_{Y}.csv`；`Y`=报表日。查找：`outpost_bridge.find_fbn_stock_files(shop, ymd)`。`D:\Downloads` 只是跳板，投递后删除。
