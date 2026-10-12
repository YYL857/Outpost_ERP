# -*- coding: utf-8 -*-
"""补采：Packaging / Manifestation / Payments 真链 / Health。"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from capture import (  # noqa: E402
    OUT_ROOT,
    SHOP_ID,
    CaptureRow,
    collect_nav_links,
    ensure_project,
    goto_resilient,
    is_missing_page,
    is_store_home,
    js_click_visible_text,
    log,
    normalize_landing,
    open_hamburger,
    page_meta,
    slug,
    _write_manifest,
)
from main import with_seller_browser  # noqa: E402


async def dump_and_click(page, label: str, start: str) -> CaptureRow:
    await goto_resilient(page, start)
    await ensure_project(page, SHOP_ID)
    # 侧栏文案可能略有出入
    for text in (label, label.rstrip("s"), label + "s", "Manifest", "Packaging Material"):
        if await js_click_visible_text(page, text, prefer_nav=True):
            break
        if await js_click_visible_text(page, text, prefer_nav=False):
            break
    await page.wait_for_timeout(2000)
    meta = await page_meta(page)
    url = meta.get("url") or page.url
    title = meta.get("title") or meta.get("docTitle") or ""
    missing = await is_missing_page(page)
    ok = bool(url) and not is_store_home(url) and not missing and "404" not in title
    return CaptureRow(
        seq=0,
        section="retry",
        guide_id=slug(label),
        item=label,
        click_path=label,
        page_title=title,
        url=url,
        landing_template=normalize_landing(url) if ok else "",
        shot="",
        shot_status="",
        ok=ok,
        nav_mode="click",
        error="" if ok else ("404" if missing or title == "404" else "no nav"),
    )


async def probe_finance(page) -> list[dict]:
    roots = [
        f"https://finance.noon.partners/?project={SHOP_ID}",
        f"https://finance.noon.partners/en/?project={SHOP_ID}",
        f"https://finance.noon.partners/en-sa/?project={SHOP_ID}",
        f"https://payments.noon.partners/?project={SHOP_ID}",
        f"https://payments.noon.partners/en/?project={SHOP_ID}",
    ]
    all_links: list[dict] = []
    for url in roots:
        try:
            await goto_resilient(page, url)
            await page.wait_for_timeout(2500)
            meta = await page_meta(page)
            missing = await is_missing_page(page)
            log("finance root", url, "→", meta.get("url"), "title=", meta.get("title"), "404=", missing)
            links = await collect_nav_links(page, include_hidden=True)
            all_links.extend(links)
            # 再点汉堡扫
            await open_hamburger(page)
            await js_click_visible_text(page, "Payments & Fees", prefer_nav=True)
            links2 = await collect_nav_links(page, include_hidden=True)
            all_links.extend(links2)
        except Exception as e:
            log("finance root fail", url, e)
    # dedupe
    seen = set()
    out = []
    for l in all_links:
        k = l.get("url")
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(l)
    return out


async def probe_health(page) -> list[dict]:
    roots = [
        f"https://noon-store.noon.partners/?project={SHOP_ID}",
        f"https://accounthealth.noon.partners/?project={SHOP_ID}",
        f"https://account-health.noon.partners/en/?project={SHOP_ID}",
        f"https://seller-performance.noon.partners/?project={SHOP_ID}",
        f"https://performance.noon.partners/en/?project={SHOP_ID}",
        f"https://rms.noon.partners/en/?project={SHOP_ID}",
    ]
    found = []
    for url in roots:
        try:
            await goto_resilient(page, url)
            await page.wait_for_timeout(2000)
            meta = await page_meta(page)
            missing = await is_missing_page(page)
            log("health root", url, "→", meta.get("url"), meta.get("title"), "404=", missing)
            if not missing and not is_store_home(meta.get("url", page.url)):
                found.append({"start": url, "final": meta.get("url"), "title": meta.get("title")})
            links = await collect_nav_links(page, include_hidden=True)
            for l in links:
                t = (l.get("text") or "").lower()
                u = (l.get("url") or "").lower()
                if "reputation" in t or "reputation" in u or "account health" in t:
                    found.append(l)
        except Exception as e:
            log("health fail", url, e)
    # store hamburger
    try:
        await goto_resilient(page, f"https://noon-store.noon.partners/?project={SHOP_ID}")
        await open_hamburger(page)
        await js_click_visible_text(page, "Account Health & Reports", prefer_nav=True)
        await page.wait_for_timeout(500)
        if await js_click_visible_text(page, "Reputation Management", prefer_nav=True):
            await page.wait_for_timeout(2000)
            meta = await page_meta(page)
            found.append({"clicked": True, "url": meta.get("url"), "title": meta.get("title")})
        links = await collect_nav_links(page, include_hidden=True)
        for l in links:
            if "reputation" in (l.get("text") or "").lower() or "reputation" in (l.get("url") or "").lower():
                found.append(l)
    except Exception as e:
        log("health menu", e)
    return found


async def run(page):
    out_dir = OUT_ROOT / SHOP_ID / "_retry"
    out_dir.mkdir(parents=True, exist_ok=True)
    shots = out_dir / "shots"
    shots.mkdir(exist_ok=True)

    rows: list[CaptureRow] = []

    # 1) Packaging — seed 已证实 path
    pack_url = f"https://fbp.noon.partners/en-sa/packing/orders/?project={SHOP_ID}"
    await goto_resilient(page, pack_url)
    await page.wait_for_timeout(2000)
    meta = await page_meta(page)
    missing = await is_missing_page(page)
    ok = not missing and not is_store_home(page.url) and (meta.get("title") or "") != "404"
    shot = shots / "packaging.png"
    await page.screenshot(path=str(shot), full_page=False)
    rows.append(
        CaptureRow(
            seq=1,
            section="Fulfilled by Partner",
            guide_id="fbp-packaging",
            item="Packaging Materials",
            click_path="Fulfilled by Partner > Packaging Materials",
            page_title=meta.get("title") or "",
            url=meta.get("url") or page.url,
            landing_template=normalize_landing(meta.get("url") or page.url) if ok else "",
            shot="packaging.png",
            shot_status="ok",
            ok=ok,
            nav_mode="seed-known",
            error="" if ok else "404/fail",
        )
    )
    log("packaging", "OK" if ok else "FAIL", rows[-1].url, rows[-1].page_title)

    # 2) Manifestation — 在 FBP 页点 Manifest / Manifestation
    seed = f"https://fbp.noon.partners/en-sa/directship/picklist/?project={SHOP_ID}"
    await goto_resilient(page, seed)
    await page.wait_for_timeout(1500)
    links = await collect_nav_links(page, include_hidden=True)
    (out_dir / "fbp_links.json").write_text(
        json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    clicked = False
    for text in ("Manifestation", "Manifest"):
        # 避免点到 Return Manifest
        if text == "Manifest":
            # 精确点：innerText === Manifest（不是 Return Manifest）
            ok_click = await page.evaluate(
                """() => {
                  const nodes = [...document.querySelectorAll('a,button,span,div,li')];
                  let best = null, area = 1e12;
                  for (const n of nodes) {
                    const t = (n.innerText || '').replace(/\\s+/g,' ').trim();
                    if (t !== 'Manifest') continue;
                    const r = n.getBoundingClientRect();
                    if (r.width < 2 || r.height < 2) continue;
                    const a = r.width * r.height;
                    if (a < area) { best = n; area = a; }
                  }
                  if (!best) return false;
                  let el = best;
                  for (let i = 0; i < 6 && el; i++) {
                    const tag = (el.tagName || '').toLowerCase();
                    if (tag === 'a' || tag === 'button') { el.click(); return true; }
                    el = el.parentElement;
                  }
                  best.click();
                  return true;
                }"""
            )
            if ok_click:
                clicked = True
                await page.wait_for_timeout(2500)
                break
        elif await js_click_visible_text(page, text, prefer_nav=True):
            clicked = True
            break
    meta = await page_meta(page)
    missing = await is_missing_page(page)
    url = meta.get("url") or page.url
    # 若仍停在 return-manifestation，算失败（那是 Return Manifest）
    is_return = "return-manifest" in url.lower()
    ok = clicked and not missing and not is_store_home(url) and not is_return
    shot = shots / "manifestation.png"
    await page.screenshot(path=str(shot), full_page=False)
    rows.append(
        CaptureRow(
            seq=2,
            section="Fulfilled by Partner",
            guide_id="fbp-manifestation",
            item="Manifestation",
            click_path="Fulfilled by Partner > Manifestation",
            page_title=meta.get("title") or "",
            url=url,
            landing_template=normalize_landing(url) if ok else "",
            shot="manifestation.png",
            shot_status="ok",
            ok=ok,
            nav_mode="sidebar-click" if clicked else "fail",
            error="" if ok else ("hit return-manifest" if is_return else "not found"),
        )
    )
    log("manifestation", "OK" if ok else "FAIL", url, rows[-1].error)

    # 3) Finance 扫链
    fin_links = await probe_finance(page)
    (out_dir / "finance_links.json").write_text(
        json.dumps(fin_links, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log("finance links", len(fin_links))

    payment_map = {
        "Statements": ["statement"],
        "Statement Of Account": ["statement-of-account", "soa", "statement of account"],
        "Invoices & Creditnotes": ["invoice", "creditnote"],
        "Transaction View": ["transaction"],
        "Exports": ["export"],
    }
    seq = 3
    for item, needles in payment_map.items():
        hit = None
        for l in fin_links:
            blob = f"{l.get('text','')} {l.get('url','')} {l.get('path','')}".lower()
            if any(n in blob for n in needles):
                # 排除 catalog
                if "catalog" in blob:
                    continue
                hit = l.get("url")
                break
        if not hit:
            rows.append(
                CaptureRow(
                    seq=seq,
                    section="Payments & Fees",
                    guide_id=slug(item),
                    item=item,
                    click_path=f"Payments & Fees > {item}",
                    page_title="",
                    url="",
                    landing_template="",
                    shot="",
                    shot_status="missing",
                    ok=False,
                    nav_mode="fail",
                    error="finance dump 无匹配",
                )
            )
            seq += 1
            continue
        await goto_resilient(page, hit)
        await ensure_project(page, SHOP_ID)
        await page.wait_for_timeout(2000)
        meta = await page_meta(page)
        missing = await is_missing_page(page)
        title = meta.get("title") or ""
        url = meta.get("url") or page.url
        ok = not missing and title != "404" and not is_store_home(url)
        shot_name = f"{seq:03d}_{slug(item)}.png"
        await page.screenshot(path=str(shots / shot_name), full_page=False)
        rows.append(
            CaptureRow(
                seq=seq,
                section="Payments & Fees",
                guide_id=slug(item),
                item=item,
                click_path=f"Payments & Fees > {item}",
                page_title=title,
                url=url,
                landing_template=normalize_landing(url) if ok else "",
                shot=shot_name,
                shot_status="ok",
                ok=ok,
                nav_mode="finance-dump",
                error="" if ok else "404 after dump",
            )
        )
        log("payment", item, "OK" if ok else "FAIL", url[:100])
        seq += 1

    # 4) Health
    health_hits = await probe_health(page)
    (out_dir / "health_hits.json").write_text(
        json.dumps(health_hits, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    health_url = ""
    for h in health_hits:
        if isinstance(h, dict) and h.get("url") and "reputation" in str(h.get("url")).lower():
            health_url = h["url"]
            break
        if isinstance(h, dict) and h.get("clicked") and h.get("url"):
            health_url = h["url"]
            break
    if health_url:
        await goto_resilient(page, health_url)
        await page.wait_for_timeout(2000)
        meta = await page_meta(page)
        missing = await is_missing_page(page)
        title = meta.get("title") or ""
        url = meta.get("url") or page.url
        ok = not missing and title != "404" and "could not be found" not in title.lower()
        await page.screenshot(path=str(shots / "health.png"), full_page=False)
        rows.append(
            CaptureRow(
                seq=seq,
                section="Account Health & Reports",
                guide_id="health",
                item="Reputation Management",
                click_path="Account Health & Reports > Reputation Management",
                page_title=title,
                url=url,
                landing_template=normalize_landing(url) if ok else "",
                shot="health.png",
                shot_status="ok",
                ok=ok,
                nav_mode="health-probe",
                error="" if ok else "404",
            )
        )
        log("health", "OK" if ok else "FAIL", url)
    else:
        rows.append(
            CaptureRow(
                seq=seq,
                section="Account Health & Reports",
                guide_id="health",
                item="Reputation Management",
                click_path="Account Health & Reports > Reputation Management",
                page_title="",
                url="",
                landing_template="",
                shot="",
                shot_status="missing",
                ok=False,
                nav_mode="fail",
                error="未找到 reputation URL",
            )
        )

    _write_manifest(out_dir, rows)
    summary = {
        "ok": [r.guide_id for r in rows if r.ok],
        "fail": [r.guide_id for r in rows if not r.ok],
        "rows": [
            {
                "id": r.guide_id,
                "ok": r.ok,
                "url": r.url,
                "landing": r.landing_template,
                "title": r.page_title,
                "error": r.error,
            }
            for r in rows
        ],
    }
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log("RETRY DONE", summary["ok"], summary["fail"])
    return summary


async def main():
    return await with_seller_browser(run)


if __name__ == "__main__":
    s = asyncio.run(main())
    ok = len(s.get("ok") or [])
    raise SystemExit(0 if ok else 2)
