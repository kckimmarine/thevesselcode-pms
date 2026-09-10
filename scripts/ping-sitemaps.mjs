#!/usr/bin/env node
/**
 * Notify search engines about updated sitemaps after build/deploy.
 *
 * Google deprecated the sitemap ping endpoint in 2023; rely on robots.txt,
 * GSC sitemap submission, and scripts/push-indexing.mjs for Google discovery.
 * Bing ping remains supported and is attempted here.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ORIGIN = 'https://www.thevesselcode.com';

function storeOrigin() {
    return String(process.env.STORE_SEO_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');
}

function discoverSitemapUrls() {
    const origin = storeOrigin();
    const publicDir = join(process.cwd(), 'public');
    const urls = [`${origin}/sitemap.xml`];

    if (existsSync(publicDir)) {
        readdirSync(publicDir)
            .filter((file) => /^sitemap-(core|store-\d+)\.xml$/.test(file))
            .sort()
            .forEach((file) => urls.push(`${origin}/${file}`));
    }

    return [...new Set(urls)];
}

async function pingBing(sitemapUrl) {
    const endpoint = `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    const response = await fetch(endpoint, { method: 'GET' });
    return { engine: 'bing', sitemapUrl, status: response.status, ok: response.ok };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const sitemapUrls = discoverSitemapUrls();

    console.log(`Sitemap ping targets (${sitemapUrls.length}):`);
    sitemapUrls.forEach((url) => console.log(' -', url));
    console.log('Note: Google sitemap ping is deprecated; use GSC + push-indexing.mjs for Google.');

    if (dryRun) {
        console.log('Dry run — no ping requests sent.');
        return;
    }

    const results = [];
    for (const sitemapUrl of sitemapUrls) {
        try {
            results.push(await pingBing(sitemapUrl));
        } catch (error) {
            results.push({
                engine: 'bing',
                sitemapUrl,
                ok: false,
                error: error.message || String(error),
            });
        }
    }

    results.forEach((result) => {
        if (result.ok) {
            console.log(`OK bing ${result.status} ${result.sitemapUrl}`);
        } else {
            console.warn(`WARN bing ${result.sitemapUrl}`, result.error || result.status);
        }
    });

    const failed = results.filter((r) => !r.ok).length;
    if (failed === results.length && results.length > 0) {
        console.warn('All sitemap pings failed (non-fatal for build).');
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
