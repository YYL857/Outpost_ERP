---
name: cross-border-listing-images
description: >-
  Generate Noon/Amazon-style cross-border e-commerce listing promo images (usually
  9:16) with English/Arabic copy, SKU-accurate selling points, and distinct frames.
  Use when the user asks for 产品宣传图, listing images, Noon/Amazon main images,
  A+ style promo set, or Saudi/MENA marketplace product creatives from reference photos.
---

# 跨境电商产品宣传图（Noon / Amazon 等）

## 何时启用

用户要做：产品主图/详情宣传图、Noon/Amazon listing 图、9:16 竖图、沙特/中东卖货图、
「按参考图生成宣传图」且带卖点文案。

## 开工前硬确认（未确认不批量出图）

向用户或从素材中锁定 **SKU 事实**（只卖现货，禁止画库存没有的规格）：

| 项 | 必须问清 / 写死 |
|----|----------------|
| 平台与市场 | 如 Noon SA；文案语言（默认英文，可加阿语；**禁止中文**除非用户点名） |
| 张数与比例 | 默认 **9 张 · 9:16**（可改）；出图后用像素核验 |
| 颜色 | 本批有哪些色；没有的色 **整套禁止出现** |
| 规格 | 层数/克重/抽数/容量等 **唯一进货规格** |
| 尺码/适配 | 如 35–45 通用、可裁剪 |
| 核心卖点 | 3–6 条；每张图只服务 1 个主卖点 |
| 参考图 | 桌面/附件实物图路径；生成时 `reference_image_paths` 必挂 |

把确认结果写成一句话 SKU 锁，例如：

> SKU 锁：黑色 ONLY · 四层加厚 ONLY · 35–45 · 最高约 6cm · 英文 · 9×9:16

## 九宫格默认选题（可按类目替换）

保证 **9 张构图互不雷同**（禁止 01/07/09 同角度换标题）：

| # | 角色 | 构图原则 |
|---|------|----------|
| 01 | 主图 Hero | 完整产品平铺/成对；白底；标题+2 徽章 |
| 02 | 规格锁 | 特写唯一规格（层数/加厚/容量）；箭头标注 |
| 03 | 尺码/适配 | 尺码线、可裁剪、适用人群 |
| 04 | 核心科技 | 气垫/材质/结构特写 |
| 05 | 效果数字 | 增高 cm / 容量 / 片数 等 |
| 06 | 使用场景 | **完整实物场景**（鞋内/车上/手持）；禁止不可能切剖 |
| 07 | 颜色/款式 | 只展示有货颜色；单色则做「本批仅×色」场景图，勿画虚假色板 |
| 08 | 舒适/细节 | 透气、防滑、分区 callout |
| 09 | 卖点汇总 | **图标网格为主**，产品只占小条/侧视，避免再复用主图构图 |

## 出图工作流

1. 建交付目录：`D:\Desktop\<品名>\promo-9x16-<平台>\` + 仓库备份 `.tmp_<sku>_promo\`
2. 拷参考图到备份目录，命名 `_ref-*.jpg`
3. 按 [prompt-template.pdf](prompt-template.pdf) 产品卡填空，**每张单独**调用 `GenerateImage`（`aspect_ratio: "9:16"` + refs）
4. 同步到交付目录；写 `README.txt`（文件名、卖点、SKU 锁）
5. 用脚本核验尺寸（目标常见 `720×1280`，宽/高 ≈ 0.5625）
6. 用户反馈只改点名的编号；改完覆盖同名文件并更新 README

## 画质与反 AI 穿帮（硬规则）

- 产品不变形、比例真实；像棚拍商品图，不要粉雾爆炸/漂浮高尔夫球等空洞特效（除非用户要）
- **禁止**：鞋跟劈开悬浮、断裂切面、结构物理不可能、手脚畸形、多余肢体
- 「隐形/内部结构」→ 用 **打开鞋舌/旁置对照品** 表达，不用假剖面
- 文案清晰英文（或用户指定阿语）；无中文乱码、无中英混拼错字
- 同套图：产品外观（颜色、气垫位置、层数）全程一致

## 用户改图口令（常见）

| 用户说 | 动作 |
|--------|------|
| 没有×色 / 只有黑色 | 重出颜色页；全套删掉无货色 |
| 同样图出现多次 | 重出雷同编号，强制换构图角色 |
| 像 AI / 看不懂 | 换「一眼能懂」的真实场景，去掉假剖面 |
| 比例对不对 | 读文件宽高核验后回答 |

## 交付物清单

- [ ] 9 张（或约定张数）已写入交付目录
- [ ] README：SKU 锁 + 每张用途
- [ ] 尺寸核验通过
- [ ] 无中文（除非用户要求）
- [ ] 无库存外规格/颜色

## 详细提示词（给人看）

中文使用手册 PDF（产品卡、九张角色、改图口令）：[prompt-template.pdf](prompt-template.pdf)

重新生成 PDF：在 `apps/api` 下执行  
`node ../../.cursor/skills/cross-border-listing-images/_build-prompt-pdf.mjs`

## Listing 系统接入（默认本机键鼠唤起 Cursor，不走官方 API）

- 模块：`apps/api/src/modules/listing/promo/`
- 默认驱动 `LISTING_PROMO_DRIVER=rpa`：拼 prompt+refs → 落盘 → **本机键鼠**打开 Cursor、粘贴发送 → 轮询 `out/` 回填
- 脚本：`apps/api/scripts/listing-promo-cursor-rpa/`（见该目录 README）
- 每人本机跑 Outpost + 本机已登录的 Cursor；互不共用一台出图机
- 局域网共享 ERP：下载 `pack.zip`（prompt+refs）→ 本机 Cursor → 上传成品到 `upload-out`
- Inbox：`.tmp_listing_promo_inbox/{jobId}/`（可用 `LISTING_PROMO_INBOX` 覆盖）
- 只投递不唤起：`LISTING_PROMO_DRIVER=folder` 或 `LISTING_PROMO_RPA=0`
- 可选 `LISTING_PROMO_DRIVER=sdk`（需密钥，不推荐）

## Outpost Listing 系统接入

运行时标准在 `apps/api/src/modules/listing/promo/`（`standards.ts` / `build-prompt.ts`）。  
Listing 页「宣传图」会拼 prompt + 参考图，唤起本机 Cursor 出图，回填 `listing-drafts/.../promo/{jobId}/out/`。
