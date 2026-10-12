# -*- coding: utf-8 -*-
"""Rebuild two-shop 6–9 GP summaries from Noon Statement of Account; FX=1.76."""
from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

FX = 1.76
MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"]
# Handoff: Advertising+Referral+FBN Outbound+Return Admin are the bill-summable core.
CORE_FEE_KEYS = (
    "Advertising Fee",
    "Referral Fee",
    "FBN Outbound Fee",
    "Return Administration Fee",
)
# Shown separately; not folded into 平台费 (avoids inventing May's +5,219 gap).
OTHER_FEE_KEYS = (
    "Damaged Returns Fee",
    "Advertising Fee (Subsidy)",
    "Warranty Fee",
    "Return Refund",
)
DESK = Path(r"D:\Desktop")
GP = Path(r"D:\Outpost_ERP\apps\api\scripts\_out\gp-sources")

FILL = PatternFill("solid", fgColor="D9E2F3")
TOTAL = PatternFill("solid", fgColor="FFF2CC")
NOTE = PatternFill("solid", fgColor="FCE4D6")
THIN = Border(
    left=Side(style="thin"),
    right=Side(style="thin"),
    top=Side(style="thin"),
    bottom=Side(style="thin"),
)
BOLD = Font(bold=True)


def n(x) -> float:
    try:
        return float(str(x or 0).replace(",", ""))
    except ValueError:
        return 0.0


def load_base_costs(path: Path) -> dict:
    """Keep 采购/头程/包装 from existing summary; ignore old 营业额/平台费."""
    wb = load_workbook(path, data_only=True)
    ws = wb["四个月汇总"] if "四个月汇总" in wb.sheetnames else wb.active
    headers = {
        str(ws.cell(4, c).value).strip(): c
        for c in range(1, ws.max_column + 1)
        if ws.cell(4, c).value
    }

    def col(*names: str) -> int | None:
        for name in names:
            if name in headers:
                return headers[name]
        return None

    c_month = col("月份") or 1
    c_cogs = col("采购成本(CNY)")
    c_intl = col("国际运费(CNY)", "国际运费\n成本(CNY)")
    c_dom = col("国内运费(CNY)", "国内运费\n成本(CNY)")
    c_pkg = col("包装采购(CNY)")
    if not all([c_cogs, c_intl, c_dom]):
        raise SystemExit(f"missing cost columns in {path}: {headers}")

    out: dict[str, dict[str, float]] = {}
    for r in range(5, ws.max_row + 1):
        m = ws.cell(r, c_month).value
        if not m or m == "合计":
            continue
        out[str(m)] = {
            "cogs": float(ws.cell(r, c_cogs).value or 0),
            "intl": float(ws.cell(r, c_intl).value or 0),
            "dom": float(ws.cell(r, c_dom).value or 0),
            "pkg": float(ws.cell(r, c_pkg).value or 0) if c_pkg else 0.0,
        }
    return out


def load_statement(path: Path) -> dict[str, dict]:
    """Aggregate Statement CSV by calendar month of Date."""
    by: dict[str, dict] = {
        m: {
            "net_proceeds": 0.0,
            "vat": 0.0,  # absolute payable (positive), matching sample S column
            "core_fees": {k: 0.0 for k in CORE_FEE_KEYS},
            "other_fees": {k: 0.0 for k in OTHER_FEE_KEYS},
            "statement_refs": set(),
            "max_date": "",
        }
        for m in MONTHS
    }
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            date = (r.get("Date") or "")[:10]
            m = date[:7]
            if m not in by:
                continue
            detail = (r.get("Details EN") or "").strip()
            amt = n(r.get("Amount"))
            tx = (r.get("Transaction") or "").strip()
            ref = (r.get("Reference") or "").strip()
            if detail == "Net Proceeds":
                by[m]["net_proceeds"] += amt
            elif "VAT" in detail:
                # bill amounts are negative; sample stores positive VAT
                by[m]["vat"] += -amt if amt < 0 else amt
            elif detail in CORE_FEE_KEYS:
                by[m]["core_fees"][detail] += amt
            elif detail in OTHER_FEE_KEYS:
                by[m]["other_fees"][detail] += amt
            if tx == "statement" and ref:
                by[m]["statement_refs"].add(ref)
                if date > by[m]["max_date"]:
                    by[m]["max_date"] = date

    for m, d in by.items():
        # core platform fee = sum of abs(negative fee lines) = -sum(amounts)
        core_sum = -sum(d["core_fees"].values())
        d["platform_fee"] = round(core_sum, 2)
        d["net_proceeds"] = round(d["net_proceeds"], 2)
        d["vat"] = round(d["vat"], 2)
        d["core_fees"] = {k: round(v, 2) for k, v in d["core_fees"].items()}
        d["other_fees"] = {k: round(v, 2) for k, v in d["other_fees"].items()}
        d["other_net"] = round(-sum(d["other_fees"].values()), 2)
        d["n_statements"] = len(d["statement_refs"])
    return by


def write_shop(
    shop_name: str,
    shop_id: str,
    costs: dict,
    stmt: dict,
    stmt_path: Path,
    out_path: Path,
) -> None:
    rows = []
    for m in MONTHS:
        s = stmt[m]
        c = costs.get(m) or {"cogs": 0.0, "intl": 0.0, "dom": 0.0, "pkg": 0.0}
        rev = s["net_proceeds"]
        fee = s["platform_fee"]
        vat = s["vat"]
        net = round(rev - fee - vat, 2)
        cogs = round(c["cogs"], 2)
        intl = round(c["intl"], 2)
        dom = round(c["dom"], 2)
        pkg = round(c["pkg"], 2)
        pure = round(net * FX - cogs - intl - dom - pkg, 2)
        pct = round(fee / rev * 100, 1) if rev else 0.0
        rows.append(
            {
                "month": m,
                "rev": rev,
                "fee": fee,
                "fee_pct": pct,
                "vat": vat,
                "net": net,
                "cogs": cogs,
                "intl": intl,
                "dom": dom,
                "pkg": pkg,
                "fx": FX,
                "pure": pure,
                "core_fees": s["core_fees"],
                "other_fees": s["other_fees"],
                "other_net": s["other_net"],
                "n_statements": s["n_statements"],
                "max_date": s["max_date"],
            }
        )

    wb = Workbook()
    w = wb.active
    w.title = "四个月汇总"
    w["A1"] = f"{shop_name}（{shop_id}）· 2026年6–9月毛利汇总（账单口径）"
    w["A1"].font = Font(bold=True, size=14)
    w.merge_cells("A1:L1")
    w["A2"] = (
        f"纯利=(营业额−平台费−VAT)×{FX} − 采购 − 国际运费 − 国内运费 − 包装；"
        "营业额=ΣNet Proceeds；平台费=账单 Advertising+Referral+FBN Outbound+Return Admin（绝对值）；"
        "不按同事五月写死差额补数。"
    )
    w.merge_cells("A2:L2")
    w["A2"].alignment = Alignment(wrap_text=True)
    w.row_dimensions[2].height = 36

    headers = [
        "月份",
        "营业额(SAR)",
        "平台费(SAR)",
        "平台费率%",
        "VAT(SAR)",
        "净营业额(SAR)",
        "采购成本(CNY)",
        "国际运费(CNY)",
        "国内运费(CNY)",
        "包装采购(CNY)",
        "汇率",
        "纯利(CNY)",
    ]
    for c, h in enumerate(headers, 1):
        cell = w.cell(4, c, h)
        cell.font = BOLD
        cell.fill = FILL
        cell.border = THIN

    keys = [
        "month",
        "rev",
        "fee",
        "fee_pct",
        "vat",
        "net",
        "cogs",
        "intl",
        "dom",
        "pkg",
        "fx",
        "pure",
    ]
    for i, r in enumerate(rows, 5):
        for c, k in enumerate(keys, 1):
            cell = w.cell(i, c, r[k])
            cell.border = THIN

    tr = 5 + len(rows)
    w.cell(tr, 1, "合计").font = BOLD
    w.cell(tr, 1).fill = TOTAL
    w.cell(tr, 1).border = THIN
    tot_rev = sum(r["rev"] for r in rows)
    tot_fee = sum(r["fee"] for r in rows)
    for col, key in {
        2: "rev",
        3: "fee",
        5: "vat",
        6: "net",
        7: "cogs",
        8: "intl",
        9: "dom",
        10: "pkg",
        12: "pure",
    }.items():
        cell = w.cell(tr, col, round(sum(r[key] for r in rows), 2))
        cell.font = BOLD
        cell.fill = TOTAL
        cell.border = THIN
    pct_cell = w.cell(tr, 4, round(tot_fee / tot_rev * 100, 1) if tot_rev else 0)
    pct_cell.fill = TOTAL
    pct_cell.font = BOLD
    pct_cell.border = THIN
    fx_cell = w.cell(tr, 11, FX)
    fx_cell.fill = TOTAL
    fx_cell.font = BOLD
    fx_cell.border = THIN

    for c in range(1, 13):
        w.column_dimensions[get_column_letter(c)].width = 14
    w.column_dimensions["A"].width = 12

    # 平台费拆分
    w2 = wb.create_sheet("平台费拆分")
    fee_headers = [
        "月份",
        "Advertising Fee",
        "Referral Fee",
        "FBN Outbound Fee",
        "Return Administration Fee",
        "平台费合计(SAR)",
        "占营业额%",
        "其他账单行净额(SAR)",
        "说明",
    ]
    w2.append(fee_headers)
    for cell in w2[1]:
        cell.font = BOLD
        cell.fill = FILL
    for r in rows:
        cf = r["core_fees"]
        note = (
            f"账单段至 {r['max_date']}；statement 段 {r['n_statements']} 条"
            if r["month"] == "2026-09"
            else f"statement 段 {r['n_statements']} 条"
        )
        if abs(r["other_net"]) > 0.01:
            note += "；其他行（Damaged/Subsidy/Warranty/Refund）未计入平台费，见本列净额"
        w2.append(
            [
                r["month"],
                round(-cf["Advertising Fee"], 2),
                round(-cf["Referral Fee"], 2),
                round(-cf["FBN Outbound Fee"], 2),
                round(-cf["Return Administration Fee"], 2),
                r["fee"],
                r["fee_pct"],
                r["other_net"],
                note,
            ]
        )
    w2.append(
        [
            "合计",
            round(sum(-r["core_fees"]["Advertising Fee"] for r in rows), 2),
            round(sum(-r["core_fees"]["Referral Fee"] for r in rows), 2),
            round(sum(-r["core_fees"]["FBN Outbound Fee"] for r in rows), 2),
            round(sum(-r["core_fees"]["Return Administration Fee"] for r in rows), 2),
            round(tot_fee, 2),
            round(tot_fee / tot_rev * 100, 1) if tot_rev else 0,
            round(sum(r["other_net"] for r in rows), 2),
            "五月样板平台费写死 36022.74，同口径账单四费合计约 30803.75，差额未补入本表",
        ]
    )
    w2["I6"].fill = NOTE
    for c in range(1, 10):
        w2.column_dimensions[get_column_letter(c)].width = 18 if c < 9 else 56

    # 数据来源
    w3 = wb.create_sheet("数据来源")
    w3["A1"] = "字段"
    w3["B1"] = "怎么来的（一句话）"
    w3["A1"].font = BOLD
    w3["B1"].font = BOLD
    w3["A1"].fill = FILL
    w3["B1"].fill = FILL
    sources = [
        [
            "营业额",
            f"Noon 月账单 Statement of Account：Details EN=Net Proceeds 按 Date 归月加总。"
            f"文件：{stmt_path.name}（已备份 gp-sources/{shop_id}/）。",
        ],
        [
            "平台费",
            "同账单 statement 行：Advertising Fee + Referral Fee + FBN Outbound Fee + "
            "Return Administration Fee，按 Amount 取绝对值加总。"
            "未把 Damaged Returns / Subsidy / Warranty / Return Refund 计入；"
            "也未按同事五月写死数补差额（五月样板 36022.74 vs 账单四费≈30803.75）。",
        ],
        ["平台费率%", "当月平台费 ÷ 当月营业额（Net Proceeds）。"],
        [
            "VAT",
            "同账单 invoice 行 Details EN 含 VAT 的 Amount 取绝对值按月加总"
            "（对齐样板 S2=-SUMIF(*VAT*)）。",
        ],
        ["净营业额", "营业额 − 平台费 − VAT（SAR），对齐样板 T2=Q2-R2-S2。"],
        ["采购成本", "飞书产品表采购单价 × 当月SKU销售件数，再汇总（沿用前版，未改）。"],
        [
            "国际运费",
            "飞书装箱表票级跨境实付（票号去重）摊到PSKU后 × 当月销量（沿用前版）。",
        ],
        ["国内运费", "飞书装箱表票级国内运费，分摊方式同上（沿用前版）。"],
        ["包装采购", "飞书账目「产品包装采购」实付，归到本店后按月加总（沿用前版；样板五月无此列）。"],
        ["汇率", f"按指定固定{FX}（SAR→CNY）。"],
        [
            "纯利",
            f"(净营业额×{FX}) − 采购 − 国际运费 − 国内运费 − 包装；只用账单+飞书真实源，不估算。",
        ],
        [
            "9月完整度",
            "两店账单末段均为 2026-09-23 的 statement；若 Noon 尚有月末段未导出，9月营业额/费/VAT 可能偏低。",
        ],
        [
            "自测",
            "HUI 五月样板：ΣNet Proceeds=66574.25、VAT=4698.8 已用同结构 CSV 复现；"
            "本表 6–9 用同一加总规则。",
        ],
    ]
    for i, (a, b) in enumerate(sources, 2):
        w3.cell(i, 1, a).border = THIN
        cell = w3.cell(i, 2, b)
        cell.border = THIN
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    w3.column_dimensions["A"].width = 12
    w3.column_dimensions["B"].width = 96
    for i in range(2, 2 + len(sources)):
        w3.row_dimensions[i].height = 40

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)
    print(
        shop_name,
        [
            (r["month"], r["rev"], r["fee"], f"{r['fee_pct']}%", r["vat"], r["pure"])
            for r in rows
        ],
        "纯利合计",
        round(sum(r["pure"] for r in rows), 2),
    )


def main() -> None:
    shops = [
        (
            "HUI Beauty",
            "PRJ396770",
            DESK / "HUI_Beauty_四个月毛利汇总_26_06_09.xlsx",
            GP / "PRJ396770" / "noon_financeweb_statements_2026-06_09.csv",
        ),
        (
            "HFY-KSA",
            "PRJ482387",
            DESK / "HFY_KSA_四个月毛利汇总_26_06_09.xlsx",
            GP / "PRJ482387" / "noon_financeweb_statements_2026-06_09.csv",
        ),
    ]
    for name, sid, old, stmt_path in shops:
        if not old.exists():
            raise SystemExit(f"missing base summary: {old}")
        if not stmt_path.exists():
            raise SystemExit(f"missing statement: {stmt_path}")
        costs = load_base_costs(old)
        stmt = load_statement(stmt_path)
        write_shop(name, sid, costs, stmt, stmt_path, old)


if __name__ == "__main__":
    main()
