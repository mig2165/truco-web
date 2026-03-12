import React from 'react';
import { X } from 'lucide-react';
import './RulesPanel.css';

interface RulesPanelProps {
    onClose: () => void;
}

export const RulesPanel: React.FC<RulesPanelProps> = ({ onClose }) => {
    return (
        <div className="rules-overlay" onClick={onClose}>
            <div className="rules-panel glass-panel" onClick={e => e.stopPropagation()}>
                <button className="rules-close" onClick={onClose}><X size={20} /></button>
                <h2 className="rules-title">📖 Truco Rules</h2>

                <div className="rules-content">
                    <section className="rules-section">
                        <h3>🃏 The Basics</h3>
                        <ul>
                            <li><strong>4 players</strong> in 2 teams (Team 1 vs Team 2)</li>
                            <li>Each player gets <strong>3 cards</strong> per round</li>
                            <li>No 8s, 9s, or 10s in the deck</li>
                            <li>First team to <strong>11 points</strong> wins the game</li>
                        </ul>
                    </section>

                    <section className="rules-section">
                        <h3>🏆 Tricks</h3>
                        <ul>
                            <li>Each round has up to <strong>3 tricks</strong></li>
                            <li>All 4 players play 1 card per trick</li>
                            <li>The <strong>highest card</strong> wins the trick</li>
                            <li>First team to win <strong>2 tricks</strong> wins the round</li>
                            <li>If all 4 cards tie, no one wins the trick</li>
                        </ul>
                    </section>

                    <section className="rules-section">
                        <h3>⭐ Card Ranking</h3>
                        <p>From weakest to strongest:</p>
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
                            <li>After trick 1, any player can call <strong>TRUCO</strong> (round worth 3 pts)</li>
                            <li>The opposing team can:
                                <ul>
                                    <li><strong>Accept</strong> — play continues at higher stakes</li>
                                    <li><strong>Fold</strong> — the calling team wins the round (1 pt)</li>
                                </ul>
                            </li>
                            <li>After accepting Truco, the <strong>opposing</strong> team can call <strong>DOUBLE</strong> (6 pts)</li>
                            <li>Then the other team can call <strong>TRIPLE</strong> (9 pts)</li>
                            <li>The same team <strong>cannot</strong> escalate twice in a row</li>
                        </ul>
                    </section>

                    <section className="rules-section">
                        <h3>🤚 Mão Baixa / Mão Real</h3>
                        <ul>
                            <li>Before trick 1, each player can call <strong>Mão Baixa</strong> (claiming a weak hand) or <strong>Mão Real</strong> (claiming a strong hand)</li>
                            <li>Opponents can:
                                <ul>
                                    <li><strong>Call Bluff</strong> — challenge the claim</li>
                                    <li><strong>Believe It</strong> — allow the switch</li>
                                </ul>
                            </li>
                        </ul>
                        <h4>If bluff is called:</h4>
                        <ul>
                            <li><strong>Truth</strong>: Caller's team gets +1 point, caller gets new cards</li>
                            <li><strong>Bluff</strong>: Opposing team gets +1 point, hand is revealed</li>
                        </ul>
                        <h4>If switch is allowed:</h4>
                        <ul>
                            <li>Caller gets new cards — <strong>no points</strong> awarded</li>
                            <li>Caller can then choose again (keep, Baixa, or Real)</li>
                        </ul>
                    </section>

                    <section className="rules-section">
                        <h3>📊 Points Summary</h3>
                        <ul>
                            <li>Normal round win: <strong>1 point</strong></li>
                            <li>Truco win: <strong>3 points</strong></li>
                            <li>Double win: <strong>6 points</strong></li>
                            <li>Triple win: <strong>9 points</strong></li>
                            <li>Goal: <strong>11 points</strong> to win</li>
                        </ul>
                    </section>
                </div>
            </div>
        </div>
    );
};
