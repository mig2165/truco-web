import React, { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { LogOut, User, X, AlertTriangle, Flag } from 'lucide-react';
import './GameTable.css';
import ReportModal from './ReportModal';

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

const PEW_PEW_DURATION_MS = 6000;
const SNIPE_DURATION_MS = 3200;

type SnipeBurstInfo = {
    burstId: number;
    winnerCard: { rank: string; suit: string; isManilha?: boolean };
    runnerUpCard: { rank: string; suit: string; isManilha?: boolean };
    winnerName: string;
};

const getCardStrength = (card: any, manilhaRank: string | null | undefined): number | null => {
    if (!card?.rank || !card?.suit) return null;
    const suitIdx = CARD_SUITS.indexOf(card.suit);
    if (suitIdx === -1) return null;
    const normalRanks = CARD_RANKS.filter((rank) => rank !== manilhaRank);
    if (card.isManilha) {
        return normalRanks.length * 4 + suitIdx;
    }
    const rankIdx = normalRanks.indexOf(card.rank);
    if (rankIdx === -1) return null;
    return rankIdx * 4 + suitIdx;
};

export const GameTable: React.FC<GameTableProps> = ({ gameState, socket, currentPlayerId, playerName, onLeave }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [forfeitConfirmOpen, setForfeitConfirmOpen] = useState(false);
    const [tricksTabExpanded, setTricksTabExpanded] = useState(false);
    const [pewPewActive, setPewPewActive] = useState(false);
    const [pewPewBurstId, setPewPewBurstId] = useState(0);
    const [snipeInfo, setSnipeInfo] = useState<SnipeBurstInfo | null>(null);
    const [secretCode, setSecretCode] = useState('');
    const [debugScore, setDebugScore] = useState({ team1: '0', team2: '0' });
    const [debugHandDrafts, setDebugHandDrafts] = useState<Record<string, DebugHandCard[]>>({});
    const lastTableSignatureRef = useRef<string>('');
    const lastRoomRef = useRef<string>('');
    const pewPewTimeoutRef = useRef<number | null>(null);
    const snipeTimeoutRef = useRef<number | null>(null);
    const snipeBurstCounterRef = useRef<number>(0);

    const isClubsManilha = (card: any) => card?.isManilha && card?.suit === 'clubs';

    useEffect(() => {
        return () => {
            if (pewPewTimeoutRef.current !== null) {
                window.clearTimeout(pewPewTimeoutRef.current);
            }
            if (snipeTimeoutRef.current !== null) {
                window.clearTimeout(snipeTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!gameState) {
            lastTableSignatureRef.current = '';
            lastRoomRef.current = '';
            if (pewPewTimeoutRef.current !== null) {
                window.clearTimeout(pewPewTimeoutRef.current);
                pewPewTimeoutRef.current = null;
            }
            if (snipeTimeoutRef.current !== null) {
                window.clearTimeout(snipeTimeoutRef.current);
                snipeTimeoutRef.current = null;
            }
            setPewPewActive(false);
            setSnipeInfo(null);
            return;
        }

        const currentSignature = gameState.table
            .map((entry: any) => `${entry.playerIndex}:${entry.card?.rank}:${entry.card?.suit}:${entry.card?.isManilha ? 'm' : 'n'}`)
            .join('|');

        // Reset detection on room switches so reconnecting or spectating another room does not replay stale bursts.
        if (lastRoomRef.current !== gameState.roomId) {
            lastRoomRef.current = gameState.roomId;
            lastTableSignatureRef.current = currentSignature;
            if (pewPewTimeoutRef.current !== null) {
                window.clearTimeout(pewPewTimeoutRef.current);
                pewPewTimeoutRef.current = null;
            }
            if (snipeTimeoutRef.current !== null) {
                window.clearTimeout(snipeTimeoutRef.current);
                snipeTimeoutRef.current = null;
            }
            setPewPewActive(false);
            setSnipeInfo(null);
            return;
        }

        const previousEntries = lastTableSignatureRef.current ? lastTableSignatureRef.current.split('|').filter(Boolean) : [];
        const currentEntries = currentSignature ? currentSignature.split('|').filter(Boolean) : [];
        const newlyPlayedEntry = currentEntries.length > previousEntries.length
            ? gameState.table[currentEntries.length - 1]
            : null;

        lastTableSignatureRef.current = currentSignature;

        if (!newlyPlayedEntry) {
            return;
        }

        if (isClubsManilha(newlyPlayedEntry.card)) {
            if (snipeTimeoutRef.current !== null) {
                window.clearTimeout(snipeTimeoutRef.current);
                snipeTimeoutRef.current = null;
            }
            setSnipeInfo(null);
            setPewPewBurstId((previousBurstId) => previousBurstId + 1);
            setPewPewActive(true);

            // Keep a single live timeout so unrelated gameState updates do not
            // cancel the overlay teardown before it runs.
            if (pewPewTimeoutRef.current !== null) {
                window.clearTimeout(pewPewTimeoutRef.current);
            }

            pewPewTimeoutRef.current = window.setTimeout(() => {
                setPewPewActive(false);
                pewPewTimeoutRef.current = null;
            }, PEW_PEW_DURATION_MS);
            return;
        }

        // Detect a trick won by literally the next single card in strength (e.g. 2♠ beating 2♦)
        if (gameState.table.length === gameState.players.length && gameState.players.length >= 2) {
            const scoredEntries = gameState.table
                .map((entry: any) => ({
                    entry,
                    player: gameState.players[entry.playerIndex],
                    strength: getCardStrength(entry.card, gameState.manilhaRank)
                }))
                .filter((item: any) => item.player && item.strength !== null);

            if (scoredEntries.length === gameState.players.length) {
                scoredEntries.sort((a: any, b: any) => b.strength - a.strength);
                const winner = scoredEntries[0];
                const bestOpponent = scoredEntries.find((item: any) => item.player.team !== winner.player.team);

                if (
                    winner &&
                    bestOpponent &&
                    !isClubsManilha(winner.entry.card) &&
                    winner.strength - bestOpponent.strength === 1
                ) {
                    snipeBurstCounterRef.current += 1;
                    setSnipeInfo({
                        burstId: snipeBurstCounterRef.current,
                        winnerCard: winner.entry.card,
                        runnerUpCard: bestOpponent.entry.card,
                        winnerName: winner.player.name
                    });

                    if (snipeTimeoutRef.current !== null) {
                        window.clearTimeout(snipeTimeoutRef.current);
                    }

                    snipeTimeoutRef.current = window.setTimeout(() => {
                        setSnipeInfo(null);
                        snipeTimeoutRef.current = null;
                    }, SNIPE_DURATION_MS);
                }
            }
        }
    }, [gameState]);

    useEffect(() => {
        if (!gameState) return;

        setDebugScore({
            team1: String(gameState.points.team1),
            team2: String(gameState.points.team2)
        });
    }, [gameState?.points.team1, gameState?.points.team2]);

    useEffect(() => {
        if (!gameState || gameState.status !== 'playing' || (gameState._phase !== 'WAITING_FOR_HAND_PHASE' && gameState._phase !== 'TRICK_PHASE')) {
            setForfeitConfirmOpen(false);
        }
    }, [gameState?.status, gameState?._phase]);

    useEffect(() => {
        if (!gameState?.secretDebug?.active) {
            setDebugHandDrafts({});
            return;
        }

        // Keep the editor aligned with the latest server state after any debug
        // mutation or regular round transition.
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
        const myIndex = gameState.players.findIndex((p: any) => p.id === currentPlayerId);
        if (myIndex === -1) return undefined;
        const targetIndex = (myIndex + offset) % gameState.players.length;
        return gameState.players[targetIndex];
    };

    const me = getRelativePlayer(0);
    const isDuel = gameState.mode === 'duel';
    const rightPlayer = isDuel ? undefined : getRelativePlayer(1);
    const topPlayer = getRelativePlayer(isDuel ? 1 : 2);
    const leftPlayer = isDuel ? undefined : getRelativePlayer(3);

    const isMyTurn = gameState.players[gameState.currentTurnIndex]?.id === currentPlayerId;
    const tricksPlayed = gameState.tricks.team1 + gameState.tricks.team2;
    const endgameHandActive = gameState.maoDeOnzeActive || gameState.maoDeFerroActive;
    const canCallTruco = !endgameHandActive && tricksPlayed >= 1 && gameState.roundPoints === 1 && gameState.callState.lastCallTeam !== me?.team;
    const canCallDouble = !endgameHandActive && gameState.roundPoints === 3 && gameState.callState.lastCallTeam !== me?.team;
    const canCallTriple = !endgameHandActive && gameState.roundPoints === 6 && gameState.callState.lastCallTeam !== me?.team;
    const canCallMao = tricksPlayed === 0 && !gameState.callState.type && !me?.maoBaixaReady;
    const winningTeam = gameState.winnerTeam
        ?? (gameState.points.team1 > gameState.points.team2 ? 1 : gameState.points.team2 > gameState.points.team1 ? 2 : null);
    const winningTeamLabel = isDuel
        ? (winningTeam === me?.team ? '🏆 You win the match!' : '🏆 Opponent wins the match!')
        : (winningTeam === 1 ? '🔵 Team 1 wins the GAME!' : '🔴 Team 2 wins the GAME!');
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
                        {secretDebugActive || player.exposedHand || (gameState.maoDeOnzeTeam === me?.team && player.team === me?.team) || gameState.status === 'round_end' || gameState.status === 'game_end'
                            ? player.hand.map((card: any, i: number) => renderCard(card, i, false))
                            : player.hand.map((_: any, i: number) => renderCard(null, i, true))
                        }
                    </div>
                )}

                {/* Card played on table — shown near this player position */}
                {cardOnTable && position !== 'bottom' && (
                    <div
                        key={`played-${globalIndex}-${cardOnTable.rank}-${cardOnTable.suit}`}
                        className={`played-card-near played-near-${position} played-card-animate`}
                    >
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
    const maxTricksInRound = isDuel ? (gameState.duelCardCount === 3 ? 3 : 5) : 3;
    const trickHistoryList: any[] = Array.isArray(gameState.trickHistory) ? gameState.trickHistory : [];
    // While a just-completed trick is still displayed in the center for 2.5s, keep only previous tricks on the side pile;
    // once the center clears (or at round_end), move that trick onto the side pile too.
    const isFullTrickStillCentered = gameState.status === 'playing' && gameState.table.length === gameState.players.length && gameState.players.length > 0;
    const sidePileTricks = isFullTrickStillCentered
        ? trickHistoryList.slice(0, -1)
        : trickHistoryList;

    return (
        <div className="game-table-wrapper">
            {/* Player Menu */}
            <button className={`menu-trigger glass-panel ${secretDebugActive ? 'debug-active' : ''}`} onClick={() => setMenuOpen(true)}>
                <User size={16} /> {playerName || me?.name || 'Me'}
                {secretDebugActive && <span className="menu-debug-pill">Debug</span>}
            </button>

            {/* Report Issue Button */}
            <button className="report-trigger glass-panel" onClick={() => setReportOpen(true)}>
                <AlertTriangle size={16} /> Report Issue
            </button>

            {/* Mini Tricks Tracker Tab */}
            <div className={`tricks-mini-tab glass-panel ${tricksTabExpanded ? 'expanded' : ''}`}>
                <button
                    type="button"
                    className="tricks-mini-tab-header"
                    onClick={() => setTricksTabExpanded((prev) => !prev)}
                    title="Click to toggle trick-by-trick history"
                >
                    <div className="tricks-mini-title-row">
                        <span className="tricks-mini-label">TRICKS</span>
                        <span className="tricks-mini-stakes">{gameState.roundPoints} pt{gameState.roundPoints === 1 ? '' : 's'}</span>
                    </div>
                    <div className="tricks-mini-score-row">
                        <span className="team-1">
                            🔵 {isDuel ? (me?.team === 1 ? 'You' : 'P1') : 'T1'}: <strong>{gameState.tricks.team1}</strong>
                        </span>
                        <span className="tricks-mini-vs">–</span>
                        <span className="team-2">
                            🔴 {isDuel ? (me?.team === 2 ? 'You' : 'Opp') : 'T2'}: <strong>{gameState.tricks.team2}</strong>
                        </span>
                    </div>
                    <div className="tricks-mini-pips">
                        {Array.from({ length: maxTricksInRound }).map((_, idx) => {
                            const record = trickHistoryList[idx];
                            const pipClass = !record
                                ? 'empty'
                                : record.winnerTeam === 1
                                    ? 'team-1-win'
                                    : record.winnerTeam === 2
                                        ? 'team-2-win'
                                        : 'tie';
                            return (
                                <span
                                    key={idx}
                                    className={`trick-pip ${pipClass}`}
                                    title={
                                        !record
                                            ? `Trick ${idx + 1}: Not played yet`
                                            : record.winnerTeam
                                                ? `Trick ${idx + 1}: Won by ${record.winnerName} (Team ${record.winnerTeam})`
                                                : `Trick ${idx + 1}: Tied`
                                    }
                                >
                                    {!record ? idx + 1 : record.winnerTeam === 1 ? '1' : record.winnerTeam === 2 ? '2' : '='}
                                </span>
                            );
                        })}
                        <span className="tricks-mini-chevron">{tricksTabExpanded ? '▾' : '▸'}</span>
                    </div>
                </button>

                {tricksTabExpanded && (
                    <div className="tricks-mini-body">
                        {trickHistoryList.length === 0 ? (
                            <div className="tricks-mini-empty">No tricks completed this round yet.</div>
                        ) : (
                            trickHistoryList.map((trick: any) => (
                                <div key={trick.trickNumber} className="tricks-mini-history-item">
                                    <div className="tricks-mini-history-head">
                                        <span>Trick #{trick.trickNumber}</span>
                                        <span className={trick.winnerTeam === 1 ? 'team-1' : trick.winnerTeam === 2 ? 'team-2' : ''}>
                                            {trick.winnerTeam ? `🏆 ${trick.winnerName}` : '🤝 Tie'}
                                        </span>
                                    </div>
                                    <div className="tricks-mini-history-cards">
                                        {trick.cards.map((entry: any, cIdx: number) => (
                                            <span
                                                key={cIdx}
                                                className={`tricks-mini-card-chip ${getSuitColor(entry.card?.suit)} ${trick.winningPlayerIndex === entry.playerIndex ? 'winner-chip' : ''}`}
                                                title={entry.playerName}
                                            >
                                                {entry.card?.rank}{getSuitSymbol(entry.card?.suit)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Fixed Forfeit Round Button */}
            {me && gameState.status === 'playing' && (gameState._phase === 'WAITING_FOR_HAND_PHASE' || gameState._phase === 'TRICK_PHASE') && (
                <button
                    className="forfeit-trigger glass-panel"
                    onClick={() => setForfeitConfirmOpen(true)}
                    title="Forfeit the current round"
                >
                    <Flag size={16} /> Forfeit Round
                </button>
            )}

            {/* Forfeit Confirmation Modal */}
            {forfeitConfirmOpen && (
                <div className="menu-overlay" onClick={() => setForfeitConfirmOpen(false)}>
                    <div className="player-menu glass-panel forfeit-modal" onClick={e => e.stopPropagation()}>
                        <button className="menu-close" onClick={() => setForfeitConfirmOpen(false)}><X size={18} /></button>
                        <h3 className="forfeit-modal-title">Forfeit Round?</h3>
                        <p className="forfeit-modal-desc">
                            {gameState.maoDeFerroActive
                                ? 'Are you sure you want to forfeit Mão de Ferro? Your opponent will win the match immediately.'
                                : `Are you sure you want to give up this round? Your opponent will be awarded ${gameState.roundPoints} ${gameState.roundPoints === 1 ? 'point' : 'points'}.`}
                        </p>
                        <div className="forfeit-modal-actions">
                            <button className="btn btn-secondary" onClick={() => setForfeitConfirmOpen(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={() => {
                                    handleCall('forfeit_round');
                                    setForfeitConfirmOpen(false);
                                }}
                            >
                                Yes, Forfeit Round
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                            <span>{isDuel ? 'You' : 'Team 1'}: <strong>{isDuel ? (me?.team === 2 ? gameState.points.team2 : gameState.points.team1) : gameState.points.team1}</strong> pts</span>
                            <span>vs</span>
                            <span>{isDuel ? 'Opponent' : 'Team 2'}: <strong>{isDuel ? (me?.team === 2 ? gameState.points.team1 : gameState.points.team2) : gameState.points.team2}</strong> pts</span>
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
                                    This is only available on non-production servers.
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

            <div className="table-felt">
                {pewPewActive && (
                    <div
                        key={pewPewBurstId}
                        className="pew-pew-overlay"
                        aria-hidden="true"
                    >
                        <div className="pew-pew-dim"></div>
                        <div className="pew-pew-flash"></div>
                        <div className="pew-pew-shockwave pew-pew-shockwave-1"></div>
                        <div className="pew-pew-shockwave pew-pew-shockwave-2"></div>
                        <div className="pew-pew-shockwave pew-pew-shockwave-3"></div>
                        <div className="pew-pew-caption">ZAP</div>
                        <span className="laser-beam laser-beam-1"></span>
                        <span className="laser-beam laser-beam-2"></span>
                        <span className="laser-beam laser-beam-3"></span>
                        <span className="laser-beam laser-beam-4"></span>
                        <span className="laser-beam laser-beam-5"></span>
                        <span className="laser-beam laser-beam-6"></span>
                        <span className="laser-beam laser-beam-7"></span>
                        <span className="laser-beam laser-beam-8"></span>
                    </div>
                )}

                {snipeInfo && !pewPewActive && (
                    <div
                        key={snipeInfo.burstId}
                        className="snipe-overlay"
                        aria-hidden="true"
                    >
                        <div className="snipe-dim"></div>
                        <div className="snipe-flash"></div>
                        <div className="snipe-ring snipe-ring-1"></div>
                        <div className="snipe-ring snipe-ring-2"></div>
                        <div className="snipe-slash snipe-slash-1"></div>
                        <div className="snipe-slash snipe-slash-2"></div>
                        <span className="snipe-spark snipe-spark-1"></span>
                        <span className="snipe-spark snipe-spark-2"></span>
                        <span className="snipe-spark snipe-spark-3"></span>
                        <span className="snipe-spark snipe-spark-4"></span>
                        <span className="snipe-spark snipe-spark-5"></span>
                        <span className="snipe-spark snipe-spark-6"></span>
                        <div className="snipe-caption">
                            <span className="snipe-caption-title">SNIPED!</span>
                            <span className="snipe-caption-sub">
                                {snipeInfo.winnerCard.rank}{getSuitSymbol(snipeInfo.winnerCard.suit)} &gt; {snipeInfo.runnerUpCard.rank}{getSuitSymbol(snipeInfo.runnerUpCard.suit)}
                            </span>
                        </div>
                    </div>
                )}

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

                {/* Played cards left on the side of the table from previous tricks in this round */}
                {sidePileTricks.length > 0 && (
                    <div className={`table-side-pile ${isDuel ? 'duel-pile' : 'classic-pile'}`}>
                        <div className="table-side-pile-label">Played Tricks</div>
                        <div className="table-side-pile-list">
                            {sidePileTricks.map((trick: any) => (
                                <div
                                    key={`side-trick-${trick.trickNumber}`}
                                    className={`side-trick-cluster ${trick.winnerTeam === 1 ? 'won-team-1' : trick.winnerTeam === 2 ? 'won-team-2' : 'won-tie'}`}
                                    title={trick.winnerTeam ? `Trick #${trick.trickNumber} — Won by ${trick.winnerName}` : `Trick #${trick.trickNumber} — Tied`}
                                >
                                    <div className="side-trick-badge">
                                        #{trick.trickNumber} {trick.winnerTeam === 1 ? '🔵' : trick.winnerTeam === 2 ? '🔴' : '🤝'}
                                    </div>
                                    <div className="side-trick-cards">
                                        {trick.cards.map((entry: any, cIdx: number) => {
                                            const isWinningCard = trick.winningPlayerIndex === entry.playerIndex;
                                            return (
                                                <div
                                                    key={cIdx}
                                                    className={`mini-table-card ${isWinningCard ? 'mini-card-winner' : ''} ${entry.card?.isManilha ? 'mini-card-manilha' : ''}`}
                                                >
                                                    <span className={`mini-card-rank ${getSuitColor(entry.card?.suit)}`}>{entry.card?.rank}</span>
                                                    <span className={`mini-card-suit ${getSuitColor(entry.card?.suit)}`}>{getSuitSymbol(entry.card?.suit)}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
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
                            <div className="game-end-subtitle">{isDuel ? 'First player to reach 12 points wins the match!' : 'Anyone can start a rematch with the same teams.'}</div>
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
                            {me.hand.length === 0 && gameState.status === 'playing' && gameState._phase === 'MAO_DE_ONZE_DECISION' && gameState.maoDeOnzeTeam !== me.team ? (
                                <div className="waiting-cards-indicator" style={{ color: '#94a3b8', fontStyle: 'italic', padding: '10px 16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.2)' }}>
                                    🎴 Cards will be dealt if opponent accepts the round
                                </div>
                            ) : (
                                me.hand.map((card: any, i: number) =>
                                    renderCard(card, i, false, isMyTurn ? () => handlePlayCard(i) : undefined)
                                )
                            )}
                        </div>
                        <div className="player-info my-info glass-panel">
                            <div className={`player-avatar team-avatar-${me.team}`}>{me.name[0]}</div>
                            <span>{me.name} <span className="you-tag">(You)</span></span>
                            <span className={`team-tag team-${me.team}`}>{me.team === 1 ? '🔵 T1' : '🔴 T2'}</span>
                            {isMyTurn && <span className="turn-indicator">Your Turn!</span>}
                        </div>

                        {/* Card played by me */}
                        {(() => {
                            const myPlayedCard = getCardOnTable(getGlobalIndex(me));
                            return myPlayedCard ? (
                                <div
                                    key={`played-me-${myPlayedCard.rank}-${myPlayedCard.suit}`}
                                    className="played-card-near played-near-bottom played-card-animate"
                                >
                                    {renderCard(myPlayedCard, 99)}
                                    <div className={`played-by-label team-${me.team}`}>{me.name} (You)</div>
                                </div>
                            ) : null;
                        })()}

                        {/* ── Mão de Onze Decision Phase buttons ── */}
                        {gameState.status === 'playing' && gameState._phase === 'MAO_DE_ONZE_DECISION' && gameState.maoDeOnzeTeam === me?.team && (
                            <div className="mao-buttons">
                                <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold' }}>⚡ MÃO DE ONZE (11 Points)!</div>
                                <div style={{ color: 'white', marginBottom: '8px', fontSize: '0.85rem' }}>
                                    {isDuel
                                        ? 'Review your hand. Will you Play or ask for a Reshuffle?'
                                        : "Review partner's cards. Will you Play or Run?"}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-secondary" onClick={() => handleCall('mao_de_onze_run')}>
                                        {isDuel ? 'Reshuffle (Opponent +1)' : 'Run (Opponent +1)'}
                                    </button>
                                    <button className="btn btn-primary" onClick={() => handleCall('mao_de_onze_play')}>
                                        {isDuel ? 'Play Hand (Worth 3 Pts)' : 'Play Hand'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {gameState.status === 'playing' && gameState._phase === 'MAO_DE_ONZE_DECISION' && gameState.maoDeOnzeTeam !== me?.team && (
                            <div className="mao-buttons">
                                <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold' }}>⚡ MÃO DE ONZE</div>
                                <div style={{ color: 'white', fontSize: '0.85rem' }}>
                                    {isDuel
                                        ? 'Opponent has 11 points and is deciding whether to Play or Reshuffle. You will receive cards if they play.'
                                        : 'Opponents are deciding on Mão de Onze.'}
                                </div>
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
                                        <button className="btn btn-secondary" onClick={() => handleCall('call_bluff')}>Call It</button>
                                        <button className="btn btn-primary" onClick={() => handleCall('accept')}>Let It Go</button>
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
