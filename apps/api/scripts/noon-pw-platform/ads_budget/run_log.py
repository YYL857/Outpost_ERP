# -*- coding: utf-8 -*-
"""广告预算运行历史：JSONL 追加 + last 摘要，方便明早核对成功时间。"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ads_budget.baseline_store import data_root, shop_dir

CST = timezone(timedelta(hours=8))


def _now_iso() -> tuple[str, str]:
    """返回 (UTC ISO, 北京时间可读串)。"""
    utc = datetime.now(timezone.utc)
    cst = utc.astimezone(CST)
    return (
        utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        cst.strftime("%Y-%m-%d %H:%M:%S CST"),
    )


def global_runs_path() -> Path:
    return data_root() / "pw-rpa" / "ads-budget-runs.jsonl"


def global_last_path() -> Path:
    return data_root() / "pw-rpa" / "ads-budget-last.json"


def shop_runs_path(shop_id: str) -> Path:
    return shop_dir(shop_id) / "runs.jsonl"


def yingdao_runs_path() -> Path:
    log_dir = Path(os.environ.get("YINGDAO_LOG_DIR", r"D:\YingDao\Logs"))
    return log_dir / "ads_budget_runs.jsonl"


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def record_run(payload: dict[str, Any]) -> dict[str, Any]:
    """
    记录一次 sync/apply/probe。
    payload 建议含：cmd, mode, ok, shops, results, trigger?, error?
    """
    utc, cst = _now_iso()
    row = {
        "finishedAt": utc,
        "finishedAtCst": cst,
        **payload,
    }
    _append_jsonl(global_runs_path(), row)
    _append_jsonl(yingdao_runs_path(), row)

    shops = payload.get("shops") or []
    if isinstance(shops, str):
        shops = [shops]
    for sid in shops:
        if not sid:
            continue
        _append_jsonl(shop_runs_path(str(sid)), row)

    last_path = global_last_path()
    last_path.parent.mkdir(parents=True, exist_ok=True)
    last_path.write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")

    # 人话摘要，记事本一眼能看
    summary = last_path.with_suffix(".txt")
    ok = bool(payload.get("ok"))
    lines = [
        f"finishedAtCst: {cst}",
        f"ok: {ok}",
        f"cmd: {payload.get('cmd')}",
        f"mode: {payload.get('mode')}",
        f"shops: {', '.join(str(s) for s in shops)}",
        f"trigger: {payload.get('trigger') or 'manual'}",
        f"message: {payload.get('message') or ''}",
        f"detailJson: {last_path}",
        f"historyJsonl: {global_runs_path()}",
    ]
    summary.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return row
