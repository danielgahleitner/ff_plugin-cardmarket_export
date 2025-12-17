# User Guide

This guide explains how to install the extension in Firefox and export your Cardmarket purchases.

---

## 1) Install (Developer Mode)

1. Clone or download this repository
2. In Firefox, open:

   ```
   about:debugging#/runtime/this-firefox
   ```

3. Click **Load Temporary Add-on…**
4. Select the repository’s `manifest.json`
5. Open Cardmarket and navigate to your purchases/orders page
6. Click the extension icon

> Tip: If you pin the extension to the toolbar, exporting becomes a one-click flow.

---

## 2) Export purchases

The popup offers two buttons:

- **Export page** — exports only the currently visible purchases page
- **Export all pages** — follows pagination and exports everything

Optional:
- **Max pages (safety cap)** — set a limit if you want to prevent very large exports

---

## 3) Choose export format

### Detailed CSV
Best for:
- Google Sheets / Excel analysis
- Pivot tables (spend per seller, spend over time, etc.)
- Custom scripts

Includes:
- order metadata + timeline
- line items
- Scryfall enrichment fields

### ManaBox import CSV
Best for:
- importing directly into ManaBox

Includes:
- Card name, quantity, language, condition, foil
- Set code + Scryfall ID
- Purchase price (optionally with shipping split)

#### Shipping split (ManaBox only)
Shown only when **ManaBox** is selected.

Modes:
- **None** — don’t add shipping to cards
- **Equal per card** — shipping / number of cards
- **Proportional by card price** — higher-priced cards get a larger share

Example (equal split):
- 5 cards, €2.50 shipping → each card’s purchase price increases by €0.50.

### Moxfield import
Exports in a format suitable for Moxfield import.

### Archidekt import
Exports in a format suitable for Archidekt import.

---

## 4) Import into Google Sheets

1. Create a new Google Spreadsheet
2. **File → Import → Upload** and select the exported CSV
3. Choose:
   - “Insert new sheet(s)”
   - Separator: **comma**

Recommended next steps:
- Create a Pivot Table:
  - Rows: sellerName
  - Values: SUM of summaryTotalRaw (or per-card price)
- Chart spend per month:
  - Extract month from arrivedDate or paidDate

---

## Troubleshooting

- **Export does nothing**: ensure you are on `https://www.cardmarket.com/*` and logged in.
- **Some set codes missing**: Scryfall matching relies on name + collector number; special variants may need improved matching.
- **ManaBox errors**: usually caused by missing/incorrect set code — verify `setCode` and `collectorNumber`.

---

## Disclaimer

This extension is not affiliated with Cardmarket or the deck/collection apps. Use at your own risk.
