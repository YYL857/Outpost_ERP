# -*- coding: utf-8 -*-
"""
Noon 卖家后台向导 · Playwright 补链（非 pw-rpa 生产 job）

用法（PowerShell）:
  cd D:\\Outpost_ERP\\apps\\api
  $env:OUTPOST_YD_GUIDE_SHOP="PRJ396770"
  $env:OUTPOST_YD_GUIDE_SECTION="all"   # payments|fbp|health|vantage|all
  python scripts/noon-guide-capture-pw/main.py

依赖 Seller Lab storage_state:
  D:\\outpost-data\\browser-profiles\\noon-seller-pw\\storage_state.json
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from capture import SHOP_ID, SECTION_ENV, run_all  # noqa: E402

SELLER_PROFILE = Path(
    os.environ.get(
        "OUTPOST_SELLER_PW_PROFILE",
        r"D:\outpost-data\browser-profiles\noon-seller-pw",
    )
)
# 默认用 persistent profile（Chrome 用户目录里 cookie 通常比单独 storage_state 新）
# OUTPOST_GUIDE_PW_PERSIST=0 则只用 storage_state.json
USE_PERSIST = os.environ.get("OUTPOST_GUIDE_PW_PERSIST", "1").strip().lower() not in (
    "0",
    "false",
    "no",
)
LOGIN_WAIT_S = int(os.environ.get("OUTPOST_GUIDE_PW_LOGIN_WAIT", "180"))


def pw_channel():
    channel = os.environ.get("OUTPOST_ADS_PW_CHANNEL", "chrome").strip() or None
    if channel in ("-", "none", "chromium"):
        return None
    return channel


def headed() -> bool:
    # 默认有头；OUTPOST_GUIDE_PW_HEADLESS=1 才无头
    return os.environ.get("OUTPOST_GUIDE_PW_HEADLESS", "0").strip().lower() not in (
        "1",
        "true",
        "yes",
    )


def _loginish(url: str) -> bool:
    u = (url or "").lower()
    return any(x in u for x in ("login", "sign-in", "signin", "auth0"))


async def _wait_for_login(page, *, timeout_s: int) -> None:
    """有头时留给人工登录；超时仍停在 login 则报错。"""
    if not _loginish(page.url):
        return
    if not headed():
        raise RuntimeError(
            f"未登录（{page.url}）。请有头运行并完成 Partners 登录，或先: "
            "python scripts/noon-pw-platform/main.py sales login"
        )
    print(
        f"[noon-guide-pw] ★ 请在 {timeout_s}s 内完成 Partners 登录"
        f"（当前 {page.url[:100]}）…",
        flush=True,
    )
    deadline = __import__("time").time() + timeout_s
    while __import__("time").time() < deadline:
        await page.wait_for_timeout(2000)
        if not _loginish(page.url) and "noon.partners" in (page.url or "").lower():
            print(f"[noon-guide-pw] 登录已检测到: {page.url[:120]}", flush=True)
            return
    raise RuntimeError(
        f"登录等待超时（仍停在 {page.url}）。"
        "请先: cd scripts/noon-pw-platform && python main.py sales login"
    )


async def with_seller_browser(fn):
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise SystemExit(
            "缺少 playwright。请: pip install playwright && python -m playwright install chromium"
        ) from e

    state_path = SELLER_PROFILE / "storage_state.json"
    SELLER_PROFILE.mkdir(parents=True, exist_ok=True)
    if not USE_PERSIST and not state_path.is_file():
        raise SystemExit(
            f"缺少登录态: {state_path}\n"
            "请先 python scripts/noon-pw-platform/main.py sales login"
        )

    channel = pw_channel()
    init_script = (
        "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
    )
    is_headed = headed()

    async with async_playwright() as p:
        browser = None
        context = None
        try:
            if USE_PERSIST:
                kwargs = dict(
                    user_data_dir=str(SELLER_PROFILE),
                    headless=not is_headed,
                    accept_downloads=True,
                    viewport={"width": 1400, "height": 900},
                    args=["--disable-blink-features=AutomationControlled"],
                    locale="en-US",
                    ignore_default_args=["--enable-automation"],
                )
                if channel:
                    kwargs["channel"] = channel
                print(
                    f"[noon-guide-pw] persistent context → {SELLER_PROFILE}",
                    flush=True,
                )
                context = await p.chromium.launch_persistent_context(**kwargs)
                await context.add_init_script(init_script)
                page = context.pages[0] if context.pages else await context.new_page()
            else:
                launch_kw = dict(
                    headless=not is_headed,
                    args=["--disable-blink-features=AutomationControlled"],
                    ignore_default_args=["--enable-automation"],
                )
                if channel:
                    launch_kw["channel"] = channel
                browser = await p.chromium.launch(**launch_kw)
                context = await browser.new_context(
                    storage_state=str(state_path),
                    accept_downloads=True,
                    viewport={"width": 1400, "height": 900},
                    locale="en-US",
                )
                await context.add_init_script(init_script)
                page = await context.new_page()

            # 先摸一下登录态
            try:
                await page.goto(
                    "https://noon-store.noon.partners/",
                    wait_until="domcontentloaded",
                    timeout=90_000,
                )
                await page.wait_for_timeout(2000)
            except Exception as e:
                print(f"[noon-guide-pw] 预热 goto 警告: {e}", flush=True)
            await _wait_for_login(page, timeout_s=LOGIN_WAIT_S)

            result = await fn(page)
            try:
                await context.storage_state(path=str(state_path))
            except Exception:
                pass
            return result
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass
            if browser:
                try:
                    await browser.close()
                except Exception:
                    pass


async def main() -> int:
    print(
        f"[noon-guide-pw] shop={SHOP_ID} section={SECTION_ENV} "
        f"profile={SELLER_PROFILE} headed={headed()}",
        flush=True,
    )

    async def _run(page):
        return await run_all(page)

    summary = await with_seller_browser(_run)
    ok = int(summary.get("items_ok") or 0)
    total = int(summary.get("items_total") or 0)
    print(f"[noon-guide-pw] result ok={ok}/{total}", flush=True)
    # 部分成功仍 exit 0，全失败 exit 2
    if total == 0:
        return 2
    if ok == 0:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
