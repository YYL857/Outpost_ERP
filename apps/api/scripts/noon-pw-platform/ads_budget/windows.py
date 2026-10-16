# -*- coding: utf-8 -*-
"""北京时间两态窗口：offpeak / peak / idle。"""
from __future__ import annotations

from datetime import datetime, time, timezone, timedelta
from typing import Literal

Mode = Literal["offpeak", "peak", "idle"]

# Asia/Shanghai = UTC+8（无需依赖 zoneinfo，Windows 友好）
CST = timezone(timedelta(hours=8))

# 低流量：09:00–16:00 → 预算压到最低
OFFPEAK_START = time(9, 0)
OFFPEAK_END = time(16, 0)
# 高峰：00:00–05:00 → 恢复人为基准
PEAK_START = time(0, 0)
PEAK_END = time(5, 0)

OFFPEAK_BUDGET_FLOOR = 5


def now_cst(when: datetime | None = None) -> datetime:
    if when is None:
        return datetime.now(CST)
    if when.tzinfo is None:
        return when.replace(tzinfo=CST)
    return when.astimezone(CST)


def resolve_mode(when: datetime | None = None) -> Mode:
    """按北京时间判定当前模式。区间为左闭右开。"""
    t = now_cst(when).time()
    if OFFPEAK_START <= t < OFFPEAK_END:
        return "offpeak"
    if PEAK_START <= t < PEAK_END:
        return "peak"
    return "idle"


def target_budget(
    mode: Mode,
    baseline: float | None,
    offpeak: float | None = None,
) -> float | None:
    """返回该 mode 下应写入的预算；idle 或 peak 无 baseline 时返回 None（跳过）。"""
    if mode == "idle":
        return None
    if mode == "offpeak":
        return float(offpeak if offpeak is not None else OFFPEAK_BUDGET_FLOOR)
    if mode == "peak":
        if baseline is None:
            return None
        return float(baseline)
    return None


def describe_windows() -> str:
    return (
        f"offpeak CST {OFFPEAK_START.strftime('%H:%M')}–{OFFPEAK_END.strftime('%H:%M')} → "
        f"row.offpeakBudget or {OFFPEAK_BUDGET_FLOOR}; "
        f"peak CST {PEAK_START.strftime('%H:%M')}–{PEAK_END.strftime('%H:%M')} → baseline; "
        "else idle (no change)"
    )
