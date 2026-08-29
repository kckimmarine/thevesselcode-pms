/* THE VESSEL CODE — Service Worker (Offline-first) */
const CACHE_VERSION = 'tvc-pms-20260830-admin-web-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

/** App shell — precached on install for offline boot */
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/app.css',
    '/css/responsive-scale.css',
    '/js/pwa.js',
    '/icons/icon.svg',
    '/icons/icon-maskable.svg',
    '/vendor/jszip.min.js',
    '/vendor/exceljs.min.js',
    '/vendor/xlsx.full.min.js',
    '/js/rbac.js',
    '/js/core/schema.js',
    '/js/core/db.js',
    '/js/core/indexes.js',
    '/js/pms.js',
    '/js/ui/viewportScale.js',
    '/js/ui/virtualList.js',
    '/js/ui/modalDrag.js',
    '/js/ui/runHours.js',
    '/js/ui/outstandingTasks.js',
    '/js/services/vendors.js',
    '/js/ui/spareMenu.js',
    '/js/ui/spareRequest.js',
    '/js/services/jobMeta.js',
    '/js/services/inventory.js',
    '/js/services/inventoryService.js',
    '/js/services/excel.js',
    '/data/spare-parts-requisition-template.xlsx',
    '/js/core/pbkdf2-fallback.js',
    '/js/space.js',
    '/js/config.js',
    '/js/auth.js',
    '/js/services/transaction.js',
    '/js/services/maintenancePlan.js',
    '/js/services/pmsMasterExcel.js',
    '/js/services/defectCase.js',
    '/js/services/defectSync.js',
    '/js/services/postponeSync.js',
    '/js/services/sync.js',
    '/js/services/masterBackup.js',
    '/js/services/stationSync.js',
    '/js/services/onlineSync.js',
    '/js/services/fleet.js',
    '/js/services/dataPurge.js',
    '/js/services/seed.js',
    '/js/ui/listFilters.js',
    '/js/ui/defectReport.js',
    '/js/app.js',
];

const OFFLINE_EXTENSIONS = ['.js', '.css', '.json', '.svg', '.woff', '.woff2'];

function isSameOrigin(url) {
    return url.origin === self.location.origin;
}

function isCacheableAsset(pathname) {
    if (pathname.startsWith('/vendor/')) return true;
    if (pathname.startsWith('/js/')) return true;
    if (pathname.startsWith('/css/')) return true;
    if (pathname.startsWith('/icons/')) return true;
    if (pathname.startsWith('/data/')) return true;
    if (pathname === '/manifest.json') return true;
    return OFFLINE_EXTENSIONS.some(ext => pathname.endsWith(ext));
}

/** Online: network-first so ?v= cache-bust query strings always fetch latest code */
function networkFirstAsset(request) {
    return fetch(request).then(res => {
        if (res && res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return res;
    }).catch(async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        return cache.match(request)
            || cache.match(request, { ignoreSearch: true })
            || Response.error();
    });
}

function networkFirstNavigation(request) {
    return fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return cache.match('/index.html', { ignoreSearch: true })
            || cache.match('/', { ignoreSearch: true })
            || Response.error();
    });
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(PRECACHE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k.startsWith('tvc-pms-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
                .map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (!isSameOrigin(url)) return;

    if (request.mode === 'navigate' || request.destination === 'document') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (isCacheableAsset(url.pathname)) {
        event.respondWith(networkFirstAsset(request));
    }
});
