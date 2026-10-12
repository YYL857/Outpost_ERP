# -*- coding: utf-8 -*-
"""
Build Jun–Sep 2026 gross-profit workbooks for HUI Beauty + HFY-KSA,
aligned to D:\\Desktop\\HFY_report_26_05.xlsx formulas.

Sources (real files only; missing cells stay empty + noted):
- Portal sales_export (Jul–Sep item rows)
- Impex productviews (Jun + cross-check)
- Impex transaction-view fees (platform fees)
- Feishu packing boxes/lines (headhaul actuals)
- Feishu 产品表每日信息 (purchase unit cost)
- Feishu 产品包装采购 (packaging)
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, Border, Side, PatternFill
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------------------
# Paths / constants
# ---------------------------------------------------------------------------
OUTPOST = Path(r"D:\outpost-data")
FEISHU_RUN = "2026-09-29T03-47-13-498Z_260f2443"
FEISHU = OUTPOST / "feishu-raw" / "runs" / FEISHU_RUN
GP_SRC = Path(r"D:\Outpost_ERP\apps\api\scripts\_out\gp-sources")
TEMPLATE = Path(r"D:\Desktop\HFY_report_26_05.xlsx")
OUT_DIR = Path(r"D:\Desktop\gp_reports_26_06_09")

FX_RATE = 1.79  # from HFY_report_26_05
FX_NOTE = "汇率取自 HFY_report_26_05（1.79）；系统 buybackRate=0 未使用"

MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"]
SHOPS = [
    {
        "id": "PRJ396770",
        "code": "N1",
        "name": "HUI Beauty",
        "file_prefix": "HUI",
        "psku_prefix": "N1",
    },
    {
        "id": "PRJ482387",
        "code": "N2",
        "name": "HFY-KSA",
        "file_prefix": "HFY",
        "psku_prefix": "N2",
    },
]

STATUS_FAIL = "Payment failed"
STATUS_CIR = "CIR"
STATUS_CANCEL = "Cancelled"
STATUS_UNDELIVERED = "Could Not Be Delivered"

FEE_COLS = [
    "Referral Fee including VAT",
    "Fullfilment & Logistics Fees including VAT",
    "Shipping Credits including VAT",
    "Other Order Fees including VAT",
]


def num(x: Any) -> float:
    if x is None or x == "":
        return 0.0
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def round2(x: float) -> float:
    return round(x + 1e-12, 2)


def month_key(s: str | None) -> str | None:
    if not s:
        return None
    m = re.search(r"(20\d{2})[-/](\d{1,2})", str(s))
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    return None


def parse_cn_date(s: Any, default_year: int = 2026) -> str | None:
    """Parse '9月17日' / '2026/07/16' / excel serial-ish strings → YYYY-MM-DD."""
    if s is None or s == "":
        return None
    if isinstance(s, (int, float)) and s > 40000:
        # Excel serial → approximate via openpyxl not required; skip rare
        from datetime import datetime, timedelta

        base = datetime(1899, 12, 30)
        d = base + timedelta(days=float(s))
        return d.strftime("%Y-%m-%d")
    text = str(s).strip()
    m = re.search(r"(20\d{2})[/-](\d{1,2})[/-](\d{1,2})", text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日", text)
    if m:
        return f"{default_year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    m = re.search(r"(\d{1,2})\s*月", text)
    if m:
        return f"{default_year}-{int(m.group(1)):02d}-01"
    return None


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sheet_by_title(snap: dict, title: str) -> list[list[Any]]:
    for s in snap.get("sheets") or []:
        if s.get("title") == title or title in (s.get("title") or ""):
            return s.get("values") or []
    raise KeyError(title)


# ---------------------------------------------------------------------------
# Load reference data
# ---------------------------------------------------------------------------
def load_purchase_prices() -> dict[str, float]:
    snap = load_json(FEISHU / "product" / "snapshot.json")
    prices: dict[str, float] = {}
    daily = sheet_by_title(snap, "产品表每日信息")
    if daily:
        headers = [str(h or "").strip().lower() for h in daily[0]]
        # psku / 采购单价
        pi = next((i for i, h in enumerate(headers) if h in ("psku", "partner_sku")), 0)
        ci = next((i for i, h in enumerate(headers) if "采购" in str(daily[0][i] or "")), 2)
        for row in daily[1:]:
            psku = str((row[pi] if pi < len(row) else "") or "").strip()
            if not psku:
                continue
            c = num(row[ci] if ci < len(row) else 0)
            if c > 0:
                prices[psku] = c
    # product master fallback
    prod = sheet_by_title(snap, "产品")
    if prod:
        headers = [str(h or "").strip() for h in prod[0]]
        try:
            pi = headers.index("PSKU")
        except ValueError:
            pi = 2
        try:
            ci = headers.index("采购单价")
        except ValueError:
            ci = -1
        for row in prod[1:]:
            psku = str((row[pi] if pi < len(row) else "") or "").strip()
            if not psku:
                continue
            if psku not in prices and ci >= 0:
                c = num(row[ci] if ci < len(row) else 0)
                if c > 0:
                    prices[psku] = c
    return prices


def load_sku_maps() -> tuple[
    dict[str, str], dict[str, str], dict[str, str], dict[str, str]
]:
    """psku→zsku, zsku→psku, psku→name, productName→shopCode (N1/N2)."""
    snap = load_json(FEISHU / "product" / "snapshot.json")
    p2z: dict[str, str] = {}
    z2p: dict[str, str] = {}
    names: dict[str, str] = {}
    name_shop: dict[str, str] = {}
    prod = sheet_by_title(snap, "产品")
    headers = [str(h or "").strip() for h in prod[0]]
    pi = headers.index("PSKU") if "PSKU" in headers else 2
    zi = headers.index("SKU") if "SKU" in headers else 1
    shop_i = headers.index("店铺代码") if "店铺代码" in headers else -1
    # 品名常在空表头列（索引 3）
    name_i = next(
        (i for i, h in enumerate(headers) if "名称" in h or h == "品名"),
        3 if len(headers) > 3 else -1,
    )
    for row in prod[1:]:
        psku = str((row[pi] if pi < len(row) else "") or "").strip()
        zsku = str((row[zi] if zi < len(row) else "") or "").strip()
        pname = (
            str((row[name_i] if name_i >= 0 and name_i < len(row) else "") or "").strip()
            if name_i >= 0
            else ""
        )
        shop = (
            str((row[shop_i] if shop_i >= 0 and shop_i < len(row) else "") or "")
            .strip()
            .upper()
        )
        if psku and zsku:
            p2z[psku] = zsku
            z2p[zsku] = psku
        if psku and pname:
            names[psku] = pname
        if pname and shop in ("N1", "N2", "N3"):
            name_shop[pname] = shop
            base = re.split(r"[-－]", pname, maxsplit=1)[0].strip()
            if base and base not in name_shop:
                name_shop[base] = shop
    psnap = load_json(FEISHU / "packing" / "snapshot.json")
    try:
        skuinfo = sheet_by_title(psnap, "SKU信息")
        h = [str(x or "").strip() for x in skuinfo[0]]
        for row in skuinfo[1:]:
            rec = {h[i]: (row[i] if i < len(row) else None) for i in range(len(h))}
            psku = str(rec.get("PSKU") or rec.get("psku") or "").strip()
            name = str(
                rec.get("品名") or rec.get("产品名称") or rec.get("名称") or ""
            ).strip()
            if psku and name and psku not in names:
                names[psku] = name
            if psku and name and name not in name_shop:
                if psku.startswith(("N1", "N2", "N3")):
                    name_shop[name] = psku[:2]
    except KeyError:
        pass
    return p2z, z2p, names, name_shop


@dataclass
class UnitHeadhaul:
    intl: float = 0.0
    dom: float = 0.0
    qty: float = 0.0


def load_unit_headhaul() -> dict[str, UnitHeadhaul]:
    """Allocate packing actual freight to PSKU; return weighted unit costs."""
    snap = load_json(FEISHU / "packing" / "snapshot.json")
    boxes = sheet_by_title(snap, "箱表")
    lines = sheet_by_title(snap, "装箱明细")
    bh = [str(x or "").strip() for x in boxes[0]]
    lh = [str(x or "").strip() for x in lines[0]]

    def bcol(*names: str) -> int:
        for n in names:
            if n in bh:
                return bh.index(n)
        # fuzzy
        for i, h in enumerate(bh):
            for n in names:
                if n in h:
                    return i
        return -1

    def lcol(*names: str) -> int:
        for n in names:
            if n in lh:
                return lh.index(n)
        for i, h in enumerate(lh):
            for n in names:
                if n in h:
                    return i
        return -1

    i_box = bcol("箱号")
    i_ticket = bcol("票号")
    i_shop = bcol("店铺Code")
    i_dom = bcol("整票国内运费")
    i_intl = bcol("整票跨境实付")
    i_recv = bcol("实收跨境费")

    # ticket → freight (dedupe)
    ticket_intl: dict[str, float] = {}
    ticket_dom: dict[str, float] = {}
    box_ticket: dict[str, str] = {}
    box_shop: dict[str, str] = {}
    ticket_boxes: dict[str, list[str]] = defaultdict(list)

    for row in boxes[1:]:
        box = str((row[i_box] if i_box >= 0 and i_box < len(row) else "") or "").strip()
        if not box:
            continue
        ticket = str(
            (row[i_ticket] if i_ticket >= 0 and i_ticket < len(row) else "") or ""
        ).strip()
        shop = str(
            (row[i_shop] if i_shop >= 0 and i_shop < len(row) else "") or ""
        ).strip()
        box_shop[box] = shop
        if ticket:
            box_ticket[box] = ticket
            ticket_boxes[ticket].append(box)
            if ticket not in ticket_intl:
                intl = num(row[i_recv] if i_recv >= 0 else 0) or num(
                    row[i_intl] if i_intl >= 0 else 0
                )
                ticket_intl[ticket] = intl
                ticket_dom[ticket] = num(row[i_dom] if i_dom >= 0 else 0)

    # lines by box
    i_lbox = lcol("箱号")
    i_psku = lcol("PSKU", "psku", "Partner SKU")
    i_qty = lcol("数量", "qty", "PCS", "产品数量")

    box_lines: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for row in lines[1:]:
        box = str(
            (row[i_lbox] if i_lbox >= 0 and i_lbox < len(row) else "") or ""
        ).strip()
        psku = str(
            (row[i_psku] if i_psku >= 0 and i_psku < len(row) else "") or ""
        ).strip()
        q = num(row[i_qty] if i_qty >= 0 and i_qty < len(row) else 0)
        if not box or not psku or q <= 0:
            continue
        box_lines[box].append((psku, q))

    # allocate ticket freight equally by line qty across boxes on ticket
    acc: dict[str, UnitHeadhaul] = defaultdict(UnitHeadhaul)
    for ticket, blist in ticket_boxes.items():
        intl = ticket_intl.get(ticket, 0.0)
        dom = ticket_dom.get(ticket, 0.0)
        # all lines on ticket
        all_lines: list[tuple[str, float]] = []
        for b in blist:
            all_lines.extend(box_lines.get(b, []))
        total_qty = sum(q for _, q in all_lines)
        if total_qty <= 0:
            continue
        for psku, q in all_lines:
            share_i = intl * (q / total_qty)
            share_d = dom * (q / total_qty)
            u = acc[psku]
            u.intl += share_i
            u.dom += share_d
            u.qty += q

    out: dict[str, UnitHeadhaul] = {}
    for psku, u in acc.items():
        if u.qty <= 0:
            continue
        out[psku] = UnitHeadhaul(
            intl=u.intl / u.qty, dom=u.dom / u.qty, qty=u.qty
        )
    return out


def load_cash_headhaul_by_shop_month() -> dict[tuple[str, str], dict[str, float]]:
    """Appendix: packing cash freight by shopCode × ship month (ticket deduped)."""
    snap = load_json(FEISHU / "packing" / "snapshot.json")
    boxes = sheet_by_title(snap, "箱表")
    bh = [str(x or "").strip() for x in boxes[0]]
    i_ticket = bh.index("票号") if "票号" in bh else 1
    i_ship = bh.index("发货时间") if "发货时间" in bh else 7
    i_shop = bh.index("店铺Code") if "店铺Code" in bh else 10
    i_dom = bh.index("整票国内运费") if "整票国内运费" in bh else 11
    i_intl = bh.index("整票跨境实付") if "整票跨境实付" in bh else 12
    i_recv = bh.index("实收跨境费") if "实收跨境费" in bh else 13
    seen: set[tuple[str, str, str]] = set()
    out: dict[tuple[str, str], dict[str, float]] = defaultdict(
        lambda: {"intl": 0.0, "dom": 0.0, "boxes": 0.0}
    )
    for row in boxes[1:]:
        ticket = str((row[i_ticket] if i_ticket < len(row) else "") or "").strip()
        shop = str((row[i_shop] if i_shop < len(row) else "") or "").strip()
        m = month_key(str(row[i_ship] if i_ship < len(row) else ""))
        if not m or m not in MONTHS:
            continue
        key = (ticket or f"box-{row[0]}", m, shop)
        out[(shop, m)]["boxes"] += 1
        if key in seen:
            continue
        seen.add(key)
        intl = num(row[i_recv] if i_recv < len(row) else 0) or num(
            row[i_intl] if i_intl < len(row) else 0
        )
        out[(shop, m)]["intl"] += intl
        out[(shop, m)]["dom"] += num(row[i_dom] if i_dom < len(row) else 0)
    return out


@dataclass
class PackagingLine:
    name: str
    qty: float
    date: str | None
    month: str | None
    amount: float
    product: str
    shop_guess: str | None  # N1/N2/None


def load_packaging(
    names: dict[str, str], name_shop: dict[str, str]
) -> list[PackagingLine]:
    snap = load_json(FEISHU / "accounts" / "snapshot.json")
    rows = sheet_by_title(snap, "产品包装采购")
    name_to_psku = {v: k for k, v in names.items() if v}
    out: list[PackagingLine] = []
    for row in rows[1:]:
        pname = str((row[0] if row else "") or "").strip()
        if not pname:
            continue
        qty = num(row[1] if len(row) > 1 else 0)
        dt = parse_cn_date(row[2] if len(row) > 2 else None)
        amount = num(row[5] if len(row) > 5 else 0)
        if amount <= 0:
            amount = num(row[4] if len(row) > 4 else 0) * (qty or 1)
        product = str((row[7] if len(row) > 7 else "") or "").strip()
        shop = None
        if product:
            shop = name_shop.get(product)
            if not shop:
                for n, sc in name_shop.items():
                    if product in n or n in product:
                        shop = sc
                        break
            if not shop:
                hit = name_to_psku.get(product)
                if hit and hit.startswith(("N1", "N2", "N3")):
                    shop = hit[:2]
                else:
                    for n, psku in name_to_psku.items():
                        if product in n or n in product:
                            if psku.startswith(("N1", "N2", "N3")):
                                shop = psku[:2]
                                break
            if not shop:
                if "HPMY" in product.upper() or product.startswith("N1"):
                    shop = "N1"
                elif "KAZA" in product.upper() or product.startswith("N2"):
                    shop = "N2"
        m = dt[:7] if dt else None
        out.append(
            PackagingLine(
                name=pname,
                qty=qty,
                date=dt,
                month=m,
                amount=amount,
                product=product,
                shop_guess=shop,
            )
        )
    return out


@dataclass
class SkuSale:
    zsku: str
    psku: str
    name: str
    revenue: float = 0.0
    units: float = 0.0
    fail: float = 0.0
    cir: float = 0.0
    cancel: float = 0.0
    undelivered: float = 0.0
    source: str = ""


def load_portal_sales(shop_id: str, month: str) -> dict[str, SkuSale]:
    path = (
        OUTPOST
        / "shops"
        / shop_id
        / "portal-imports"
        / "sales_export_2026-07-02_2026-09-29.csv"
    )
    if not path.exists():
        return {}
    out: dict[str, SkuSale] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            ts = r.get("order_timestamp") or r.get("shipment_timestamp") or ""
            if month_key(ts) != month:
                continue
            zsku = (r.get("sku") or "").strip()
            psku = (r.get("partner_sku") or "").strip()
            if not zsku and not psku:
                continue
            key = zsku or psku
            st = (r.get("status") or "").strip()
            gmv = num(r.get("gmv_lcy") or r.get("offer_price"))
            rec = out.get(key)
            if not rec:
                rec = SkuSale(zsku=zsku, psku=psku, name="", source="portal_sales_export")
                out[key] = rec
            rec.units += 1
            if st == STATUS_FAIL:
                rec.fail += 1
            elif st == STATUS_CIR:
                rec.cir += 1
            elif st == STATUS_CANCEL:
                rec.cancel += 1
            elif st == STATUS_UNDELIVERED:
                rec.undelivered += 1
            else:
                # Delivered/Shipped/Processing count as sold GMV
                rec.revenue += gmv
    return out


def load_impex_sales(shop_id: str, month: str) -> dict[str, SkuSale]:
    path = GP_SRC / shop_id / f"sales_2026-06-01_2026-09-29.csv"
    if not path.exists():
        return {}
    out: dict[str, SkuSale] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if month_key(r.get("Visit_Date")) != month:
                continue
            psku = (r.get("Partner_SKU") or "").strip()
            zsku = (r.get("SKU") or "").strip()
            if not psku and not zsku:
                continue
            key = zsku or psku
            ship = num(r.get("Shipped_Units"))
            cancel = num(r.get("Cancelled_Units"))
            rev = num(r.get("Revenue_Shipped"))
            title = (r.get("Product_Title") or "").strip()
            rec = out.get(key)
            if not rec:
                rec = SkuSale(
                    zsku=zsku,
                    psku=psku,
                    name=title,
                    source="impex_productviews",
                )
                out[key] = rec
            rec.units += ship
            rec.cancel += cancel
            rec.revenue += rev
            if title and not rec.name:
                rec.name = title
    return out


def load_platform_fees(shop_id: str, month: str) -> dict[str, float]:
    """Return totals: platform_fee_sar (order fees excl ads), ads_fee_sar."""
    path = GP_SRC / shop_id / "fees.csv"
    platform = 0.0
    ads = 0.0
    if not path.exists():
        return {"platform_fee_sar": 0.0, "ads_fee_sar": 0.0, "missing": 1.0}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if month_key(r.get("Transaction Date")) != month:
                continue
            t = (r.get("Transaction Type") or "").strip()
            fee_sum = sum(num(r.get(c)) for c in FEE_COLS)
            # fees are negative in file
            if t in ("order", "order_update"):
                platform += -fee_sum if fee_sum < 0 else fee_sum
            non = num(r.get("Non-Order Fees including VAT"))
            if non:
                ads += -non if non < 0 else non
    return {
        "platform_fee_sar": round2(platform),
        "ads_fee_sar": round2(ads),
        "missing": 0.0,
    }


# ---------------------------------------------------------------------------
# Build month report data
# ---------------------------------------------------------------------------
@dataclass
class MonthReport:
    shop: dict
    month: str
    sku_rows: list[dict]
    totals: dict
    caveats: list[str] = field(default_factory=list)
    sale_source: str = ""
    packaging_rows: list[dict] = field(default_factory=list)
    cash_headhaul: dict = field(default_factory=dict)


def build_month(
    shop: dict,
    month: str,
    prices: dict[str, float],
    p2z: dict[str, str],
    z2p: dict[str, str],
    names: dict[str, str],
    unit_hh: dict[str, UnitHeadhaul],
    packaging: list[PackagingLine],
    cash_hh: dict[tuple[str, str], dict[str, float]],
) -> MonthReport:
    caveats: list[str] = []
    sales: dict[str, SkuSale] = {}
    sale_source = ""

    if month == "2026-06":
        sales = load_impex_sales(shop["id"], month)
        sale_source = "impex_productviews (六月无 portal item 导出；缺 Payment failed/CIR/未送达拆分)"
        caveats.append(
            "2026-06 销量来自 Impex productviews（Shipped_Units/Revenue_Shipped），"
            "非 Seller Lab item 行；与 7–9 月 portal sales_export 口径不同"
        )
    else:
        sales = load_portal_sales(shop["id"], month)
        sale_source = "portal_sales_export (item 行；status 仅见 Delivered/Shipped/Processing)"
        if not sales:
            sales = load_impex_sales(shop["id"], month)
            sale_source = "impex_productviews (portal 缺月回退)"
            caveats.append(f"{month} portal sales 为空，回退 Impex productviews")
        # portal export typically lacks CIR/cancel/undelivered
        if sales and all(s.cir + s.cancel + s.fail + s.undelivered == 0 for s in sales.values()):
            caveats.append(
                "portal sales_export 无 CIR/Cancelled/Payment failed/Could Not Be Delivered 行；"
                "COGS 件数≈销售件数（未做样板级扣减）"
            )

    fees = load_platform_fees(shop["id"], month)
    if fees.get("missing"):
        caveats.append("缺 Transaction View fees 文件：平台费留空")

    # packaging for shop+month
    pkg_rows = []
    pkg_total = 0.0
    pkg_unassigned = 0.0
    for p in packaging:
        if p.month != month:
            continue
        if p.shop_guess and p.shop_guess != shop["code"]:
            continue
        if not p.shop_guess:
            # only count unassigned once on N1 report appendix — attribute later
            pkg_unassigned += p.amount
            continue
        pkg_rows.append(
            {
                "name": p.name,
                "product": p.product,
                "date": p.date,
                "qty": p.qty,
                "amount": round2(p.amount),
            }
        )
        pkg_total += p.amount

    # For unassigned packaging: split note — assign half? NO. Put on summary only.
    # Per-shop: only clearly attributed. Unassigned listed in summary workbook.

    sku_rows = []
    for key, s in sorted(sales.items(), key=lambda kv: -kv[1].revenue):
        psku = s.psku or z2p.get(s.zsku, "")
        zsku = s.zsku or p2z.get(psku, "")
        if psku and not psku.startswith(shop["psku_prefix"]):
            # keep if shop's export; still include (export is shop-scoped)
            pass
        name = s.name or names.get(psku, "")
        unit_cost = prices.get(psku, 0.0)
        cogs_units = s.units - s.fail - s.cir - s.cancel - s.undelivered
        if cogs_units < 0:
            cogs_units = 0
        purchase_total = unit_cost * cogs_units if unit_cost else None
        hh = unit_hh.get(psku)
        intl = round2(hh.intl * cogs_units) if hh and cogs_units else None
        dom = round2(hh.dom * cogs_units) if hh and cogs_units else None
        if unit_cost <= 0:
            caveats.append(f"缺采购单价: {psku or zsku}")
        sku_rows.append(
            {
                "zsku": zsku,
                "psku": psku,
                "name": name,
                "revenue": round2(s.revenue),
                "units": s.units,
                "effective_units": s.units - s.fail,
                "fail": s.fail,
                "cir": s.cir,
                "cancel": s.cancel,
                "undelivered": s.undelivered,
                "return_rate": (s.cir / (s.units - s.fail))
                if (s.units - s.fail) > 0
                else 0,
                "unit_cost": unit_cost or None,
                "purchase_total": round2(purchase_total) if purchase_total is not None else None,
                "intl_freight": intl,
                "dom_freight": dom,
                "ticket": "",
            }
        )

    # dedupe caveat spam
    caveats = list(dict.fromkeys(caveats))
    # keep only first 30 sku-missing price notes + summary count
    price_miss = [c for c in caveats if c.startswith("缺采购单价")]
    other = [c for c in caveats if not c.startswith("缺采购单价")]
    if price_miss:
        other.append(f"缺采购单价 SKU 数: {len(price_miss)}")
        other.extend(price_miss[:15])
    caveats = other

    purchase_sum = sum(r["purchase_total"] or 0 for r in sku_rows)
    intl_sum = sum(r["intl_freight"] or 0 for r in sku_rows)
    dom_sum = sum(r["dom_freight"] or 0 for r in sku_rows)
    revenue = sum(r["revenue"] for r in sku_rows)
    platform = fees.get("platform_fee_sar") or 0.0
    vat = None  # not separately available (fees include VAT)
    caveats.append(
        "VAT 未单独出具：Transaction View 费用列均为 including VAT；"
        "样板 S 列（月账单 VAT）本月标记为缺源"
    )
    net = revenue - platform  # VAT omitted
    pure = net * FX_RATE - purchase_sum - intl_sum - dom_sum - pkg_total

    cash = cash_hh.get((shop["code"], month), {"intl": 0, "dom": 0, "boxes": 0})

    totals = {
        "revenue_sar": round2(revenue),
        "platform_fee_sar": round2(platform) if not fees.get("missing") else None,
        "vat_sar": vat,
        "net_revenue_sar": round2(net),
        "purchase_cny": round2(purchase_sum),
        "intl_freight_cny": round2(intl_sum),
        "dom_freight_cny": round2(dom_sum),
        "packaging_cny": round2(pkg_total),
        "fx": FX_RATE,
        "pure_profit_cny": round2(pure),
        "ads_fee_sar": fees.get("ads_fee_sar"),
        "units": sum(r["units"] for r in sku_rows),
        "pkg_unassigned_month_cny": round2(
            sum(p.amount for p in packaging if p.month == month and not p.shop_guess)
        ),
    }

    return MonthReport(
        shop=shop,
        month=month,
        sku_rows=sku_rows,
        totals=totals,
        caveats=caveats,
        sale_source=sale_source,
        packaging_rows=pkg_rows,
        cash_headhaul=cash,
    )


# ---------------------------------------------------------------------------
# Excel emit
# ---------------------------------------------------------------------------
THIN = Border(
    left=Side(style="thin"),
    right=Side(style="thin"),
    top=Side(style="thin"),
    bottom=Side(style="thin"),
)
HEADER_FILL = PatternFill("solid", fgColor="D9E2F3")
TOTAL_FILL = PatternFill("solid", fgColor="FFF2CC")


def write_month_workbook(rep: MonthReport, path: Path) -> None:
    wb = Workbook()
    # --- report ---
    ws = wb.active
    ws.title = "report"
    headers = [
        "ZSKU",
        "PSKU",
        "品名",
        "销售额(SAR)",
        "销售件数",
        "有效销售件数（扣除付款失败）",
        "付款失败",
        "退货数量",
        "取消数量",
        "未送达数量",
        "退货率",
        "采购单价",
        "总采购成本(¥)",
        "国际运费成本(¥)",
        "国内运费成本(¥)",
        "备注",
    ]
    for c, h in enumerate(headers, 1):
        cell = ws.cell(1, c, h)
        cell.font = Font(bold=True)
        cell.fill = HEADER_FILL
        cell.border = THIN
        cell.alignment = Alignment(wrap_text=True, vertical="center")

    for i, r in enumerate(rep.sku_rows, 2):
        vals = [
            r["zsku"],
            r["psku"],
            r["name"],
            r["revenue"],
            r["units"],
            r["effective_units"],
            r["fail"],
            r["cir"],
            r["cancel"],
            r["undelivered"],
            r["return_rate"],
            r["unit_cost"],
            r["purchase_total"],
            r["intl_freight"],
            r["dom_freight"],
            "",
        ]
        for c, v in enumerate(vals, 1):
            cell = ws.cell(i, c, v)
            cell.border = THIN

    # shop totals block (cols Q–AA style)
    t = rep.totals
    block = [
        ("营业额(SAR)", t["revenue_sar"]),
        ("平台费(SAR)", t["platform_fee_sar"]),
        ("VAT", t["vat_sar"] if t["vat_sar"] is not None else "缺源"),
        ("净营业额(SAR)", t["net_revenue_sar"]),
        ("采购成本(CNY)", t["purchase_cny"]),
        ("国际运费成本(CNY)", t["intl_freight_cny"]),
        ("国内运费成本(CNY)", t["dom_freight_cny"]),
        ("产品包装采购(CNY)", t["packaging_cny"]),
        ("汇率", t["fx"]),
        ("纯利(CNY)", t["pure_profit_cny"]),
        ("广告费(SAR,未扣纯利)", t["ads_fee_sar"]),
    ]
    start_col = 18  # R
    ws.cell(1, start_col, "店铺月汇总").font = Font(bold=True)
    for i, (label, val) in enumerate(block, 2):
        ws.cell(i, start_col, label).fill = TOTAL_FILL
        ws.cell(i, start_col + 1, val).fill = TOTAL_FILL

    ws.cell(14, start_col, "销量来源")
    ws.cell(14, start_col + 1, rep.sale_source)
    ws.cell(15, start_col, FX_NOTE)
    ws.cell(16, start_col, "纯利公式")
    ws.cell(
        16,
        start_col + 1,
        "净营业额×汇率 − 采购 − 国际运费 − 国内运费 − 包装采购；净营业额=营业额−平台费（VAT缺源未扣）",
    )

    # --- 最新采购单价 ---
    ws2 = wb.create_sheet("最新采购单价-产品表")
    ws2.append(["PSKU", "采购单价"])
    seen = set()
    for r in rep.sku_rows:
        if r["psku"] and r["psku"] not in seen:
            ws2.append([r["psku"], r["unit_cost"]])
            seen.add(r["psku"])

    # --- SKU map ---
    ws3 = wb.create_sheet("SKU-产品表")
    ws3.append(["PSKU", "SKU", "产品名称"])
    for r in rep.sku_rows:
        ws3.append([r["psku"], r["zsku"], r["name"]])

    # --- sale raw note ---
    ws4 = wb.create_sheet("销量来源说明")
    ws4.append(["字段", "值"])
    ws4.append(["店铺", f"{rep.shop['name']} ({rep.shop['id']})"])
    ws4.append(["月份", rep.month])
    ws4.append(["销量来源", rep.sale_source])
    ws4.append(["SKU行数", len(rep.sku_rows)])
    ws4.append(["", ""])
    ws4.append(["caveats", ""])
    for c in rep.caveats:
        ws4.append(["", c])

    # --- fees note ---
    ws5 = wb.create_sheet("平台费来源")
    ws5.append(["说明", "Transaction View item-level（Impex fees），按 Transaction Date 归月"])
    ws5.append(["平台费口径", "order/order_update 的 Referral+Fulfillment+Shipping Credits+Other Order Fees（取绝对值）"])
    ws5.append(["平台费(SAR)", t["platform_fee_sar"]])
    ws5.append(["广告等非订单费(SAR,未进纯利)", t["ads_fee_sar"]])
    ws5.append(["VAT", "缺源（费用列含 VAT，无独立 VAT Payable 账单）"])

    # --- packaging ---
    ws6 = wb.create_sheet("产品包装采购")
    ws6.append(["包装名字", "包装产品", "日期", "数量", "总价(CNY)"])
    for p in rep.packaging_rows:
        ws6.append([p["name"], p["product"], p["date"], p["qty"], p["amount"]])
    ws6.append([])
    ws6.append(["本店本月合计", "", "", "", t["packaging_cny"]])
    ws6.append(["当月未能归店金额(见汇总册)", "", "", "", t["pkg_unassigned_month_cny"]])

    # --- cash headhaul appendix ---
    ws7 = wb.create_sheet("装箱实付勾稽")
    ws7.append(["说明", "按发货时间×店铺Code 汇总装箱票级实付（非销货分摊；仅勾稽）"])
    ws7.append(["店铺Code", rep.shop["code"]])
    ws7.append(["月份", rep.month])
    ws7.append(["票级国际运费合计(CNY)", round2(rep.cash_headhaul.get("intl", 0))])
    ws7.append(["票级国内运费合计(CNY)", round2(rep.cash_headhaul.get("dom", 0))])
    ws7.append(["箱行数", rep.cash_headhaul.get("boxes", 0)])
    ws7.append(["销货分摊国际运费(CNY)", t["intl_freight_cny"]])
    ws7.append(["销货分摊国内运费(CNY)", t["dom_freight_cny"]])

    # --- raw sale month sheet (template-like) ---
    append_month_sale_sheet(wb, rep)
    append_month_fees_sheet(wb, rep)

    for col in range(1, 17):
        ws.column_dimensions[get_column_letter(col)].width = 14
    ws.column_dimensions["C"].width = 28

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)


def append_month_sale_sheet(wb: Workbook, rep: MonthReport) -> None:
    title = f"{rep.month[5:]}月sale报表"
    ws = wb.create_sheet(title[:31])
    shop_id = rep.shop["id"]
    month = rep.month
    if month == "2026-06":
        path = GP_SRC / shop_id / "sales_2026-06-01_2026-09-29.csv"
        if not path.exists():
            ws.append(["缺源", str(path)])
            return
        with path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            header = next(reader)
            ws.append(header)
            n = 0
            for row in reader:
                if month_key(row[0] if row else "") == month:
                    ws.append(row)
                    n += 1
                    if n >= 5000:
                        break
        ws.append([])
        ws.append(["注", "六月为 Impex productviews；行数上限 5000"])
        return

    path = (
        OUTPOST
        / "shops"
        / shop_id
        / "portal-imports"
        / "sales_export_2026-07-02_2026-09-29.csv"
    )
    if not path.exists():
        ws.append(["缺源", str(path)])
        return
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        ws.append(header)
        # order_timestamp col index
        try:
            ti = header.index("order_timestamp")
        except ValueError:
            ti = 15
        n = 0
        for row in reader:
            ts = row[ti] if ti < len(row) else ""
            if month_key(ts) == month:
                ws.append(row)
                n += 1
                if n >= 5000:
                    break


def append_month_fees_sheet(wb: Workbook, rep: MonthReport) -> None:
    title = f"{rep.month[5:]}月账单"
    ws = wb.create_sheet(title[:31])
    path = GP_SRC / rep.shop["id"] / "fees.csv"
    if not path.exists():
        ws.append(["缺源", "无 Transaction View fees.csv；Noon invoices 需 contract_order_nrs"])
        return
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        ws.append(header)
        try:
            di = header.index("Transaction Date")
        except ValueError:
            di = 6
        n = 0
        for row in reader:
            if month_key(row[di] if di < len(row) else "") == rep.month:
                ws.append(row)
                n += 1
                if n >= 8000:
                    break
    ws.append([])
    ws.append(
        [
            "注",
            "来源 Impex transactionviewreportonitemlevel（非 Statement of Account）；VAT 独立项缺源",
        ]
    )


def write_summary(reports: list[MonthReport], path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "四个月汇总"
    headers = [
        "店铺",
        "店铺ID",
        "月份",
        "营业额(SAR)",
        "平台费(SAR)",
        "VAT",
        "净营业额(SAR)",
        "采购成本(CNY)",
        "国际运费(CNY)",
        "国内运费(CNY)",
        "包装采购(CNY)",
        "汇率",
        "纯利(CNY)",
        "广告费(SAR未扣)",
        "销量来源",
        "销货分摊头程vs当月装箱实付(国际)",
    ]
    for c, h in enumerate(headers, 1):
        cell = ws.cell(1, c, h)
        cell.font = Font(bold=True)
        cell.fill = HEADER_FILL

    for i, rep in enumerate(reports, 2):
        t = rep.totals
        cash_intl = round2(rep.cash_headhaul.get("intl", 0))
        ws.cell(i, 1, rep.shop["name"])
        ws.cell(i, 2, rep.shop["id"])
        ws.cell(i, 3, rep.month)
        ws.cell(i, 4, t["revenue_sar"])
        ws.cell(i, 5, t["platform_fee_sar"])
        ws.cell(i, 6, "缺源")
        ws.cell(i, 7, t["net_revenue_sar"])
        ws.cell(i, 8, t["purchase_cny"])
        ws.cell(i, 9, t["intl_freight_cny"])
        ws.cell(i, 10, t["dom_freight_cny"])
        ws.cell(i, 11, t["packaging_cny"])
        ws.cell(i, 12, t["fx"])
        ws.cell(i, 13, t["pure_profit_cny"])
        ws.cell(i, 14, t["ads_fee_sar"])
        ws.cell(i, 15, rep.sale_source)
        ws.cell(
            i,
            16,
            f"分摊{t['intl_freight_cny']} / 实付{cash_intl}",
        )

    # sources sheet
    ws2 = wb.create_sheet("数据来源与缺口")
    notes = [
        ["项目", "来源", "状态"],
        ["汇率", "HFY_report_26_05 = 1.79", "已采用"],
        ["7–9月销量", "portal-imports/sales_export_*.csv", "已采用"],
        ["6月销量", "Impex productviewsandsalesdata", "已采用（口径不同于 portal）"],
        ["平台费", "Impex transaction view fees.csv", "已采用（含VAT字样列）"],
        ["VAT独立项", "Noon 月账单 Statement", "缺源（invoices API 需 contract_order_nrs）"],
        ["采购单价", "飞书 产品表每日信息", f"run {FEISHU_RUN}"],
        ["头程", "飞书装箱表 整票跨境实付/国内运费 → 明细分摊 × COGS件数", f"run {FEISHU_RUN}"],
        ["包装采购", "飞书账目表·产品包装采购", "已拉；仅归店成功计入店月"],
        ["样板退货/取消扣减", "May sale status", "portal 导出无 CIR 等，无法复刻"],
        ["禁止", "finance overview 0.5kg 伪头程 / 臆造金额", "未使用"],
    ]
    for r in notes:
        ws2.append(r)

    ws3 = wb.create_sheet("caveats明细")
    ws3.append(["店铺", "月份", "caveat"])
    for rep in reports:
        for c in rep.caveats:
            ws3.append([rep.shop["name"], rep.month, c])

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)


def main() -> None:
    print("loading prices / maps / headhaul / packaging...")
    prices = load_purchase_prices()
    p2z, z2p, names, name_shop = load_sku_maps()
    unit_hh = load_unit_headhaul()
    packaging = load_packaging(names, name_shop)
    cash_hh = load_cash_headhaul_by_shop_month()
    assigned = sum(1 for p in packaging if p.shop_guess)
    print(
        f"prices={len(prices)} unit_hh={len(unit_hh)} packaging={len(packaging)} "
        f"assigned={assigned} names={len(names)} name_shop={len(name_shop)}"
    )
    for p in packaging:
        print(
            f"  pkg {p.month} {p.amount} shop={p.shop_guess} "
            f"product={p.product!r} name={p.name!r}"
        )

    reports: list[MonthReport] = []
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for shop in SHOPS:
        for month in MONTHS:
            print(f"build {shop['file_prefix']} {month}...")
            rep = build_month(
                shop,
                month,
                prices,
                p2z,
                z2p,
                names,
                unit_hh,
                packaging,
                cash_hh,
            )
            reports.append(rep)
            ym = month[2:4] + "_" + month[5:7]  # 26_06
            out = OUT_DIR / f"{shop['file_prefix']}_report_{ym}.xlsx"
            write_month_workbook(rep, out)
            print(
                f"  → {out.name} rev={rep.totals['revenue_sar']} pure={rep.totals['pure_profit_cny']} skus={len(rep.sku_rows)}"
            )

    summary = OUT_DIR / "SUMMARY_两店四个月毛利_26_06_09.xlsx"
    write_summary(reports, summary)
    print("summary", summary)

    # spot-check dump for Jul HFY
    jul = next(
        r
        for r in reports
        if r.shop["id"] == "PRJ482387" and r.month == "2026-07"
    )
    check = {
        "template": str(TEMPLATE),
        "fx": FX_RATE,
        "jul_hfy_totals": jul.totals,
        "jul_hfy_sale_source": jul.sale_source,
        "jul_hfy_caveats": jul.caveats,
        "jul_hfy_top5": jul.sku_rows[:5],
    }
    (GP_SRC / "spotcheck_jul_hfy.json").write_text(
        json.dumps(check, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("spotcheck written")


if __name__ == "__main__":
    main()
