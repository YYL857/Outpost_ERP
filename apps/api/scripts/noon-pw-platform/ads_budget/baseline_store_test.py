# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ads_budget.baseline_store import (  # noqa: E402
    load_baseline,
    merge_live_snapshot,
    parse_psku,
    parse_shop_whitelist,
    save_baseline,
)

assert parse_psku("N3SADD001WHT-something") == "N3SADD001WHT"
assert parse_psku("ABC123") == "ABC123"
assert parse_psku("-N2SAJCQ001BLK-蓝测手环-7-31-手动") == "N2SAJCQ001BLK"
assert parse_psku("N2SABMQ001PNK毛毛虫粉色-手动") == "N2SABMQ001PNK"

with tempfile.TemporaryDirectory() as td:
    os.environ["OUTPOST_DATA_ROOT"] = td
    os.environ["OUTPOST_ADS_BUDGET_SHOPS"] = "PRJ488078"
    assert parse_shop_whitelist() == ["PRJ488078"]

    live = [
        {
            "campaignId": "C_AAA",
            "campaignName": "N3SADD001WHT-x",
            "budget": 10,
        }
    ]
    rows, stats = merge_live_snapshot(
        "PRJ488078", live, refresh_baseline=False, mode="peak"
    )
    assert stats["inserted"] == 1
    assert rows["C_AAA"].baselineBudget is None
    assert rows["C_AAA"].needsBaseline is True
    assert rows["C_AAA"].lastSeenBudget == 10
    save_baseline("PRJ488078", rows)

    rows2, stats2 = merge_live_snapshot(
        "PRJ488078", live, refresh_baseline=True, mode="peak"
    )
    assert stats2["baselineRefreshed"] == 1
    assert rows2["C_AAA"].baselineBudget == 10
    assert rows2["C_AAA"].needsBaseline is False
    save_baseline("PRJ488078", rows2)

    # 低峰页面已是 5：日常 sync 不得覆盖 baseline
    live_low = [{**live[0], "budget": 5}]
    rows3, _ = merge_live_snapshot(
        "PRJ488078", live_low, refresh_baseline=False, mode="offpeak"
    )
    assert rows3["C_AAA"].baselineBudget == 10
    assert rows3["C_AAA"].lastSeenBudget == 5

    loaded = load_baseline("PRJ488078")
    assert "C_AAA" in loaded
    assert loaded["C_AAA"].baselineBudget == 10

    # 再插一条；下次 sync 只有 C_AAA → C_BBB 应自动停用
    rows3["C_BBB"] = rows3["C_AAA"].__class__(
        shopId="PRJ488078",
        campaignId="C_BBB",
        campaignName="N3SADD002WHT-y",
        psku="N3SADD002WHT",
        baselineBudget=8,
        lastSeenBudget=5,
        mode="offpeak",
        enabled=True,
        updatedAt="2026-10-14T00:00:00Z",
        needsBaseline=False,
        updatedBy="ui",
    )
    save_baseline("PRJ488078", rows3)
    rows4, stats4 = merge_live_snapshot(
        "PRJ488078", live_low, refresh_baseline=False, mode="offpeak"
    )
    assert stats4["disabledGone"] == 1
    assert rows4["C_BBB"].enabled is False
    assert rows4["C_BBB"].updatedBy == "sync-offline"
    assert rows4["C_AAA"].enabled is True
    save_baseline("PRJ488078", rows4)
    # C_BBB 再回 Live → 重新启用
    live_both = [
        live_low[0],
        {
            "campaignId": "C_BBB",
            "campaignName": "N3SADD002WHT-y",
            "budget": 5,
        },
    ]
    rows5, stats5 = merge_live_snapshot(
        "PRJ488078", live_both, refresh_baseline=False, mode="offpeak"
    )
    assert stats5["reenabledLive"] == 1
    assert rows5["C_BBB"].enabled is True

print("ads_budget.baseline_store_test ok")
