# Cardmarket Purchases → CSV / ManaBox / Moxfield / Archidekt

![Firefox](https://img.shields.io/badge/Firefox-MV3-orange)
![Version](https://img.shields.io/github/v/tag/danielgahleitner/ff_plugin-cardmarket_export?label=version)
![License](https://img.shields.io/github/license/danielgahleitner/ff_plugin-cardmarket_export)
![Last Commit](https://img.shields.io/github/last-commit/danielgahleitner/ff_plugin-cardmarket_export)

A Firefox browser extension that exports your **Cardmarket purchase history** into multiple formats — **Detailed CSV**, **ManaBox**, **Moxfield**, and **Archidekt** — enriched with **Scryfall metadata** and optional **shipping cost splitting**.

> Not affiliated with Cardmarket, Scryfall, ManaBox, Moxfield, or Archidekt.

---

## Quick links

-   **[User Guide](./USER_GUIDE.md)** — how to install & export
-   **[Developer Notes](./DEVELOPER_NOTES.md)** — architecture, scraping, exports, Scryfall
-   **[Firefox Add-ons Store Description](./AMO_DESCRIPTION.md)** — ready-to-paste listing text

---

## ✨ Features

-   Export purchases from Cardmarket (current page or all pages)
-   Multiple export targets:
    -   Detailed CSV (for Google Sheets / Excel)
    -   ManaBox import CSV (set codes + Scryfall IDs)
    -   Moxfield import
    -   Archidekt import
-   Scryfall enrichment:
    -   `setCode`, `scryfallId`, `scryfallSetName`
-   Shipping split options (ManaBox only):
    -   none / equal per card / proportional by card price
-   Polished popup UI with progress, ETA, optional log

---

## 📷 UI preview (placeholders)

> Add images to `assets/` and replace the placeholders below.

![Popup – idle](./assets/screenshots/popup-idle.png)
![Popup – exporting](./assets/screenshots/popup-exporting.png)

GIF placeholder:

-   `./assets/gifs/export-demo.gif`

---

## 📦 Installation (Developer Mode)

1. Clone this repository:
    ```bash
    git clone https://github.com/danielgahleitner/ff_plugin-cardmarket_export.git
    ```
2. Open Firefox and navigate to:
    ```
    about:debugging#/runtime/this-firefox
    ```
3. Click **Load Temporary Add-on…**
4. Select `manifest.json`
5. Open Cardmarket → Purchases
6. Click the extension icon

---

## License

MIT — see `LICENSE`.

---

## Author

© Daniel Gahleitner
