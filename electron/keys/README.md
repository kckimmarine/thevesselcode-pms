# License keys

- `public.pem` — embedded in the app for signature verification (safe to commit).
- `private.pem` — **never distribute**. Used only by `npm run license:issue`.

Generate:

```bash
npm run license:keys
```

Issue Pilot licenses (3 months):

```bash
npm run license:issue
```
