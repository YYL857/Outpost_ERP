# -*- coding: utf-8 -*-
"""tsx 风格：python -m ads_budget.windows_test 或直接跑本文件。"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ads_budget.windows import CST, resolve_mode, target_budget  # noqa: E402


def _dt(h: int, m: int = 0) -> datetime:
    return datetime(2026, 10, 13, h, m, tzinfo=CST)


assert resolve_mode(_dt(9, 0)) == "offpeak"
assert resolve_mode(_dt(15, 59)) == "offpeak"
assert resolve_mode(_dt(16, 0)) == "idle"
assert resolve_mode(_dt(0, 0)) == "peak"
assert resolve_mode(_dt(4, 59)) == "peak"
assert resolve_mode(_dt(5, 0)) == "idle"
assert resolve_mode(_dt(21, 0)) == "idle"

assert target_budget("offpeak", 10) == 5
assert target_budget("offpeak", 10, 8) == 8
assert target_budget("peak", 12) == 12.0
assert target_budget("peak", None) is None
assert target_budget("idle", 10) is None

print("ads_budget.windows_test ok")
