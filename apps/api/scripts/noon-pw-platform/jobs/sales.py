# -*- coding: utf-8 -*-
"""
Seller Lab Sales 导出（对照影刀 outpost_noon_sales_export）。
深链带日期、不点 Status；Export → New export；落盘后清洗三态。
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import (  # noqa: E402
    LOG_DIR,
    SELLER_HOME,
    SELLER_PROFILE,
    click_first,
    goto_resilient,
    headless_default,
    with_browser,
)
from session_sync import is_auth_gate  # noqa: E402
from shop_switch import ensure_shop  # noqa: E402

_BRIDGE_DIR = Path(r"D:\YingDao\Flows\_lib")
if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))
import outpost_bridge as bridge  # noqa: E402

STATUSES = ("Delivered", "Processing", "Shipped")
KEEP = {s.lower() for s in STATUSES}
LOOKBACK = max(1, int(os.environ.get("OUTPOST_YD_SALES_LOOKBACK_DAYS", "90") or "90"))
SALES_FROM = os.environ.get("OUTPOST_YD_SALES_FROM", "").strip()
SALES_TO = os.environ.get("OUTPOST_YD_SALES_TO", "").strip()
STATE_PATH = SELLER_PROFILE / "storage_state.json"


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def date_range() -> tuple[str, str]:
    if SALES_FROM and SALES_TO:
        a, b = SALES_FROM, SALES_TO
        return (a, b) if a <= b else (b, a)
    to_d = datetime.now().date()
    from_d = to_d - timedelta(days=LOOKBACK - 1)
    return from_d.isoformat(), to_d.isoformat()


def sales_url(shop_id: str, from_ymd: str, to_ymd: str) -> str:
    sid = shop_id.strip().upper()
    return (
        f"{SELLER_HOME}?project={sid}&from_date={from_ymd}&to_date={to_ymd}"
    )


def split_csv_line(line: str) -> list[str]:
    return next(csv.reader(io.StringIO(line)))


def filter_keep_statuses(path: Path) -> tuple[int, int]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return 0, 0
    headers = [h.strip().lower() for h in split_csv_line(lines[0])]
    try:
        i_status = headers.index("status")
    except ValueError:
        log("[clean] 无 status 列，跳过清洗")
        return max(0, len(lines) - 1), 0
    kept_lines = [lines[0]]
    kept = dropped = 0
    for line in lines[1:]:
        cols = split_csv_line(line)
        st = (cols[i_status] if i_status < len(cols) else "").strip().lower()
        if st and st not in KEEP:
            dropped += 1
            continue
        kept_lines.append(line)
        kept += 1
    path.write_text("\n".join(kept_lines) + "\n", encoding="utf-8-sig")
    log(f"[clean] kept={kept} dropped={dropped} → {path.name}")
    return kept, dropped


def deliver(src: Path, shop_id: str, from_ymd: str, to_ymd: str) -> dict:
    dest_name = bridge.sales_export_name(from_ymd, to_ymd)
    portal = bridge.deliver_to_portal(src, dest_name=dest_name, shop_id=shop_id)
    kept, dropped = filter_keep_statuses(Path(portal))
    return {
        "shop_id": shop_id,
        "from": from_ymd,
        "to": to_ymd,
        "path": str(portal),
        "rows": kept,
        "dropped": dropped,
    }


async def _export_one(context, page, shop_id: str, from_ymd: str, to_ymd: str) -> dict:
    sid = shop_id.strip().upper()
    dest_dir = bridge.shop_download_dir(sid)
    dest_dir.mkdir(parents=True, exist_ok=True)
    url = sales_url(sid, from_ymd, to_ymd)
    log(f"[shop] {sid} → {url}")
    await goto_resilient(page, url)
    try:
        await page.wait_for_load_state("networkidle", timeout=25_000)
    except Exception:
        pass
    try:
        await page.locator("text=Export").first.wait_for(state="visible", timeout=30_000)
    except Exception:
        pass
    if is_auth_gate(page.url or ""):
        raise RuntimeError("疑似未登录 Seller Lab。请先 python main.py sales login")
    await ensure_shop(page, sid, kind="sales")
    if sid.lower() not in (page.url or "").lower():
        log(f"[shop] 二次打开深链 {url}")
        await goto_resilient(page, url)
        await ensure_shop(page, sid, kind="sales")
        if sid.lower() not in (page.url or "").lower():
            raise RuntimeError(
                f"销量页未落到 {sid}。url={page.url}。请确认该店在同一 Seller Lab 账号下。"
            )

    try:
        cdp = await context.new_cdp_session(page)
        await cdp.send(
            "Browser.setDownloadBehavior",
            {
                "behavior": "allow",
                "downloadPath": str(dest_dir),
                "eventsEnabled": True,
            },
        )
    except Exception as e:
        log(f"[download] CDP allow 跳过: {e}")

    dest = dest_dir / f"{sid}_sales_export_{from_ymd}_{to_ymd}.csv"
    log("[sales] 跳过 Status 点选 → Export → New export → 点文件旁下载图标")
    since = time.time()
    downloaded = await _handle_export_and_download(page, dest_dir, dest, sid, since)
    if not downloaded.is_file() or downloaded.stat().st_size < 80:
        raise RuntimeError(f"下载文件异常: {downloaded}")
    log(f"[download] {sid} → {downloaded} ({downloaded.stat().st_size} bytes)")
    info = deliver(downloaded, sid, from_ymd, to_ymd)
    log(f"[done][{sid}] portal={info['path']} kept={info['rows']}")
    return info


async def _click_export_header(page) -> None:
    await click_first(
        page,
        [
            "role=button[name='Export']",
            "button:has-text('Export')",
            "text='Export'",
        ],
        timeout_ms=5000,
        label="export",
    )


async def _export_modal_open(page) -> bool:
    try:
        loc = page.locator("text=Export File").first
        return await loc.is_visible()
    except Exception:
        return False


async def _wait_export_modal(page, timeout_ms: int = 20_000) -> None:
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if await _export_modal_open(page):
            log("[export] Export File 弹窗已出现")
            return
        await page.wait_for_timeout(400)
    raise RuntimeError("Export File 弹窗未出现")


async def _click_new_export(page) -> None:
    await click_first(
        page,
        [
            "role=button[name='New export']",
            "button:has-text('New export')",
            "text='New export'",
        ],
        timeout_ms=8000,
        label="new-export",
    )


async def _click_download_icon(page) -> str:
    """Playwright 点文件名右侧下载图标（JS click 不会触发 download 事件）。"""
    file_loc = page.locator("text=/sales_export/i").first
    await file_loc.wait_for(state="visible", timeout=8000)
    selectors = [
        "xpath=following::button[1]",
        "xpath=following::a[1]",
        "xpath=following::*[@role='button'][1]",
        "xpath=ancestor::*[self::div or self::tr][2]//button[not(contains(normalize-space(.),'New export'))][not(contains(normalize-space(.),'Cancel'))][last()]",
    ]
    last = None
    for rel in selectors:
        try:
            icon = file_loc.locator(rel).first
            await icon.wait_for(state="visible", timeout=2500)
            lab = (await icon.inner_text()).strip()
            if re.search(r"new export|cancel", lab, re.I):
                continue
            await icon.click(timeout=4000)
            log(f"[export] Playwright 已点下载控件 {rel} lab={lab!r}")
            return f"ok:pw:{rel}"
        except Exception as e:
            last = e
    raise RuntimeError(f"Playwright 点不中下载图标: {last}")


def _looks_like_sales_csv(path: Path) -> bool:
    name = path.name.lower()
    if "sales" in name:
        return True
    if path.suffix.lower() not in (".csv", ".xlsx"):
        return False
    try:
        head = path.read_bytes()[:800].decode("utf-8-sig", errors="replace").lower()
        return "partner_sku" in head or "gmv_lcy" in head
    except Exception:
        return False


def _newest_csv(dest_dir: Path, since: float) -> Path | None:
    cands = []
    for d in (dest_dir, bridge.DOWNLOAD_DIR, Path(r"D:\Downloads"), Path.home() / "Downloads"):
        if not d.is_dir():
            continue
        for p in d.iterdir():
            if not p.is_file():
                continue
            if p.name.endswith((".crdownload", ".tmp", ".partial")):
                continue
            if p.stat().st_mtime < since - 2:
                continue
            if not _looks_like_sales_csv(p):
                continue
            cands.append(p)
    if not cands:
        return None
    cands.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return cands[0]


async def _save_download(download, dest: Path) -> Path:
    await download.save_as(str(dest))
    return dest


async def _handle_export_and_download(
    page, dest_dir: Path, dest: Path, shop_id: str, since: float
) -> Path:
    await _click_export_header(page)
    await _wait_export_modal(page)
    log("[export] 点 New export 按当前日期重新生成")
    await _click_new_export(page)
    await page.wait_for_timeout(1500)

    deadline = time.time() + 180
    reopen = 0
    while time.time() < deadline:
        hit = _newest_csv(dest_dir, since)
        if hit:
            log(f"[export] 已自动落盘 → {hit.name}")
            if hit.resolve() != dest.resolve():
                dest.write_bytes(hit.read_bytes())
                return dest
            return hit

        modal = await _export_modal_open(page)
        has_file = False
        try:
            has_file = await page.locator("text=/sales_export/i").first.is_visible()
        except Exception:
            has_file = False
        log(f"[probe] modal={'ok' if modal else 'no'} file={'ok' if has_file else 'no'}")

        if modal and has_file:
            try:
                async with page.expect_download(timeout=60_000) as dl_info:
                    await _click_download_icon(page)
                download = await dl_info.value
                return await _save_download(download, dest)
            except Exception as e:
                log(f"[export] 点图标后未捕获 download: {e}")
                hit2 = _newest_csv(dest_dir, since)
                if hit2:
                    dest.write_bytes(hit2.read_bytes())
                    return dest

        if not modal and reopen < 3 and time.time() > since + 12 + reopen * 25:
            reopen += 1
            log(f"[export] 弹窗已关，第 {reopen} 次重开 Export 再点下载图标")
            try:
                await _click_export_header(page)
                await _wait_export_modal(page)
            except Exception as e:
                log(f"[export] 重开失败: {e}")
                await page.wait_for_timeout(2000)
                continue
            try:
                async with page.expect_download(timeout=60_000) as dl_info:
                    await _click_download_icon(page)
                download = await dl_info.value
                return await _save_download(download, dest)
            except Exception as e:
                log(f"[export] 重开后点图标失败: {e}")

        await page.wait_for_timeout(2000)

    raise RuntimeError(f"{shop_id} New export 超时：未见 sales_export 落盘")


async def cmd_login():
    log(
        f"[login] seller profile={SELLER_PROFILE}；"
        "请在弹出的 Chrome 完成登录/邮箱验证码。脚本只等待、不会刷新或提前关窗。"
    )

    def _auth_url(u: str) -> bool:
        low = (u or "").lower()
        return any(
            x in low
            for x in (
                "login.noon.partners",
                "accounts.google.com",
                "/signin",
                "/sign-in",
                "/otp",
                "login",
                "sign-in",
                "signin",
            )
        )

    async def run(context, page):
        await goto_resilient(page, SELLER_HOME)
        log("[login] 若已发送验证码请耐心等邮件；窗口会保留约 15 分钟")
        # 与广告 login 对齐：15 分钟，鉴权页期间绝不 goto/reload
        for _ in range(300):
            u = page.url or ""
            if not _auth_url(u):
                try:
                    await context.storage_state(path=str(STATE_PATH))
                except Exception:
                    pass
                log(f"[login] 已离开登录页 url={u[:120]}")
                return {"ok": True, "url": page.url, "profile": str(SELLER_PROFILE)}
            await page.wait_for_timeout(3000)
        return {"ok": False, "error": "login timeout (15min)", "url": page.url}

    return await with_browser(
        profile=SELLER_PROFILE, persist=True, headed=True, fn=run
    )


async def cmd_ui():
    shops = bridge.parse_shop_ids()
    from_ymd, to_ymd = date_range()
    if not STATE_PATH.is_file():
        raise RuntimeError("无 Seller Lab cookie。请先 python main.py sales login")
    log(f"[ui] sales shops={shops} {from_ymd}→{to_ymd}")

    async def run(context, page):
        results, errors = [], []
        for i, sid in enumerate(shops):
            try:
                log(f"======== [{i+1}/{len(shops)}] {sid} ========")
                results.append(await _export_one(context, page, sid, from_ymd, to_ymd))
            except Exception as e:
                errors.append(f"{sid}: {e}")
                log(f"[FAIL][{sid}] {e}")
                traceback.print_exc()
        if not results:
            raise RuntimeError("全部店铺销量导出失败: " + " | ".join(errors))
        payload = {
            "mode": "pw-sales-ui",
            "from": from_ymd,
            "to": to_ymd,
            "results": results,
            "errors": errors,
        }
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        p = LOG_DIR / f"sales_export_pw_ok_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload

    return await with_browser(
        profile=SELLER_PROFILE,
        persist=False,
        headed=not headless_default(),
        fn=run,
    )


def main(cmd: str) -> int:
    import asyncio

    if cmd == "login":
        # 与广告共用：同窗一次 OTP，双写 storage_state
        from session_sync import run_unified_login

        return run_unified_login()
    if cmd == "ui":
        from session_sync import looks_like_auth_fail, try_recover_session_for_export

        def _run_ui() -> dict:
            return asyncio.run(cmd_ui())

        try:
            r = _run_ui()
        except Exception as e:
            log(f"[fatal] {e}")
            if looks_like_auth_fail(str(e)) and try_recover_session_for_export(str(e)):
                try:
                    r = _run_ui()
                except Exception as e2:
                    log(f"[fatal] 重登后仍失败: {e2}")
                    return 1
            else:
                return 1
        blob = json.dumps(r, ensure_ascii=False)
        if r.get("errors") and looks_like_auth_fail(blob):
            if try_recover_session_for_export(blob):
                try:
                    r = _run_ui()
                except Exception as e:
                    log(f"[fatal] 重登后仍失败: {e}")
                    return 1
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 1 if r.get("errors") else 0
    log("sales 用法: ui | login")
    return 2
