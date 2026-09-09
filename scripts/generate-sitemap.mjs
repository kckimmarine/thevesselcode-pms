#!/usr/bin/env node
/**
 * Generate chunked sitemaps for IMPA store SEO URLs.
 * Output: public/sitemap.xml (index) + public/sitemap-store-N.xml
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const URLS_PER_SITEMAP = 10_000;
const origin = String(process.env.STORE_SEO_ORIGIN || 'https://app.thevesselcode.com').replace(/\/$/, '');

const indexPath = join(root, 'api', '_data', 'impa-seo-index.json');
const fallbackPath = join(root, 'public', 'data', 'impa-seo-index.json');
const source = existsSync(indexPath) ? indexPath : fallbackPath;
if (!existsSync(source)) {
    console.error('MISSING impa-seo-index.json — run generate-impa-seo-index.mjs first');
    process.exit(1);
}

const payload = JSON.parse(readFileSync(source, 'utf8'));
const codes = Object.keys(payload.items || {}).sort();
const publicDir = join(root, 'public');
mkdirSync(publicDir, { recursive: true });

const lastmod = new Date().toISOString().slice(0, 10);
const chunks = [];
for (let i = 0; i < codes.length; i += URLS_PER_SITEMAP) {
    chunks.push(codes.slice(i, i + URLS_PER_SITEMAP));
}

const chunkFiles = [];
chunks.forEach((chunk, idx) => {
    const fileName = `sitemap-store-${idx + 1}.xml`;
    chunkFiles.push(fileName);
    const urls = chunk.map((code) => `  <url>
    <loc>${origin}/store/${code}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
    writeFileSync(join(publicDir, fileName), xml);
    console.log('OK', `public/${fileName}`, `(${chunk.length} URLs)`);
});

const indexEntries = chunkFiles.map((fileName) => `  <sitemap>
    <loc>${origin}/${fileName}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`).join('\n');

const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexEntries}
</sitemapindex>
`;
writeFileSync(join(publicDir, 'sitemap.xml'), sitemapIndex);
console.log('OK public/sitemap.xml', `(${chunkFiles.length} child sitemaps, ${codes.length} URLs)`);

const robots = `User-agent: *
Allow: /store/
Allow: /toolkit
Allow: /about-contact/

Sitemap: ${origin}/sitemap.xml
`;
writeFileSync(join(publicDir, 'robots.txt'), robots);
console.log('OK public/robots.txt');
