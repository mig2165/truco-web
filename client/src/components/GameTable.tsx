import React, { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { LogOut, User, X, AlertTriangle } from 'lucide-react';
import './GameTable.css';
import ReportModal from './ReportModal';
import { AvatarWithHat } from './AvatarWithHat';

interface GameTableProps {
    gameState: any;
    socket: Socket | null;
    currentPlayerId: string | undefined;
    playerName?: string;
    onLeave?: () => void;
}

const CARD_RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'] as const;
const CARD_SUITS = ['diamonds', 'spades', 'hearts', 'clubs'] as const;

type DebugRank = typeof CARD_RANKS[number];
type DebugSuit = typeof CARD_SUITS[number];
type DebugHandCard = { rank: DebugRank; suit: DebugSuit };
type DebugCommand =
    | { type: 'setScore'; score: { team1: number; team2: number } }
    | { type: 'setPlayerHand'; playerId: string; cards: DebugHandCard[] };

export const GameTable: React.FC<GameTableProps> = ({ gameState, socket, currentPlayerId, playerName, onLeave }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [pewPewActive, setPewPewActive] = useState(false);
    const [pewPewBurstId, setPewPewBurstId] = useState(0);
    const [secretCode, setSecretCode] = useState('');
    const [debugScore, setDebugScore] = useState({ team1: '0', team2: '0' });
    const [debugHandDrafts, setDebugHandDrafts] = useState<Record<string, DebugHandCard[]>>({});
    const lastTableSignatureRef = useRef<string>('');
    const lastRoomRef = useRef<string>('');

    const isClubsManilha = (card: any) => card?.isManilha && card?.suit === 'clubs';

    useEffect(() => {
        if (!gameState) {
            lastTableSignatureRef.current = '';
            lastRoomRef.current = '';
            setPewPewActive(false);
            return;
        }

        const currentSignature = gameState.table
            .map((entry: any) => `${entry.playerIndex}:${entry.card?.rank}:${entry.card?.suit}:${entry.card?.isManilha ? 'm' : 'n'}`)
            .join('|');

        // Reset the detector when the room changes so joining a different table does not replay stale effects.
        if (lastRoomRef.current !== gameState.roomId) {
            lastRoomRef.current = gameState.roomId;
            lastTableSignatureRef.current = currentSignature;
            setPewPewActive(false);
            return;
        }

        const previousEntries = lastTableSignatureRef.current ? lastTableSignatureRef.current.split('|').filter(Boolean) : [];
        const currentEntries = currentSignature ? currentSignature.split('|').filter(Boolean) : [];
        const newlyPlayedEntry = currentEntries.length > previousEntries.length
            ? gameState.table[currentEntries.length - 1]
            : null;

        lastTableSignatureRef.current = currentSignature;

        if (!newlyPlayedEntry || !isClubsManilha(newlyPlayedEntry.card)) {
            return;
        }

        setPewPewBurstId((previousBurstId) => previousBurstId + 1);
        setPewPewActive(true);

        const stopEffectTimer = window.setTimeout(() => {
            setPewPewActive(false);
        }, 1700);

        return () => {
            window.clearTimeout(stopEffectTimer);
        };
    }, [gameState]);

    useEffect(() => {
        if (!gameState) return;

        setDebugScore({
            team1: String(gameState.points.team1),
            team2: String(gameState.points.team2)
        });
    }, [gameState?.points.team1, gameState?.points.team2]);

    useEffect(() => {
        if (!gameState?.secretDebug?.active) {
            setDebugHandDrafts({});
            return;
        }

        // Mirror the server-authoritative hands so the local editor stays aligned
        // after each debug mutation, trick play, or round reset.
        const nextDrafts = Object.fromEntries(
            gameState.players.map((player: any) => [
                player.id,
                player.hand.map((card: any) => ({
                    rank: card.rank as DebugRank,
                    suit: card.suit as DebugSuit
                }))
            ])
        ) as Record<string, DebugHandCard[]>;

        setDebugHandDrafts(nextDrafts);
        setSecretCode('');
    }, [gameState?.players, gameState?.secretDebug?.active]);

    if (!gameState) return null;

    const secretDebugAvailable = Boolean(gameState.secretDebug?.available);
    const secretDebugActive = Boolean(gameState.secretDebug?.active);

    const allPlayersReady = gameState.players.every((p: any) => p.maoBaixaReady);

    const sendDebugCommand = (command: DebugCommand) => {
        if (!socket) return;
        socket.emit('debugCommand', gameState.roomId, command);
    };

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

    const handleStartRematch = () => {
        if (socket) {
            socket.emit('startRematch', gameState.roomId);
        }
    };

    const handleActivateSecretDebug = () => {
        const trimmedCode = secretCode.trim();
        if (!socket || !trimmedCode) return;

        socket.emit('activateSecretDebug', gameState.roomId, trimmedCode);
    };

    const applyDebugScore = () => {
        const team1 = Number.parseInt(debugScore.team1, 10);
        const team2 = Number.parseInt(debugScore.team2, 10);
        if (Number.isNaN(team1) || Number.isNaN(team2)) return;

        sendDebugCommand({
            type: 'setScore',
            score: {
                team1: Math.max(0, Math.min(11, team1)),
                team2: Math.max(0, Math.min(11, team2))
            }
        });
    };

    const updateDebugCard = (playerId: string, cardIndex: number, field: 'rank' | 'suit', value: string) => {
        setDebugHandDrafts((currentDrafts) => {
            const playerDraft = currentDrafts[playerId];
            if (!playerDraft) return currentDrafts;

            const nextDraft = playerDraft.map((card, index) =>
                index === cardIndex
                    ? {
                        ...card,
                        [field]: value
                    }
                    : card
            );

            return {
                ...currentDrafts,
                [playerId]: nextDraft as DebugHandCard[]
            };
        });
    };

    const applyDebugHand = (playerId: string) => {
        const cards = debugHandDrafts[playerId];
        if (!cards) return;

        sendDebugCommand({
            type: 'setPlayerHand',
            playerId,
            cards
        });
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
    const endgameHandActive = gameState.maoDeOnzeActive || gameState.maoDeFerroActive;
    const canCallTruco = !endgameHandActive && tricksPlayed >= 1 && gameState.roundPoints === 1 && gameState.callState.lastCallTeam !== me?.team;
    const canCallDouble = !endgameHandActive && gameState.roundPoints === 3 && gameState.callState.lastCallTeam !== me?.team;
    const canCallTriple = !endgameHandActive && gameState.roundPoints === 6 && gameState.callState.lastCallTeam !== me?.team;
    const canCallMao = tricksPlayed === 0 && !gameState.callState.type && !me?.maoBaixaReady;
    const winningTeamLabel = (gameState.winnerTeam === 1 || (gameState.winnerTeam == null && gameState.points.team1 > gameState.points.team2))
        ? '🔵 Team 1 wins the GAME!'
        : '🔴 Team 2 wins the GAME!';
    const roundWinnerTeam = gameState.winnerTeam
        ?? (gameState.tricks.team1 > gameState.tricks.team2 ? 1 : gameState.tricks.team2 > gameState.tricks.team1 ? 2 : null);

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
                    <AvatarWithHat
                        initial={player.name[0] ?? '?'}
                        hat={player.hat}
                        circleClassName={`player-avatar team-avatar-${player.team}`}
                    />
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
                        {secretDebugActive || player.exposedHand || (gameState.maoDeOnzeTeam === me?.team && player.team === me?.team)
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
    const showTrickWinnerOverlay = gameState.status === 'playing' && Boolean(trickWinnerText);

    const currentTurnPlayer = gameState.players[gameState.currentTurnIndex];

    return (
        <div className="game-table-wrapper">
            {pewPewActive && (
                <div key={pewPewBurstId} className="pew-pew-overlay" aria-hidden="true">
                    <div className="pew-pew-dim"></div>
                    <div className="pew-pew-flash"></div>
                    <div className="pew-pew-caption">CLUBS MANILHA</div>
                    <span className="laser-beam laser-beam-1"></span>
                    <span className="laser-beam laser-beam-2"></span>
                    <span className="laser-beam laser-beam-3"></span>
                    <span className="laser-beam laser-beam-4"></span>
                    <span className="laser-beam laser-beam-5"></span>
                    <span className="laser-beam laser-beam-6"></span>
                </div>
            )}

            {/* Player Menu */}
            <button className={`menu-trigger glass-panel ${secretDebugActive ? 'debug-active' : ''}`} onClick={() => setMenuOpen(true)}>
                <User size={16} /> {playerName || me?.name || 'Me'}
                {secretDebugActive && <span className="menu-debug-pill">Debug</span>}
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
                            <AvatarWithHat
                                initial={(playerName || me?.name || '?')[0] ?? '?'}
                                hat={me?.hat}
                                size="lg"
                                circleClassName={`player-avatar team-avatar-${me?.team} avatar-lg`}
                            />
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
                        {secretDebugAvailable && !secretDebugActive && (
                            <section className="secret-debug-section">
                                <div className="secret-debug-title">Secret Debug Code</div>
                                <div className="secret-debug-inline">
                                    <input
                                        className="secret-debug-input"
                                        type="password"
                                        value={secretCode}
                                        onChange={(event) => setSecretCode(event.target.value)}
                                        placeholder="Enter code"
                                    />
                                    <button
                                        className="btn btn-secondary"
                                        onClick={handleActivateSecretDebug}
                                        disabled={!secretCode.trim()}
                                    >
                                        Unlock
                                    </button>
                                </div>
                                <div className="secret-debug-note">
                                    This capability is server-disabled in production deployments.
                                </div>
                            </section>
                        )}
                        {secretDebugActive && (
                            <section className="secret-debug-section">
                                <div className="secret-debug-title">Debug Mode Active</div>
                                <div className="secret-debug-score-editor">
                                    <label>
                                        Team 1
                                        <input
                                            type="number"
                                            min={0}
                                            max={11}
                                            value={debugScore.team1}
                                            onChange={(event) => setDebugScore((current) => ({ ...current, team1: event.target.value }))}
                                        />
                                    </label>
                                    <label>
                                        Team 2
                                        <input
                                            type="number"
                                            min={0}
                                            max={11}
                                            value={debugScore.team2}
                                            onChange={(event) => setDebugScore((current) => ({ ...current, team2: event.target.value }))}
                                        />
                                    </label>
                                    <button className="btn btn-primary" onClick={applyDebugScore}>
                                        Reset Round With Score
                                    </button>
                                </div>
                                <div className="secret-debug-player-list">
                                    {gameState.players.map((player: any) => {
                                        const playerDraft = debugHandDrafts[player.id] ?? [];

                                        return (
                                            <div key={player.id} className="secret-debug-player-card">
                                                <div className="secret-debug-player-header">
                                                    <strong>{player.name}</strong>
                                                    <span className={`team-${player.team}`}>Team {player.team}</span>
                                                </div>
                                                {playerDraft.length === 0 ? (
                                                    <div className="secret-debug-empty">No cards left in hand.</div>
                                                ) : (
                                                    <div className="secret-debug-card-grid">
                                                        {playerDraft.map((card, cardIndex) => (
                                                            <div key={`${player.id}-${cardIndex}`} className="secret-debug-card-row">
                                                                <select
                                                                    value={card.rank}
                                                                    onChange={(event) => updateDebugCard(player.id, cardIndex, 'rank', event.target.value)}
                                                                >
                                                                    {CARD_RANKS.map((rank) => (
                                                                        <option key={rank} value={rank}>{rank}</option>
                                                                    ))}
                                                                </select>
                                                                <select
                                                                    value={card.suit}
                                                                    onChange={(event) => updateDebugCard(player.id, cardIndex, 'suit', event.target.value)}
                                                                >
                                                                    {CARD_SUITS.map((suit) => (
                                                                        <option key={suit} value={suit}>{suit}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => applyDebugHand(player.id)}
                                                    disabled={playerDraft.length === 0}
                                                >
                                                    Apply Hand
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}
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
                {showTrickWinnerOverlay && (
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

                    {gameState.status === 'round_end' && (
                        <div className="round-result">
                            {roundWinnerTeam === 1
                                ? '🔵 Team 1 wins the round!'
                                : roundWinnerTeam === 2
                                    ? '🔴 Team 2 wins the round!'
                                    : 'Round ended.'}
                        </div>
                    )}
                    {gameState.status === 'game_end' && (
                        <div className="round-result game-end">
                            <div className="game-end-title">{winningTeamLabel}</div>
                            <div className="game-end-subtitle">Anyone can start a rematch with the same teams.</div>
                            <button className="btn btn-primary rematch-button" onClick={handleStartRematch}>
                                Start Rematch
                            </button>
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
                            <AvatarWithHat
                                initial={me.name[0] ?? '?'}
                                hat={me.hat}
                                circleClassName={`player-avatar team-avatar-${me.team}`}
                            />
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
                        {gameState.status === 'playing' && isMyTurn && gameState.maoDeFerroActive && allPlayersReady && (
                            <div className="truco-hint">Mao de Ferro does not allow Truco.</div>
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
