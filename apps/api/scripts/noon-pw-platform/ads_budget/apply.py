# -*- coding: utf-8 -*-
"""按 mode 计算目标并批量改预算（幂等、分批、失败续跑）。"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ads_budget.baseline_store import (
    BaselineRow,
    budget_batch_size,
    budgets_close,
    last_run_path,
    load_baseline,
    save_baseline,
)
from ads_budget.page_live import set_campaign_budget
from ads_budget.windows import Mode, target_budget


def log(msg: str) -> None:
    print(f"[ads-budget] {msg}", flush=True)


def plan_changes(
    rows: dict[str, BaselineRow],
    mode: Mode,
    *,
    only_failed_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """生成待改列表；无 baseline 的 peak / disabled / idle 跳过。"""
    planned: list[dict[str, Any]] = []
    for cid, row in sorted(rows.items(), key=lambda x: x[0]):
        if not row.enabled:
            continue
        if only_failed_ids is not None and cid not in only_failed_ids:
            continue
        tgt = target_budget(mode, row.baselineBudget, row.offpeakBudget)
        if tgt is None:
            continue
        if mode == "peak" and (row.baselineBudget is None or row.needsBaseline):
            planned.append(
                {
                    "campaignId": cid,
                    "psku": row.psku,
                    "from": row.lastSeenBudget,
                    "to": None,
                    "skip": True,
                    "reason": "needs_baseline",
                }
            )
            continue
        if budgets_close(row.lastSeenBudget, tgt):
            planned.append(
                {
                    "campaignId": cid,
                    "psku": row.psku,
                    "from": row.lastSeenBudget,
                    "to": tgt,
                    "skip": True,
                    "reason": "already_at_target",
                }
            )
            continue
        planned.append(
            {
                "campaignId": cid,
                "psku": row.psku,
                "from": row.lastSeenBudget,
                "to": tgt,
                "skip": False,
                "reason": "",
            }
        )
    return planned


async def apply_plan(
    page,
    shop_id: str,
    mode: Mode,
    plan: list[dict[str, Any]],
    *,
    dry_run: bool,
) -> dict[str, Any]:
    sid = shop_id.strip().upper()
    batch = budget_batch_size()
    todo = [p for p in plan if not p.get("skip")]
    skipped = [p for p in plan if p.get("skip")]
    results: list[dict[str, Any]] = []
    ok_n = fail_n = 0

    log(
        f"apply shop={sid} mode={mode} dry_run={dry_run} "
        f"todo={len(todo)} skipped={len(skipped)} batch={batch}"
    )

    for i, item in enumerate(todo):
        cid = item["campaignId"]
        tgt = float(item["to"])
        if i and i % batch == 0:
            log(f"batch pause after {i}…")
            await page.wait_for_timeout(1500)
        r = await set_campaign_budget(page, cid, tgt, dry_run=dry_run)
        r["psku"] = item.get("psku")
        r["from"] = item.get("from")
        results.append(r)
        if r.get("ok"):
            ok_n += 1
            log(f"OK {cid} {item.get('from')} → {tgt}")
        else:
            fail_n += 1
            log(f"FAIL {cid}: {r.get('error')}")

    # 更新 lastSeenBudget（非 dry-run 且成功）
    if not dry_run and ok_n:
        rows = load_baseline(sid)
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for r in results:
            if not r.get("ok"):
                continue
            row = rows.get(r["campaignId"])
            if not row:
                continue
            row.lastSeenBudget = float(r["target"])
            row.mode = mode
            row.updatedAt = now
            rows[r["campaignId"]] = row
        save_baseline(sid, rows)

    summary = {
        "shopId": sid,
        "mode": mode,
        "dryRun": dry_run,
        "planned": len(plan),
        "todo": len(todo),
        "skipped": len(skipped),
        "ok": ok_n,
        "failed": fail_n,
        "skippedDetail": skipped,
        "results": results,
        "finishedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    path = last_run_path(sid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"last_run → {path}")
    return summary


def load_failed_ids(shop_id: str) -> set[str]:
    path = last_run_path(shop_id)
    if not path.is_file():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    out: set[str] = set()
    for r in data.get("results") or []:
        if r.get("ok"):
            continue
        cid = str(r.get("campaignId") or "").strip()
        if cid:
            out.add(cid)
    return out
