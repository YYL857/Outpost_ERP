# NOON Seller Lab discovery

Use the saved Playwright profile (`D:\outpost-data\noon-browser-profile`) to inventory portal pages before designing sync.

## Prerequisites

1. Outpost → **NOON 接入** → **浏览器登录并保存登录态**
2. Playwright Chromium installed under `apps/api`

## Commands

```powershell
cd D:\outpost-erp
node scripts/noon-discover/discover-nav.mjs
node scripts/noon-discover/discover-pages.mjs
node scripts/noon-discover/discover-network.mjs
```

Optional:

- `OUTPOST_SOP_HEADLESS=1` — headless Chromium
- `NOON_DISCOVER_MAX_PAGES=30` — page visit cap
- `NOON_DISCOVER_START=https://www.noon.partners/en-ae/` — nav start URL

## Outputs (`scripts/noon-discover/out/`)

| File | Content |
|------|---------|
| `nav.json` | Same-origin nav links + draft domain mapping |
| `pages-index.json` | Per-page status / export controls / headers |
| `pages/*.md` | Human-readable page notes |
| `screenshots/*.png` | First-viewport screenshots |
| `mapping-draft.json` | Draft Noon → Outpost mapping |
| `network.json` | XHR/fetch endpoints seen on seed pages |

If you see `fault filter abort`, re-login in Outpost and re-run.
