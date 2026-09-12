#!/usr/bin/env node
/**
 * Generate chunked sitemaps for IMPA store SEO URLs.
 * Output: public/sitemap.xml (index) + public/sitemap-store-N.xml
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const URLS_PER_SITEMAP = 10_000;
const origin = String(process.env.STORE_SEO_ORIGIN || 'https://www.thevesselcode.com').replace(/\/$/, '');
const lastmod = new Date().toISOString().slice(0, 10);

const CORE_PAGES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/toolkit', changefreq: 'weekly', priority: '0.9' },
  { path: '/contact-us', changefreq: 'monthly', priority: '0.7' },
];

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

const coreUrls = CORE_PAGES.map(({ path, changefreq, priority }) => `  <url>
    <loc>${origin}${path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`).join('\n');
const coreXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${coreUrls}
</urlset>
`;
writeFileSync(join(publicDir, 'sitemap-core.xml'), coreXml);
console.log('OK public/sitemap-core.xml', `(${CORE_PAGES.length} URLs)`);

const lastmodStore = lastmod;
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
    <lastmod>${lastmodStore}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
    writeFileSync(join(publicDir, fileName), xml);
    console.log('OK', `public/${fileName}`, `(${chunk.length} URLs)`);
});

const indexEntries = [
  `  <sitemap>
    <loc>${origin}/sitemap-core.xml</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`,
  ...chunkFiles.map((fileName) => `  <sitemap>
    <loc>${origin}/${fileName}</loc>
    <lastmod>${lastmodStore}</lastmod>
  </sitemap>`),
].join('\n');

const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexEntries}
</sitemapindex>
`;
writeFileSync(join(publicDir, 'sitemap.xml'), sitemapIndex);
console.log('OK public/sitemap.xml', `(${chunkFiles.length + 1} child sitemaps, ${codes.length} store URLs)`);

for (const file of readdirSync(publicDir)) {
  const stale = /^sitemap-store-(\d+)\.xml$/.exec(file);
  if (stale && !chunkFiles.includes(file)) {
    unlinkSync(join(publicDir, file));
    console.log('OK removed stale', `public/${file}`);
  }
}

const sitemapAllowLines = [
  'Allow: /sitemap.xml',
  'Allow: /sitemap-core.xml',
  ...chunkFiles.map((fileName) => `Allow: /${fileName}`),
  'Allow: /data/plates/',
];
const sitemapDirectiveLines = [
  `Sitemap: ${origin}/sitemap.xml`,
  `Sitemap: ${origin}/sitemap-core.xml`,
  ...chunkFiles.map((fileName) => `Sitemap: ${origin}/${fileName}`),
];

const robots = `User-agent: *
${sitemapAllowLines.join('\n')}
Allow: /store/
Allow: /toolkit
Allow: /services
Allow: /sm
Allow: /contact-us

${sitemapDirectiveLines.join('\n')}
`;
writeFileSync(join(publicDir, 'robots.txt'), robots);
console.log('OK public/robots.txt', `(${chunkFiles.length} store sitemap directives)`);
