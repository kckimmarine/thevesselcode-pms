# Superintendent (Gemini) context exports

## Modular (recommended)

```bash
# 3 sections (full frontend in one file — may be ~3.4 MB)
npm run export:modular-context

# 6 lighter files for Gemini web chat (no truncation)
npm run export:modular-context:split
```

Outputs are written to the **repository root** (`context-*.txt`), gitignored — regenerate locally or ask Cursor Agent to run the command.

Upload order for audit: `context-1-frontend-shell` → `context-2-frontend-app` → … (split mode) or `context-1-frontend.txt` first (monolithic).

Operational workflow: **Shipowner → Gemini → Cursor Agent** (see `docs/GEMINI-COLLAB.md`).
