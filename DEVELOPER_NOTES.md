# Developer Notes

This document describes the architecture and implementation details.

---

## Project structure (typical)

- `manifest.json` — MV3 manifest
- `popup.html`, `popup.js` — UI + orchestration
- `content.js` — scraping & row extraction
- `background.js` — Scryfall enrichment + export building + downloads
- `csv.js` — CSV helper (if used)
- `icons/` — extension icons
- `assets/` — screenshots / gifs (optional)

---

## High-level flow

1. User clicks Export in the popup.
2. `popup.js` injects `content.js` (and helpers) into the active tab.
3. `content.js`:
   - scrapes order list pages (optionally paginated)
   - fetches order detail pages via `fetch(url, { credentials: 'include' })`
   - produces a list of “raw rows” (one row per line item)
4. `content.js` sends rows to `background.js` via `browser.runtime.sendMessage`:
   - `CM_BUILD_EXPORT` with `rows` + `format` (+ options like shipping split)
5. `background.js`:
   - enriches rows via Scryfall (cached lookup)
   - builds target-format text (CSV for detailed / ManaBox / others)
   - returns `{ text, filename, mime }`
6. `content.js` requests download via `CM_DOWNLOAD_TEXT` (background uses `browser.downloads.download`).

---

## Scraping

### Orders overview
- order rows are collected from the table (e.g. `#StatusTable`)
- pagination uses a robust `next` selector

### Order details
- line items parsed from `table.product-table` rows
- summary block:
  - `data-total-price`, `data-shipping-price`, `data-item-value`
- timeline block:
  - extracts timestamps for unpaid/paid/shipped/arrived

### Common pitfalls
- Seller name may appear in multiple spans; selectors should target the last/most specific text span
- Language icon is a nested `span.icon` with `aria-label` / tooltip titles — ensure you query the correct nested node
- Some card names include variant tags like `(V.1)` which can confuse Scryfall matching; normalization should handle this (see below)

---

## Scryfall enrichment

### Lookup strategy
Preferred order:
1. Exact name + collector number (`cn:`)
2. Exact name only

Endpoint used:
- `/cards/search?q=...&unique=prints&order=released`

### Caching
- Cache key: `name || collectorNumber`
- Prevents repeated requests across multiple orders

### Rate limiting
- Add a small delay between requests (e.g. 100–150ms) to be polite

### Variant handling (recommended)
If you hit tricky names like:
- `Tinybones, Bauble Burglar (V.1)`

Suggested approach:
- Try the original name first
- If no result, try a normalized name with trailing variant markers removed:
  - remove ` (V.1)` / ` (V.2)` / ` (… )` patterns
  - trim

---

## Exports

### Detailed CSV
- wide schema: order + line item + Scryfall fields

### ManaBox
- ensure **Set code** is non-empty
- purchase price:
  - parse numeric values (dot decimal internally)
  - output values with comma as decimal separator when targeting locales that expect it
- optional shipping split:
  - equal: shipping / totalQty
  - proportional: shipping * (itemPrice / totalItemsPrice)

---

## Testing checklist

- Export current page (small dataset)
- Export all pages (pagination)
- Verify:
  - sellerName extracted
  - language extracted
  - setCode / scryfallId present
  - ManaBox import succeeds
  - shipping split math correct
  - popup UI remains usable (log scroll, hide/show)
