// content.js

const SELECTORS = {
    // Orders overview
    orderRow: '#StatusTable .table-body > div.row.set-as-link',
    orderLink: 'a[href*="/Orders/"]',
    sellerName: '.seller-name .has-content-centered.me-1 span',
    itemCount: '.col-smallNumber.d-none.d-lg-flex',
    totalAmount: '.col-price > div',
    arrivedDateTime: '.col-datetime span',
    nextPageLink: 'a[data-direction="next"]',

    // Order details
    articleRows: 'table.product-table[id^="ArticleTable"] tbody > tr[data-article-id]',
    itemPriceCell: 'td.price',

    // Summary + timeline
    summary: '.summary[data-total-price]',
    timelineBox: '#Timeline .timeline-box',
};

const CANCELLED_RUNS = new Set();

function sendProgress(runId, payload) {
    if (!runId) return;
    browser.runtime.sendMessage({ type: 'CM_EXPORT_PROGRESS', runId, ...payload }).catch(() => {});
}

function checkCancelled(runId) {
    if (runId && CANCELLED_RUNS.has(runId)) throw new Error('Cancelled by user');
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function getText(el) {
    return el ? el.textContent.trim() : '';
}

function absolutizeUrl(href) {
    if (!href) return '';
    const h = String(href).trim();
    if (!h || h === 'null' || h === '#') return '';
    return new URL(h, window.location.origin).toString();
}

function parsePurchaseList(doc) {
    const rows = Array.from(doc.querySelectorAll(SELECTORS.orderRow));
    const orders = [];

    for (const row of rows) {
        const a = row.querySelector(SELECTORS.orderLink);
        const relativeUrl = row.getAttribute('data-url') || a?.getAttribute('href');
        if (!relativeUrl) continue;

        const url = absolutizeUrl(relativeUrl);
        const orderId = getText(a) || (url.match(/\/Orders\/(\d+)/)?.[1] ?? '');

        // safer seller: pick first seller name span that actually has text
        const sellerCandidates = Array.from(row.querySelectorAll('.seller-name span'))
            .map(getText)
            .filter(Boolean);
        const sellerName = sellerCandidates.find((t) => t && t.length > 0) || '';

        const itemCount = getText(row.querySelector(SELECTORS.itemCount));
        const total = getText(row.querySelector(SELECTORS.totalAmount));

        const spans = row.querySelectorAll(SELECTORS.arrivedDateTime);
        const arrivedDate = getText(spans?.[0] ?? null);
        const arrivedTime = getText(spans?.[1] ?? null);

        orders.push({ orderId, url, sellerName, itemCount, total, arrivedDate, arrivedTime });
    }

    const nextEl = doc.querySelector(SELECTORS.nextPageLink);
    let nextRel =
        nextEl?.getAttribute('href') ||
        nextEl?.getAttribute('data-url') ||
        nextEl?.dataset?.url ||
        nextEl?.getAttribute('data-href') ||
        nextEl?.dataset?.href ||
        '';

    nextRel = (nextRel || '').trim();
    const nextUrl =
        nextRel && nextRel !== 'null' && nextRel !== '#' ? absolutizeUrl(nextRel) : null;

    return { orders, nextUrl };
}

async function fetchHtml(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
    const text = await res.text();
    return new DOMParser().parseFromString(text, 'text/html');
}

async function collectOrders(mode, maxPages, runId) {
    let doc = document;
    let pageCount = 1;

    const allOrders = [];
    while (true) {
        checkCancelled(runId);
        const { orders, nextUrl } = parsePurchaseList(doc);
        allOrders.push(...orders);

        if (mode !== 'all') break;
        if (!nextUrl) break;
        if (maxPages && pageCount >= maxPages) break;

        await sleep(800);
        doc = await fetchHtml(nextUrl);
        pageCount++;
    }

    const seen = new Set();
    return allOrders.filter((o) => (seen.has(o.url) ? false : (seen.add(o.url), true)));
}

function parseSummary(doc) {
    const s = doc.querySelector(SELECTORS.summary);
    if (!s) return null;

    return {
        articleCount: s.getAttribute('data-article-count') || '',
        itemValueRaw: s.getAttribute('data-item-value') || '',
        shippingRaw: s.getAttribute('data-shipping-price') || '',
        totalRaw: s.getAttribute('data-total-price') || '',
        itemValue: getText(s.querySelector('.item-value')) || '',
        shipping: getText(s.querySelector('.shipping-price')) || '',
        total:
            getText(s.querySelector('span.total.strong')) ||
            getText(s.querySelector('.total')) ||
            '',
    };
}

function parseTimeline(doc) {
    const boxes = Array.from(doc.querySelectorAll(SELECTORS.timelineBox));
    if (!boxes.length) return {};

    const result = {};
    for (const b of boxes) {
        const labelRaw = getText(b.querySelector('div:first-child'))
            .replace(/\u00A0/g, ' ')
            .replace(':', '')
            .trim();

        const spans = b.querySelectorAll('div:nth-child(2) span');
        const date = getText(spans?.[0] ?? null);
        const time = getText(spans?.[1] ?? null);
        if (!labelRaw) continue;

        const key = (() => {
            const l = labelRaw.toLowerCase();
            if (l.includes('unbezahlt')) return 'unpaid';
            if (l.includes('bezahlt')) return 'paid';
            if (l.includes('versandt')) return 'shipped';
            if (l.includes('angekommen')) return 'arrived';
            return labelRaw.replace(/\s+/g, '_');
        })();

        result[`${key}Date`] = date;
        result[`${key}Time`] = time;
    }
    return result;
}

function parseOrderDetails(doc, order) {
    const rows = Array.from(doc.querySelectorAll(SELECTORS.articleRows));
    if (!rows.length) return [];

    const summary = parseSummary(doc) || {};
    const timeline = parseTimeline(doc) || {};

    const out = [];
    for (const tr of rows) {
        const articleId = tr.getAttribute('data-article-id') || '';
        const productId = tr.getAttribute('data-product-id') || '';
        const qty = tr.getAttribute('data-amount') || getText(tr.querySelector('td.amount')) || '';
        const name = tr.getAttribute('data-name') || '';
        const expansionName = tr.getAttribute('data-expansion-name') || '';
        const collectorNumber = tr.getAttribute('data-number') || '';
        const conditionCode = tr.getAttribute('data-condition') || '';
        const languageCode = tr.getAttribute('data-language') || '';
        const priceItemRaw = tr.getAttribute('data-price') || '';
        const comment = tr.getAttribute('data-comment') || '';

        const priceItem = getText(tr.querySelector(SELECTORS.itemPriceCell)) || '';

        const condition =
            tr.querySelector('.article-condition')?.getAttribute('data-bs-original-title') ||
            tr.querySelector('.article-condition')?.getAttribute('aria-label') ||
            getText(tr.querySelector('.article-condition .badge')) ||
            '';

        const languageEl =
            tr.querySelector('td.info .col-icon span.icon[aria-label]') ||
            tr.querySelector('td.info .col-icon span.icon[data-bs-original-title]') ||
            tr.querySelector('td.info .col-icon span.icon[data-original-title]') ||
            null;

        const language =
            languageEl?.getAttribute('aria-label') ||
            languageEl?.getAttribute('data-bs-original-title') ||
            languageEl?.getAttribute('data-original-title') ||
            '';

        const productUrlRel =
            tr.querySelector('td.name a[href*="/Products/"]')?.getAttribute('href') ||
            tr.querySelector('td.info a[href*="/Products/"]')?.getAttribute('href') ||
            '';
        const productUrl = productUrlRel ? absolutizeUrl(productUrlRel) : '';

        // foil detection: best-effort from row attributes/classes (adjust later if you find a definitive marker)
        const foil =
            tr.getAttribute('data-is-foil') === '1' || tr.classList.contains('is-foil')
                ? 'foil'
                : 'normal';

        out.push({
            orderId: order.orderId,
            orderUrl: order.url,

            overviewArrivedDate: order.arrivedDate || '',
            overviewArrivedTime: order.arrivedTime || '',
            sellerName: order.sellerName || '',
            overviewItemCount: order.itemCount || '',
            overviewTotal: order.total || '',

            summaryArticleCount: summary.articleCount || '',
            summaryItemValueRaw: summary.itemValueRaw || '',
            summaryShippingRaw: summary.shippingRaw || '',
            summaryTotalRaw: summary.totalRaw || '',
            summaryItemValue: summary.itemValue || '',
            summaryShipping: summary.shipping || '',
            summaryTotal: summary.total || '',

            unpaidDate: timeline.unpaidDate || '',
            unpaidTime: timeline.unpaidTime || '',
            paidDate: timeline.paidDate || '',
            paidTime: timeline.paidTime || '',
            shippedDate: timeline.shippedDate || '',
            shippedTime: timeline.shippedTime || '',
            arrivedDate: timeline.arrivedDate || '',
            arrivedTime: timeline.arrivedTime || '',

            articleId,
            productId,
            productUrl,
            itemName: name,
            expansionName,
            collectorNumber,
            condition,
            conditionCode,
            language,
            languageCode,
            qty,
            foil,
            priceItemRaw,
            priceItem,
            comment,
        });
    }

    return out;
}

async function exportPurchases(mode, maxPages, runId, exportFormat, shippingMode) {
    if (!location.hostname.includes('cardmarket.com')) throw new Error('Not on cardmarket.com');

    sendProgress(runId, { phase: 'collect', note: 'Collecting order list…' });
    const orders = await collectOrders(mode, maxPages, runId);
    sendProgress(runId, { phase: 'collect', note: `Found ${orders.length} orders.` });

    const rows = [];
    for (let i = 0; i < orders.length; i++) {
        checkCancelled(runId);
        const o = orders[i];

        sendProgress(runId, {
            phase: 'fetch',
            current: i + 1,
            total: orders.length,
            orderId: o.orderId,
            url: o.url,
        });
        await sleep(600);

        const detailDoc = await fetchHtml(o.url);
        const parsed = parseOrderDetails(detailDoc, o);
        rows.push(...parsed);

        sendProgress(runId, {
            phase: 'parse',
            current: i + 1,
            total: orders.length,
            orderId: o.orderId,
            note: `Added ${parsed.length} line items. Total rows so far: ${rows.length}`,
        });
    }

    sendProgress(runId, { phase: 'build', note: `Building export (${rows.length} rows)…` });

    const buildResp = await browser.runtime.sendMessage({
        type: 'CM_BUILD_EXPORT',
        format: exportFormat || 'csv',
        rows,
        shippingMode: shippingMode || 'none',
    });

    if (!buildResp?.ok) throw new Error(buildResp?.error || 'Build export failed');

    sendProgress(runId, { phase: 'download', note: 'Sending file to background for download…' });

    const dlResp = await browser.runtime.sendMessage({
        type: 'CM_DOWNLOAD_TEXT',
        text: buildResp.text,
        filename: buildResp.filename,
        mime: buildResp.mime || 'text/csv;charset=utf-8',
        saveAs: true,
    });

    if (!dlResp?.ok) throw new Error(dlResp?.error || 'Download failed in background');

    sendProgress(runId, { phase: 'done', note: `Finished. File: ${buildResp.filename}` });

    return { rows: rows.length, filename: buildResp.filename };
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'CM_EXPORT_CANCEL' && msg.runId) {
        CANCELLED_RUNS.add(msg.runId);
        sendResponse({ ok: true });
        return;
    }

    if (msg?.type !== 'CM_EXPORT_PURCHASES') return;

    (async () => {
        try {
            const { rows, filename } = await exportPurchases(
                msg.mode,
                msg.maxPages,
                msg.runId,
                msg.exportFormat || 'csv',
                msg.shippingMode || 'none'
            );
            sendResponse({ ok: true, rows, filename });
        } catch (e) {
            sendResponse({ ok: false, error: e?.message || String(e) });
        }
    })();

    return true;
});
