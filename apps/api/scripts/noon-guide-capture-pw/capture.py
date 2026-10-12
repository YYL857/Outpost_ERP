# -*- coding: utf-8 -*-
"""Noon Seller Lab 菜单补链：侧栏点击 / 种子 URL / 同域扫链。"""
from __future__ import annotations

import csv
import json
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

SHOP_ID = os.environ.get("OUTPOST_YD_GUIDE_SHOP", "PRJ396770").strip().upper()
SECTION_ENV = os.environ.get("OUTPOST_YD_GUIDE_SECTION", "all").strip().lower()
OUT_ROOT = Path(
    os.environ.get(
        "OUTPOST_YD_GUIDE_OUT",
        r"D:\outpost-data\noon-guide-capture",
    )
)
STORE_HOME = "https://noon-store.noon.partners/"
FBP_SEED = "https://fbp.noon.partners/en-sa/directship/picklist/?project={project}"
WAIT_MS = int(float(os.environ.get("OUTPOST_YD_GUIDE_WAIT", "4")) * 1000)

# 侧栏点不开时的直达候选（采到真 URL 后以地址栏为准；404 会判失败）
URL_CANDIDATES: dict[str, list[str]] = {
    "Statements": [
        "https://finance.noon.partners/en/statements?project={project}",
        "https://finance.noon.partners/en-sa/statements?project={project}",
        "https://payments.noon.partners/en/statements?project={project}",
        "https://payments.noon.partners/en-sa/statements?project={project}",
        "https://financeweb.noon.partners/en/statements?project={project}",
    ],
    "Statement Of Account": [
        "https://finance.noon.partners/en/statement-of-account?project={project}",
        "https://finance.noon.partners/en/soa?project={project}",
        "https://payments.noon.partners/en/statement-of-account?project={project}",
        "https://finance.noon.partners/en-sa/statement-of-account?project={project}",
    ],
    "Invoices & Creditnotes": [
        "https://finance.noon.partners/en/invoices?project={project}",
        "https://finance.noon.partners/en/invoices-and-creditnotes?project={project}",
        "https://payments.noon.partners/en/invoices?project={project}",
        "https://finance.noon.partners/en-sa/invoices?project={project}",
    ],
    "Transaction View": [
        "https://finance.noon.partners/en/transaction-view?project={project}",
        "https://finance.noon.partners/en/transactions?project={project}",
        "https://payments.noon.partners/en/transaction-view?project={project}",
        "https://finance.noon.partners/en-sa/transaction-view?project={project}",
    ],
    "Exports": [
        "https://finance.noon.partners/en/exports?project={project}",
        "https://payments.noon.partners/en/exports?project={project}",
        "https://finance.noon.partners/en-sa/exports?project={project}",
    ],
    "Manifestation": [
        "https://directship.noon.partners/en/handovers?project={project}",
        "https://directship.noon.partners/en/handover?project={project}",
    ],
    "Packaging Materials": [
        "https://fbp.noon.partners/en-sa/packing/orders/?project={project}",
    ],
    "Reputation Management": [
        "https://noon-reputation.noon.partners/en/?project={project}",
    ],
    "Vantage Analytics": [
        "https://vantage.noon.partners/en/?project={project}",
    ],
}

# 写入 landingUrl 时丢掉的瞬时查询参数
STRIP_QUERY_KEYS = {
    "lc",
    "limits",
    "page",
    "from_date",
    "to_date",
    "fromDate",
    "toDate",
    "limit",
    "offset",
    "activeTab",
    "pageSize",
    "whCode",
}

# guide id ↔ 侧栏英文（与 noon-seller-guide / 影刀 SECTION_DEFS 对齐）
SECTION_DEFS: dict[str, dict[str, Any]] = {
    "payments": {
        "parent": "Payments & Fees",
        "probe": "Statements",
        "seed": None,
        "items": [
            ("payments-statement", "Statements"),
            ("payments-soa", "Statement Of Account"),
            ("payments-invoices", "Invoices & Creditnotes"),
            ("payments-transactions", "Transaction View"),
            ("payments-exports", "Exports"),
        ],
    },
    "fbp": {
        "parent": "Fulfilled by Partner",
        "probe": "Directship",
        "seed": FBP_SEED,
        "items": [
            ("fbp-directship", "Directship"),
            ("fbp-picklists", "Directship Picklists"),
            ("fbp-direct-delivery", "Direct Delivery Shipments"),
            ("fbp-return-manifest", "Return Manifestation"),
            ("fbp-delivery-returns", "Delivery Returns"),
            ("fbp-manifestation", "Manifestation"),
            ("fbp-customer-returns", "Customer Returns"),
            ("fbp-oos-logs", "Out of Stock Logs"),
            ("fbp-packaging", "Packaging Materials"),
            ("fbp-reports", "Reports"),
            ("fbp-warehouse", "Warehouse"),
        ],
    },
    "health": {
        "parent": "Account Health & Reports",
        "probe": "Reputation Management",
        "seed": None,
        "items": [
            ("health", "Reputation Management"),
        ],
    },
    "vantage": {
        "parent": "Vantage Analytics",
        "probe": "Vantage Analytics",
        "seed": None,
        "items": [
            ("vantage", "Vantage Analytics"),
        ],
    },
}


@dataclass
class CaptureRow:
    seq: int
    section: str
    guide_id: str
    item: str
    click_path: str
    page_title: str
    url: str
    landing_template: str
    shot: str
    shot_status: str
    ok: bool
    nav_mode: str
    error: str = ""
    captured_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def log(*args: Any) -> None:
    print("[noon-guide-pw]", *args, flush=True)


def slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", text.strip().lower()).strip("_")
    return s or "item"


def normalize_landing(url: str) -> str:
    if not url:
        return ""
    try:
        u = urlparse(url)
        qs = parse_qs(u.query, keep_blank_values=True)
        flat: dict[str, str] = {}
        for k, vals in qs.items():
            if k in STRIP_QUERY_KEYS or k.lower() in STRIP_QUERY_KEYS:
                continue
            if k.lower() == "project":
                flat[k] = "{project}"
            else:
                flat[k] = vals[0] if vals else ""
        # tab=rtv 等业务态保留
        path = u.path
        path = re.sub(r"/en/STR[^/]+/", "/en/{store}/", path, count=1)
        new_q = urlencode(flat) if flat else ""
        return urlunparse((u.scheme, u.netloc, path, "", new_q, ""))
    except Exception:
        return url.replace(SHOP_ID, "{project}")


def is_store_home(url: str) -> bool:
    u = (url or "").lower()
    return "noon-store.noon.partners" in u and "/home" in u


def looks_logged_out(url: str, title: str) -> bool:
    blob = f"{url} {title}".lower()
    return any(
        x in blob
        for x in (
            "login",
            "sign-in",
            "signin",
            "auth0",
            "fault filter abort",
            "access denied",
        )
    )


async def page_meta(page) -> dict[str, str]:
    try:
        data = await page.evaluate(
            """() => {
              const h1 = document.querySelector('h1');
              const h2 = document.querySelector('h2');
              const title =
                (h1 && (h1.innerText || '').trim()) ||
                (h2 && (h2.innerText || '').trim()) ||
                (document.title || '').trim();
              return {
                url: location.href || '',
                title: title,
                path: location.pathname || '',
                docTitle: document.title || '',
              };
            }"""
        )
        return {k: str(v or "") for k, v in (data or {}).items()}
    except Exception:
        return {
            "url": page.url,
            "title": "",
            "path": "",
            "docTitle": "",
        }


async def fault_aborted(page) -> bool:
    try:
        html = await page.content()
        return "fault filter abort" in (html or "").lower()
    except Exception:
        return False


async def goto_resilient(page, url: str) -> None:
    last = None
    for wait in ("domcontentloaded", "commit"):
        try:
            await page.goto(url, wait_until=wait, timeout=90_000)
            await page.wait_for_timeout(WAIT_MS)
            return
        except Exception as e:
            last = e
            await page.wait_for_timeout(1500)
    raise RuntimeError(f"打开页面失败: {last}") from last


async def menu_probe_visible(page) -> bool:
    """汉堡打开后应能看见 Catalog / Payments 等一级入口。"""
    for label in (
        "Catalog",
        "Payments & Fees",
        "Fulfilled by Partner",
        "Advertising",
        "Vantage Analytics",
    ):
        try:
            loc = page.get_by_text(label, exact=True).first
            if await loc.is_visible(timeout=400):
                return True
        except Exception:
            continue
    return False


async def open_hamburger(page) -> bool:
    """对齐影刀：点 noon logo 左侧按钮；打开后校验菜单文案可见。"""
    if await menu_probe_visible(page):
        log("hamburger", "already-open")
        return True

    result = await page.evaluate(
        """() => {
          function visible(el) {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.top < 120;
          }
          function clickEl(el) {
            try { el.click(); return true; } catch (e) { return false; }
          }
          const header = document.querySelector('header') || document.body;
          let logo = null;
          header.querySelectorAll('img,svg,a,span,div').forEach((el) => {
            if (logo) return;
            const al = ((el.getAttribute('alt') || '') + ' ' +
              (el.getAttribute('aria-label') || '') + ' ' +
              (el.textContent || '')).toLowerCase();
            const r = el.getBoundingClientRect();
            if (r.top < 90 && r.left < 220 && r.width > 20 && /noon/.test(al)) logo = el;
          });
          if (!logo) {
            header.querySelectorAll('*').forEach((el) => {
              if (logo) return;
              const t = (el.textContent || '').trim().toLowerCase();
              const r = el.getBoundingClientRect();
              if (t === 'noon' && r.top < 90 && r.left < 220 && r.width < 120 && el.children.length < 3)
                logo = el;
            });
          }
          if (logo) {
            const lr = logo.getBoundingClientRect();
            let best = null, bestDx = 1e9;
            header.querySelectorAll('button,[role="button"],a').forEach((el) => {
              if (!visible(el)) return;
              const r = el.getBoundingClientRect();
              if (r.left >= lr.left) return;
              if (r.width < 18 || r.width > 72 || r.height < 18 || r.height > 72) return;
              const dx = lr.left - r.right;
              if (dx >= -4 && dx < bestDx) { best = el; bestDx = dx; }
            });
            if (best && clickEl(best)) return 'logo-left';
          }
          const cands = [];
          document.querySelectorAll('button,[role="button"],a').forEach((el) => {
            const al = ((el.getAttribute('aria-label') || '') + ' ' +
              (el.getAttribute('title') || '')).toLowerCase();
            if (/menu|navigation|nav|sidebar|drawer|hamburger/.test(al) &&
                visible(el) && el.getBoundingClientRect().left < 120) cands.push(el);
          });
          header.querySelectorAll('button,[role="button"]').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.top < 80 && r.left < 100 && r.width > 20 && r.width < 64 &&
                r.height > 20 && r.height < 64) cands.push(el);
          });
          document.querySelectorAll('button svg, [role="button"] svg').forEach((svg) => {
            const el = svg.closest('button,[role="button"],a');
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (r.top < 80 && r.left < 120) cands.push(el);
          });
          const seen = [];
          for (const el of cands) {
            if (seen.includes(el)) continue;
            seen.push(el);
            if (clickEl(el)) return 'cand';
          }
          return false;
        }"""
    )
    await page.wait_for_timeout(900)
    if result and await menu_probe_visible(page):
        log("hamburger", result)
        return True

    # Playwright 选择器再试
    for sel in (
        "button[aria-label*='menu' i]",
        "button[aria-label*='Menu' i]",
        "header button:has(svg)",
    ):
        try:
            loc = page.locator(sel).first
            await loc.wait_for(state="visible", timeout=1500)
            await loc.click(timeout=1500)
            await page.wait_for_timeout(900)
            if await menu_probe_visible(page):
                log("hamburger", sel[:80])
                return True
        except Exception:
            continue

    # 坐标：logo 左侧常见位置
    for x, y in ((28, 28), (40, 32), (56, 36), (20, 40)):
        try:
            await page.mouse.click(x, y)
            await page.wait_for_timeout(700)
            if await menu_probe_visible(page):
                log("hamburger", f"mouse({x},{y})")
                return True
        except Exception:
            continue

    log("hamburger", "FAILED open")
    return False


async def js_click_visible_text(page, text: str, *, prefer_nav: bool = True) -> bool:
    ok = await page.evaluate(
        """({ needle, preferNav }) => {
          function isVisible(el) {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
            if (parseFloat(style.opacity || '1') < 0.05) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            const vw = window.innerWidth || 0;
            const vh = window.innerHeight || 0;
            if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
            return true;
          }
          const roots = [];
          if (preferNav) {
            document.querySelectorAll(
              'aside,nav,[role="navigation"],[class*="drawer"],[class*="Drawer"],[class*="sidebar"],[class*="SideBar"],[class*="menu"]'
            ).forEach((r) => roots.push(r));
          }
          if (!roots.length) roots.push(document.body);
          let best = null;
          let bestArea = 1e12;
          function scan(root) {
            const nodes = root.querySelectorAll('a,button,[role="button"],[role="menuitem"],span,div,li,p');
            for (const n of nodes) {
              if (n.children && n.children.length > 8) continue;
              if (!isVisible(n)) continue;
              const t = (n.innerText || '').replace(/\\s+/g, ' ').trim();
              if (t !== needle && !t.startsWith(needle + ' ')) continue;
              // exact preferred; allow "Vantage Analytics New"
              if (t !== needle && !(needle.length >= 8 && t.toLowerCase().startsWith(needle.toLowerCase()))) continue;
              const r = n.getBoundingClientRect();
              const area = r.width * r.height;
              if (area < bestArea) { best = n; bestArea = area; }
            }
          }
          for (const r of roots) scan(r);
          if (!best) scan(document.body);
          if (!best) return false;
          let el = best;
          for (let j = 0; j < 8 && el; j++) {
            const tag = (el.tagName || '').toLowerCase();
            const role = el.getAttribute && el.getAttribute('role');
            if (tag === 'a' || tag === 'button' || role === 'button' || role === 'menuitem' || el.onclick) {
              el.click();
              return true;
            }
            el = el.parentElement;
          }
          best.click();
          return true;
        }""",
        {"needle": text, "preferNav": prefer_nav},
    )
    if ok:
        await page.wait_for_timeout(WAIT_MS)
        log("js-click", repr(text))
    return bool(ok)


async def try_cmdk(page, text: str) -> bool:
    try:
        await page.keyboard.press("Control+k")
        await page.wait_for_timeout(600)
        # 输入框
        box = page.locator(
            "input[type='search'], input[placeholder*='Search' i], [role='combobox'] input, [cmdk-input], input"
        ).first
        await box.wait_for(state="visible", timeout=2500)
        await box.fill("")
        await box.type(text, delay=40)
        await page.wait_for_timeout(700)
        # 点结果
        opt = page.get_by_role("option", name=re.compile(re.escape(text), re.I)).first
        try:
            await opt.click(timeout=2000)
        except Exception:
            await page.keyboard.press("Enter")
        await page.wait_for_timeout(WAIT_MS)
        log("cmdk", repr(text))
        return True
    except Exception as e:
        log("cmdk-fail", repr(text), str(e)[:120])
        try:
            await page.keyboard.press("Escape")
        except Exception:
            pass
        return False


async def collect_nav_links(page, *, include_hidden: bool = True) -> list[dict[str, str]]:
    """收集 noon.partners 链接。include_hidden=True 时含抽屉里隐藏 DOM（汉堡关着也能扫到）。"""
    try:
        return await page.evaluate(
            """({ includeHidden }) => {
              const out = [];
              const seen = new Set();
              const nodes = document.querySelectorAll('a[href]');
              for (const a of nodes) {
                const href = a.href || a.getAttribute('href') || '';
                if (!href || href.startsWith('javascript:')) continue;
                let u;
                try { u = new URL(href, location.href); } catch { continue; }
                if (!u.hostname.endsWith('noon.partners')) continue;
                if (!includeHidden) {
                  const style = window.getComputedStyle(a);
                  const r = a.getBoundingClientRect();
                  if (style.display === 'none' || style.visibility === 'hidden') continue;
                  if (r.width < 1 && r.height < 1) continue;
                }
                const text = (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
                const key = u.origin + u.pathname.replace(/\\/$/, '') + '|' + text;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                  text,
                  url: u.origin + u.pathname + u.search,
                  path: u.pathname,
                  host: u.hostname,
                });
              }
              return out;
            }""",
            {"includeHidden": include_hidden},
        )
    except Exception:
        return []


def match_link(links: list[dict[str, str]], item: str) -> str | None:
    needle = item.strip().lower()
    prefer_host_bits: list[str] = []
    if needle in (
        "statements",
        "statement of account",
        "invoices & creditnotes",
        "transaction view",
    ) or (needle == "exports" and True):
        # Payments Exports ≠ Catalog Exports
        if needle == "exports":
            prefer_host_bits = ["finance", "payment"]
        else:
            prefer_host_bits = ["finance", "payment"]

    def host_ok(l: dict[str, str]) -> bool:
        if not prefer_host_bits:
            return True
        h = (l.get("host") or l.get("url") or "").lower()
        return any(b in h for b in prefer_host_bits)

    ranked = sorted(links, key=lambda l: (0 if host_ok(l) else 1))

    # exact text
    for l in ranked:
        t = (l.get("text") or "").strip().lower()
        # Packaging Materials ↔ Packaging Material
        text_hit = (
            t == needle
            or t.startswith(needle + " ")
            or (needle.endswith("s") and t == needle[:-1])
            or (not needle.endswith("s") and t == needle + "s")
        )
        if text_hit:
            if needle == "exports" and not host_ok(l) and "catalog" in (l.get("url") or "").lower():
                continue
            return l.get("url")
    # path heuristics
    path_hints = {
        "statements": ["/statements", "/statement"],
        "statement of account": ["/soa", "/statement-of-account", "/statementofaccount"],
        "invoices & creditnotes": ["/invoice", "/creditnote"],
        "transaction view": ["/transaction"],
        "exports": ["/export"],
        "directship": ["/directship"],
        "directship picklists": ["/picklist"],
        "direct delivery shipments": ["/direct-delivery", "/directdelivery"],
        "return manifestation": ["/return-manifest", "/returnmanifest"],
        "delivery returns": ["/delivery-return"],
        "manifestation": ["/manifestation"],
        "customer returns": ["/customer-return", "fbp-returns"],
        "out of stock logs": ["/stocklog", "/oos", "/out-of-stock"],
        "packaging materials": ["/packing", "/packaging"],
        "reports": ["/exports", "/report"],
        "warehouse": ["/warehouse"],
        "reputation management": ["/reputation", "/account-health", "/health"],
        "vantage analytics": ["/vantage", "analytics"],
        "payments & fees": ["/finance", "/payment"],
    }
    hints = path_hints.get(needle, [])
    # avoid Reports matching fbnreports when on fbp host
    for l in ranked:
        path = (l.get("path") or "").lower()
        text = (l.get("text") or "").lower()
        url = (l.get("url") or "").lower()
        if needle == "reports" and "fbn" in path:
            continue
        if needle == "manifestation" and "return" in path:
            continue
        if needle == "exports" and ("catalog" in path or "catalog" in url):
            continue
        if prefer_host_bits and not host_ok(l):
            continue
        for h in hints:
            if h in path or h.replace("-", "") in path.replace("-", ""):
                if needle in text or not text or len(text) < 40:
                    return l.get("url")
        if needle in text and any(h.strip("/") in path for h in hints):
            return l.get("url")
    return None


async def ensure_project(page, project: str) -> None:
    url = page.url
    if f"project={project}" in url or f"project={project.lower()}" in url:
        return
    if "noon.partners" not in url:
        return
    try:
        u = urlparse(url)
        qs = parse_qs(u.query, keep_blank_values=True)
        qs["project"] = [project]
        flat = {k: v[0] if v else "" for k, v in qs.items()}
        new = urlunparse((u.scheme, u.netloc, u.path, "", urlencode(flat), ""))
        await goto_resilient(page, new)
    except Exception as e:
        log("ensure-project skip", e)


async def is_missing_page(page) -> bool:
    try:
        data = await page.evaluate(
            """() => {
              const body = (document.body && document.body.innerText || '').slice(0, 2500);
              const title = (document.title || '').trim();
              const h1 = (document.querySelector('h1') && document.querySelector('h1').innerText || '').trim();
              return { body, title, h1 };
            }"""
        )
        body = (data.get("body") or "").lower()
        title = (data.get("title") or "").lower()
        h1 = (data.get("h1") or "").lower()
        if title == "404" or h1 == "404":
            return True
        if "this page could not be found" in body:
            return True
        if "404" in body and (
            "missing" in body or "not found" in body or "page is missing" in body
        ):
            return True
        # Next.js 极简 404：正文很短且含 404
        if "404" in body and len(body.strip()) < 80:
            return True
        return False
    except Exception:
        return False


async def probe_url_candidates(page, item: str) -> tuple[bool, str]:
    """试候选直达 URL；成功离开 store/home 且非 404。"""
    cands = list(URL_CANDIDATES.get(item) or [])
    # Packaging：侧栏真链
    if item == "Packaging Materials":
        cands.insert(
            0,
            "https://fbp.noon.partners/en-sa/packing/orders/?project={project}",
        )
    for tpl in cands:
        url = tpl.format(project=SHOP_ID)
        try:
            await goto_resilient(page, url)
            await page.wait_for_timeout(1800)
            meta = await page_meta(page)
            if await fault_aborted(page):
                continue
            if looks_logged_out(page.url, meta.get("title", "")):
                continue
            if await is_missing_page(page):
                log("probe 404", url[:100])
                continue
            if (meta.get("title") or "").strip() == "404":
                log("probe 404 title", url[:100])
                continue
            if is_store_home(page.url):
                continue
            log("probe OK", item, page.url[:110], "title=", meta.get("title"))
            return True, "url-probe"
        except Exception as e:
            log("probe fail", url[:80], str(e)[:80])
    return False, ""


async def navigate_to_item(
    page,
    *,
    parent: str,
    item: str,
    start_url: str,
) -> tuple[str, str]:
    """返回 (nav_mode, error)."""
    # 0) 先扫当前页 DOM 里隐藏菜单链接（Store 常把全站链预埋进抽屉）
    await goto_resilient(page, start_url)
    await ensure_project(page, SHOP_ID)
    links = await collect_nav_links(page, include_hidden=True)
    href = match_link(links, item)
    if not href and parent:
        # 父级名有时带整块 submenu 的入口
        href = match_link(links, parent)
        if href and parent.lower() not in item.lower():
            # 先打开父级落地再扫子链
            try:
                await goto_resilient(page, href)
                await ensure_project(page, SHOP_ID)
                sub = await collect_nav_links(page, include_hidden=True)
                href = match_link(sub, item)
            except Exception:
                href = None
    if href:
        await goto_resilient(page, href)
        await ensure_project(page, SHOP_ID)
        if not await is_missing_page(page) and not is_store_home(page.url):
            return "dom-href", ""

    # 1) 汉堡 + 展开父级 + 点子项
    await goto_resilient(page, start_url)
    await ensure_project(page, SHOP_ID)
    opened = await open_hamburger(page)
    if opened:
        if parent and parent != item:
            await js_click_visible_text(page, parent, prefer_nav=True)
            await page.wait_for_timeout(600)
        if await js_click_visible_text(page, item, prefer_nav=True):
            return "sidebar", ""
        links = await collect_nav_links(page, include_hidden=True)
        href = match_link(links, item)
        if href:
            await goto_resilient(page, href)
            await ensure_project(page, SHOP_ID)
            if not await is_missing_page(page):
                return "href-scan", ""

    # 2) 全页可见链接文本
    if await js_click_visible_text(page, item, prefer_nav=False):
        return "page-text", ""

    # 3) Ctrl+K
    await goto_resilient(page, start_url)
    await ensure_project(page, SHOP_ID)
    if await try_cmdk(page, item):
        if not is_store_home(page.url):
            return "cmdk", ""

    # 4) 直达候选探测
    ok, mode = await probe_url_candidates(page, item)
    if ok:
        return mode, ""

    return "fail", f"侧栏/链接/CmdK/URL探测 均未命中 {item!r}"


async def capture_section(page, section_key: str) -> list[CaptureRow]:
    defn = SECTION_DEFS[section_key]
    parent: str = defn["parent"]
    items: list[tuple[str, str]] = defn["items"]
    seed_tpl: str | None = defn.get("seed")

    out_dir = OUT_ROOT / SHOP_ID / section_key
    shots = out_dir / "shots"
    shots.mkdir(parents=True, exist_ok=True)

    rows: list[CaptureRow] = []
    start = f"{STORE_HOME}?project={SHOP_ID}"

    # FBP：先种子页扫同域侧栏，建立 item→url 缓存
    link_cache: dict[str, str] = {}
    if seed_tpl:
        seed = seed_tpl.format(project=SHOP_ID)
        try:
            await goto_resilient(page, seed)
            await ensure_project(page, SHOP_ID)
            if await fault_aborted(page):
                log("seed fault abort", seed)
            else:
                await open_hamburger(page)
                await js_click_visible_text(page, parent, prefer_nav=True)
                links = await collect_nav_links(page, include_hidden=True)
                for _gid, item in items:
                    u = match_link(links, item)
                    if u:
                        link_cache[item] = u
                log("fbp link cache", len(link_cache), "of", len(items))
                # 落盘全部链接便于补漏
                dump = out_dir / "seed_links.json"
                dump.write_text(
                    json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8"
                )
        except Exception as e:
            log("seed failed", e)

    # payments/health/vantage：先在 Store 扫隐藏 DOM 建缓存
    if section_key in ("payments", "health", "vantage") and not link_cache:
        try:
            await goto_resilient(page, start)
            await ensure_project(page, SHOP_ID)
            await open_hamburger(page)
            if parent:
                await js_click_visible_text(page, parent, prefer_nav=True)
                await page.wait_for_timeout(500)
            links = await collect_nav_links(page, include_hidden=True)
            for _gid, item in items:
                u = match_link(links, item)
                if u:
                    link_cache[item] = u
            (out_dir / "menu_links.json").write_text(
                json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            log(section_key, "menu cache", len(link_cache), "of", len(items), "links=", len(links))
        except Exception as e:
            log("menu cache fail", e)

    for seq, (guide_id, item) in enumerate(items, start=1):
        click_path = f"{parent} > {item}" if parent != item else item
        nav_mode = ""
        err = ""
        meta: dict[str, str] = {}
        try:
            if item in link_cache:
                await goto_resilient(page, link_cache[item])
                await ensure_project(page, SHOP_ID)
                nav_mode = "seed-cache"
            else:
                nav_mode, err = await navigate_to_item(
                    page, parent=parent, item=item, start_url=start
                )
            await page.wait_for_timeout(800)
            meta = await page_meta(page)
            if await fault_aborted(page):
                err = (err + "; " if err else "") + "fault filter abort"
            if looks_logged_out(meta.get("url", ""), meta.get("title", "")):
                err = (err + "; " if err else "") + "疑似未登录/被挡"
        except Exception as e:
            err = str(e)[:240]
            meta = await page_meta(page)
            if not nav_mode:
                nav_mode = "error"

        url = meta.get("url") or page.url
        title = meta.get("title") or meta.get("docTitle") or ""
        missing = await is_missing_page(page)
        ok = (
            bool(url)
            and not is_store_home(url)
            and not missing
            and "fault filter" not in err.lower()
            and not looks_logged_out(url, title)
        )
        if nav_mode == "fail" and not ok:
            ok = False
        if ok and is_store_home(url):
            ok = False
        if missing:
            err = (err + "; " if err else "") + "404 missing page"
            ok = False

        shot_name = f"{seq:03d}_{slug(item)}.png"
        shot_path = shots / shot_name
        shot_status = "missing"
        try:
            await page.screenshot(path=str(shot_path), full_page=False)
            shot_status = "ok" if shot_path.is_file() and shot_path.stat().st_size > 800 else "empty"
        except Exception as e:
            shot_status = f"fail:{str(e)[:60]}"

        if not ok and not err:
            err = "仍停在 Store Dashboard 或未离开入口页"

        row = CaptureRow(
            seq=seq,
            section=parent,
            guide_id=guide_id,
            item=item,
            click_path=click_path,
            page_title=title,
            url=url,
            landing_template=normalize_landing(url) if ok else "",
            shot=shot_name,
            shot_status=shot_status,
            ok=ok,
            nav_mode=nav_mode,
            error=err,
        )
        rows.append(row)
        log(
            f"{section_key}/{item}",
            "OK" if ok else "FAIL",
            nav_mode,
            url[:100],
            err[:80] if err else "",
        )

    _write_manifest(out_dir, rows)
    return rows


def _write_manifest(out_dir: Path, rows: list[CaptureRow]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "manifest.csv"
    jsonl_path = out_dir / "manifest.jsonl"
    fields = [
        "seq",
        "section",
        "guide_id",
        "item",
        "click_path",
        "page_title",
        "url",
        "landing_template",
        "shot",
        "shot_status",
        "ok",
        "nav_mode",
        "captured_at",
        "error",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: getattr(r, k) for k in fields})
    with jsonl_path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(asdict(r), ensure_ascii=False) + "\n")
    summary = {
        "shopId": SHOP_ID,
        "section": out_dir.name,
        "items_ok": sum(1 for r in rows if r.ok),
        "items_total": len(rows),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "rows": [asdict(r) for r in rows],
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log("wrote", csv_path, f"ok={summary['items_ok']}/{summary['items_total']}")


def sections_to_run() -> list[str]:
    if SECTION_ENV in ("", "all"):
        return ["payments", "fbp", "health", "vantage"]
    if SECTION_ENV not in SECTION_DEFS:
        raise SystemExit(
            f"未知 SECTION={SECTION_ENV!r}，可选: all|payments|fbp|health|vantage"
        )
    return [SECTION_ENV]


async def run_all(page) -> dict[str, Any]:
    started = datetime.now(timezone.utc).isoformat()
    all_rows: list[CaptureRow] = []
    by_section: dict[str, list[CaptureRow]] = {}

    await goto_resilient(page, f"{STORE_HOME}?project={SHOP_ID}")
    meta = await page_meta(page)
    if await fault_aborted(page) or looks_logged_out(meta.get("url", ""), meta.get("title", "")):
        raise RuntimeError(
            "Seller Lab 登录态无效或被 Akamai 拦截。"
            " 请刷新 D:\\outpost-data\\browser-profiles\\noon-seller-pw\\storage_state.json "
            f"（当前 url={meta.get('url')!r} title={meta.get('title')!r}）"
        )
    log("start ok", meta.get("url"), meta.get("title"))

    for key in sections_to_run():
        log("=== section", key, "===")
        rows = await capture_section(page, key)
        by_section[key] = rows
        all_rows.extend(rows)

    shop_dir = OUT_ROOT / SHOP_ID
    shop_dir.mkdir(parents=True, exist_ok=True)
    ok_n = sum(1 for r in all_rows if r.ok)
    run_txt = (
        f"noon-guide-capture-pw\n"
        f"shop={SHOP_ID}\n"
        f"sections={','.join(sections_to_run())}\n"
        f"started={started}\n"
        f"finished={datetime.now(timezone.utc).isoformat()}\n"
        f"items_ok={ok_n}/{len(all_rows)}\n"
        f"ok_ids={','.join(r.guide_id for r in all_rows if r.ok)}\n"
        f"fail_ids={','.join(r.guide_id for r in all_rows if not r.ok)}\n"
    )
    (shop_dir / "RUN.txt").write_text(run_txt, encoding="utf-8")
    merged = {
        "shopId": SHOP_ID,
        "startedAt": started,
        "items_ok": ok_n,
        "items_total": len(all_rows),
        "bySection": {
            k: {
                "ok": sum(1 for r in v if r.ok),
                "total": len(v),
                "rows": [asdict(r) for r in v],
            }
            for k, v in by_section.items()
        },
    }
    (shop_dir / "capture-summary.json").write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log("DONE", f"ok={ok_n}/{len(all_rows)}", shop_dir)
    return merged
