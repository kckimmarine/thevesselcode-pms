# Gemini → GitHub Issue Webhook

Receives a Gemini-authored work-instruction JSON and creates a GitHub Issue
tagged with the **`cursor-agent`** label so a Cursor agent picks it up.

- Endpoint: `POST /api/gemini/create-issue`
- Handler: [`api/gemini/create-issue.js`](../api/gemini/create-issue.js)
- Logic: [`api/_lib/githubIssues.js`](../api/_lib/githubIssues.js)
- Test: `npm run test-gemini-issue-endpoint`

## Server configuration (Vercel env vars)

| Env var | Required | Purpose |
|---------|----------|---------|
| `GITHUB_ISSUE_TOKEN` (or `GITHUB_TOKEN`) | ✅ | GitHub PAT / fine-grained token with **Issues: write** on the target repo. |
| `GITHUB_ISSUE_REPO` (or `GITHUB_REPO`) | ✅ | Target repo as `owner/repo`, e.g. `kckimmarine/thevesselcode-pms`. |
| `GEMINI_ISSUE_WEBHOOK_SECRET` (or `GEMINI_WEBHOOK_SECRET`) | ✅ | Shared secret required on every request. |
| `GITHUB_API_URL` | — | Override for GitHub Enterprise (defaults to `https://api.github.com`). |

Make sure the `cursor-agent` label exists in the repo (GitHub auto-creates
unknown labels on issue creation, but pre-creating it lets you pick a color).

## Authentication

Send the shared secret on every request, either as a bearer token or header:

```
Authorization: Bearer <GEMINI_ISSUE_WEBHOOK_SECRET>
# or
x-tvc-gemini-key: <GEMINI_ISSUE_WEBHOOK_SECRET>
```

## Request body

`Content-Type: application/json`. The instruction may be sent at the top level
or wrapped under `instruction` / `work` / `task` / `issue` / `data`.

| Field | Required | Notes |
|-------|----------|-------|
| `title` (or `summary` / `name`) | ✅ | Issue title. |
| `body` | — | If present, used verbatim as the issue body (skips composition). |
| `description` (or `details`) | — | Composed into the body. |
| `context` | — | Rendered as a `## Context` section. |
| `tasks` (or `steps` / `subtasks` / `instructions`) | — | Rendered as a `## Tasks` checklist. |
| `acceptance_criteria` (or `done_when` / `acceptance`) | — | Rendered as a `## Acceptance Criteria` checklist. |
| `files` (or `paths`) | — | Rendered as a `## Files` list. |
| `labels` | — | Extra labels; `cursor-agent` is always added and deduped. |
| `assignees` | — | Optional GitHub usernames. |

The full original JSON is always appended to the issue body inside a
collapsible `<details>` block for traceability.

## Example

```bash
curl -X POST "https://app.thevesselcode.com/api/gemini/create-issue" \
  -H "Authorization: Bearer $GEMINI_ISSUE_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add CSV export to SPARE inventory",
    "description": "HQ users need to export the current SPARE inventory to CSV.",
    "tasks": ["Add Export CSV button", "Wire click to CSV generation"],
    "acceptance_criteria": ["CSV downloads with all rows"],
    "labels": ["enhancement", "spare"]
  }'
```

Success (`201`):

```json
{
  "ok": true,
  "issue_number": 123,
  "issue_url": "https://api.github.com/repos/owner/repo/issues/123",
  "html_url": "https://github.com/owner/repo/issues/123",
  "labels": ["cursor-agent", "enhancement", "spare"]
}
```

## Responses

| Status | `error` | When |
|--------|---------|------|
| `201` | — | Issue created. |
| `400` | `BAD_REQUEST` | Empty/invalid JSON or missing `title`. |
| `401` | `UNAUTHORIZED` | Missing/incorrect secret. |
| `405` | `METHOD_NOT_ALLOWED` | Not a `POST`. |
| `501` | `NOT_CONFIGURED` | Server env vars not set. |
| `502` | `GITHUB_ERROR` / `GITHUB_UNREACHABLE` | GitHub rejected the request or was unreachable. |
