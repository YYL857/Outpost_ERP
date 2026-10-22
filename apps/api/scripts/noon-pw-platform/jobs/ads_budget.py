# -*- coding: utf-8 -*-
"""
广告预算峰期切换 job。

用法:
  python main.py ads-budget probe
  python main.py ads-budget sync
  python main.py ads-budget sync --refresh-baseline
  python main.py ads-budget apply
  python main.py ads-budget apply --mode offpeak
  python main.py ads-budget apply --mode peak --dry-run
  python main.py ads-budget apply --only-failed

环境变量:
  OUTPOST_ADS_BUDGET_SHOPS         白名单，默认 PRJ488078
  OUTPOST_ADS_BUDGET_BATCH         分批大小，默认 15
  OUTPOST_ADS_BUDGET_SCROLL_ROUNDS 每页滚动上限，默认 20
  OUTPOST_ADS_BUDGET_MAX_PAGES     sync 翻页上限，默认 50
  OUTPOST_ADS_PW_HEADLESS          1=无头（默认有头）
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ads_budget.apply import apply_plan, load_failed_ids, plan_changes  # noqa: E402
from ads_budget.baseline_store import (  # noqa: E402
    baseline_path,
    merge_live_snapshot,
    parse_shop_whitelist,
    save_baseline,
)
from ads_budget.page_live import (  # noqa: E402
    filter_live_only,
    open_shop_campaigns,
    probe_page,
    scrape_live_campaigns,
)
from ads_budget.run_log import record_run  # noqa: E402
from ads_budget.windows import describe_windows, resolve_mode  # noqa: E402
from noon_login_autofill import otp_auto_enabled  # noqa: E402
from runtime import ADS_PROFILE, LOG_DIR, headless_default, with_browser  # noqa: E402
from session_sync import (  # noqa: E402
    has_sso_cookies,
    looks_like_auth_fail,
    run_unified_login,
    try_recover_session_for_export,
)


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _parse_argv(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="ads-budget")
    p.add_argument(
        "cmd",
        choices=("probe", "sync", "apply", "login", "ui", "help"),
        help="probe|sync|apply|login；ui 等同 probe",
    )
    p.add_argument(
        "--refresh-baseline",
        action="store_true",
        help="sync 时用页面当前预算覆盖 baseline（仅人工高峰同步时用）",
    )
    p.add_argument(
        "--mode",
        choices=("auto", "offpeak", "peak", "idle"),
        default="auto",
        help="apply 目标模式；默认 auto 按北京时间",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印将改谁，不点页面",
    )
    p.add_argument(
        "--only-failed",
        action="store_true",
        help="只重试上次 last_run.json 失败的 campaignId",
    )
    p.add_argument(
        "--shops",
        default="",
        help="覆盖白名单，逗号分隔；默认 OUTPOST_ADS_BUDGET_SHOPS",
    )
    return p.parse_args(argv)


def _ensure_ads_session_or_login() -> bool:
    """
    启动前检查 Ad Manager SSO cookie；没有则走统一登录（IMAP OTP）。
    夜间定时几乎必掉登录态，sync/apply 共用。
    返回 True=可继续开浏览器；False=OTP 未开或登录失败。
    """
    if has_sso_cookies(ADS_PROFILE):
        log("preflight: Ad Manager SSO cookie 仍在")
        return True
    log("preflight: 无 Ad Manager SSO cookie（会话多半已掉）")
    if not otp_auto_enabled():
        log("preflight: OUTPOST_NOON_OTP_AUTO=0，已显式关闭无人值守")
        return False
    # 与 ads 导出同一入口：发码 + IMAP 取码 + 双写 storage_state
    ok = try_recover_session_for_export("ads-budget preflight: 无 SSO cookie")
    if ok:
        log("preflight: 统一登录 OK")
        return True
    log("preflight: 统一登录失败（勿改人工登录；查 IMAP / Welcome Back 链路）")
    return False


def _shops_for_args(args: argparse.Namespace) -> list[str]:
    if args.shops.strip():
        return [s.strip().upper() for s in args.shops.split(",") if s.strip()]
    return parse_shop_whitelist()


def _record_top_level_failure(
    *,
    cmd: str,
    args: argparse.Namespace,
    error: str,
    started_at: str,
    started_mono: float,
) -> None:
    """
    预检登录失败 / with_browser 抛异常等「根本没跑起来」的路径也要留痕。
    最小字段；不写 results（一店都没跑）。
    """
    mode = resolve_mode() if args.mode == "auto" else args.mode
    shops = _shops_for_args(args)
    trigger = (os.environ.get("OUTPOST_ADS_BUDGET_TRIGGER") or "manual").strip() or "manual"
    duration_ms = int((time.monotonic() - started_mono) * 1000)
    msg = f"{cmd}/{mode} ok=False top-level fail: {error[:160]}"
    try:
        hist = record_run(
            {
                "ok": False,
                "cmd": cmd,
                "mode": str(mode),
                "startedAt": started_at,
                "durationMs": duration_ms,
                "error": error,
                "trigger": trigger,
                "shops": shops,
                "message": msg,
            }
        )
        log(f"history → finishedAtCst={hist.get('finishedAtCst')} ok=False (top-level)")
    except Exception as e:
        log(f"record_run failed after top-level error: {e}")


async def _run_for_shops(cmd: str, args: argparse.Namespace) -> tuple[int, str]:
    shops = _shops_for_args(args)
    if not shops:
        log("白名单为空，退出")
        return 2, "白名单为空"

    mode = resolve_mode() if args.mode == "auto" else args.mode
    log(f"windows: {describe_windows()}")
    log(f"shops={shops} cmd={cmd} mode={mode} dry_run={args.dry_run}")

    headed = not headless_default()
    started_mono = time.monotonic()
    started_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    async def fn(context, page):
        results = []
        for sid in shops:
            shop_t0 = time.monotonic()
            scrape_ms = 0
            apply_ms = 0
            log(f"==== shop {sid} ====")
            try:
                await open_shop_campaigns(page, sid)
                await filter_live_only(page)
                if cmd == "probe":
                    info = await probe_page(page)
                    log(json.dumps(info, ensure_ascii=False, indent=2))
                    results.append(
                        {
                            "shopId": sid,
                            "probe": info,
                            "durationMs": int((time.monotonic() - shop_t0) * 1000),
                        }
                    )
                    continue

                scrape_t0 = time.monotonic()
                live = await scrape_live_campaigns(page)
                scrape_ms = int((time.monotonic() - scrape_t0) * 1000)
                if not live and cmd in ("sync", "apply"):
                    # 避免登录墙下「0 行却当成功」
                    raise RuntimeError(
                        "疑似未登录或列表为空：Live 抓取 0 条（若在登录/OTP 页请走统一登录重试）"
                    )

                if cmd == "sync":
                    rows, stats = merge_live_snapshot(
                        sid,
                        live,
                        refresh_baseline=bool(args.refresh_baseline),
                        mode=str(mode),
                    )
                    path = save_baseline(sid, rows)
                    log(f"sync stats={stats} → {path}")
                    results.append(
                        {
                            "shopId": sid,
                            "stats": stats,
                            "path": str(path),
                            "durationMs": int((time.monotonic() - shop_t0) * 1000),
                            "scrapeMs": scrape_ms,
                        }
                    )
                    continue

                # apply：先轻量刷新 lastSeen（不改 baseline）
                rows, stats = merge_live_snapshot(
                    sid, live, refresh_baseline=False, mode=str(mode)
                )
                save_baseline(sid, rows)
                log(f"pre-apply snapshot stats={stats} path={baseline_path(sid)}")

                if mode == "idle":
                    log("mode=idle，不改预算")
                    results.append(
                        {
                            "shopId": sid,
                            "mode": "idle",
                            "skipped": True,
                            "durationMs": int((time.monotonic() - shop_t0) * 1000),
                            "scrapeMs": scrape_ms,
                        }
                    )
                    continue

                only_failed = load_failed_ids(sid) if args.only_failed else None
                if args.only_failed and not only_failed:
                    log("only-failed 但无失败记录，跳过")
                    results.append(
                        {
                            "shopId": sid,
                            "onlyFailedEmpty": True,
                            "durationMs": int((time.monotonic() - shop_t0) * 1000),
                            "scrapeMs": scrape_ms,
                        }
                    )
                    continue

                plan = plan_changes(rows, mode, only_failed_ids=only_failed)  # type: ignore[arg-type]
                needs_baseline_n = sum(
                    1
                    for item in plan
                    if item.get("skip") and item.get("reason") == "needs_baseline"
                )
                for item in plan:
                    tag = "SKIP" if item.get("skip") else "SET"
                    log(
                        f"  {tag} {item.get('psku')} {item['campaignId']} "
                        f"{item.get('from')} → {item.get('to')} {item.get('reason') or ''}"
                    )
                apply_t0 = time.monotonic()
                summary = await apply_plan(
                    page, sid, mode, plan, dry_run=bool(args.dry_run)  # type: ignore[arg-type]
                )
                apply_ms = int((time.monotonic() - apply_t0) * 1000)
                summary["durationMs"] = int((time.monotonic() - shop_t0) * 1000)
                summary["scrapeMs"] = scrape_ms
                summary["applyMs"] = apply_ms
                summary["needsBaselineCount"] = needs_baseline_n
                results.append(summary)
                if summary.get("failed"):
                    log(f"shop {sid} 有 {summary['failed']} 条失败")
            except Exception as e:
                log(f"shop {sid} ERROR: {e}")
                results.append(
                    {
                        "shopId": sid,
                        "error": str(e),
                        "durationMs": int((time.monotonic() - shop_t0) * 1000),
                        "scrapeMs": scrape_ms,
                        "applyMs": apply_ms,
                    }
                )
        return results

    results = await with_browser(
        profile=ADS_PROFILE,
        persist=False,
        headed=headed,
        fn=fn,
    )
    duration_ms = int((time.monotonic() - started_mono) * 1000)
    fail = sum(1 for r in (results or []) if r.get("error") or (r.get("failed") or 0) > 0)
    err_blob = " ".join(
        str(r.get("error") or "") for r in (results or []) if r.get("error")
    )
    ok_n = sum(int(r.get("ok") or 0) for r in (results or []) if isinstance(r, dict))
    fail_n = sum(int(r.get("failed") or 0) for r in (results or []) if isinstance(r, dict))
    needs_baseline_total = sum(
        int(r.get("needsBaselineCount") or 0)
        for r in (results or [])
        if isinstance(r, dict)
    )
    # 写总日志（单次快照）
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = LOG_DIR / f"ads_budget_{cmd}_{stamp}.json"
    out.write_text(
        json.dumps({"cmd": cmd, "mode": mode, "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log(f"log → {out}")

    # 追加历史 + last 摘要（明早看成功时间用这个）
    trigger = (os.environ.get("OUTPOST_ADS_BUDGET_TRIGGER") or "manual").strip() or "manual"
    msg = (
        f"{cmd}/{mode} ok={fail == 0} shops={len(shops)} "
        f"applyOk={ok_n} applyFail={fail_n} needsBaseline={needs_baseline_total}"
        + (f" err={err_blob[:120]}" if err_blob else "")
    )
    hist = record_run(
        {
            "cmd": cmd,
            "mode": str(mode),
            "ok": fail == 0,
            "shops": shops,
            "dryRun": bool(args.dry_run),
            "trigger": trigger,
            "message": msg,
            "applyOk": ok_n,
            "applyFailed": fail_n,
            "needsBaselineCount": needs_baseline_total,
            "startedAt": started_at,
            "durationMs": duration_ms,
            "error": err_blob or None,
            "snapshotLog": str(out),
            "results": results,
        }
    )
    log(f"history → finishedAtCst={hist.get('finishedAtCst')} ok={hist.get('ok')}")
    last_txt = r"D:\outpost-data\pw-rpa\ads-budget-last.txt"
    if hist:
        log(f"last → {last_txt}")
    return (1 if fail else 0, err_blob)


def run(argv: list[str] | None = None) -> int:
    raw = list(argv if argv is not None else sys.argv[1:])
    # main.py 传入的是 cmd + 其余；兼容单独跑本文件
    if raw and raw[0] in ("ads-budget", "ads_budget"):
        raw = raw[1:]
    if not raw:
        raw = ["help"]
    # ui → probe
    if raw[0] == "ui":
        raw[0] = "probe"
    if raw[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    if raw[0] == "login":
        return run_unified_login()

    args = _parse_argv(raw)
    cmd = args.cmd
    if cmd == "ui":
        cmd = "probe"

    started_mono = time.monotonic()
    started_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # sync / apply / probe 共用：先保登录态，再开浏览器（夜间定时必经）
    # 登录失败禁止再开有头窗等人手填——无人值守默认开，失败只记日志退出
    if cmd in ("sync", "apply", "probe"):
        if not _ensure_ads_session_or_login():
            err = (
                "无法保证登录态：无人值守登录失败。"
                "请查 IMAP / OUTPOST_NOON_LOGIN_EMAIL；不要人工在弹窗里登。"
            )
            log(err)
            _record_top_level_failure(
                cmd=cmd,
                args=args,
                error=err,
                started_at=started_at,
                started_mono=started_mono,
            )
            return 1
        # 允许进页后再 login 一次（preflight 已登过则下面撞墙不会重复，因 TRIED）
        os.environ.pop("OUTPOST_NOON_EXPORT_LOGIN_TRIED", None)

    async def _once() -> tuple[int, str]:
        return await _run_for_shops(cmd, args)

    try:
        code, err_blob = asyncio.run(_once())
        if code == 0:
            return 0
        if looks_like_auth_fail(err_blob) and try_recover_session_for_export(err_blob):
            log("auth recovered via unified login（IMAP OTP），整轮重试…")
            os.environ.pop("OUTPOST_NOON_EXPORT_LOGIN_TRIED", None)
            code2, _ = asyncio.run(_once())
            return code2
        if err_blob and not looks_like_auth_fail(err_blob):
            log(f"失败但未识别为登录墙，不自动 OTP。err={err_blob[:200]}")
        return code
    except KeyboardInterrupt:
        log("interrupted")
        return 130
    except Exception as e:
        msg = str(e)
        log(f"fatal: {msg}")
        if looks_like_auth_fail(msg) and try_recover_session_for_export(msg):
            log("auth recovered via unified login，整轮重试…")
            try:
                os.environ.pop("OUTPOST_NOON_EXPORT_LOGIN_TRIED", None)
                code2, _ = asyncio.run(_once())
                return code2
            except Exception as e2:
                log(f"retry fatal: {e2}")
                _record_top_level_failure(
                    cmd=cmd,
                    args=args,
                    error=str(e2),
                    started_at=started_at,
                    started_mono=started_mono,
                )
                return 1
        _record_top_level_failure(
            cmd=cmd,
            args=args,
            error=msg,
            started_at=started_at,
            started_mono=started_mono,
        )
        return 1


def main(argv: list[str] | None = None) -> int:
    """供 main.py 调用：传入 ads-budget 之后的参数，如 ['sync', '--refresh-baseline']。"""
    return run(list(argv) if argv is not None else None)


if __name__ == "__main__":
    raise SystemExit(run())
