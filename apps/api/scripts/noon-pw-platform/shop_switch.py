# -*- coding: utf-8 -*-
"""按店铺切 Ad Manager / Seller Lab 账号，避免 URL 带 project 仍停在上一店。

Ad Manager 顶栏有两套下拉，切勿点错：
  - 顶部项目/店铺：文案含 PRJ396770 + 店名（要切的是这个）
  - 下方广告主：文案像「100252 | HUI Beauty」（不是切店）
"""
from __future__ import annotations

import os
import re


def shop_labels() -> dict[str, str]:
    raw = (os.environ.get("OUTPOST_YD_ADS_SHOP_LABELS") or "").strip()
    out: dict[str, str] = {}
    for part in re.split(r"[,;]", raw):
        part = part.strip()
        if ":" not in part:
            continue
        key, val = part.split(":", 1)
        kid = key.strip().upper()
        if kid and val.strip():
            out[kid] = val.strip()
    return out


def needles_for(shop_id: str) -> list[str]:
    sid = shop_id.strip().upper()
    out: list[str] = [sid]
    lab = shop_labels().get(sid, "")
    if lab:
        out.append(lab)
        if "|" in lab:
            out.append(lab.split("|")[-1].strip())
    seen: set[str] = set()
    uniq: list[str] = []
    for n in out:
        k = n.upper()
        if not n or k in seen:
            continue
        seen.add(k)
        uniq.append(n)
    return uniq


def text_matches(text: str, shop_id: str) -> bool:
    t = (text or "").upper()
    if not t:
        return False
    for n in needles_for(shop_id):
        if n.upper() in t:
            return True
    return False


def url_has_project(url: str, shop_id: str) -> bool:
    """URL 是否已带目标 project=PRJ…（query 或 path）。"""
    u = (url or "").upper()
    sid = shop_id.strip().upper()
    if not sid:
        return False
    if f"PROJECT={sid}" in u.replace("&AMP;", "&"):
        return True
    # 宽松：…project=PRJ396770…
    return bool(re.search(rf"PROJECT[=:]{re.escape(sid)}\b", u))


async def project_chip_text(page) -> str:
    """顶栏项目切换器文案（含 PRJ…）；不要广告主「数字 | 名」。"""
    try:
        data = await page.evaluate(
            """() => {
              const nodes = document.querySelectorAll(
                'button,[role="button"],[role="combobox"],[aria-haspopup="listbox"],a'
              );
              let best = '';
              for (const n of nodes) {
                const t = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim();
                if (!t || t.length > 120) continue;
                if (!/PRJ\\d+/i.test(t)) continue;
                // 排除明显广告主「123 | Name」且不含 PRJ 的（已用 PRJ 过滤）
                const rect = n.getBoundingClientRect();
                if (rect.width < 8 || rect.height < 8) continue;
                // 优先靠近顶栏（y 小）
                if (!best) best = t;
                else if (rect.top < 120) best = t;
              }
              return best;
            }"""
        )
        return str(data or "")
    except Exception:
        return ""


async def advertiser_header_text(page) -> str:
    """下方广告主头（仅日志用），形如 100252 | HUI Beauty。"""
    try:
        data = await page.evaluate(
            """() => {
              const nodes = document.querySelectorAll(
                'button,[role="button"],[role="combobox"],[aria-haspopup="listbox"]'
              );
              for (const n of nodes) {
                const t = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim();
                if (!t || t.length > 80) continue;
                if (/PRJ\\d+/i.test(t)) continue;
                if (/\\d{3,}\\s*\\|/.test(t)) return t;
              }
              return '';
            }"""
        )
        return str(data or "")
    except Exception:
        return ""


async def header_text(page) -> str:
    """兼容旧调用：优先项目 chip，其次广告主头。"""
    proj = await project_chip_text(page)
    if proj:
        return proj
    return await advertiser_header_text(page)


async def open_project_switcher(page, shop_id: str) -> bool:
    """只打开顶部项目/店铺切换器，禁止点广告主「数字 | 名」。"""
    sid = shop_id.strip().upper()
    sels: list[str] = []
    if sid:
        # 已在目标店时 chip 上就有 PRJ id
        chunk = sid.replace("'", "\\'")
        sels.append(f"button:has-text('{chunk}')")
        sels.append(f"[role=button]:has-text('{chunk}')")
        sels.append(f"[role=combobox]:has-text('{chunk}')")
    # 任意含 PRJ 的顶栏按钮（先于「含 |」的广告主）
    sels.extend(
        [
            "button:has-text('PRJ')",
            "[role=button]:has-text('PRJ')",
            "[role=combobox]:has-text('PRJ')",
        ]
    )
    for sel in sels:
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=2500)
            # 再确认不是广告主头
            txt = ((await loc.inner_text()) or "").replace("\n", " ").strip()
            if re.match(r"^\d{3,}\s*\|", txt) and "PRJ" not in txt.upper():
                print(f"[shop-switch] 跳过广告主头 {txt[:40]!r}", flush=True)
                continue
            if "PRJ" not in txt.upper() and sid and sid not in txt.upper():
                # 宽松：允许店名 chip；若完全不像项目切换则跳过
                if not text_matches(txt, sid) and len(txt) < 3:
                    continue
            await loc.click(timeout=2500)
            print(f"[shop-switch] 打开项目切换器 {sel[:80]} text={txt[:50]!r}", flush=True)
            return True
        except Exception:
            continue

    # 兜底：evaluate 点第一个含 PRJ 且靠顶栏的可点击节点
    try:
        ok = await page.evaluate(
            """() => {
              const nodes = [...document.querySelectorAll(
                'button,[role="button"],[role="combobox"],[aria-haspopup="listbox"]'
              )];
              const scored = [];
              for (const n of nodes) {
                const t = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim();
                if (!/PRJ\\d+/i.test(t)) continue;
                if (/^\\d{3,}\\s*\\|/.test(t)) continue;
                const r = n.getBoundingClientRect();
                if (r.top > 160 || r.width < 8) continue;
                scored.push({ n, top: r.top });
              }
              scored.sort((a, b) => a.top - b.top);
              if (!scored.length) return false;
              scored[0].n.click();
              return true;
            }"""
        )
        if ok:
            print("[shop-switch] 打开项目切换器（顶栏 PRJ DOM）", flush=True)
            return True
    except Exception as e:
        print(f"[shop-switch] DOM 点项目切换失败: {e}", flush=True)
    return False


async def open_switcher(page) -> bool:
    """旧名兼容：改为打开项目切换器（无 shop_id 时用 PRJ 兜底）。"""
    return await open_project_switcher(page, "")


async def click_shop_option(page, shop_id: str) -> bool:
    for needle in needles_for(shop_id):
        locators = [
            page.get_by_role("option", name=re.compile(re.escape(needle), re.I)),
            page.locator(f"[role='menuitem']:has-text('{needle}')"),
            page.locator(f"[role='option']:has-text('{needle}')"),
            page.get_by_text(needle, exact=False),
        ]
        for loc in locators:
            try:
                await loc.first.click(timeout=2500)
                print(f"[shop-switch] 点选项 {needle}", flush=True)
                return True
            except Exception:
                continue
    return False


async def page_permission_denied(page) -> bool:
    """Ad Manager 对无权 project 会弹 All Organizations + sufficient permissions。"""
    try:
        blob = await page.evaluate(
            """() => {
              const body = (document.body && document.body.innerText) || '';
              const title = document.title || '';
              return (body + ' ' + title).toLowerCase();
            }"""
        )
        t = str(blob or "")
        return (
            "sufficient permissions" in t
            or "do not have sufficient permission" in t
            or "没有足够权限" in t
            or "无权查看" in t
            or "无权访问" in t
        )
    except Exception:
        return False


async def ensure_shop(page, shop_id: str, *, kind: str) -> None:
    sid = shop_id.strip().upper()
    url = page.url or ""
    proj = await project_chip_text(page)
    adv = await advertiser_header_text(page)
    denied = await page_permission_denied(page)
    print(
        f"[shop-switch] {kind} want={sid} label={shop_labels().get(sid, '')!r} "
        f"url={url} projectChip={proj!r} advertiser={adv!r} denied={denied}",
        flush=True,
    )
    # URL 带 project= 但权限弹窗已出：绝不能当成「已在该店」
    if denied:
        raise RuntimeError(
            f"账号下拉找不到店铺 {sid}（{shop_labels().get(sid, '')}）—"
            f"Ad Manager 显示无权限。当前 projectChip={proj!r}"
        )

    url_hit = url_has_project(url, sid)
    chip_hit = text_matches(proj, sid) or (sid in (proj or "").upper())

    # URL 已是目标 project，且顶栏 PRJ chip 一致（或找不到 chip 但无权限弹窗）→ 已在店
    if url_hit and (chip_hit or not proj):
        print(f"[shop-switch] 已在 {sid}（URL project" + (" + 顶栏 chip" if chip_hit else "") + "）", flush=True)
        return

    # URL 对了但顶栏显示别的 PRJ → 必须切
    if url_hit and proj and not chip_hit:
        print(
            f"[shop-switch] URL 已是 {sid} 但顶栏仍是 {proj!r}，打开项目切换器",
            flush=True,
        )
    elif not url_hit:
        print(f"[shop-switch] URL 未命中 {sid}，打开项目切换器", flush=True)

    opened = await open_project_switcher(page, sid)
    if opened:
        await page.wait_for_timeout(700)
        if not await click_shop_option(page, sid):
            try:
                await page.keyboard.press("Escape")
            except Exception:
                pass
            raise RuntimeError(
                f"项目下拉找不到店铺 {sid}（{shop_labels().get(sid, '')}）。"
                f"当前 projectChip={proj!r}"
            )
        await page.wait_for_timeout(2500)
        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass
        if await page_permission_denied(page):
            raise RuntimeError(
                f"项目下拉找不到店铺 {sid}（{shop_labels().get(sid, '')}）—"
                "切店后仍无权限"
            )
    elif not url_hit and not chip_hit:
        raise RuntimeError(
            f"无法打开项目切换器，且当前不是 {sid}。url={page.url} projectChip={proj!r}"
        )

    url2 = page.url or ""
    proj2 = await project_chip_text(page)
    if await page_permission_denied(page):
        raise RuntimeError(
            f"切店后仍不是 {sid}（无权限）。url={url2} projectChip={proj2!r}"
        )
    if not url_has_project(url2, sid) and not text_matches(proj2, sid):
        raise RuntimeError(f"切店后仍不是 {sid}。url={url2} projectChip={proj2!r}")
    print(f"[shop-switch] OK {sid} url={url2} projectChip={proj2!r}", flush=True)
