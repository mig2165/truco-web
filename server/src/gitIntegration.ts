import type { BugReport } from './bugReport';
import type { FixRecord, PullRequestRecord } from './database';

// ─── GitIntegration ────────────────────────────────────────────────────────────

export class GitIntegration {
    private githubToken: string | undefined;
    private owner: string;
    private repo: string;

    constructor() {
        this.githubToken = process.env.GITHUB_TOKEN;
        const repoFullName = process.env.GITHUB_REPOSITORY ?? 'mig2165/truco-web';
        const parts = repoFullName.split('/');
        this.owner = parts[0] ?? 'mig2165';
        this.repo = parts[1] ?? 'truco-web';

        if (this.githubToken) {
            console.log(`[GitIntegration] GitHub token detected — PR creation enabled (${this.owner}/${this.repo}).`);
        } else {
            console.log('[GitIntegration] No GITHUB_TOKEN — PR creation will be simulated.');
        }
    }

    // ── GitHub Issues ──────────────────────────────────────────────────────────

    /**
     * Opens a GitHub Issue for the given bug report so that collaborators can
     * track it independently of the auto-fix pipeline.  Returns the new issue
     * number and URL, or null when the GitHub token is not configured.
     */
    async createGithubIssue(report: BugReport): Promise<{ issueNumber: number; issueUrl: string } | null> {
        if (!this.githubToken) {
            console.log('[GitIntegration] Skipping GitHub Issue creation — no GITHUB_TOKEN');
            return null;
        }

        const categoryEmoji: Record<string, string> = {
            gameplay_bug: '🎮',
            ui_bug: '🖥️',
            scoring_bug: '🔢',
            hand_call_bug: '🃏',
            other: '🐛',
        };
        const emoji = categoryEmoji[report.category] ?? '🐛';
        const descChars = Array.from(report.description);
        const truncDesc = descChars.length > 80 ? descChars.slice(0, 80).join('') + '…' : report.description;
        const title = `${emoji} [${report.category}] ${truncDesc}`;

        const body = `## Bug Report — \`${report.id}\`

| Field | Value |
|-------|-------|
| **Reported By** | ${report.playerName} |
| **Category** | \`${report.category}\` |
| **Timestamp** | ${new Date(report.timestamp).toISOString()} |
| **Room ID** | \`${report.roomId}\` |
| **Status** | \`${report.status}\` |

### Description
> ${report.description}

---

*This issue was created automatically by the Truco bug-report pipeline.  
It will be updated as the report moves through the auto-fix workflow.*`;

        try {
            const issue = await this.githubRequest<{ number: number; html_url: string }>('/issues', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    body,
                    labels: ['bug-report', report.category],
                }),
            });
            console.log(`[GitIntegration] Created GitHub Issue #${issue.number}: ${issue.html_url}`);
            return { issueNumber: issue.number, issueUrl: issue.html_url };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[GitIntegration] Failed to create GitHub Issue:', message);
            return null;
        }
    }

    /**
     * Adds a comment to an existing GitHub Issue (e.g. when the report is
     * auto-fixed or resolved).
     */
    async addGithubIssueComment(issueNumber: number, body: string): Promise<void> {
        if (!this.githubToken) return;
        try {
            await this.githubRequest(`/issues/${issueNumber}/comments`, {
                method: 'POST',
                body: JSON.stringify({ body }),
            });
            console.log(`[GitIntegration] Added comment to Issue #${issueNumber}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[GitIntegration] Failed to add comment to Issue #${issueNumber}:`, message);
        }
    }

    /**
     * Closes a GitHub Issue (used when the bug has been resolved or the PR merged).
     */
    async closeGithubIssue(issueNumber: number): Promise<void> {
        if (!this.githubToken) return;
        try {
            await this.githubRequest(`/issues/${issueNumber}`, {
                method: 'PATCH',
                body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
            });
            console.log(`[GitIntegration] Closed GitHub Issue #${issueNumber}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[GitIntegration] Failed to close Issue #${issueNumber}:`, message);
        }
    }

    async createPullRequest(report: BugReport, fix: FixRecord): Promise<PullRequestRecord> {
        const branchName = `auto-fix/bug-${report.id.substring(0, 12)}`;
        const recordBase: Omit<PullRequestRecord, 'prNumber' | 'prUrl' | 'errorMessage'> = {
            id: `pr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            reportId: report.id,
            fixId: fix.id,
            timestamp: Date.now(),
            branchName,
            status: 'created',
        };

        if (!this.githubToken) {
            console.log(`[GitIntegration] Simulating PR for branch ${branchName} (no GITHUB_TOKEN)`);
            return {
                ...recordBase,
                status: 'created',
                prUrl: `https://github.com/${this.owner}/${this.repo}/compare/${branchName}`,
            };
        }

        try {
            const defaultBranch = await this.getDefaultBranch();
            const baseSha = await this.getBranchSha(defaultBranch);
            await this.createBranch(branchName, baseSha);
            const prBody = this.buildPrBody(report, fix);
            const pr = await this.openPullRequest(branchName, defaultBranch, report, prBody);

            console.log(`[GitIntegration] Created PR #${pr.number}: ${pr.html_url}`);
            return {
                ...recordBase,
                prNumber: pr.number,
                prUrl: pr.html_url,
                status: 'created',
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[GitIntegration] Failed to create PR:', message);
            return {
                ...recordBase,
                status: 'failed',
                errorMessage: message,
            };
        }
    }

    // ── GitHub API helpers ─────────────────────────────────────────────────────

    private async githubRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${this.githubToken}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                ...(options.headers ?? {}),
            },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`GitHub API ${endpoint} failed: ${response.status} — ${text}`);
        }

        return response.json() as Promise<T>;
    }

    private async getDefaultBranch(): Promise<string> {
        const repo = await this.githubRequest<{ default_branch: string }>('');
        return repo.default_branch;
    }

    private async getBranchSha(branch: string): Promise<string> {
        const ref = await this.githubRequest<{ object: { sha: string } }>(`/git/ref/heads/${branch}`);
        return ref.object.sha;
    }

    private async createBranch(branchName: string, sha: string): Promise<void> {
        await this.githubRequest('/git/refs', {
            method: 'POST',
            body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
        });
    }

    private async openPullRequest(
        head: string,
        base: string,
        report: BugReport,
        body: string,
    ): Promise<{ number: number; html_url: string }> {
        return this.githubRequest<{ number: number; html_url: string }>('/pulls', {
            method: 'POST',
            body: JSON.stringify({
                title: `[Auto-fix] ${report.category}: ${report.description.substring(0, 69)}${report.description.length > 69 ? '…' : ''}`,
                head,
                base,
                body,
                draft: false,
            }),
        });
    }

    // ── PR body builder ────────────────────────────────────────────────────────

    private buildPrBody(report: BugReport, fix: FixRecord): string {
        const investigation = report.investigationResult;
        const violations = investigation?.ruleViolations
            .map(v => `- **[${v.severity.toUpperCase()}]** \`${v.rule}\`: ${v.description}`)
            .join('\n') ?? '_No violations recorded._';

        return `## 🤖 Automated Bug Fix

This pull request was generated automatically by the Truco self-healing bug-fix pipeline.

---

### 📋 Original Bug Report
| Field | Value |
|-------|-------|
| **ID** | \`${report.id}\` |
| **Category** | ${report.category} |
| **Reported By** | ${report.playerName} |
| **Timestamp** | ${new Date(report.timestamp).toISOString()} |
| **Status** | ${report.status} |

**Description:**
> ${report.description}

---

### 🔍 Investigation Findings

${violations}

**Suspected Function:** \`${investigation?.suspectedFunction ?? 'unknown'}\`

${investigation?.explanation ?? ''}

---

### 🔧 Generated Fix

**Target File:** \`${fix.targetFile}\`
**Confidence:** ${(fix.confidence * 100).toFixed(0)}%

**Explanation:** ${fix.explanation}

**Suggested Patch:**
\`\`\`typescript
${fix.generatedPatch}
\`\`\`

---

### ✅ Next Steps
1. Review the suggested patch above
2. Apply the changes to \`${fix.targetFile}\`
3. Run existing tests to verify the fix
4. Merge if tests pass

---
*Generated by the Truco automated bug-fix pipeline · Fix ID: \`${fix.id}\`*`;
    }
}

export const gitIntegration = new GitIntegration();
