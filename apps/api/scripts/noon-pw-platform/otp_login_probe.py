# -*- coding: utf-8 -*-
"""
强制过期登录态 → 自动邮箱 OTP 登录 → 抓业务页证据。

用法：
  python main.py keepalive otp-probe

成功标准（写进 RESULT）：
  1) 开跑前已清掉 storage_state（模拟过期）
  2) OUTPOST_NOON_OTP_AUTO=1，日志含自动填邮箱 / IMAP 取码
  3) 登录后能打开 Ad Manager 或 Seller 业务页，并留下截图+页面文案
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from noon_login_autofill import login_email, otp_auto_enabled  # noqa: E402
from email_otp import imap_configured  # noqa: E402
from runtime import (  # noqa: E402
    ADS_HOME,
    ADS_PROFILE,
    SELLER_HOME,
    SELLER_PROFILE,
    with_browser,
)
from session_sync import (  # noqa: E402
    _ads_ready,
    _seller_ready,
    goto_once,
    is_auth_gate,
    run_unified_login,
)


OUT_ROOT = Path(
    os.environ.get("OUTPOST_OTP_PROBE_DIR", r"D:\outpost-data\otp-auto-test")
)


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _backup_and_clear_states(run_dir: Path) -> list[dict]:
    """备份并删除两套 storage_state，强制下次走登录。"""
    info = []
    bak = run_dir / "cleared-states"
    bak.mkdir(parents=True, exist_ok=True)
    for label, profile in (("ads", ADS_PROFILE), ("seller", SELLER_PROFILE)):
        state = profile / "storage_state.json"
        row = {"label": label, "path": str(state), "existed": state.is_file()}
        if state.is_file():
            dest = bak / f"{label}_storage_state.json"
            shutil.copy2(state, dest)
            state.unlink()
            row["backedUpTo"] = str(dest)
            row["cleared"] = True
            log(f"[probe] 已清除 {label} storage_state → 备份 {dest.name}")
        else:
            row["cleared"] = False
            log(f"[probe] {label} 本无 storage_state（已是过期/未登录）")
        info.append(row)
    return info


async def _capture_site(
    profile: Path,
    url: str,
    label: str,
    ready_fn,
    shot_path: Path,
) -> dict:
    """用刚写入的 storage_state 有头打开业务页，截图+抽文案。"""

    async def run(context, page):
        await goto_once(page, url, attempts=2, timeout_ms=90_000)
        await page.wait_for_timeout(3000)
        cur = page.url or ""
        title = ""
        try:
            title = await page.title()
        except Exception:
            pass
        snip = ""
        try:
            snip = ((await page.inner_text("body")) or "").replace("\n", " ")
            snip = " ".join(snip.split())[:400]
        except Exception:
            pass
        auth = is_auth_gate(cur, snip, title)
        ready = bool(ready_fn(cur)) and not auth
        try:
            await page.screenshot(path=str(shot_path), full_page=False)
        except Exception as e:
            log(f"[probe] 截图失败 {label}: {e}")
        return {
            "ok": ready,
            "label": label,
            "url": cur,
            "title": title,
            "authGate": auth,
            "snippet": snip,
            "screenshot": str(shot_path) if shot_path.is_file() else None,
        }

    return await with_browser(
        profile=profile, persist=False, headed=True, fn=run
    )


def _write_human_result(run_dir: Path, payload: dict) -> Path:
    ok = bool(payload.get("ok"))
    lines = [
        f"结果: {'PASS 成功' if ok else 'FAIL 失败'}",
        f"时间: {payload.get('finishedAt')}",
        f"目录: {run_dir}",
        "",
        "检查项:",
        f"  - 已清登录态: {payload.get('clearedOk')}",
        f"  - OTP_AUTO 开: {payload.get('otpAuto')}",
        f"  - IMAP 已配: {payload.get('imapConfigured')}",
        f"  - 统一登录 ok: {payload.get('loginOk')}",
        f"  - 业务页证据 ok: {payload.get('evidenceOk')}",
        "",
        f"说明: {payload.get('message')}",
        "",
    ]
    ev = payload.get("evidence") or {}
    for k, v in ev.items():
        if not isinstance(v, dict):
            continue
        lines.append(f"[{k}] ok={v.get('ok')} url={v.get('url')}")
        lines.append(f"  title={v.get('title')}")
        lines.append(f"  shot={v.get('screenshot')}")
        lines.append(f"  snip={(v.get('snippet') or '')[:160]}")
        lines.append("")
    name = "PASS.txt" if ok else "FAIL.txt"
    path = run_dir / name
    path.write_text("\n".join(lines), encoding="utf-8")
    (run_dir / "RESULT.txt").write_text("\n".join(lines), encoding="utf-8")
    return path


def run_otp_login_probe() -> int:
    import asyncio

    run_dir = OUT_ROOT / _stamp()
    run_dir.mkdir(parents=True, exist_ok=True)
    log(f"[probe] 输出目录 {run_dir}")

    # 强制开自动 OTP（本探针用途）
    os.environ["OUTPOST_NOON_OTP_AUTO"] = "1"

    pre = {
        "otpAuto": otp_auto_enabled(),
        "imapConfigured": imap_configured(),
        "loginEmail": login_email(),
        "startedAt": datetime.now().isoformat(timespec="seconds"),
    }
    if not pre["imapConfigured"] or not pre["loginEmail"]:
        payload = {
            **pre,
            "ok": False,
            "clearedOk": False,
            "loginOk": False,
            "evidenceOk": False,
            "finishedAt": datetime.now().isoformat(timespec="seconds"),
            "message": "缺少 OUTPOST_NOON_LOGIN_EMAIL 或 IMAP USER/PASS，无法测自动取码",
        }
        (run_dir / "result.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        _write_human_result(run_dir, payload)
        log(f"[probe] FAIL: {payload['message']}")
        return 1

    cleared = _backup_and_clear_states(run_dir)
    cleared_ok = all(
        (not c["existed"]) or c.get("cleared") for c in cleared
    )

    log("[probe] 开始统一登录（应走邮箱 OTP 自动回填）…")
    # run_unified_login 自己会写 log JSON；这里再包一层
    code = run_unified_login()
    login_ok = code == 0

    evidence: dict = {}
    evidence_ok = False
    if login_ok:
        log("[probe] 登录返回 OK，抓业务页证据（有头）…")
        try:
            evidence["ads"] = asyncio.run(
                _capture_site(
                    ADS_PROFILE,
                    ADS_HOME,
                    "ads",
                    _ads_ready,
                    run_dir / "evidence_ads.png",
                )
            )
        except Exception as e:
            evidence["ads"] = {"ok": False, "error": str(e)}
            log(f"[probe] ads 证据失败: {e}")
        try:
            evidence["seller"] = asyncio.run(
                _capture_site(
                    SELLER_PROFILE,
                    SELLER_HOME,
                    "seller",
                    _seller_ready,
                    run_dir / "evidence_seller.png",
                )
            )
        except Exception as e:
            evidence["seller"] = {"ok": False, "error": str(e)}
            log(f"[probe] seller 证据失败: {e}")
        evidence_ok = bool(
            (evidence.get("ads") or {}).get("ok")
            or (evidence.get("seller") or {}).get("ok")
        )
    else:
        log("[probe] 统一登录未成功，跳过业务页证据")

    ok = bool(cleared_ok and login_ok and evidence_ok)
    msg = (
        "自动清登录态 → OTP 登录 → 业务页可见，判定成功"
        if ok
        else (
            "失败："
            + (
                "登录未过；"
                if not login_ok
                else ""
            )
            + (
                "登录后未见业务页数据；"
                if login_ok and not evidence_ok
                else ""
            )
            + (
                "清登录态异常；"
                if not cleared_ok
                else ""
            )
        ).rstrip("；")
    )

    payload = {
        **pre,
        "ok": ok,
        "clearedOk": cleared_ok,
        "cleared": cleared,
        "loginOk": login_ok,
        "loginExitCode": code,
        "evidenceOk": evidence_ok,
        "evidence": evidence,
        "finishedAt": datetime.now().isoformat(timespec="seconds"),
        "message": msg,
        "runDir": str(run_dir),
    }
    (run_dir / "result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    human = _write_human_result(run_dir, payload)
    # 最新指针，方便明天一眼看
    latest = OUT_ROOT / "LATEST"
    latest.write_text(
        f"{'PASS' if ok else 'FAIL'}\n{run_dir}\n{human}\n{msg}\n",
        encoding="utf-8",
    )
    log(f"[probe] {'PASS' if ok else 'FAIL'} → {human}")
    log(f"[probe] 摘要 {OUT_ROOT / 'LATEST'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(run_otp_login_probe())
