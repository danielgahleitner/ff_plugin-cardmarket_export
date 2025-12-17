let currentRunId = null;
let activeTabId = null;

const el = (id) => document.getElementById(id);

function setState(kind, text) {
    el('stateText').textContent = text;
    el('stateDot').classList.remove('ok', 'bad');
    if (kind === 'ok') el('stateDot').classList.add('ok');
    if (kind === 'bad') el('stateDot').classList.add('bad');
}

function setPhase(text) {
    el('phase').textContent = text;
}
function setCount(text) {
    el('count').textContent = text || '—';
}
function setHint(text) {
    el('hint').textContent = text || '';
}
function setRows(text) {
    el('rows').textContent = text || 'Rows: —';
}
function setEta(text) {
    el('eta').textContent = text || '—';
}
function setBar(pct) {
    el('barFill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function appendLog(line) {
    const log = el('log');
    log.textContent = (log.textContent ? log.textContent + '\n' : '') + line;
    log.scrollTop = log.scrollHeight;
    el('lastLine').textContent = line.slice(0, 50) + (line.length > 50 ? '…' : '');
}

function setRunning(running) {
    el('exportPage').disabled = running;
    el('exportAll').disabled = running;
    el('cancel').disabled = !running;
    el('maxPages').disabled = running;
    el('exportFormat').disabled = running;
    el('shippingMode').disabled = running;
}

// --- export format / shipping UI ---
function updateShippingVisibility() {
    const format = el('exportFormat').value;

    const shippingField = el('shippingField');
    if (format === 'manabox') {
        shippingField.classList.remove('hidden');
    } else {
        // Hide + force None
        shippingField.classList.add('hidden');
        el('shippingMode').value = 'none';
    }
}

el('exportFormat').addEventListener('change', updateShippingVisibility);

// --- tab helpers ---
async function getActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function injectFiles(tabId, files) {
    await browser.scripting.executeScript({
        target: { tabId },
        files,
    });
}

// --- ETA estimation (moving average per order) ---
let startTs = 0;
let lastOrderIdx = 0;
let samples = [];

function resetEta() {
    startTs = Date.now();
    lastOrderIdx = 0;
    samples = [];
    setEta('—');
}

function updateEta(current, total) {
    if (!startTs || total <= 0) return;

    if (current > lastOrderIdx) {
        const now = Date.now();
        const elapsed = now - startTs;

        const perOrder = elapsed / current;
        samples.push(perOrder);
        if (samples.length > 8) samples.shift();

        lastOrderIdx = current;
    }

    if (!samples.length) return;

    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const remaining = Math.max(0, total - current);
    const etaMs = remaining * avg;

    const mins = Math.floor(etaMs / 60000);
    const secs = Math.floor((etaMs % 60000) / 1000);
    setEta(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
}

function extractRowsFromNote(note) {
    if (!note) return null;
    const m = note.match(/Total rows(?: so far)?:\s*(\d+)/i) || note.match(/Total rows:\s*(\d+)/i);
    return m ? Number(m[1]) : null;
}

// Live progress from content.js
browser.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'CM_EXPORT_PROGRESS') return;
    if (currentRunId && msg.runId !== currentRunId) return;

    const phase = msg.phase || 'working';
    setPhase(phase);
    setState('run', 'Running');

    if (typeof msg.current === 'number' && typeof msg.total === 'number' && msg.total > 0) {
        setCount(`${msg.current}/${msg.total}`);
        setBar((msg.current / msg.total) * 100);
        updateEta(msg.current, msg.total);
    }

    if (msg.note) setHint(msg.note);

    const rows = extractRowsFromNote(msg.note);
    if (typeof rows === 'number') setRows(`Rows: ${rows}`);

    const parts = [`[${phase}]`];
    if (msg.orderId) parts.push(`Order ${msg.orderId}`);
    if (msg.note) parts.push(msg.note);
    appendLog(parts.join(' '));
});

async function runExport(mode) {
    try {
        const tab = await getActiveTab();
        activeTabId = tab.id;

        const maxPagesRaw = el('maxPages').value;
        const maxPages = maxPagesRaw ? Number(maxPagesRaw) : null;

        const exportFormat = el('exportFormat').value || 'csv';
        const shippingMode =
            exportFormat === 'manabox' ? el('shippingMode').value || 'none' : 'none';

        currentRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        el('log').textContent = '';
        el('lastLine').textContent = '—';
        setState('run', 'Running');
        setPhase('Starting');
        setHint('Injecting scripts…');
        setCount('—');
        setRows('Rows: —');
        setBar(0);
        resetEta();
        setRunning(true);

        await injectFiles(tab.id, ['csv.js', 'content.js']);
        appendLog('[inject] OK');

        setHint(mode === 'all' ? 'Scraping all pages…' : 'Scraping current page…');

        // Ask content.js to scrape -> it will call background to build + download
        const resp = await browser.tabs.sendMessage(tab.id, {
            type: 'CM_EXPORT_PURCHASES',
            mode,
            maxPages,
            runId: currentRunId,
            exportFormat,
            shippingMode, // will be "none" unless ManaBox is selected
        });

        if (resp?.ok) {
            setState('ok', 'Done');
            setPhase('Done');
            setHint(`Saved ${resp.filename}`);
            setCount(`Rows: ${resp.rows}`);
            setBar(100);
            setEta('0s');
            appendLog(`[done] File: ${resp.filename}`);
        } else {
            setState('bad', 'Failed');
            setPhase('Failed');
            setHint('See log for details');
            setBar(0);
            appendLog(`[error] ${resp?.error || 'No response from content script.'}`);
        }
    } catch (e) {
        setState('bad', 'Failed');
        setPhase('Failed');
        setHint('Injection or messaging failed');
        setBar(0);
        appendLog(`[fatal] ${e?.message || String(e)}`);
    } finally {
        setRunning(false);
    }
}

el('exportPage').addEventListener('click', () => runExport('page'));
el('exportAll').addEventListener('click', () => runExport('all'));

el('cancel').addEventListener('click', async () => {
    try {
        if (!activeTabId || !currentRunId) return;
        appendLog('[cancel] requested');
        await browser.tabs.sendMessage(activeTabId, {
            type: 'CM_EXPORT_CANCEL',
            runId: currentRunId,
        });
    } catch (e) {
        appendLog(`[cancel-error] ${e?.message || String(e)}`);
    }
});

el('clear').addEventListener('click', () => {
    el('log').textContent = '';
    el('lastLine').textContent = '—';
    setHint('Cleared');
});

el('toggleLog').addEventListener('click', () => {
    const wrap = el('logWrap');
    const hidden = wrap.style.display === 'none';
    wrap.style.display = hidden ? 'flex' : 'none';
    el('toggleLog').textContent = hidden ? 'Hide log' : 'Show log';
});

// Initial state
setState('idle', 'Idle');
setPhase('Idle');
setHint('Ready');
setCount('—');
setRows('Rows: —');
setEta('—');
setBar(0);

// Ensure shipping UI matches current selection
updateShippingVisibility();
