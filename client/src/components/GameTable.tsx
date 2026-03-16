import React, { useState } from 'react';
import { Socket } from 'socket.io-client';
import { LogOut, User, X, AlertTriangle } from 'lucide-react';
import './GameTable.css';
import ReportModal from './ReportModal';

interface GameTableProps {
    gameState: any;
    socket: Socket | null;
    currentPlayerId: string | undefined;
    playerName?: string;
    onLeave?: () => void;
}

export const GameTable: React.FC<GameTableProps> = ({ gameState, socket, currentPlayerId, playerName, onLeave }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);

    if (!gameState) return null;

    const allPlayersReady = gameState.players.every((p: any) => p.maoBaixaReady);

    const handlePlayCard = (index: number) => {
        const awaitingMyTeam = gameState.callState?.awaitingResponseFromTeam === me?.team;
        if (socket && isMyTurn && allPlayersReady && !awaitingMyTeam && !gameState.callState?.type) {
            socket.emit('playCard', gameState.roomId, index);
        }
    };

    const handleCall = (callType: string) => {
        if (socket) {
            socket.emit('call', gameState.roomId, callType);
        }
    };

    const getRelativePlayer = (offset: number) => {
        const myIndex = Math.max(0, gameState.players.findIndex((p: any) => p.id === currentPlayerId));
        const targetIndex = (myIndex + offset) % 4;
        return gameState.players[targetIndex];
    };

    const me = getRelativePlayer(0);
    const rightPlayer = getRelativePlayer(1);
    const topPlayer = getRelativePlayer(2);   // Partner
    const leftPlayer = getRelativePlayer(3);

    const isMyTurn = gameState.players[gameState.currentTurnIndex]?.id === currentPlayerId;
    const tricksPlayed = gameState.tricks.team1 + gameState.tricks.team2;
    const canCallTruco = tricksPlayed >= 1 && gameState.roundPoints === 1 && gameState.callState.lastCallTeam !== me?.team;
    const canCallDouble = gameState.roundPoints === 3 && gameState.callState.lastCallTeam !== me?.team;
    const canCallTriple = gameState.roundPoints === 6 && gameState.callState.lastCallTeam !== me?.team;
    const canCallMao = tricksPlayed === 0 && !gameState.callState.type && !me?.maoBaixaReady;

    const getSuitSymbol = (suit: string) => {
        switch (suit) {
            case 'hearts': return '♥';
            case 'diamonds': return '♦';
            case 'clubs': return '♣';
            case 'spades': return '♠';
            default: return '';
        }
    };

    const getSuitColor = (suit: string) => (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';

    const renderCard = (card: any, index: number, hidden = false, onClick?: () => void) => {
        if (hidden) {
            return (
                <div key={index} className="playing-card back">
                    <div className="card-pattern"></div>
                </div>
            );
        }
        return (
            <div
                key={index}
                className={`playing-card front ${onClick ? 'playable' : ''} ${card?.isManilha ? 'manilha-glow' : ''}`}
                onClick={onClick}
            >
                <div className={`card-value ${getSuitColor(card?.suit)}`}>{card?.rank}</div>
                <div className={`card-suit ${getSuitColor(card?.suit)}`}>{getSuitSymbol(card?.suit)}</div>
            </div>
        );
    };

    const getCardOnTable = (playerGlobalIndex: number) => {
        const played = gameState.table.find((t: any) => t.playerIndex === playerGlobalIndex);
        return played ? played.card : null;
    };

    // Get the global player index for a given relative player object
    const getGlobalIndex = (player: any) =>
        player ? gameState.players.findIndex((p: any) => p.id === player.id) : -1;

    const renderPlayerPosition = (
        player: any,
        position: 'top' | 'left' | 'right' | 'bottom',
        isMine = false
    ) => {
        if (!player) return null;

        const globalIndex = getGlobalIndex(player);
        const cardOnTable = getCardOnTable(globalIndex);
        const isPartner = me && player.team === me.team && player.id !== me?.id;
        const isTurn = gameState.players[gameState.currentTurnIndex]?.id === player.id;
        const teamLabel = player.team === 1 ? '🔵 T1' : '🔴 T2';
        const vertical = position === 'left' || position === 'right';

        // Find the most recent notification for this player's team
        // (Since the original poster was a player, we use team as a proxy to show it on *someone* on the team.
        // Even better is if it was the player, but team works for Truco rules. We grab the last one for the team)
        const teamNotifications = (gameState.notifications || []).filter((n: any) => n.team === player.team);
        const latestNotification = teamNotifications.length > 0 ? teamNotifications[teamNotifications.length - 1] : null;

        return (
            <div className={`player-position position-${position} ${isTurn && !isMine ? 'other-turn' : ''}`}>
                {/* Player info badge */}
                <div className={`player-info ${isPartner ? 'partner-info' : ''} ${isTurn && !isMine ? 'turn-pulse' : ''}`}>
                    <div className={`player-avatar team-avatar-${player.team}`}>{player.name[0]}</div>
                    <span>{player.name}</span>
                    {isPartner && <span className="partner-badge">Partner</span>}
                    <span className={`team-tag team-${player.team}`}>{teamLabel}</span>
                    {isTurn && !isMine && allPlayersReady && <span className="thinking-dots">...</span>}
                    {!player.maoBaixaReady && tricksPlayed === 0 && !gameState.callState.type && <span className="thinking-dots" style={{ color: '#a78bfa', marginLeft: '4px' }}>Thinking...</span>}
                    {latestNotification && (
                        <div className="player-notification-bubble">
                            {latestNotification.message}
                        </div>
                    )}
                </div>

                {/* Cards in hand */}
                {position !== 'bottom' && (
                    <div className={`player-hand ${vertical ? 'vertical' : ''}`}>
                        {player.exposedHand || (gameState.maoDeOnzeTeam === me?.team && player.team === me?.team)
                            ? player.hand.map((card: any, i: number) => renderCard(card, i, false))
                            : player.hand.map((_: any, i: number) => renderCard(null, i, true))
                        }
                    </div>
                )}

                {/* Card played on table — shown near this player position */}
                {cardOnTable && position !== 'bottom' && (
                    <div className={`played-card-near played-near-${position}`}>
                        {renderCard(cardOnTable, globalIndex)}
                        <div className={`played-by-label team-${player.team}`}>{player.name}</div>
                    </div>
                )}
            </div>
        );
    };

    const trickWinnerText = gameState.lastTrickWinnerName
        ? `🏆 ${gameState.lastTrickWinnerName} (Team ${gameState.lastTrickWinner}) won the trick!`
        : gameState.lastTrickWinner === null && gameState.table.length === 0 && tricksPlayed > 0
            ? '🤝 Tied trick!'
            : null;

    const currentTurnPlayer = gameState.players[gameState.currentTurnIndex];

    return (
        <div className="game-table-wrapper">

            {/* Player Menu */}
            <button className="menu-trigger glass-panel" onClick={() => setMenuOpen(true)}>
                <User size={16} /> {playerName || me?.name || 'Me'}
            </button>

            {/* Report Issue Button */}
            <button className="report-trigger glass-panel" onClick={() => setReportOpen(true)}>
                <AlertTriangle size={16} /> Report Issue
            </button>

            {menuOpen && (
                <div className="menu-overlay" onClick={() => setMenuOpen(false)}>
                    <div className="player-menu glass-panel" onClick={e => e.stopPropagation()}>
                        <button className="menu-close" onClick={() => setMenuOpen(false)}><X size={18} /></button>
                        <div className="menu-header">
                            <div className={`player-avatar team-avatar-${me?.team} avatar-lg`}>{(playerName || me?.name || '?')[0]}</div>
                            <div>
                                <div className="menu-name">{playerName || me?.name}</div>
                                <div className={`menu-team team-${me?.team}`}>
                                    {me?.team === 1 ? '🔵 Team 1' : '🔴 Team 2'}
                                </div>
                            </div>
                        </div>
                        <div className="menu-score">
                            <span>Team 1: <strong>{gameState.points.team1}</strong></span>
                            <span>vs</span>
                            <span>Team 2: <strong>{gameState.points.team2}</strong></span>
                        </div>
                        <button className="btn btn-danger leave-btn" onClick={onLeave}>
                            <LogOut size={16} /> Leave Table
                        </button>
                    </div>
                </div>
            )}

            {/* Trick call banner */}
            {gameState.callState.awaitingResponseFromTeam === me?.team && (
                <div className="call-banner glass-panel">
                    <h3>👊 Opponent called: {gameState.callState.type?.toUpperCase().replace('_', ' ')}</h3>
                    <div className="call-actions">
                        <button className="btn btn-primary" onClick={() => handleCall('accept')}>Accept</button>
                        <button className="btn btn-secondary" onClick={() => handleCall('decline')}>Fold</button>
                        {(gameState.callState.type === 'mao_baixa' || gameState.callState.type === 'mao_real') && (
                            <button className="btn btn-danger" onClick={() => handleCall('call_bluff')}>Call Bluff!</button>
                        )}
                    </div>
                </div>
            )}

            <div className="table-felt">

                {/* Trick result banner (fades away) */}
                {trickWinnerText && (
                    <div className="trick-result-overlay">
                        <div className="trick-result-banner">
                            {trickWinnerText}
                            <div className="trick-score">Tricks — Team 1: {gameState.tricks.team1} | Team 2: {gameState.tricks.team2}</div>
                            {currentTurnPlayer && (
                                <div className="next-turn-hint">
                                    Next: {currentTurnPlayer.id === currentPlayerId ? 'Your turn!' : `${currentTurnPlayer.name}'s turn`}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Vira */}
                <div className="table-center">
                    {gameState.vira && (
                        <div className="vira-container">
                            <span className="vira-label">Vira</span>
                            {renderCard(gameState.vira, 0)}
                            <span className="manilha-hint">Manilha: <strong>{gameState.manilhaRank}</strong></span>
                        </div>
                    )}

                    {/* Center played cards */}
                    <div className="played-cards-area">
                        {gameState.table.map((entry: any) => {
                            const player = gameState.players[entry.playerIndex];
                            const relOffset = (entry.playerIndex - getGlobalIndex(me) + 4) % 4;
                            const posMap: Record<number, string> = { 0: 'bottom', 1: 'right', 2: 'top', 3: 'left' };
                            const pos = posMap[relOffset] || 'bottom';
                            return (
                                <div key={entry.playerIndex} className={`played-card-slot played-${pos}`}>
                                    {renderCard(entry.card, entry.playerIndex)}
                                    <div className={`played-by-label team-${player?.team}`}>
                                        {player?.name}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {gameState.status === 'round_end' && (
                        <div className="round-result">
                            {gameState.tricks.team1 > gameState.tricks.team2
                                ? '🔵 Team 1 wins the round!'
                                : '🔴 Team 2 wins the round!'}
                        </div>
                    )}
                    {gameState.status === 'game_end' && (
                        <div className="round-result game-end">
                            {gameState.points.team1 >= 11 ? '🔵 Team 1 wins the GAME!' : '🔴 Team 2 wins the GAME!'}
                        </div>
                    )}
                </div>

                {/* Other players */}
                {renderPlayerPosition(topPlayer, 'top')}
                {renderPlayerPosition(leftPlayer, 'left')}
                {renderPlayerPosition(rightPlayer, 'right')}

                {/* Me — bottom */}
                {me && (
                    <div className={`player-position position-bottom ${isMyTurn ? 'my-turn' : ''}`}>
                        <div className="player-hand my-hand">
                            {me.hand.map((card: any, i: number) =>
                                renderCard(card, i, false, isMyTurn ? () => handlePlayCard(i) : undefined)
                            )}
                        </div>
                        <div className="player-info my-info glass-panel">
                            <div className={`player-avatar team-avatar-${me.team}`}>{me.name[0]}</div>
                            <span>{me.name} <span className="you-tag">(You)</span></span>
                            <span className={`team-tag team-${me.team}`}>{me.team === 1 ? '🔵 T1' : '🔴 T2'}</span>
                            {isMyTurn && <span className="turn-indicator">Your Turn!</span>}
                        </div>

                        {/* Card played by me */}
                        {getCardOnTable(getGlobalIndex(me)) && (
                            <div className="played-card-near played-near-bottom">
                                {renderCard(getCardOnTable(getGlobalIndex(me)), 99)}
                                <div className={`played-by-label team-${me.team}`}>{me.name} (You)</div>
                            </div>
                        )}

                        {/* ── Mão de Onze Decision Phase buttons ── */}
                        {gameState.status === 'playing' && gameState._phase === 'MAO_DE_ONZE_DECISION' && gameState.maoDeOnzeTeam === me?.team && (
                            <div className="mao-buttons">
                                <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold' }}>⚡ MÃO DE ONZE (11 Points)!</div>
                                <div style={{ color: 'white', marginBottom: '8px', fontSize: '0.85rem' }}>Review partner's cards. Will you Play or Run?</div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-secondary" onClick={() => handleCall('mao_de_onze_run')}>Run (Opponent +1)</button>
                                    <button className="btn btn-primary" onClick={() => handleCall('mao_de_onze_play')}>Play Hand</button>
                                </div>
                            </div>
                        )}

                        {gameState.status === 'playing' && gameState._phase === 'MAO_DE_ONZE_DECISION' && gameState.maoDeOnzeTeam !== me?.team && (
                            <div className="mao-buttons">
                                <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold' }}>Waiting...</div>
                                <div style={{ color: 'white', fontSize: '0.85rem' }}>Opponents are deciding on Mão de Onze.</div>
                            </div>
                        )}

                        {/* ── Mão Phase buttons ── */}
                        {gameState.status === 'playing' && gameState._phase !== 'MAO_DE_ONZE_DECISION' && canCallMao && !gameState.callState.type && (
                            <div className="mao-buttons">
                                <div style={{ color: 'white', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold' }}>Review your hand:</div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-secondary" onClick={() => handleCall('keep_hand')}>Keep Hand</button>
                                    <button className="btn btn-primary" onClick={() => handleCall('mao_baixa')}>Mão Baixa</button>
                                    <button className="btn btn-primary" onClick={() => handleCall('mao_real')}>Mão Real</button>
                                </div>
                            </div>
                        )}

                        {/* ── Opponent reacts to a Mão call ── */}
                        {gameState.status === 'playing' &&
                            (gameState.callState.type === 'mao_baixa' || gameState.callState.type === 'mao_real') &&
                            gameState.callState.awaitingResponseFromTeam === me?.team && (
                                <div className="mao-buttons">
                                    <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold' }}>Opponent called {gameState.callState.type === 'mao_baixa' ? 'Mão Baixa' : 'Mão Real'}!</div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="btn btn-secondary" onClick={() => handleCall('call_bluff')}>Call Bluff 🤨</button>
                                        <button className="btn btn-primary" onClick={() => handleCall('accept')}>Believe It ✅</button>
                                    </div>
                                </div>
                            )}

                        {/* ── Truco / Respond buttons ── */}
                        {gameState.status === 'playing' && !gameState.callState.type && allPlayersReady && isMyTurn && (
                            <div className="action-buttons">
                                {canCallTruco && <button className="btn btn-truco" onClick={() => handleCall('truco')}>TRUCO!</button>}
                                {canCallDouble && <button className="btn btn-truco" onClick={() => handleCall('double')}>DOUBLE!</button>}
                                {canCallTriple && <button className="btn btn-truco" onClick={() => handleCall('triple')}>TRIPLE!</button>}
                            </div>
                        )}

                        {/* ── Respond to Truco ── */}
                        {gameState.status === 'playing' &&
                            (gameState.callState.type === 'truco' || gameState.callState.type === 'double' || gameState.callState.type === 'triple') &&
                            gameState.callState.awaitingResponseFromTeam === me?.team && (
                                <div className="mao-buttons">
                                    <div style={{ color: '#f87171', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold' }}>Opponent called {gameState.callState.type?.toUpperCase()}!</div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="btn btn-primary" onClick={() => handleCall('accept')}>Accept ✅</button>
                                        <button className="btn btn-secondary" onClick={() => handleCall('fold')}>Fold 🏳️</button>
                                    </div>
                                </div>
                            )}

                        {gameState.status === 'playing' && isMyTurn && !canCallTruco && tricksPlayed === 0 && !gameState.callState.type && allPlayersReady && (
                            <div className="truco-hint">Truco can only be called after trick 1</div>
                        )}
                    </div>
                )}
            </div>

            {/* Report Issue Modal */}
            {reportOpen && (
                <ReportModal
                    socket={socket}
                    roomId={gameState.roomId}
                    playerName={playerName || me?.name || 'Player'}
                    gameState={gameState}
                    onClose={() => setReportOpen(false)}
                />
            )}
        </div>
    );
};
