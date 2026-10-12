# -*- coding: utf-8 -*-
"""从 packing 侧栏采 Handover/Shipments；Ctrl+K 搜 Payments 五项。"""
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
    page_meta,
    try_cmdk,
    _write_manifest,
)
from main import with_seller_browser  # noqa: E402

SIDEBAR_CLICKS = [
    ("fbp-manifestation", "Manifestation", ["Manifestation", "Handover", "Shipments", "Orders"]),
]
PAYMENT_QUERIES = [
    ("payments-statement", "Statements"),
    ("payments-soa", "Statement Of Account"),
    ("payments-invoices", "Invoices & Creditnotes"),
    ("payments-transactions", "Transaction View"),
    ("payments-exports", "Exports"),
]


async def run(page):
    out = OUT_ROOT / SHOP_ID / "_probe2"
    out.mkdir(parents=True, exist_ok=True)
    shots = out / "shots"
    shots.mkdir(exist_ok=True)
    rows: list[CaptureRow] = []

    # --- packing 侧栏 ---
    pack = f"https://fbp.noon.partners/en-sa/packing/orders/?project={SHOP_ID}"
    await goto_resilient(page, pack)
    await page.wait_for_timeout(2000)
    links = await collect_nav_links(page, include_hidden=True)
    (out / "packing_links.json").write_text(
        json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    labels = await page.evaluate(
        """() => [...document.querySelectorAll('a,button,span,li')]
          .map(n => (n.innerText||'').replace(/\\s+/g,' ').trim())
          .filter(t => t && t.length < 40)
          .filter((t,i,a) => a.indexOf(t)===i)
          .slice(0,80)"""
    )
    (out / "packing_labels.json").write_text(
        json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log("packing labels", labels)

    seq = 1
    for guide_id, item, aliases in SIDEBAR_CLICKS:
        await goto_resilient(page, pack)
        await page.wait_for_timeout(1000)
        clicked = False
        used = ""
        for alias in aliases:
            if await js_click_visible_text(page, alias, prefer_nav=True):
                clicked = True
                used = alias
                break
            # exact Manifest (not Return Manifest)
            if alias == "Manifestation":
                ok = await page.evaluate(
                    """() => {
                      for (const n of document.querySelectorAll('a,span,div,li,button')) {
                        const t = (n.innerText||'').replace(/\\s+/g,' ').trim();
                        if (t === 'Handover' || t === 'Shipments' || t === 'Orders') {
                          const r = n.getBoundingClientRect();
                          if (r.width < 2) continue;
                          let el = n;
                          for (let i=0;i<5&&el;i++) {
                            if ((el.tagName||'').toLowerCase()==='a') { el.click(); return t; }
                            el = el.parentElement;
                          }
                          n.click(); return t;
                        }
                      }
                      return '';
                    }"""
                )
                if ok:
                    clicked = True
                    used = str(ok)
                    break
        await page.wait_for_timeout(2500)
        meta = await page_meta(page)
        url = meta.get("url") or page.url
        title = meta.get("title") or ""
        missing = await is_missing_page(page)
        ok = clicked and not missing and title != "404" and not is_store_home(url)
        shot = f"{seq:02d}_{guide_id}.png"
        await page.screenshot(path=str(shots / shot), full_page=False)
        rows.append(
            CaptureRow(
                seq=seq,
                section="Fulfilled by Partner",
                guide_id=guide_id,
                item=item,
                click_path=f"alias={used}",
                page_title=title,
                url=url,
                landing_template=normalize_landing(url) if ok else "",
                shot=shot,
                shot_status="ok",
                ok=ok,
                nav_mode="packing-sidebar",
                error="" if ok else f"clicked={clicked} used={used}",
            )
        )
        log("sidebar", item, used, "OK" if ok else "FAIL", url[:100])
        seq += 1

        # 若点到 Handover/Shipments，也单独记一行
        if used and used != item:
            rows.append(
                CaptureRow(
                    seq=seq,
                    section="Fulfilled by Partner",
                    guide_id=f"alias-{used.lower()}",
                    item=used,
                    click_path=used,
                    page_title=title,
                    url=url,
                    landing_template=normalize_landing(url) if ok else "",
                    shot=shot,
                    shot_status="ok",
                    ok=ok,
                    nav_mode="packing-sidebar",
                    error="",
                )
            )
            seq += 1

    # --- Ctrl+K from Store / Finance ---
    for start_name, start_url in (
        ("store", f"https://noon-store.noon.partners/?project={SHOP_ID}"),
        ("finance", f"https://finance.noon.partners/en/?project={SHOP_ID}"),
        ("vantage", f"https://vantage.noon.partners/en/?project={SHOP_ID}"),
    ):
        for guide_id, query in PAYMENT_QUERIES:
            await goto_resilient(page, start_url)
            await ensure_project(page, SHOP_ID)
            await page.wait_for_timeout(1200)
            before = page.url
            hit = await try_cmdk(page, query)
            await page.wait_for_timeout(2000)
            meta = await page_meta(page)
            url = meta.get("url") or page.url
            title = meta.get("title") or ""
            missing = await is_missing_page(page)
            moved = url != before and not is_store_home(url)
            ok = hit and moved and not missing and title != "404"
            shot = f"{seq:02d}_cmdk_{start_name}_{guide_id}.png"
            await page.screenshot(path=str(shots / shot), full_page=False)
            rows.append(
                CaptureRow(
                    seq=seq,
                    section="Payments & Fees",
                    guide_id=guide_id,
                    item=query,
                    click_path=f"cmdk@{start_name}",
                    page_title=title,
                    url=url,
                    landing_template=normalize_landing(url) if ok else "",
                    shot=shot,
                    shot_status="ok",
                    ok=ok,
                    nav_mode=f"cmdk-{start_name}",
                    error="" if ok else f"hit={hit} moved={moved}",
                )
            )
            log("cmdk", start_name, query, "OK" if ok else "FAIL", url[:100])
            seq += 1
            if ok:
                # 同一项已命中就跳过其他 start
                break

    # 去重：每个 guide_id 保留 ok 优先
    best: dict[str, CaptureRow] = {}
    for r in rows:
        prev = best.get(r.guide_id)
        if not prev or (r.ok and not prev.ok):
            best[r.guide_id] = r
    final = list(best.values())
    _write_manifest(out, final)
    summary = {
        "ok": [r.guide_id for r in final if r.ok],
        "fail": [r.guide_id for r in final if not r.ok],
        "rows": [
            {
                "id": r.guide_id,
                "ok": r.ok,
                "url": r.url,
                "landing": r.landing_template,
                "title": r.page_title,
                "mode": r.nav_mode,
                "error": r.error,
            }
            for r in final
        ],
    }
    (out / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log("PROBE2 DONE", summary["ok"], summary["fail"])
    return summary


async def main():
    return await with_seller_browser(run)


if __name__ == "__main__":
    s = asyncio.run(main())
    raise SystemExit(0 if s.get("ok") else 1)
