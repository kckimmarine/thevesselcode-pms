# Bluehost homepage menu — PMS & Toolkit

Marketing site **thevesselcode.com** navigation is managed in **WordPress** (Bluehost), not in this git repo.

This repo only ships the embed pages under `bluehost/`:

| Path on server | URL | Purpose |
|----------------|-----|---------|
| `public_html/pms/index.html` | https://thevesselcode.com/pms/ | PMS demo iframe |
| `public_html/toolkit/index.html` | https://thevesselcode.com/toolkit/ | Maritime Toolkit iframe |
| `public_html/impa/index.html` | https://thevesselcode.com/impa/ | **Redirect only** → `/toolkit/` |

## Add Toolkit to the mobile / desktop menu

1. Log in to **WordPress** (Bluehost → cPanel → WordPress / wp-admin).
2. Go to **Appearance → Menus** (or **Customize → Menus**).
3. Open the menu used by the site header (same menu that contains **PMS**).
4. **Add menu item → Custom Link**
   - **URL:** `https://thevesselcode.com/toolkit/`
   - **Link text:** `Toolkit` (or `Maritime Toolkit`)
5. Drag **Toolkit** next to **PMS** (recommended order: … PMS → Toolkit → The Code …).
6. **Save Menu** and clear any cache (Bluehost cache / Cloudflare if enabled).

## Verify

- Mobile hamburger menu shows **Toolkit**.
- Tap opens https://thevesselcode.com/toolkit/ with the Maritime Toolkit embed.
- Old `/impa/` URL redirects to `/toolkit/`.

## Deploy embed files (FTP)

From repo root:

```bash
npm run deploy:bluehost
```

Credentials: `deploy/.env.deploy.local` or Cursor/GitHub secrets (`BLUEHOST_FTP_*`).
