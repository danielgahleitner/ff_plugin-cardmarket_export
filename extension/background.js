// background.js (MV3 in Firefox with background.scripts)

const SCRYFALL_BASE = 'https://api.scryfall.com';

function normalizeName(name) {
    return (name || '').trim();
}

function cleanDisplayName(name) {
    return normalizeName(name)
        .replace(/\s*\(V\.\d+\)\s*$/i, '')
        .replace(/\s*\(Version\s*\d+\)\s*$/i, '')
        .trim();
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse numbers from either:
 * - Cardmarket attribute numeric: "6.4"
 * - German display: "6,40 €"
 * - German with thousands: "1.234,56"
 *
 * Output: JS number (dot decimal internally)
 */
function parseNumberLoose(v) {
    if (v == null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;

    let s = String(v).trim();
    if (!s) return null;

    // strip currency and spaces
    s = s.replace(/\s/g, '').replace(/€/g, '');

    // If it contains a comma, treat comma as decimal separator and dots as thousands separators.
    // Example: "1.234,56" -> "1234.56"
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else {
        // No comma:
        // - "6.4" should remain "6.4" (decimal dot)
        // - "1234" remains "1234"
        // We do NOT remove dots here.
        // If you ever hit a format like "1.234" meaning thousands, you'd need extra heuristics,
        // but Cardmarket attributes are typically dot-decimal, not thousands.
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * Format numeric price with:
 * - 2 decimals
 * - comma as decimal separator
 * - no thousands separator
 */
function formatPrice(n) {
    if (!Number.isFinite(n)) return '';
    return n.toFixed(2).replace('.', ',');
}

async function scryfallFetchJson(url) {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Scryfall HTTP ${res.status}`);
    return await res.json();
}

async function resolveScryfallCard({ name, collectorNumber }) {
    const n0 = cleanDisplayName(name);
    if (!n0) return null;

    const tryExactSearch = async (n) => {
        if (collectorNumber) {
            const q1 = `!"${n.replace(/"/g, '\\"')}" cn:${collectorNumber}`;
            const url1 = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(
                q1
            )}&unique=prints&order=released`;
            const j1 = await scryfallFetchJson(url1);
            if (j1?.data?.length) return j1.data[0];
        }

        const q2 = `!"${n.replace(/"/g, '\\"')}"`;
        const url2 = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(
            q2
        )}&unique=prints&order=released`;
        const j2 = await scryfallFetchJson(url2);
        if (j2?.data?.length) return j2.data[0];

        return null;
    };

    try {
        const c = await tryExactSearch(n0);
        if (c) return c;
    } catch (_) {}

    const n1 = n0.replace(/\s*\([^)]*\)\s*$/g, '').trim();
    if (n1 && n1 !== n0) {
        try {
            const c = await tryExactSearch(n1);
            if (c) return c;
        } catch (_) {}
    }

    return null;
}

async function enrichRowsWithScryfall(rows) {
    const out = [];
    const cache = new Map();

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const key = `${cleanDisplayName(r.itemName)}||${r.collectorNumber || ''}`;

        if (cache.has(key)) {
            out.push({ ...r, ...cache.get(key) });
            continue;
        }

        let card = null;
        try {
            card = await resolveScryfallCard({
                name: r.itemName,
                collectorNumber: r.collectorNumber,
            });
        } catch (_) {
            card = null;
        }

        const enriched = {
            setCode: card?.set ? String(card.set).toLowerCase() : '',
            scryfallId: card?.id || '',
            scryfallSetName: card?.set_name || '',
            scryfallName: card?.name || '',
            scryfallLang: card?.lang || '',
        };

        cache.set(key, enriched);
        out.push({ ...r, ...enriched });

        await sleep(110);
    }

    return out;
}

function toCsvLine(values) {
    return values
        .map((v) => {
            const s = v == null ? '' : String(v);
            if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        })
        .join(',');
}

function buildCsv(rows, columns) {
    const head = toCsvLine(columns);
    const body = rows.map((r) => toCsvLine(columns.map((c) => r[c]))).join('\n');
    return `${head}\n${body}\n`;
}

/**
 * Shipping allocation per order.
 * Returns a map(orderId -> { perCardEqual, perLinePerCard(Map) })
 */
function computeShippingAllocation(rows, mode) {
    const perOrder = new Map();

    for (const r of rows) {
        const orderId = r.orderId || '';
        if (!orderId) continue;

        const qty = parseNumberLoose(r.qty) ?? 1;
        const ship = parseNumberLoose(r.summaryShippingRaw) ?? 0;

        // Base unit price: prefer raw attribute (data-price="6.4"), fallback to display ("6,40 €")
        const baseUnit = parseNumberLoose(r.priceItemRaw) ?? parseNumberLoose(r.priceItem) ?? 0;

        if (!perOrder.has(orderId)) {
            perOrder.set(orderId, { shipping: ship, totalQty: 0, subtotal: 0, lines: [] });
        }

        const o = perOrder.get(orderId);
        o.totalQty += qty;
        o.subtotal += qty * baseUnit;
        o.lines.push({ r, qty, baseUnit });
    }

    const out = new Map();

    for (const [orderId, o] of perOrder.entries()) {
        const shipping = Number.isFinite(o.shipping) ? o.shipping : 0;

        const perCardEqual = mode === 'equal' && o.totalQty > 0 ? shipping / o.totalQty : 0;

        const perLinePerCard = new Map();
        if (mode === 'proportional' && o.subtotal > 0) {
            for (const line of o.lines) {
                const lineTotal = line.qty * line.baseUnit;
                const lineShipTotal = shipping * (lineTotal / o.subtotal);
                const perCard = line.qty > 0 ? lineShipTotal / line.qty : 0;
                const key = `${cleanDisplayName(line.r.itemName)}||${line.r.collectorNumber || ''}`;
                perLinePerCard.set(key, perCard);
            }
        }

        out.set(orderId, { perCardEqual, perLinePerCard });
    }

    return out;
}

function buildManaBoxCsv(rows, shippingMode) {
    const alloc = computeShippingAllocation(rows, shippingMode || 'none');

    const mapped = rows.map((r) => {
        const cardName = (r.scryfallName || '').trim() || cleanDisplayName(r.itemName || '');
        const setCode = (r.setCode || '').trim().toLowerCase();
        const qty = Number(parseNumberLoose(r.qty) ?? 1);

        const baseUnit = parseNumberLoose(r.priceItemRaw) ?? parseNumberLoose(r.priceItem) ?? null;

        let shipShare = 0;
        if (shippingMode && shippingMode !== 'none') {
            const o = alloc.get(r.orderId || '');
            if (o) {
                if (shippingMode === 'equal') {
                    shipShare = o.perCardEqual || 0;
                } else if (shippingMode === 'proportional') {
                    const key = `${cleanDisplayName(r.itemName)}||${r.collectorNumber || ''}`;
                    shipShare = o.perLinePerCard.get(key) || 0;
                }
            }
        }

        const unitPrice = baseUnit != null ? baseUnit + shipShare : null;

        return {
            'Card name': cardName,
            'Set code': setCode,
            Quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
            Foil: (r.foil || 'normal').toLowerCase() === 'foil' ? 'foil' : 'normal',
            'Card number': (r.collectorNumber || '').trim(),
            Language: (r.scryfallLang || '').trim().toLowerCase(),
            Condition: (r.condition || '').trim(),
            'Purchase price': unitPrice != null ? formatPrice(unitPrice) : '',
            'Purchase currency': 'EUR',
            'Scryfall ID': (r.scryfallId || '').trim(),
            'Import error': '',
        };
    });

    const cols = [
        'Card name',
        'Set code',
        'Quantity',
        'Foil',
        'Card number',
        'Language',
        'Condition',
        'Purchase price',
        'Purchase currency',
        'Scryfall ID',
        'Import error',
    ];

    return buildCsv(mapped, cols);
}

async function downloadTextFile({ text, filename, mime, saveAs }) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    try {
        await browser.downloads.download({ url, filename, saveAs: !!saveAs });
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'CM_BUILD_EXPORT') {
        (async () => {
            try {
                const format = msg.format || 'csv';
                const rows = Array.isArray(msg.rows) ? msg.rows : [];
                const shippingMode = msg.shippingMode || 'none';

                const needsScryfall = ['csv', 'manabox', 'moxfield', 'archidekt'].includes(format);
                const enriched = needsScryfall ? await enrichRowsWithScryfall(rows) : rows;

                if (format === 'manabox') {
                    const text = buildManaBoxCsv(enriched, shippingMode);
                    sendResponse({
                        ok: true,
                        text,
                        mime: 'text/csv;charset=utf-8',
                        filename: `cardmarket-manabox-${new Date().toISOString().slice(0, 10)}.csv`,
                    });
                    return;
                }

                // Default: detailed CSV
                const columns = [
                    'orderId',
                    'orderUrl',
                    'sellerName',
                    'overviewArrivedDate',
                    'overviewArrivedTime',
                    'overviewItemCount',
                    'overviewTotal',

                    'summaryArticleCount',
                    'summaryItemValue',
                    'summaryShipping',
                    'summaryTotal',
                    'summaryItemValueRaw',
                    'summaryShippingRaw',
                    'summaryTotalRaw',

                    'unpaidDate',
                    'unpaidTime',
                    'paidDate',
                    'paidTime',
                    'shippedDate',
                    'shippedTime',
                    'arrivedDate',
                    'arrivedTime',

                    'articleId',
                    'productId',
                    'productUrl',
                    'itemName',
                    'expansionName',
                    'collectorNumber',
                    'condition',
                    'conditionCode',
                    'language',
                    'languageCode',
                    'qty',
                    'foil',
                    'priceItem',
                    'priceItemRaw',
                    'comment',

                    'setCode',
                    'scryfallId',
                    'scryfallSetName',
                    'scryfallName',
                    'scryfallLang',
                ];

                const text = buildCsv(enriched, columns);
                sendResponse({
                    ok: true,
                    text,
                    mime: 'text/csv;charset=utf-8',
                    filename: `cardmarket-purchases-${new Date().toISOString().slice(0, 10)}.csv`,
                });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }

    if (msg?.type === 'CM_DOWNLOAD_TEXT') {
        (async () => {
            try {
                await downloadTextFile({
                    text: msg.text || '',
                    filename: msg.filename || 'export.csv',
                    mime: msg.mime || 'text/csv;charset=utf-8',
                    saveAs: msg.saveAs,
                });
                sendResponse({ ok: true });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }
});
