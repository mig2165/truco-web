import type { BugReport, InvestigationResult } from './bugReport';
import type { FixRecord } from './database';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface AnthropicResponse {
    content: Array<{ type: string; text: string }>;
}

// ─── BugFixer ─────────────────────────────────────────────────────────────────

export class BugFixer {
    private anthropicApiKey: string | undefined;

    constructor() {
        this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        if (this.anthropicApiKey) {
            console.log('[BugFixer] Anthropic API key detected — AI-powered fixes enabled.');
        } else {
            console.log('[BugFixer] No Anthropic API key — falling back to heuristic fix generation.');
        }
    }

    async generateFix(report: BugReport): Promise<FixRecord> {
        const investigation = report.investigationResult;
        if (!investigation || investigation.ruleViolations.length === 0) {
            return this.buildRecord(report, {
                generatedPatch: '// No rule violations detected — no patch needed.',
                targetFile: 'N/A',
                explanation: 'Investigation found no violations; report may be cosmetic or client-side.',
                confidence: 0.3,
                status: 'skipped',
            });
        }

        if (this.anthropicApiKey) {
            try {
                return await this.generateWithClaude(report, investigation);
            } catch (err) {
                console.warn('[BugFixer] Claude API failed, falling back to heuristic:', err);
            }
        }

        return this.generateHeuristic(report, investigation);
    }

    // ── Claude-powered generation ──────────────────────────────────────────────

    private async generateWithClaude(report: BugReport, investigation: InvestigationResult): Promise<FixRecord> {
        const prompt = this.buildPrompt(report, investigation);

        const messages: AnthropicMessage[] = [
            { role: 'user', content: prompt },
        ];

        const body = JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 2048,
            messages,
        });

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.anthropicApiKey!,
                'anthropic-version': '2023-06-01',
            },
            body,
        });

        if (!response.ok) {
            throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as AnthropicResponse;
        const text = data.content[0]?.text ?? '';

        const { patch, targetFile, explanation } = this.parsePatchFromLLMResponse(text);

        return this.buildRecord(report, {
            generatedPatch: patch,
            targetFile,
            explanation,
            confidence: 0.8,
            status: 'generated',
        });
    }

    private buildPrompt(report: BugReport, investigation: InvestigationResult): string {
        const violations = investigation.ruleViolations
            .map(v => `  - [${v.severity.toUpperCase()}] ${v.rule}: ${v.description}`)
            .join('\n');

        return `You are a TypeScript game-logic bug fixer for a Truco card-game web application.

Bug Report:
- Category: ${report.category}
- Description: ${report.description}
- Suspected function: ${investigation.suspectedFunction}
- Explanation: ${investigation.explanation}

Rule Violations:
${violations}

Suggested fix context:
${investigation.suggestedFix}

Game files:
- server/src/gameLogic.ts  — Card types, compareCards, createDeck, setManilhas, getManilhaRank
- server/src/gameManager.ts — TrucoGameManager with round/trick/scoring logic

Generate a minimal TypeScript patch to fix the primary violation. Format your response EXACTLY as:

TARGET_FILE: <relative path to file>
EXPLANATION: <one sentence explanation>
PATCH:
\`\`\`typescript
// Your patch here
\`\`\``;
    }

    private parsePatchFromLLMResponse(text: string): { patch: string; targetFile: string; explanation: string } {
        const targetFileMatch = /TARGET_FILE:\s*(.+)/i.exec(text);
        const explanationMatch = /EXPLANATION:\s*(.+)/i.exec(text);
        const patchMatch = /```typescript\s*([\s\S]*?)```/i.exec(text);

        return {
            targetFile: targetFileMatch?.[1]?.trim() ?? 'server/src/gameManager.ts',
            explanation: explanationMatch?.[1]?.trim() ?? 'AI-generated patch for detected violation.',
            patch: patchMatch?.[1]?.trim() ?? text.trim(),
        };
    }

    // ── Heuristic generation ───────────────────────────────────────────────────

    private generateHeuristic(report: BugReport, investigation: InvestigationResult): FixRecord {
        const primary = investigation.ruleViolations[0]!;

        const patches: Record<string, { patch: string; targetFile: string }> = {
            scoring_non_negative: {
                targetFile: 'server/src/gameManager.ts',
                patch: `// Guard: clamp team scores to non-negative values
// In the round resolution handler, after updating points:
if (this.gameState.points.team1 < 0) this.gameState.points.team1 = 0;
if (this.gameState.points.team2 < 0) this.gameState.points.team2 = 0;`,
            },
            scoring_max: {
                targetFile: 'server/src/gameManager.ts',
                patch: `// Guard: clamp team scores to max of 12
// In the round resolution handler, after updating points:
this.gameState.points.team1 = Math.min(12, this.gameState.points.team1);
this.gameState.points.team2 = Math.min(12, this.gameState.points.team2);`,
            },
            card_hierarchy: {
                targetFile: 'server/src/gameLogic.ts',
                patch: `// Ensure setManilhas correctly marks all cards with matching rank
// In setManilhas(), verify every card with rank === manilhaRank gets isManilha = true:
export function setManilhas(deck: Card[], manilhaRank: Rank): Card[] {
    return deck.map(card => ({
        ...card,
        isManilha: card.rank === manilhaRank,
        manilhaValue: card.rank === manilhaRank ? MANILHA_SUIT_ORDER.indexOf(card.suit) : -1,
    }));
}`,
            },
            bluff_resolution: {
                targetFile: 'server/src/gameManager.ts',
                patch: `// Guard: ensure roundPoints is always a valid truco value
// In call handling logic:
const VALID_ROUND_POINTS = [1, 3, 6, 9, 12] as const;
if (!VALID_ROUND_POINTS.includes(this.gameState.roundPoints as typeof VALID_ROUND_POINTS[number])) {
    console.error('[Truco] Invalid roundPoints:', this.gameState.roundPoints, '— resetting to 1');
    this.gameState.roundPoints = 1;
}`,
            },
            mao_de_onze_trigger: {
                targetFile: 'server/src/gameManager.ts',
                patch: `// Guard: only activate Mão de Onze when exactly one team has 11 points
// In round-start logic:
const { team1, team2 } = this.gameState.points;
this.gameState.maoDeOnzeActive = (team1 === 11) !== (team2 === 11); // XOR
this.gameState.maoDeFerroActive = team1 === 11 && team2 === 11;`,
            },
            mao_de_ferro_trigger: {
                targetFile: 'server/src/gameManager.ts',
                patch: `// Guard: only activate Mão de Ferro when both teams have 11 points
// In round-start logic:
const { team1, team2 } = this.gameState.points;
this.gameState.maoDeFerroActive = team1 === 11 && team2 === 11;
this.gameState.maoDeOnzeActive = (team1 === 11) !== (team2 === 11);`,
            },
            round_transitions: {
                targetFile: 'server/src/gameManager.ts',
                patch: `// Guard: ensure total tricks in a round never exceed 3
// In trick resolution handler:
const totalTricks = this.gameState.tricks.team1 + this.gameState.tricks.team2;
if (totalTricks >= 3) {
    console.warn('[Truco] Maximum tricks reached — forcing round end');
    this.resolveRound();
    return;
}`,
            },
        };

        const fix = patches[primary.rule] ?? {
            targetFile: 'server/src/gameManager.ts',
            patch: `// No specific patch template for rule "${primary.rule}".
// Manually review: ${investigation.suspectedFunction}
// Violation: ${primary.description}`,
        };

        const categoryHints: Record<string, string> = {
            gameplay_bug: 'Review trick/round transition logic in gameManager.ts.',
            scoring_bug: 'Add clamping guards around all points mutations.',
            hand_call_bug: 'Validate call escalation sequence in truco call handler.',
            ui_bug: 'This may be a client-side rendering issue — check GameTable.tsx.',
            other: 'Requires manual investigation.',
        };

        return this.buildRecord(report, {
            generatedPatch: fix.patch,
            targetFile: fix.targetFile,
            explanation: `${primary.description} — ${categoryHints[report.category] ?? 'Review suspected function.'}`,
            confidence: 0.6,
            status: 'generated',
        });
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private buildRecord(report: BugReport, fields: {
        generatedPatch: string;
        targetFile: string;
        explanation: string;
        confidence: number;
        status: FixRecord['status'];
    }): FixRecord {
        return {
            id: `fix-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            reportId: report.id,
            timestamp: Date.now(),
            ...fields,
        };
    }
}

export const bugFixer = new BugFixer();
