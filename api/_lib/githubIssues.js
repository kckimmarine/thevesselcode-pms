'use strict';

/**
 * Gemini → GitHub Issue bridge.
 *
 * Turns a Gemini-authored work-instruction JSON object into a GitHub Issue and
 * always tags it with the `cursor-agent` label so a Cursor agent picks it up.
 *
 * Server env (set on Vercel):
 *   - GITHUB_ISSUE_TOKEN (or GITHUB_TOKEN): PAT / fine-grained token with
 *     "Issues: write" on the target repo.
 *   - GITHUB_ISSUE_REPO (or GITHUB_REPO): "owner/repo", e.g.
 *     "kckimmarine/thevesselcode-pms". Defaults to GITHUB_REPOSITORY when the
 *     function runs inside GitHub Actions.
 *   - GITHUB_API_URL (optional): override for GitHub Enterprise.
 */

const AGENT_LABEL = 'cursor-agent';
const DEFAULT_API_BASE = 'https://api.github.com';

function githubConfig() {
    const token = String(process.env.GITHUB_ISSUE_TOKEN || process.env.GITHUB_TOKEN || '').trim();
    const repo = String(
        process.env.GITHUB_ISSUE_REPO || process.env.GITHUB_REPO || process.env.GITHUB_REPOSITORY || '',
    ).trim();
    const apiBase = String(process.env.GITHUB_API_URL || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
    return { token, repo, apiBase };
}

/** True when the server has enough config to create issues. */
function isReady() {
    const { token, repo } = githubConfig();
    return !!(token && /^[^/\s]+\/[^/\s]+$/.test(repo));
}

function makeError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

/** Normalize a labels-ish value (string | string[] | comma list) into a clean array. */
function coerceStringList(value) {
    if (value == null) return [];
    const arr = Array.isArray(value) ? value : String(value).split(',');
    const out = [];
    for (const item of arr) {
        const s = String(item == null ? '' : item).trim();
        if (s) out.push(s);
    }
    return out;
}

/** De-duplicate while preserving first-seen order (case-insensitive for labels). */
function dedupeLabels(labels) {
    const seen = new Set();
    const out = [];
    for (const label of labels) {
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(label);
    }
    return out;
}

/**
 * A Gemini payload may be the instruction itself, or wrap it under a common
 * key. Unwrap so callers can be forgiving about the exact envelope.
 */
function extractInstruction(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw makeError('BAD_REQUEST', 'Request body must be a JSON object.');
    }
    for (const key of ['instruction', 'work', 'task', 'issue', 'data']) {
        const nested = payload[key];
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            // Only unwrap when the outer object is a pure envelope (no title of its own).
            const hasOwnTitle = ['title', 'summary', 'name'].some((k) => payload[k]);
            if (!hasOwnTitle) return nested;
        }
    }
    return payload;
}

function renderChecklist(items) {
    return coerceStringList(items).map((s) => `- [ ] ${s}`).join('\n');
}

function renderBulletList(items) {
    return coerceStringList(items).map((s) => `- ${s}`).join('\n');
}

/**
 * Build the GitHub Issue payload from a Gemini instruction object.
 * Returns { title, body, labels, assignees }.
 */
function buildIssueFromInstruction(rawInstruction) {
    const instruction = extractInstruction(rawInstruction);

    const title = String(
        instruction.title || instruction.summary || instruction.name || '',
    ).trim();
    if (!title) {
        throw makeError('BAD_REQUEST', 'Instruction is missing a "title" (or "summary"/"name").');
    }

    // Body: an explicit `body` string is used verbatim; otherwise compose the
    // body from the individual known fields (description, tasks, etc.).
    let body = '';
    const explicitBody = instruction.body;
    if (explicitBody && typeof explicitBody === 'string' && explicitBody.trim()) {
        body = explicitBody.trim();
    } else {
        const sections = [];
        const description = instruction.description || instruction.details;
        if (description && typeof description === 'string' && description.trim()) {
            sections.push(description.trim());
        }
        if (instruction.context && String(instruction.context).trim()) {
            sections.push(`## Context\n${String(instruction.context).trim()}`);
        }

        const tasks = instruction.tasks || instruction.steps || instruction.subtasks || instruction.instructions;
        if (coerceStringList(tasks).length) {
            sections.push(`## Tasks\n${renderChecklist(tasks)}`);
        }

        const acceptance = instruction.acceptance_criteria || instruction.done_when || instruction.acceptance;
        if (coerceStringList(acceptance).length) {
            sections.push(`## Acceptance Criteria\n${renderChecklist(acceptance)}`);
        }

        const files = instruction.files || instruction.paths;
        if (coerceStringList(files).length) {
            sections.push(`## Files\n${renderBulletList(files)}`);
        }

        body = sections.join('\n\n').trim();
    }

    // Always append the raw instruction for full fidelity / traceability.
    const rawJson = JSON.stringify(instruction, null, 2);
    const provenance = [
        '',
        '---',
        '<sub>Auto-created from a Gemini work instruction.</sub>',
        '',
        '<details><summary>Original instruction (JSON)</summary>',
        '',
        '```json',
        rawJson,
        '```',
        '',
        '</details>',
    ].join('\n');

    body = `${body}${body ? '\n' : ''}${provenance}`.trim();

    // Labels: cursor-agent is always present, plus any caller-provided labels.
    const extraLabels = coerceStringList(instruction.labels);
    const labels = dedupeLabels([AGENT_LABEL, ...extraLabels]);

    const assignees = coerceStringList(instruction.assignees);

    const payload = { title, body, labels };
    if (assignees.length) payload.assignees = assignees;
    return payload;
}

/**
 * Create the GitHub issue.
 * @param {object} rawInstruction Parsed Gemini JSON.
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl] Injectable fetch (defaults to global fetch).
 * @param {object} [opts.config] Injectable config (defaults to env-derived).
 * @returns {Promise<{ ok: true, issue_number: number, issue_url: string, html_url: string, labels: string[] }>}
 */
async function createGitHubIssue(rawInstruction, opts = {}) {
    const config = opts.config || githubConfig();
    const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);

    if (!config.token || !/^[^/\s]+\/[^/\s]+$/.test(config.repo || '')) {
        throw makeError(
            'NOT_CONFIGURED',
            'Set GITHUB_ISSUE_TOKEN (Issues: write) and GITHUB_ISSUE_REPO ("owner/repo") on the server.',
        );
    }
    if (typeof fetchImpl !== 'function') {
        throw makeError('NOT_CONFIGURED', 'No fetch implementation available in this runtime.');
    }

    const issue = buildIssueFromInstruction(rawInstruction);
    const apiBase = config.apiBase || DEFAULT_API_BASE;
    const url = `${apiBase}/repos/${config.repo}/issues`;

    let resp;
    try {
        resp = await fetchImpl(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'tvc-gemini-issue-bot',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify(issue),
        });
    } catch (e) {
        throw makeError('GITHUB_UNREACHABLE', `Failed to reach GitHub API: ${e.message || String(e)}`);
    }

    let data = null;
    try {
        data = await resp.json();
    } catch (_) {
        data = null;
    }

    if (!resp.ok) {
        const ghMessage = data?.message || `HTTP ${resp.status}`;
        throw makeError('GITHUB_ERROR', `GitHub API rejected the issue: ${ghMessage}`);
    }

    return {
        ok: true,
        issue_number: data?.number,
        issue_url: data?.url,
        html_url: data?.html_url,
        labels: issue.labels,
    };
}

module.exports = {
    AGENT_LABEL,
    githubConfig,
    isReady,
    coerceStringList,
    dedupeLabels,
    extractInstruction,
    buildIssueFromInstruction,
    createGitHubIssue,
};
