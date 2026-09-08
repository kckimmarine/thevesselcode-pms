# Maritime Toolkit — Bluehost embed

Production URL (avoids WordPress `/toolkit` slug conflict):

| Item | Value |
|------|--------|
| Server path | `public_html/maritime-toolkit/index.html` |
| Public URL | https://thevesselcode.com/maritime-toolkit/ |
| App iframe | https://app.thevesselcode.com/toolkit?embed=1 |
| Menu | Custom Link → `https://thevesselcode.com/maritime-toolkit/` |

Do **not** use `/toolkit/` on Bluehost — WordPress page slug `toolkit` intercepts that path.

## Deploy

```bash
npm run deploy:bluehost
```

Uploads `bluehost/maritime-toolkit/index.html` (and `pms/`, `impa/`).

## Local preview

```
https://thevesselcode.com/maritime-toolkit/?local=1
```

→ iframe loads `http://localhost:3000/toolkit?embed=1`

## App changes (Vercel)

Toolkit UI updates ship with the main repo deploy to `app.thevesselcode.com`.
Bluehost only hosts the thin iframe wrapper.

See also: [TOOLKIT-BLANK-FIX.md](./TOOLKIT-BLANK-FIX.md) for troubleshooting.
