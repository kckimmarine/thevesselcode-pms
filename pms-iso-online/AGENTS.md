# AGENTS.md — PERFECT MARINE SOLUTION ISO (Online)

**Online-first** ISO audit management. Not TVC-PMS app code.

## Stack

| Layer | Path |
|-------|------|
| Portal UI | `portal/` |
| Supabase schema | `deploy/supabase-schema.sql`, `deploy/supabase-storage.sql` |
| Optional Markdown | `content/` |

## Rules

1. Use a **dedicated Supabase project** — never TVC-PMS production DB.
2. Document register lives in `iso_documents` table; do not rely on chat-only state.
3. Sensitive PDFs go to Storage bucket `iso-evidence`, not git.
4. Korean UI copy in `portal/` is expected.

## Commands

```bash
npm start
npm run setup:supabase
npm run verify
```

## Related

TVC-PMS software: https://github.com/kckimmarine/thevesselcode-pms
