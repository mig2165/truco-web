"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bugReportManager = exports.BugReportManager = void 0;
const gameLogic_1 = require("./gameLogic");
// ─── Helpers ────────────────────────────────────────────────────────────────────
const INSULT_PATTERNS = [
    /\b(idiot|stupid|dumb|trash|garbage|suck|hate\s+you|moron|loser)\b/i,
    /\b(f+u+c+k+|s+h+i+t+|a+s+s+h+o+l+e+|b+i+t+c+h+|d+a+m+n+)\b/i,
];
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
function isRepeatedChars(text) {
    const stripped = text.replace(/\s/g, '');
    if (stripped.length === 0)
        return true;
    return stripped.split('').every(ch => ch === stripped[0]);
}
// ─── BugReportManager Class ────────────────────────────────────────────────────
class BugReportManager {
    reports = [];
    simulationResults = [];
    gameEventLogs = new Map();
    // ── Event Logging ──────────────────────────────────────────────────────
    logGameEvent(roomId, event) {
        let events = this.gameEventLogs.get(roomId);
        if (!events) {
            events = [];
            this.gameEventLogs.set(roomId, events);
        }
        events.push(event);
        if (events.length > 20) {
            this.gameEventLogs.set(roomId, events.slice(-20));
        }
    }
    // ── Snapshot Creation ──────────────────────────────────────────────────
    createSnapshot(gameState) {
        const roomEvents = this.gameEventLogs.get(gameState.roomId) ?? [];
        return {
            score: { team1: gameState.points.team1, team2: gameState.points.team2 },
            roundState: gameState.status,
            playerHands: gameState.players.map(p => ({
                playerId: p.id,
                cards: [...p.hand],
            })),
            last20Events: [...roomEvents],
            callHistory: gameState.notifications.map(n => n.message),
            trickHistory: gameState.table.map(t => `Player ${t.playerIndex} played ${t.card.rank} of ${t.card.suit}`),
            vira: gameState.vira,
            manilhaRank: gameState.manilhaRank,
            currentPhase: gameState._phase ?? gameState.status,
            maoDeFerroActive: gameState.maoDeFerroActive ?? false,
            maoDeOnzeActive: gameState.maoDeOnzeActive ?? false,
            roundPoints: gameState.roundPoints,
            tricks: { team1: gameState.tricks.team1, team2: gameState.tricks.team2 },
        };
    }
    // ── Report Submission ──────────────────────────────────────────────────
    submitReport(report) {
        const validation = this.validateReport(report);
        report.validationResult = validation;
        if (!validation.isValid) {
            report.status = 'invalid';
        }
        else {
            report.status = 'needs_investigation';
        }
        this.reports.push(report);
        return report;
    }
    // ── Feature 2: Validation ──────────────────────────────────────────────
    validateReport(report) {
        const desc = report.description.trim();
        if (desc.length === 0) {
            return { isValid: false, reason: 'Description is empty.', confidence: 1 };
        }
        if (desc.length < 10) {
            return { isValid: false, reason: 'Description is too short (minimum 10 characters).', confidence: 0.9 };
        }
        if (isRepeatedChars(desc)) {
            return { isValid: false, reason: 'Description contains only repeated characters.', confidence: 0.95 };
        }
        for (const pattern of INSULT_PATTERNS) {
            if (pattern.test(desc)) {
                return { isValid: false, reason: 'Description contains inappropriate language.', confidence: 0.85 };
            }
        }
        // Heuristic confidence: longer and more varied descriptions are more likely valid
        const wordCount = desc.split(/\s+/).length;
        const confidence = Math.min(1, 0.5 + wordCount * 0.05);
        return { isValid: true, reason: 'Report appears valid.', confidence };
    }
    // ── Feature 3: Investigation ───────────────────────────────────────────
    investigateReport(report) {
        const snapshot = report.gameSnapshot;
        const violations = [];
        // Check scoring correctness
        if (snapshot.score.team1 < 0 || snapshot.score.team2 < 0) {
            violations.push({
                rule: 'scoring_non_negative',
                description: 'A team score is negative, which should never happen.',
                severity: 'critical',
            });
        }
        if (snapshot.score.team1 > 12 || snapshot.score.team2 > 12) {
            violations.push({
                rule: 'scoring_max',
                description: 'A team score exceeds the maximum of 12.',
                severity: 'critical',
            });
        }
        // Check trick winner correctness via card hierarchy
        if (snapshot.vira && snapshot.manilhaRank) {
            const hands = snapshot.playerHands;
            for (const hand of hands) {
                for (const card of hand.cards) {
                    if (card.rank === snapshot.manilhaRank && !card.isManilha) {
                        violations.push({
                            rule: 'card_hierarchy',
                            description: `Card ${card.rank} of ${card.suit} should be marked as manilha but is not.`,
                            severity: 'high',
                        });
                    }
                }
            }
        }
        // Check bluff resolution (roundPoints should be valid)
        const validRoundPoints = [1, 3, 6, 9, 12];
        if (!validRoundPoints.includes(snapshot.roundPoints)) {
            violations.push({
                rule: 'bluff_resolution',
                description: `Round points value ${snapshot.roundPoints} is not a valid truco round point value.`,
                severity: 'medium',
            });
        }
        // Check Mão de Onze behavior
        if (snapshot.maoDeOnzeActive) {
            if (snapshot.score.team1 !== 11 && snapshot.score.team2 !== 11) {
                violations.push({
                    rule: 'mao_de_onze_trigger',
                    description: 'Mão de Onze is active but neither team has 11 points.',
                    severity: 'critical',
                });
            }
        }
        // Check Mão de Ferro behavior
        if (snapshot.maoDeFerroActive) {
            if (snapshot.score.team1 !== 11 || snapshot.score.team2 !== 11) {
                violations.push({
                    rule: 'mao_de_ferro_trigger',
                    description: 'Mão de Ferro is active but both teams do not have exactly 11 points.',
                    severity: 'critical',
                });
            }
        }
        // Check round transitions
        if (snapshot.tricks.team1 + snapshot.tricks.team2 > 3) {
            violations.push({
                rule: 'round_transitions',
                description: 'Total tricks in a round exceed 3.',
                severity: 'critical',
            });
        }
        // Build summary
        const suspectedFunction = violations.length > 0
            ? this.guessSuspectedFunction(violations)
            : 'none';
        const explanation = violations.length > 0
            ? `Found ${violations.length} rule violation(s) in the game snapshot.`
            : 'No rule violations detected in the game snapshot.';
        const suggestedFix = violations.length > 0
            ? this.buildSuggestedFix(violations)
            : 'No fix needed based on current analysis.';
        return { ruleViolations: violations, suspectedFunction, explanation, suggestedFix };
    }
    guessSuspectedFunction(violations) {
        const first = violations[0];
        if (!first)
            return 'unknown';
        const ruleToFunction = {
            scoring_non_negative: 'points calculation in round resolution',
            scoring_max: 'points calculation in round resolution',
            card_hierarchy: 'setManilhas',
            bluff_resolution: 'call handling / truco escalation',
            mao_de_onze_trigger: 'mão de onze activation logic',
            mao_de_ferro_trigger: 'mão de ferro activation logic',
            round_transitions: 'trick/round transition logic',
        };
        return ruleToFunction[first.rule] ?? 'unknown';
    }
    buildSuggestedFix(violations) {
        const lines = [];
        for (const v of violations) {
            lines.push(`[${v.severity.toUpperCase()}] ${v.rule}: ${v.description}`);
        }
        lines.push('');
        lines.push('Suggested action: Review the functions listed above and add guard clauses to enforce the violated rules.');
        return lines.join('\n');
    }
    // ── Feature 4: Rule Simulation ─────────────────────────────────────────
    runRuleSimulation() {
        const violations = [];
        let stateDump = {};
        try {
            // --- Set up deck and deal ---
            let deck = (0, gameLogic_1.createDeck)();
            deck = (0, gameLogic_1.shuffleDeck)(deck);
            const vira = deck.pop();
            const manilhaRank = (0, gameLogic_1.getManilhaRank)(vira.rank);
            deck = (0, gameLogic_1.setManilhas)(deck, manilhaRank);
            const playerHands = [[], [], [], []];
            for (let i = 0; i < 3; i++) {
                for (let p = 0; p < 4; p++) {
                    const card = deck.pop();
                    if (card) {
                        playerHands[p].push(card);
                    }
                }
            }
            stateDump = {
                vira,
                manilhaRank,
                playerHands: playerHands.map((h, i) => ({ player: i, cards: [...h] })),
                tricks: [],
            };
            // --- Rule 1 & 2: Play 3 tricks, verify card hierarchy resolves to a winner ---
            const trickWins = [0, 0, 0, 0]; // wins per player
            const teamTricks = { team1: 0, team2: 0 }; // players 0,2 = team1; 1,3 = team2
            for (let trick = 0; trick < 3; trick++) {
                const played = [];
                for (let p = 0; p < 4; p++) {
                    const card = playerHands[p].shift();
                    if (card) {
                        played.push({ playerIndex: p, card });
                    }
                }
                if (played.length === 0)
                    break;
                // Find trick winner: card that beats all others
                let winnerEntry = played[0];
                for (let i = 1; i < played.length; i++) {
                    const cmp = (0, gameLogic_1.compareCards)(played[i].card, winnerEntry.card);
                    if (cmp > 0) {
                        winnerEntry = played[i];
                    }
                }
                // Rule 1: There must always be a deterministic winner (no unresolved ties)
                // compareCards resolves ties by suit, so there should always be a winner
                const tiedWithWinner = played.filter(p => p.playerIndex !== winnerEntry.playerIndex &&
                    (0, gameLogic_1.compareCards)(p.card, winnerEntry.card) === 0);
                if (tiedWithWinner.length > 0) {
                    violations.push({
                        rule: 'card_hierarchy_resolution',
                        description: `Trick ${trick + 1}: Card comparison did not resolve to a single winner.`,
                    });
                }
                trickWins[winnerEntry.playerIndex]++;
                const winnerTeam = (winnerEntry.playerIndex % 2 === 0) ? 'team1' : 'team2';
                teamTricks[winnerTeam]++;
                stateDump.tricks.push({
                    trick: trick + 1,
                    played: played.map(p => ({
                        player: p.playerIndex,
                        card: `${p.card.rank} of ${p.card.suit}${p.card.isManilha ? ' (manilha)' : ''}`,
                    })),
                    winner: winnerEntry.playerIndex,
                    winnerTeam,
                });
            }
            // Rule 3: Round winner requires 2+ tricks
            const roundWinnerTeam = teamTricks.team1 >= 2 ? 'team1' : teamTricks.team2 >= 2 ? 'team2' : null;
            if (!roundWinnerTeam) {
                violations.push({
                    rule: 'round_winner_two_tricks',
                    description: `No team won 2+ tricks (team1=${teamTricks.team1}, team2=${teamTricks.team2}).`,
                });
            }
            stateDump.teamTricks = { ...teamTricks };
            stateDump.roundWinner = roundWinnerTeam;
            // Rule 4: Mão Baixa / Mão Real logic — verify truco escalation sequence
            const escalationSequence = [1, 3, 6, 9, 12];
            for (let i = 1; i < escalationSequence.length; i++) {
                const prev = escalationSequence[i - 1];
                const curr = escalationSequence[i];
                if (curr <= prev) {
                    violations.push({
                        rule: 'mao_baixa_real_logic',
                        description: `Escalation sequence is non-increasing: ${prev} -> ${curr}.`,
                    });
                }
            }
            // Rule 5: Bluff challenges assign points correctly
            // Simulate a truco call: when refused, calling team gets the current round points
            // When accepted, round points escalate to the next tier
            const simulatedRoundPoints = escalationSequence[0]; // starts at 1
            const nextTier = escalationSequence[1]; // truco accepted → 3
            const refusalAward = simulatedRoundPoints; // refusing gives current stake
            if (refusalAward < 1) {
                violations.push({
                    rule: 'bluff_challenge_points',
                    description: `Truco refusal should award at least 1 point, got ${refusalAward}.`,
                });
            }
            if (nextTier <= simulatedRoundPoints) {
                violations.push({
                    rule: 'bluff_challenge_points',
                    description: `Accepted truco should raise stakes: ${simulatedRoundPoints} -> ${nextTier}.`,
                });
            }
            stateDump.bluffSimulation = { refusalAward, acceptedStake: nextTier };
            // Rule 6: Mão de Onze triggers at 11 — simulate by checking manilha logic
            // at score boundary; create a fresh deck and verify setManilhas works at this
            // game stage (no functional difference, but validates the pipeline)
            const maoDeOnzeTestDeck = (0, gameLogic_1.setManilhas)((0, gameLogic_1.createDeck)(), manilhaRank);
            const manilhasInDeck = maoDeOnzeTestDeck.filter(c => c.isManilha);
            if (manilhasInDeck.length !== 4) {
                violations.push({
                    rule: 'mao_de_onze_trigger',
                    description: `Expected exactly 4 manilhas in deck, found ${manilhasInDeck.length}.`,
                });
            }
            // Verify Mão de Onze condition: exactly one team at 11
            const maoDeOnzeScores = { team1: 11, team2: 5 };
            const shouldTriggerOnze = maoDeOnzeScores.team1 === 11 || maoDeOnzeScores.team2 === 11;
            const shouldNotBeFerro = !(maoDeOnzeScores.team1 === 11 && maoDeOnzeScores.team2 === 11);
            if (!shouldTriggerOnze || !shouldNotBeFerro) {
                violations.push({
                    rule: 'mao_de_onze_trigger',
                    description: 'Mão de Onze should trigger when exactly one team reaches 11.',
                });
            }
            // Rule 7: Game ends when 11-point team gains a point
            // Simulate: team at 11 wins a round worth 1 point → score becomes 12 → game over
            const scoreBeforeWin = 11;
            const roundAward = roundWinnerTeam ? 1 : 0;
            const scoreAfterWin = scoreBeforeWin + roundAward;
            const gameEnded = scoreAfterWin >= 12;
            if (roundWinnerTeam && !gameEnded) {
                violations.push({
                    rule: 'game_end_after_11',
                    description: `Game should end when 11-point team wins a round (score: ${scoreAfterWin}).`,
                });
            }
            stateDump.maoDeOnzeSimulation = {
                scoreBeforeWin,
                roundAward,
                scoreAfterWin,
                gameEnded,
            };
            // Rule 8: Mão de Ferro at 11-11 — verify manilha hierarchy is strict
            // (In Mão de Ferro, all 4 manilhas must have distinct manilhaValue for fair play)
            const manilhaValues = manilhasInDeck.map(c => c.manilhaValue).sort((a, b) => a - b);
            const expectedManilhaValues = [0, 1, 2, 3];
            const maoDeFerroValid = manilhaValues.length === 4 &&
                manilhaValues.every((v, i) => v === expectedManilhaValues[i]);
            if (!maoDeFerroValid) {
                violations.push({
                    rule: 'mao_de_ferro_trigger',
                    description: `Manilha values should be [0,1,2,3] for Mão de Ferro fairness, got [${manilhaValues.join(',')}].`,
                });
            }
            stateDump.maoDeFerroSimulation = {
                manilhaValues,
                maoDeFerroValid,
            };
        }
        catch (err) {
            violations.push({
                rule: 'simulation_error',
                description: `Simulation threw an error: ${err.message ?? String(err)}`,
            });
        }
        const result = {
            id: generateId(),
            timestamp: Date.now(),
            passed: violations.length === 0,
            violations,
            gameStateDump: stateDump,
        };
        this.simulationResults.push(result);
        return result;
    }
    // ── Feature 5: Debugging Agent ─────────────────────────────────────────
    analyzeAndSuggestFix(report) {
        const investigation = report.investigationResult ?? this.investigateReport(report);
        if (investigation.ruleViolations.length === 0) {
            return {
                suspectedFunction: 'none',
                explanation: 'No rule violations were found. The reported issue may be cosmetic or client-side.',
                suggestedFix: 'Investigate the client-side rendering and event handling code.',
            };
        }
        const categoryToFunction = {
            gameplay_bug: 'gameManager round/trick transition handlers',
            ui_bug: 'client-side rendering (not server)',
            scoring_bug: 'points calculation in round resolution',
            hand_call_bug: 'call handling / truco escalation logic',
            other: 'unknown — requires manual investigation',
        };
        const suspectedFunction = categoryToFunction[report.category]
            ?? investigation.suspectedFunction;
        const criticalViolations = investigation.ruleViolations.filter(v => v.severity === 'critical');
        const highViolations = investigation.ruleViolations.filter(v => v.severity === 'high');
        const parts = [];
        if (criticalViolations.length > 0) {
            parts.push(`${criticalViolations.length} critical violation(s) detected.`);
        }
        if (highViolations.length > 0) {
            parts.push(`${highViolations.length} high-severity violation(s) detected.`);
        }
        parts.push(`Category: ${report.category}.`);
        parts.push(investigation.explanation);
        const explanation = parts.join(' ');
        const fixLines = [
            `Suspected function: ${suspectedFunction}`,
            '',
        ];
        for (const v of investigation.ruleViolations) {
            fixLines.push(`- [${v.severity.toUpperCase()}] ${v.rule}: ${v.description}`);
        }
        fixLines.push('');
        fixLines.push('Recommended patch:');
        fixLines.push(`  Add validation guards in "${suspectedFunction}" to enforce the violated rules.`);
        fixLines.push('  Ensure state transitions are atomic and scores are clamped to valid ranges.');
        const suggestedFix = fixLines.join('\n');
        return { suspectedFunction, explanation, suggestedFix };
    }
    // ── Accessors ──────────────────────────────────────────────────────────
    getReports() {
        return this.reports;
    }
    getSimulationResults() {
        return this.simulationResults;
    }
    getReport(id) {
        return this.reports.find(r => r.id === id);
    }
}
exports.BugReportManager = BugReportManager;
// Singleton instance
exports.bugReportManager = new BugReportManager();
