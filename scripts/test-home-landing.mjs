#!/usr/bin/env node
/**
 * Smoke test: marketing site shell, routing, and shared header
 * Run: node scripts/test-home-landing.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(ok ? 'OK' : 'FAIL', name, detail ? `— ${detail}` : '');
}

check('home/index.html exists', existsSync(join(ROOT, 'home/index.html')));
check('services/index.html exists', existsSync(join(ROOT, 'services/index.html')));
check('pms/index.html exists', existsSync(join(ROOT, 'pms/index.html')));
check('contact-us/index.html exists', existsSync(join(ROOT, 'contact-us/index.html')));
check('js/marketing-shell.js exists', existsSync(join(ROOT, 'js/marketing-shell.js')));
check('css/marketing-shell.css exists', existsSync(join(ROOT, 'css/marketing-shell.css')));

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const redirects = vercel.redirects || [];
const rewrites = vercel.rewrites || [];

check('home redirect to root', redirects.some((r) => r.source === '/home/' && r.destination === '/'));
check('about-contact redirect', redirects.some((r) => r.source === '/about-contact/' && r.destination === '/contact-us'));
check('no / -> /home/ redirect', !redirects.some((r) => r.destination === '/home/'));
check('app host root rewrite', rewrites.some((r) => r.source === '/' && r.destination === '/app.html'));
check('marketing host root rewrite', rewrites.some((r) => r.source === '/' && r.destination === '/home/index.html'));
check('services rewrite', rewrites.some((r) => r.destination === '/services/index.html'));
check('pms rewrite', rewrites.some((r) => r.destination === '/pms/index.html'));
check('pms not redirected to app', !redirects.some((r) => r.source === '/pms' && String(r.destination).includes('app.thevesselcode.com')));
check('contact-us rewrite', rewrites.some((r) => r.destination === '/contact-us/index.html'));

const shell = readFileSync(join(ROOT, 'js/marketing-shell.js'), 'utf8');
const home = readFileSync(join(ROOT, 'home/index.html'), 'utf8');
check('marketing topbar mount', home.includes('id="marketing-topbar"'));
check('marketing shell script', home.includes('marketing-shell.js'));
check('hero slogan', home.includes('Decoding the Engineering, Operations, and Economics'));
check('home hero smart vessel class', home.includes('mkt-hero-smart-vessel'));
check('hero vessel image asset exists', existsSync(join(ROOT, 'public/assets/images/hero-smart-vessel.jpg')));
check('sync-public-assets script exists', existsSync(join(ROOT, 'scripts/sync-public-assets.mjs')));
check('home hero variant picker', home.includes('home-hero-variant-picker') && home.includes('home-hero-variant.js'));
check('home hero variant script exists', existsSync(join(ROOT, 'js/home-hero-variant.js')));
check('home hero eyebrow removed', !home.includes('Former C/E'));
check('services link in marketing shell', shell.includes("href: '/services'"));
check('pms nav internal route', shell.includes("href: '/pms'") && !shell.includes("href: 'https://app.thevesselcode.com', label: 'TVC-PMS'"));
check('contact us link in marketing footer', shell.includes("href: '/contact-us'"));
check('no inline services section on home', !home.includes('id="service-superintendent"'));
check('canonical root', home.includes('https://thevesselcode.com/'));

const services = readFileSync(join(ROOT, 'services/index.html'), 'utf8');
check('services page pillars', services.includes('Owner') && services.includes('Strategic Supply'));
check('services active nav', services.includes('data-mkt-active="services"'));
check('services photo card classes', services.includes('home-service-card--photo') && services.includes('home-service-card--superintendent'));
const serviceImages = [
    'service-superintendent.jpg',
    'service-retrofit.jpg',
    'service-psc.jpg',
    'service-repair.jpg',
    'service-supply.webp',
];
serviceImages.forEach((name) => {
    check(`service image asset ${name}`, existsSync(join(ROOT, 'public/assets/images/services', name)));
});
check('service photo css', readFileSync(join(ROOT, 'css/marketing-theme.css'), 'utf8').includes('home-service-card--photo'));

const pms = readFileSync(join(ROOT, 'pms/index.html'), 'utf8');
check('pms page hero title', pms.includes('Fleet Planned Maintenance'));
check('pms active nav', pms.includes('data-mkt-active="pms"'));
check('pms go to app CTA', pms.includes('href="https://app.thevesselcode.com"'));
check('home explore pms internal', home.includes('href="/pms"'));

const contact = readFileSync(join(ROOT, 'contact-us/index.html'), 'utf8');
check('contact us title', contact.includes('Contact Us | THE VESSEL CODE'));
check('contact form', contact.includes('id="acContactForm"'));

const toolkit = readFileSync(join(ROOT, 'toolkit.html'), 'utf8');
check('toolkit shared header', toolkit.includes('marketing-topbar'));
check('toolkit no legacy header', !toolkit.includes('store-public-header'));

check('nav contact us in topbar', shell.includes("label: 'Contact Us'"));
check('header contact CTA removed', !shell.includes('home-topbar-cta'));

const marketingCss = [
    join(ROOT, 'css/marketing-theme.css'),
    join(ROOT, 'home/index.html'),
    join(ROOT, 'services/index.html'),
    join(ROOT, 'pms/index.html'),
    join(ROOT, 'contact-us/index.html'),
].map((p) => readFileSync(p, 'utf8')).join('\n');
check('no unsplash on marketing pages', !/unsplash\.com/i.test(marketingCss));
check('marketing theme css exists', existsSync(join(ROOT, 'css/marketing-theme.css')));
check('hero vessel background css', readFileSync(join(ROOT, 'css/marketing-theme.css'), 'utf8').includes('/assets/images/hero-smart-vessel.jpg'));
check('no marketing-photography css', !existsSync(join(ROOT, 'css/marketing-photography.css')));

check('build skips dist/index.html', !existsSync(join(ROOT, 'dist/index.html')));
check('build outputs pms app shell', existsSync(join(ROOT, 'dist/app.html')));
check('build outputs marketing home', existsSync(join(ROOT, 'dist/home/index.html')));
check('build outputs hero vessel image', existsSync(join(ROOT, 'dist/assets/images/hero-smart-vessel.jpg')));
serviceImages.forEach((name) => {
    check(`build outputs service image ${name}`, existsSync(join(ROOT, 'dist/assets/images/services', name)));
});
if (existsSync(join(ROOT, 'dist/app.html'))) {
    const distApp = readFileSync(join(ROOT, 'dist/app.html'), 'utf8');
    check('dist/app.html is PMS', distApp.includes('TVC_App') || distApp.includes('TVC-PMS'));
}
if (existsSync(join(ROOT, 'dist/home/index.html'))) {
    const distHome = readFileSync(join(ROOT, 'dist/home/index.html'), 'utf8');
    check('dist/home/index.html is marketing', distHome.includes('marketing-shell.js'));
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
    console.error('\nMarketing site tests FAILED');
    process.exit(1);
}
console.log('\nMarketing site tests passed.');
