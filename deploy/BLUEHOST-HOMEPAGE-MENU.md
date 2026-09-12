# Bluehost homepage menu — PMS & Toolkit

Marketing site **thevesselcode.com** navigation is managed in **WordPress** (Bluehost).

Embed pages are **static files** (same pattern as PMS):

| Server file | URL |
|-------------|-----|
| `public_html/maritime-pms/index.html` | https://thevesselcode.com/maritime-pms/ |
| `public_html/maritime-toolkit/index.html` | https://thevesselcode.com/maritime-toolkit/ |

> Do **not** use `/pms/` or `/toolkit/` — WordPress page slugs intercept those paths on Bluehost.

**Do not** embed iframe inside WordPress pages. Use **Custom Link** in the menu + static `index.html` on the server.

See **[TOOLKIT-LIKE-PMS.md](./TOOLKIT-LIKE-PMS.md)** for Toolkit setup (Korean, step-by-step).

**Homepage lead-gen (FAB + demo form):** **[HOME-LEAD-GEN.md](./HOME-LEAD-GEN.md)** — paste `bluehost/wp/tvc-home-lead-gen.html` into WPCode footer.

## Menu (Custom Link)

1. WordPress → **Appearance → Menus** (or Site Editor → Navigation)
2. Add **Custom Link**:
   - Toolkit → `https://thevesselcode.com/maritime-toolkit/`
   - PMS → `https://thevesselcode.com/maritime-pms/`
3. Save menu, clear cache.

## Deploy files

```bash
npm run deploy:bluehost
```

Or cPanel File Manager → upload `bluehost/toolkit/index.html` and `bluehost/pms/index.html`.
