function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    // Quote if it contains special chars
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function toCsv(rows, columns) {
    const header = columns.map(csvEscape).join(',');
    const lines = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(','));
    // Excel-friendly UTF-8 BOM is often helpful:
    return '\uFEFF' + [header, ...lines].join('\r\n');
}

// Expose globally for content.js
window.CM_CSV = { toCsv };
