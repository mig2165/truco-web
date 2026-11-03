import React, { useState } from 'react';
import { X } from 'lucide-react';
import './RulesPanel.css';

interface RulesPanelProps {
    onClose: () => void;
    mode?: 'classic' | 'duel';
}

export const RulesPanel: React.FC<RulesPanelProps> = ({ onClose, mode = 'classic' }) => {
    const [selectedMode, setSelectedMode] = useState<'classic' | 'duel'>(mode);

    return (
        <div className="rules-overlay" onClick={onClose}>
            <div className="rules-panel glass-panel" onClick={e => e.stopPropagation()}>
                <button className="rules-close" onClick={onClose}><X size={20} /></button>
                <h2 className="rules-title">📖 Truco Rules</h2>

                <div className="rules-mode-tabs">
                    <button
                        type="button"
                        className={`rules-mode-tab ${selectedMode === 'duel' ? 'active' : ''}`}
                        onClick={() => setSelectedMode('duel')}
                    >
                        ⚔️ 1v1 Duel Rules
                    </button>
                    <button
                        type="button"
                        className={`rules-mode-tab ${selectedMode === 'classic' ? 'active' : ''}`}
                        onClick={() => setSelectedMode('classic')}
                    >
                        👥 2v2 Classic Rules
                    </button>
                </div>

                <div className="rules-content">
                    {selectedMode === 'duel' ? (
                        <>
                            <section className="rules-section">
                                <h3>⚔️ 1v1 Duel Basics <span className="rules-badge">1v1 Mode</span></h3>
                                <ul>
                                    <li><strong>2 players</strong> face-to-face in a head-to-head duel</li>
                                    <li><strong>Two Hand Variations:</strong>
                                        <ul>
                                            <li><strong>3-Card Version:</strong> Fast-paced. 3 cards dealt, best of 3 tricks (first to 2 tricks wins the hand).</li>
                                            <li><strong>5-Card Version:</strong> Strategic. 5 cards dealt, best of 5 tricks (first to 3 tricks wins the hand).</li>
                                        </ul>
                                    </li>
                                    <li>No 8s, 9s, or 10s in the deck</li>
                                    <li><strong>Match Victory:</strong> Best of 5 hands — the first player to win <strong>3 hands</strong> wins the match!</li>
                                </ul>
                            </section>

                            <section className="rules-section">
                                <h3>🏆 Duel Tricks & Hands</h3>
                                <ul>
                                    <li>Both duelists play 1 card per trick</li>
                                    <li>The <strong>highest card</strong> wins the trick</li>
                                    <li>In 3-card duel: first to win <strong>2 tricks</strong> takes the hand</li>
                                    <li>In 5-card duel: first to win <strong>3 tricks</strong> takes the hand</li>
                                    <li>If a trick ties, the winner of the previous trick (or hand starter) leads the next</li>
                                </ul>
                            </section>
                        </>
                    ) : (
                        <>
                            <section className="rules-section">
                                <h3>👥 2v2 Classic Basics <span className="rules-badge">2v2 Mode</span></h3>
                                <ul>
                                    <li><strong>4 players</strong> in 2 teams of 2 (Team 1 vs Team 2)</li>
                                    <li>Each player gets <strong>3 cards</strong> per round</li>
                                    <li>No 8s, 9s, or 10s in the deck</li>
                                    <li>First team to reach <strong>12 points</strong> wins the match!</li>
                                    <li><strong>11 points</strong> starts the endgame (Mão de Onze)</li>
                                </ul>
                            </section>

                            <section className="rules-section">
                                <h3>🏆 Classic Tricks</h3>
                                <ul>
                                    <li>Each round has up to <strong>3 tricks</strong></li>
                                    <li>All 4 players play 1 card per trick</li>
                                    <li>The <strong>highest card</strong> wins the trick</li>
                                    <li>First team to win <strong>2 tricks</strong> wins the round</li>
                                    <li>If all 4 cards tie, no one wins the trick</li>
                                </ul>
                            </section>
                        </>
                    )}

                    <section className="rules-section">
                        <h3>⭐ Card Ranking</h3>
                        <p>From weakest to strongest (identical in 1v1 and 2v2):</p>
                        <div className="rank-list">4 → 5 → 6 → 7 → Q → J → K → A → 2 → 3</div>
                    </section>

                    <section className="rules-section">
                        <h3>🔥 Vira & Manilha</h3>
                        <ul>
                            <li>The <strong>Vira</strong> card is flipped from the deck</li>
                            <li>The rank <strong>above</strong> the Vira becomes the <strong>Manilha</strong> (strongest card)</li>
                            <li>Manilhas beat all other cards</li>
                            <li>If two Manilhas clash, suit order determines the winner:<br />
                                ♦ Diamonds &lt; ♠ Spades &lt; ♥ Hearts &lt; ♣ Clubs</li>
                        </ul>
                    </section>

                    <section className="rules-section">
                        <h3>👊 Truco Escalation</h3>
                        <ul>
                            <li>After trick 1, any player can call <strong>TRUCO</strong> (escalates stakes to 3 pts)</li>
                            <li>The opponent / opposing team can:
                                <ul>
                                    <li><strong>Accept</strong> — play continues at higher stakes</li>
                                    <li><strong>Fold</strong> — the calling side wins the round directly (1 pt)</li>
                                </ul>
                            </li>
                            <li>After accepting Truco, the other side can call <strong>DOUBLE</strong> (6 pts)</li>
                            <li>Then the other side can call <strong>TRIPLE</strong> (9 pts)</li>
                            <li>The same player / team <strong>cannot</strong> escalate twice in a row</li>
                        </ul>
                    </section>

                    {selectedMode === 'classic' && (
                        <section className="rules-section">
                            <h3>🏁 Endgame Rules (2v2)</h3>
                            <ul>
                                <li>Normal scoring is <strong>hard capped at 11</strong></li>
                                <li>If a team reaches <strong>11</strong>, the next hand becomes <strong>Mão de Onze</strong></li>
                                <li>If both teams are at <strong>11-11</strong>, the next hand is <strong>Mão de Ferro</strong></li>
                            </ul>
                            <h4>Mão de Onze</h4>
                            <ul>
                                <li>The team on <strong>11</strong> can view their hands together and choose to <strong>Play</strong> or <strong>Run</strong></li>
                                <li>If they <strong>Run</strong>, opponents gain <strong>1 point</strong></li>
                                <li>If they <strong>Play</strong> and win, they reach 12 and win the game</li>
                            </ul>
                            <h4>Mão de Ferro</h4>
                            <ul>
                                <li>At <strong>11-11</strong>, all cards stay hidden face-down</li>
                                <li>No Truco calls allowed; the winner of the hand takes the entire game</li>
                            </ul>
                        </section>
                    )}

                    <section className="rules-section">
                        <h3>🤚 Mão Baixa / Mão Real</h3>
                        <ul>
                            <li>Before trick 1, a player can call <strong>Mão Baixa</strong> (claiming a weak hand) or <strong>Mão Real</strong> (claiming a strong hand)</li>
                            <li>The opponent can accept the claim to redeal, or call the bluff to reveal the hand</li>
                            <li>If true, the caller redeals; if caught bluffing, the caller's hand stays exposed</li>
                        </ul>
                    </section>
                </div>
            </div>
        </div>
    );
};
