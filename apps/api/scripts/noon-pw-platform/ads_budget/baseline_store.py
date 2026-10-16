# -*- coding: utf-8 -*-
"""按店隔离的广告预算基准表（CSV，可人工维护）。"""
from __future__ import annotations

import csv
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

FIELDNAMES = [
    "shopId",
    "campaignId",
    "campaignName",
    "psku",
    "baselineBudget",
    "offpeakBudget",
    "lastSeenBudget",
    "mode",
    "enabled",
    "updatedAt",
    "needsBaseline",
    "updatedBy",
]


@dataclass
class BaselineRow:
    shopId: str
    campaignId: str
    campaignName: str = ""
    psku: str = ""
    baselineBudget: float | None = None
    # 低峰目标（权威）；空则 apply 回落到 windows.OFFPEAK_BUDGET_FLOOR
    offpeakBudget: float | None = None
    lastSeenBudget: float | None = None
    mode: str = "unknown"
    enabled: bool = True
    updatedAt: str = ""
    needsBaseline: bool = False
    # ui | calc | sync-refresh | apply | "" — 谁写了目标列/行
    updatedBy: str = ""


def data_root() -> Path:
    return Path(os.environ.get("OUTPOST_DATA_ROOT", r"D:\outpost-data"))


def shop_dir(shop_id: str) -> Path:
    sid = shop_id.strip().upper()
    return data_root() / "shops" / sid / "ads-budget"


def baseline_path(shop_id: str) -> Path:
    return shop_dir(shop_id) / "baseline.csv"


def last_run_path(shop_id: str) -> Path:
    return shop_dir(shop_id) / "last_run.json"


def parse_psku(campaign_name: str) -> str:
    """活动名前缀作 PSKU：N3SADD001WHT-... → N3SADD001WHT；容忍前导 -。"""
    name = (campaign_name or "").strip()
    if not name:
        return ""
    # 常见脏前缀：-N2SA... / _N2SA...
    name = re.sub(r"^[^A-Za-z0-9]+", "", name)
    if not name:
        return ""
    # 字母数字段（可直接顶中文：N2SAxxx粉色）
    m = re.match(r"^([A-Za-z0-9]+)", name)
    if not m:
        return name.split()[0][:64]
    token = m.group(1)
    # 像正式 PSKU（同时含字母+数字）时直接用，避免被后面中文/空格污染
    if re.search(r"[A-Za-z]", token) and re.search(r"\d", token):
        return token[:64]
    if "-" in name:
        token = name.split("-", 1)[0].strip()
    elif "_" in name and re.match(r"^[A-Za-z0-9]+_", name):
        token = name.split("_", 1)[0].strip()
    return token[:64]


def _fnum(v) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s.lower() in ("", "nan", "none", "-"):
        return None
    # 去掉货币符号
    s = re.sub(r"[^\d.\-]", "", s)
    if not s or s in (".", "-", "-."):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _bool(v, default: bool = True) -> bool:
    if v is None or v == "":
        return default
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in ("1", "true", "yes", "y", "on")


def _row_from_dict(d: dict) -> BaselineRow | None:
    cid = str(d.get("campaignId") or d.get("campaign_id") or "").strip()
    sid = str(d.get("shopId") or d.get("shop_id") or "").strip().upper()
    if not cid or not sid:
        return None
    name = str(d.get("campaignName") or d.get("campaign_name") or "").strip()
    psku = str(d.get("psku") or "").strip() or parse_psku(name)
    return BaselineRow(
        shopId=sid,
        campaignId=cid,
        campaignName=name,
        psku=psku,
        baselineBudget=_fnum(d.get("baselineBudget") if "baselineBudget" in d else d.get("baseline_budget")),
        offpeakBudget=_fnum(d.get("offpeakBudget") if "offpeakBudget" in d else d.get("offpeak_budget")),
        lastSeenBudget=_fnum(d.get("lastSeenBudget") if "lastSeenBudget" in d else d.get("last_seen_budget")),
        mode=str(d.get("mode") or "unknown").strip() or "unknown",
        enabled=_bool(d.get("enabled"), True),
        updatedAt=str(d.get("updatedAt") or d.get("updated_at") or "").strip(),
        needsBaseline=_bool(
            d.get("needsBaseline") if "needsBaseline" in d else d.get("needs_baseline"),
            False,
        ),
        updatedBy=str(d.get("updatedBy") or d.get("updated_by") or "").strip(),
    )


def load_baseline(shop_id: str) -> dict[str, BaselineRow]:
    path = baseline_path(shop_id)
    out: dict[str, BaselineRow] = {}
    if not path.is_file():
        return out
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(raw.splitlines())
    for d in reader:
        row = _row_from_dict(d)
        if row:
            out[row.campaignId] = row
    return out


def save_baseline(shop_id: str, rows: dict[str, BaselineRow]) -> Path:
    path = baseline_path(shop_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(rows.values(), key=lambda r: (r.psku or "", r.campaignId))
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        for r in ordered:
            d = asdict(r)
            d["baselineBudget"] = "" if r.baselineBudget is None else r.baselineBudget
            d["offpeakBudget"] = "" if r.offpeakBudget is None else r.offpeakBudget
            d["lastSeenBudget"] = "" if r.lastSeenBudget is None else r.lastSeenBudget
            d["enabled"] = "1" if r.enabled else "0"
            d["needsBaseline"] = "1" if r.needsBaseline else "0"
            w.writerow(d)
    return path


def merge_live_snapshot(
    shop_id: str,
    live: list[dict],
    *,
    refresh_baseline: bool,
    mode: str = "unknown",
) -> tuple[dict[str, BaselineRow], dict]:
    """
    用 Live 列表合并基准表。
    refresh_baseline=True 时才用页面预算覆盖 baselineBudget（人工高峰同步）。
    日常 sync 只更新 lastSeenBudget / 元数据，不改 baseline。
    """
    sid = shop_id.strip().upper()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    existing = load_baseline(sid)
    stats = {
        "seen": 0,
        "inserted": 0,
        "baselineRefreshed": 0,
        "baselineKept": 0,
        "needsBaseline": 0,
        "disabledGone": 0,
        "reenabledLive": 0,
    }
    seen_ids: set[str] = set()

    for item in live:
        cid = str(item.get("campaignId") or "").strip()
        if not cid:
            continue
        name = str(item.get("campaignName") or "").strip()
        budget = _fnum(item.get("budget"))
        stats["seen"] += 1
        seen_ids.add(cid)
        row = existing.get(cid)
        if row is None:
            stats["inserted"] += 1
            has_b = budget is not None and refresh_baseline
            row = BaselineRow(
                shopId=sid,
                campaignId=cid,
                campaignName=name,
                psku=parse_psku(name),
                baselineBudget=budget if has_b else None,
                offpeakBudget=None,
                lastSeenBudget=budget,
                mode=mode,
                enabled=True,
                updatedAt=now,
                needsBaseline=not has_b,
                updatedBy="sync-refresh" if has_b else "",
            )
            if row.needsBaseline:
                stats["needsBaseline"] += 1
            elif has_b:
                stats["baselineRefreshed"] += 1
            existing[cid] = row
            continue

        row.campaignName = name or row.campaignName
        row.psku = parse_psku(row.campaignName) or row.psku
        row.lastSeenBudget = budget if budget is not None else row.lastSeenBudget
        row.mode = mode or row.mode
        row.updatedAt = now
        # 再次出现在 Live：若上次因「同步未见」停用，则自动重新启用
        if not row.enabled and row.updatedBy == "sync-offline":
            row.enabled = True
            stats["reenabledLive"] += 1
        if refresh_baseline and budget is not None:
            # 显式导入目标：才写 baselineBudget；日常 sync 永不覆盖
            row.baselineBudget = budget
            row.needsBaseline = False
            row.updatedBy = "sync-refresh"
            stats["baselineRefreshed"] += 1
        else:
            stats["baselineKept"] += 1
            if row.baselineBudget is None:
                row.needsBaseline = True
                stats["needsBaseline"] += 1
            elif row.updatedBy == "sync-offline":
                # 已重新启用，清掉 offline 标记（保留目标列）
                row.updatedBy = "sync"
        existing[cid] = row

    # Live 列表扫全后：本次未见的活动 = 已暂停/下架/不在 Live → 自动停用（apply 跳过）
    for cid, row in existing.items():
        if cid in seen_ids:
            continue
        if not row.enabled and row.updatedBy == "sync-offline":
            continue
        row.enabled = False
        row.updatedBy = "sync-offline"
        row.updatedAt = now
        stats["disabledGone"] += 1

    return existing, stats


def parse_shop_whitelist() -> list[str]:
    """
    白名单：OUTPOST_ADS_BUDGET_SHOPS，默认仅试店 PRJ488078。
    未在名单内的店一律跳过（扩主力店时只加 ID）。
    """
    raw = (os.environ.get("OUTPOST_ADS_BUDGET_SHOPS") or "PRJ488078").strip()
    out: list[str] = []
    seen: set[str] = set()
    for part in re.split(r"[,;\s]+", raw):
        sid = part.strip().upper()
        if not sid or sid in seen:
            continue
        seen.add(sid)
        out.append(sid)
    return out


def budget_batch_size() -> int:
    try:
        n = int(os.environ.get("OUTPOST_ADS_BUDGET_BATCH", "15") or "15")
    except ValueError:
        n = 15
    return max(1, min(n, 100))


def budgets_close(a: float | None, b: float | None, eps: float = 0.01) -> bool:
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) <= eps
