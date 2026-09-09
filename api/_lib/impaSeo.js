'use strict';

const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const CHAPTER_CATEGORY = {
    '33': 'Safety Equipment',
    '59': 'Safety Equipment',
    '61': 'Hand Tools',
    '75': 'Valves & Cocks',
    '79': 'Paints & Coatings',
    '81': 'Packing & Jointing',
};

const INDEX_PATHS = [
    join(process.cwd(), 'api', '_data', 'impa-seo-index.json'),
    join(process.cwd(), 'public', 'data', 'impa-seo-index.json'),
];

let _indexCache = null;

function storeSeoOrigin() {
    const fromEnv = String(process.env.STORE_SEO_ORIGIN || '').trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    return 'https://app.thevesselcode.com';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeCode(value) {
    return String(value || '').trim().replace(/\D/g, '').padStart(6, '0').slice(-6);
}

function isValidImpaCode(value) {
    const code = String(value || '').trim();
    return /^\d{4,6}$/.test(code);
}

function expandCompactRow(raw, code) {
    if (!raw || typeof raw !== 'object') return null;
    const impaCode = normalizeCode(raw.c || raw.impa_code || raw.code || code);
    if (!impaCode || impaCode === '000000') return null;
    const chapter = String(raw.g || impaCode.slice(0, 2) || '').trim();
    const specs = raw.specs && typeof raw.specs === 'object' ? { ...raw.specs } : {};
    return {
        impa_code: impaCode,
        code: impaCode,
        name: String(raw.n || raw.name || '').trim(),
        unit: String(raw.u || raw.unit || 'PCS').trim() || 'PCS',
        category: raw.category || CHAPTER_CATEGORY[chapter] || `Chapter ${chapter}`,
        chapter,
        plate_id: String(raw.p || raw.plate_id || raw.plate_no || '').trim(),
        specs,
    };
}

function loadIndex() {
    if (_indexCache) return _indexCache;
    const path = INDEX_PATHS.find((p) => existsSync(p));
    if (!path) {
        throw new Error('IMPA SEO index missing. Run scripts/generate-impa-seo-index.mjs during build.');
    }
    _indexCache = JSON.parse(readFileSync(path, 'utf8'));
    return _indexCache;
}

function getItemByCode(code) {
    const normalized = normalizeCode(code);
    if (!isValidImpaCode(normalized)) return null;
    const index = loadIndex();
    const raw = index.items?.[normalized];
    if (!raw) return null;
    return expandCompactRow(raw, normalized);
}

function derivePlateAssetUrl(item) {
    const code = item?.impa_code || '';
    const chapter = code.slice(0, 2);
    const segment = code.slice(2, 4);
    if (chapter && segment) {
        return `/data/plates/PL-${chapter}-${segment}.webp`;
    }
    return '';
}

function specRows(item) {
    const rows = [
        ['IMPA Code', item.impa_code],
        ['Product Name', item.name],
        ['Unit of Measure', item.unit],
        ['Catalog Section', item.category],
    ];
    if (item.plate_id) rows.push(['Plate Reference', item.plate_id]);
    Object.entries(item.specs || {}).forEach(([key, value]) => {
        if (value != null && String(value).trim()) rows.push([key, String(value)]);
    });
    return rows.filter(([, value]) => String(value || '').trim());
}

function buildDescription(item) {
    const bits = [
        `Technical specifications and marine stores data for IMPA ${item.impa_code}`,
        item.name ? `(${item.name})` : '',
        item.unit ? `Unit: ${item.unit}.` : '',
        item.category ? `Section: ${item.category}.` : '',
    ].filter(Boolean);
    const text = bits.join(' ').replace(/\s+/g, ' ').trim();
    return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function buildJsonLd(item, pageUrl, imageUrl) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: item.name || `IMPA ${item.impa_code}`,
        sku: item.impa_code,
        category: item.category,
        description: buildDescription(item),
        url: pageUrl,
        brand: {
            '@type': 'Brand',
            name: 'IMPA Marine Stores Guide',
        },
        manufacturer: {
            '@type': 'Organization',
            name: 'THE VESSEL CODE',
        },
        ...(imageUrl ? { image: imageUrl } : {}),
    };
}

function buildStoreItemHtml(item, { origin } = {}) {
    const base = (origin || storeSeoOrigin()).replace(/\/$/, '');
    const pageUrl = `${base}/store/${item.impa_code}`;
    const toolkitUrl = `${base}/toolkit?impa=${encodeURIComponent(item.impa_code)}`;
    const title = `IMPA ${item.impa_code} - ${item.name || 'Marine Store Item'} | The Vessel Code`;
    const description = buildDescription(item);
    const plateUrl = derivePlateAssetUrl(item);
    const imageUrl = plateUrl ? `${base}${plateUrl}` : '';
    const rows = specRows(item);
    const tableHtml = rows.map(([label, value]) => (
        `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )).join('');
    const jsonLd = JSON.stringify(buildJsonLd(item, pageUrl, imageUrl || undefined));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(pageUrl)}">
  <meta name="robots" content="index,follow">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="THE VESSEL CODE">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : ''}
  <meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", system-ui, sans-serif; }
    body { margin: 0; background: #f4f7fb; color: #0f172a; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 24px 16px 48px; }
    .card { background: #fff; border: 1px solid #dbe4f0; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(15,23,42,.06); }
    .badge { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #0b3d91; background: #e8f1ff; border-radius: 999px; padding: 6px 10px; }
    h1 { margin: 12px 0 8px; font-size: clamp(1.35rem, 2.8vw, 2rem); line-height: 1.2; }
    .lead { color: #475569; line-height: 1.6; margin: 0 0 20px; }
    .grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 768px) { .grid { grid-template-columns: 280px minmax(0, 1fr); align-items: start; } }
    .plate { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; min-height: 220px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .plate img { width: 100%; height: auto; display: block; }
    .plate-fallback { padding: 24px; text-align: center; color: #64748b; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { width: 38%; color: #475569; font-weight: 600; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 10px; font-weight: 700; text-decoration: none; }
    .btn-primary { background: #0b3d91; color: #fff; }
    .btn-secondary { background: #fff; color: #0b3d91; border: 1px solid #bfd0ea; }
    .footer { margin-top: 18px; color: #64748b; font-size: 13px; }
  </style>
</head>
<body>
  <main class="wrap">
    <article class="card" itemscope itemtype="https://schema.org/Product">
      <span class="badge">IMPA ${escapeHtml(item.impa_code)}</span>
      <h1 itemprop="name">${escapeHtml(item.name || `IMPA ${item.impa_code}`)}</h1>
      <p class="lead">${escapeHtml(description)}</p>
      <div class="grid">
        <section class="plate" aria-label="Catalog plate">
          ${imageUrl
        ? `<img src="${escapeHtml(plateUrl)}" alt="IMPA ${escapeHtml(item.impa_code)} catalog plate" loading="lazy" itemprop="image">`
        : `<div class="plate-fallback">Catalog plate reference: ${escapeHtml(item.plate_id || 'Not available')}</div>`}
        </section>
        <section aria-label="Specifications">
          <table class="spec-table">
            <tbody>${tableHtml}</tbody>
          </table>
        </section>
      </div>
      <div class="actions">
        <a class="btn btn-primary" href="${escapeHtml(toolkitUrl)}">Open Interactive Maritime Toolkit</a>
        <a class="btn btn-secondary" href="${escapeHtml(`${base}/toolkit`)}">Browse Full IMPA Catalog</a>
      </div>
      <p class="footer">THE VESSEL CODE — offline-first PMS + SPICS and maritime toolkit for shipboard operations.</p>
    </article>
  </main>
</body>
</html>`;
}

function buildNotFoundHtml(code, { origin } = {}) {
    const base = (origin || storeSeoOrigin()).replace(/\/$/, '');
    const title = `IMPA ${escapeHtml(code || 'Item')} Not Found | The Vessel Code`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="robots" content="noindex,follow">
  <link rel="canonical" href="${escapeHtml(`${base}/toolkit`)}">
</head>
<body style="font-family:system-ui,sans-serif;padding:32px;">
  <h1>IMPA item not found</h1>
  <p>No catalog entry matched code <strong>${escapeHtml(code || '')}</strong>.</p>
  <p><a href="${escapeHtml(`${base}/toolkit`)}">Open Maritime Toolkit</a></p>
</body>
</html>`;
}

module.exports = {
    CHAPTER_CATEGORY,
    storeSeoOrigin,
    normalizeCode,
    isValidImpaCode,
    expandCompactRow,
    loadIndex,
    getItemByCode,
    buildDescription,
    buildStoreItemHtml,
    buildNotFoundHtml,
};
