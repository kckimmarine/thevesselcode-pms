/**
 * Host-based routing for marketing vs PMS app on the same Vercel project.
 * - thevesselcode.com / www → marketing landing at /home/
 * - app.thevesselcode.com → PMS index.html (default static)
 */
const MARKETING_HOSTS = new Set(['thevesselcode.com', 'www.thevesselcode.com']);

export default function middleware(request) {
    const url = new URL(request.url);
    const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();

    if (!MARKETING_HOSTS.has(host)) {
        return;
    }

    if (url.pathname === '/' || url.pathname === '') {
        url.pathname = '/home/index.html';
        return Response.rewrite(url);
    }

    return;
}

export const config = {
    matcher: ['/'],
};
