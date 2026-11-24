import React, { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { LogOut, User, X, AlertTriangle, Flag, Volume2, VolumeX, Smile } from 'lucide-react';
import './GameTable.css';
import ReportModal from './ReportModal';
import { ModalDialog } from './ModalDialog';
import { getStoredFeltTheme } from './ShopModal';
import { playSoundEffect, isSoundMuted, setSoundMuted } from '../lib/soundEffects';

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

const QUICK_EMOTE_OPTIONS = [
    { key: 'truco', icon: '🔥', text: 'TRUCO?!' },
    { key: 'snipe', icon: '🎯', text: 'Nice Snipe!' },
    { key: 'bluff', icon: '🤨', text: 'Bluffing!' },
    { key: 'sweat', icon: '😅', text: 'Sweating...' },
    { key: 'ez', icon: '😎', text: 'Too Easy!' },
    { key: 'gg', icon: '🤝', text: 'Good Game!' },
] as const;

const PARTNER_SIGNAL_OPTIONS = [
    { key: 'zap', icon: '😉', label: 'Wink', hint: 'Zap (Clubs Manilha)' },
    { key: 'copas', icon: '🤨', label: 'Eyebrow', hint: 'Copas (Hearts Manilha)' },
    { key: 'espadilha', icon: '😗', label: 'Whistle', hint: 'Espadilha / Strong 3' },
    { key: 'high', icon: '😤', label: 'Nod', hint: 'Push stakes!' },
    { key: 'low', icon: '🫣', label: 'Shrug', hint: 'Play safe' },
] as const;

type SnipeBurstInfo = {
    burstId: number;
    winnerCard: { rank: string; suit: string; isManilha?: boolean };
    runnerUpCard: { rank: string; suit: string; isManilha?: boolean };
    winnerName: string;
};

type ActiveEmote = {
    id: string;
    icon: string;
    text: string;
};

type PartnerSignalToast = {
    id: string;
    senderName: string;
    icon: string;
    label: string;
    hint: string;
    isTell: boolean;
};

const getCardStrength = (card: any, manilhaRank: string | null | undefined): number | null => {
    if (card?.isCovered) return -1;
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
    const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
    const [soundMuted, setSoundMutedState] = useState(() => isSoundMuted());
    const [feltTheme, setFeltTheme] = useState(() => getStoredFeltTheme());
    const [playCoveredNext, setPlayCoveredNext] = useState(false);
    const [emoteMenuOpen, setEmoteMenuOpen] = useState(false);
    const [signalMenuOpen, setSignalMenuOpen] = useState(false);
    const [activeEmotes, setActiveEmotes] = useState<Record<string, ActiveEmote>>({});
    const [partnerSignalToast, setPartnerSignalToast] = useState<PartnerSignalToast | null>(null);
    const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null);
    const [tricksTabExpanded, setTricksTabExpanded] = useState(true);
    const [clientTrickHistory, setClientTrickHistory] = useState<any[]>([]);
    const [pewPewActive, setPewPewActive] = useState(false);
    const [pewPewBurstId, setPewPewBurstId] = useState(0);
    const [snipeInfo, setSnipeInfo] = useState<SnipeBurstInfo | null>(null);
    const [secretCode, setSecretCode] = useState('');
    const [debugScore, setDebugScore] = useState({ team1: '0', team2: '0' });
    const [debugHandDrafts, setDebugHandDrafts] = useState<Record<string, DebugHandCard[]>>({});
    const lastTableSignatureRef = useRef<string>('');
    const lastRoomRef = useRef<string>('');
    const lastCallKeyRef = useRef<string>('');
    const lastWinKeyRef = useRef<string>('');
    const lastTickSecondRef = useRef<number | null>(null);
    const pewPewTimeoutRef = useRef<number | null>(null);
    const snipeTimeoutRef = useRef<number | null>(null);
    const emoteTimeoutsRef = useRef<Record<string, number>>({});
    const signalTimeoutRef = useRef<number | null>(null);
    const snipeBurstCounterRef = useRef<number>(0);

    const isClubsManilha = (card: any) => !card?.isCovered && card?.isManilha && card?.suit === 'clubs';

    useEffect(() => {
        return () => {
            if (pewPewTimeoutRef.current !== null) {
                window.clearTimeout(pewPewTimeoutRef.current);
            }
            if (snipeTimeoutRef.current !== null) {
                window.clearTimeout(snipeTimeoutRef.current);
            }
            if (signalTimeoutRef.current !== null) {
                window.clearTimeout(signalTimeoutRef.current);
            }
            for (const timerId of Object.values(emoteTimeoutsRef.current)) {
                window.clearTimeout(timerId);
            }
        };
    }, []);

    // Keep table felt synchronized with the Shop modal selection
    useEffect(() => {
        const syncCosmetics = () => setFeltTheme(getStoredFeltTheme());
        window.addEventListener('truco-cosmetics-updated', syncCosmetics);
        window.addEventListener('storage', syncCosmetics);
        return () => {
            window.removeEventListener('truco-cosmetics-updated', syncCosmetics);
            window.removeEventListener('storage', syncCosmetics);
        };
    }, []);

    // Listen for transient table emotes & 2v2 private partner signals
    useEffect(() => {
        if (!socket) return;

        const handleTableEmote = (payload: { id: string; playerId: string; icon: string; text: string }) => {
            playSoundEffect('emote');
            setActiveEmotes((prev) => ({
                ...prev,
                [payload.playerId]: { id: payload.id, icon: payload.icon, text: payload.text },
            }));
            if (emoteTimeoutsRef.current[payload.playerId] !== undefined) {
                window.clearTimeout(emoteTimeoutsRef.current[payload.playerId]);
            }
            emoteTimeoutsRef.current[payload.playerId] = window.setTimeout(() => {
                setActiveEmotes((prev) => {
                    const next = { ...prev };
                    delete next[payload.playerId];
                    return next;
                });
                delete emoteTimeoutsRef.current[payload.playerId];
            }, 3200);
        };

        const handlePartnerSignal = (payload: PartnerSignalToast) => {
            playSoundEffect('signal');
            setPartnerSignalToast(payload);
            if (signalTimeoutRef.current !== null) {
                window.clearTimeout(signalTimeoutRef.current);
            }
            signalTimeoutRef.current = window.setTimeout(() => {
                setPartnerSignalToast(null);
                signalTimeoutRef.current = null;
            }, 4000);
        };

        socket.on('tableEmote', handleTableEmote);
        socket.on('partnerSignal', handlePartnerSignal);
        return () => {
            socket.off('tableEmote', handleTableEmote);
            socket.off('partnerSignal', handlePartnerSignal);
        };
    }, [socket]);

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
            .map((entry: any) => `${entry.playerIndex}:${entry.card?.rank}:${entry.card?.suit}:${entry.card?.isManilha ? 'm' : 'n'}:${entry.card?.isCovered ? 'c' : 'u'}`)
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

        if (
            gameState.tricks?.team1 === 0 &&
            gameState.tricks?.team2 === 0 &&
            (!gameState.table || gameState.table.length === 0) &&
            (!gameState.trickHistory || gameState.trickHistory.length === 0)
        ) {
            setClientTrickHistory((prev) => (prev.length > 0 ? [] : prev));
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

        const isClubsBlast = isClubsManilha(newlyPlayedEntry.card);
        if (newlyPlayedEntry.card?.isCovered) {
            playSoundEffect('covered');
        } else if (isClubsBlast) {
            playSoundEffect('zap');
        } else {
            playSoundEffect('card');
        }

        if (isClubsBlast) {
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
        }

        // When all players in the round have played their card for this trick:
        // 1) Record client-side fallback trick history so even if server trickHistory is missing, every player sees it
        // 2) Detect a trick won by literally the next single card in strength (e.g. 2♠ beating 2♦)
        if (gameState.table.length === gameState.players.length && gameState.players.length >= 2) {
            const scoredEntries = gameState.table
                .map((entry: any) => ({
                    entry,
                    player: gameState.players[entry.playerIndex],
                    strength: getCardStrength(entry.card, gameState.manilhaRank)
                }))
                .filter((item: any) => item.player && item.strength !== null);

            if (scoredEntries.length === gameState.players.length) {
                const sorted = [...scoredEntries].sort((a: any, b: any) => b.strength - a.strength);
                const winner = sorted[0];
                const allTied = scoredEntries.every((item: any) => item.strength === scoredEntries[0].strength);

                setClientTrickHistory((prev) => {
                    const nextNum = prev.length + 1;
                    return [
                        ...prev,
                        {
                            trickNumber: nextNum,
                            winnerTeam: allTied ? null : winner.player.team,
                            winnerName: allTied ? null : winner.player.name,
                            winningPlayerIndex: allTied ? null : winner.entry.playerIndex,
                            cards: gameState.table.map((entry: any) => {
                                const p = gameState.players[entry.playerIndex];
                                return {
                                    playerIndex: entry.playerIndex,
                                    playerName: p?.name ?? `P${entry.playerIndex + 1}`,
                                    team: p?.team ?? 1,
                                    card: { ...entry.card }
                                };
                            })
                        }
                    ];
                });

                const bestOpponent = sorted.find((item: any) => item.player.team !== winner.player.team);

                if (
                    !isClubsBlast &&
                    winner &&
                    bestOpponent &&
                    !winner.entry.card?.isCovered &&
                    !bestOpponent.entry.card?.isCovered &&
                    !isClubsManilha(winner.entry.card) &&
                    winner.strength - bestOpponent.strength === 1
                ) {
                    snipeBurstCounterRef.current += 1;
                    playSoundEffect('snipe');
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

    // Truco raise & match-win SFX cues
    useEffect(() => {
        const callType = gameState?.status === 'playing' ? gameState?.callState?.type : null;
        const callKey = callType ? `${callType}:${gameState.callState.callingTeam}:${gameState.roundPoints}` : '';
        if (callKey && callKey !== lastCallKeyRef.current && (callType === 'truco' || callType === 'double' || callType === 'triple')) {
            playSoundEffect('truco');
        }
        lastCallKeyRef.current = callKey;
    }, [gameState?.status, gameState?.callState?.type, gameState?.callState?.callingTeam, gameState?.roundPoints]);

    useEffect(() => {
        if (!gameState || gameState.status !== 'game_end') return;
        const winKey = `${gameState.roomId}:${gameState.matchIndex ?? 0}`;
        if (lastWinKeyRef.current === winKey) return;
        lastWinKeyRef.current = winKey;
        const myTeam = gameState.players?.find((p: any) => p.id === currentPlayerId)?.team;
        const wTeam = gameState.winnerTeam
            ?? (gameState.points.team1 > gameState.points.team2 ? 1 : gameState.points.team2 > gameState.points.team1 ? 2 : null);
        if (wTeam && myTeam === wTeam) {
            playSoundEffect('win');
        }
    }, [gameState?.status, gameState?.roomId, gameState?.matchIndex, gameState?.winnerTeam, gameState?.points?.team1, gameState?.points?.team2, gameState?.players, currentPlayerId]);

    // Turn timer countdown + final-5s urgent tick sound
    useEffect(() => {
        if (!gameState || gameState.status !== 'playing' || !gameState.turnDeadline) {
            setTurnSecondsLeft(null);
            return;
        }
        const updateTimer = () => {
            const secs = Math.max(0, Math.ceil((gameState.turnDeadline - Date.now()) / 1000));
            setTurnSecondsLeft(secs);
        };
        updateTimer();
        const intervalId = window.setInterval(updateTimer, 250);
        return () => window.clearInterval(intervalId);
    }, [gameState?.status, gameState?.turnDeadline]);

    useEffect(() => {
        if (!gameState || gameState.status !== 'playing' || turnSecondsLeft === null) {
            lastTickSecondRef.current = null;
            return;
        }
        const myPlayer = gameState.players?.find((p: any) => p.id === currentPlayerId);
        const isTurnMine = gameState.players?.[gameState.currentTurnIndex]?.id === currentPlayerId;
        const isRespondingToCall = Boolean(myPlayer && gameState.callState?.awaitingResponseFromTeam === myPlayer.team);
        if ((isTurnMine || isRespondingToCall) && turnSecondsLeft > 0 && turnSecondsLeft <= 5 && lastTickSecondRef.current !== turnSecondsLeft) {
            lastTickSecondRef.current = turnSecondsLeft;
            playSoundEffect('tick');
        }
    }, [turnSecondsLeft, gameState, currentPlayerId]);

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
        if (!gameState || gameState.status !== 'playing' || gameState.callState?.type) {
            setPlayCoveredNext(false);
            return;
        }
        const tricksTotal = (gameState.tricks?.team1 ?? 0) + (gameState.tricks?.team2 ?? 0);
        const isTurnMine = gameState.players?.[gameState.currentTurnIndex]?.id === currentPlayerId;
        if (!isTurnMine || tricksTotal === 0 || gameState.maoDeFerroActive) {
            setPlayCoveredNext(false);
        }
    }, [gameState, currentPlayerId]);

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

    const toggleMute = () => {
        const next = !soundMuted;
        setSoundMuted(next);
        setSoundMutedState(next);
    };

    const handleSendEmote = (emoteKey: string) => {
        if (!socket) return;
        socket.emit('sendEmote', gameState.roomId, emoteKey);
        setEmoteMenuOpen(false);
    };

    const handleSendSignal = (signalKey: string) => {
        if (!socket) return;
        socket.emit('sendPartnerSignal', gameState.roomId, signalKey);
        setSignalMenuOpen(false);
    };

    const handleLeaveTableClick = () => {
        if (gameState.status === 'game_end') {
            onLeave?.();
            return;
        }
        setLeaveConfirmOpen(true);
    };

    const sendDebugCommand = (command: DebugCommand) => {
        if (!socket) return;
        socket.emit('debugCommand', gameState.roomId, command);
    };

    const handlePlayCard = (index: number) => {
        const awaitingMyTeam = gameState.callState?.awaitingResponseFromTeam === me?.team;
        if (socket && isMyTurn && allPlayersReady && !awaitingMyTeam && !gameState.callState?.type) {
            const useCovered = playCoveredNext && tricksPlayed >= 1 && !gameState.maoDeFerroActive;
            socket.emit('playCard', gameState.roomId, index, useCovered);
            setPlayCoveredNext(false);
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
    const canPlayCovered = tricksPlayed >= 1 && !gameState.maoDeFerroActive;
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

    const renderCard = (card: any, index: number, hidden = false, onClick?: () => void, cardBackId?: string) => {
        const isMaskedCovered = Boolean(card?.isCovered) && (card?.rank === '?' || card?.suit === 'hidden');
        if (hidden || isMaskedCovered) {
            return (
                <div
                    key={index}
                    className={`playing-card back ${cardBackId || 'back_slate'} ${card?.isCovered ? 'covered-card' : ''}`}
                    onClick={onClick}
                    title={card?.isCovered ? 'Played face-down (-1 power)' : undefined}
                >
                    <div className="card-pattern"></div>
                    {card?.isCovered && <span className="covered-card-badge">🕵️</span>}
                </div>
            );
        }
        return (
            <div
                key={index}
                className={`playing-card front ${onClick ? 'playable' : ''} ${card?.isManilha && !card?.isCovered ? 'manilha-glow' : ''} ${card?.isCovered ? 'covered-face-card' : ''}`}
                onClick={onClick}
                title={card?.isCovered ? 'Played face-down (-1 power)' : undefined}
            >
                <div className={`card-value ${getSuitColor(card?.suit)}`}>{card?.rank}</div>
                <div className={`card-suit ${getSuitColor(card?.suit)}`}>{getSuitSymbol(card?.suit)}</div>
                {card?.isCovered && <span className="covered-face-tag">🕵️</span>}
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
        const seatEmote = activeEmotes[player.id];

        // Find the most recent notification for this player's team
        const teamNotifications = (gameState.notifications || []).filter((n: any) => n.team === player.team);
        const latestNotification = teamNotifications.length > 0 ? teamNotifications[teamNotifications.length - 1] : null;

        return (
            <div className={`player-position position-${position} ${isTurn && !isMine ? 'other-turn' : ''}`}>
                {/* Player info badge */}
                <div className={`player-info ${isPartner ? 'partner-info' : ''} ${isTurn && !isMine ? 'turn-pulse' : ''}`}>
                    <div className={`player-avatar team-avatar-${player.team}`}>{player.name[0]}</div>
                    <span>{player.name}</span>
                    {player.titleLabel && <span className="player-title-pill">{player.titleLabel}</span>}
                    {(player.currentStreak ?? 0) > 0 && (
                        <span className="player-streak-pill" title={`${player.currentStreak} win streak`}>
                            🔥{player.currentStreak}
                        </span>
                    )}
                    {isPartner && <span className="partner-badge">Partner</span>}
                    <span className={`team-tag team-${player.team}`}>{teamLabel}</span>
                    {isTurn && !isMine && allPlayersReady && <span className="thinking-dots">...</span>}
                    {!player.maoBaixaReady && tricksPlayed === 0 && !gameState.callState.type && <span className="thinking-dots" style={{ color: '#a78bfa', marginLeft: '4px' }}>Thinking...</span>}
                    {seatEmote ? (
                        <div key={seatEmote.id} className="player-emote-bubble">
                            <span>{seatEmote.icon}</span>
                            <span>{seatEmote.text}</span>
                        </div>
                    ) : latestNotification ? (
                        <div className="player-notification-bubble">
                            {latestNotification.message}
                        </div>
                    ) : null}
                </div>

                {/* Cards in hand */}
                {position !== 'bottom' && (
                    <div className={`player-hand ${vertical ? 'vertical' : ''}`}>
                        {secretDebugActive || player.exposedHand || (gameState.maoDeOnzeTeam === me?.team && player.team === me?.team) || gameState.status === 'round_end' || gameState.status === 'game_end'
                            ? player.hand.map((card: any, i: number) => renderCard(card, i, false, undefined, player.cardBack))
                            : player.hand.map((_: any, i: number) => renderCard(null, i, true, undefined, player.cardBack))
                        }
                    </div>
                )}

                {/* Card played on table — shown near this player position */}
                {cardOnTable && position !== 'bottom' && (
                    <div
                        key={`played-${globalIndex}-${cardOnTable.rank}-${cardOnTable.suit}-${cardOnTable.isCovered ? 'cov' : 'open'}`}
                        className={`played-card-near played-near-${position} played-card-animate`}
                    >
                        {renderCard(cardOnTable, globalIndex, false, undefined, player.cardBack)}
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
    const trickHistoryList: any[] =
        Array.isArray(gameState.trickHistory) && gameState.trickHistory.length > 0
            ? gameState.trickHistory
            : clientTrickHistory;
    const sidePileTricks = trickHistoryList;
    const myGlobalIndex = getGlobalIndex(me);
    const team1DuelName = me?.team === 1 ? 'You' : (gameState.players.find((p: any) => p.team === 1)?.name || 'P1');
    const team2DuelName = me?.team === 2 ? 'You' : (gameState.players.find((p: any) => p.team === 2)?.name || 'P2');
    const formatTrickPlayerName = (playerIndex: number, fallbackName: string) =>
        playerIndex === myGlobalIndex ? 'You' : (fallbackName || `P${playerIndex + 1}`);

    return (
        <div className="game-table-wrapper">
            {/* Player Menu */}
            <button className={`menu-trigger glass-panel ${secretDebugActive ? 'debug-active' : ''}`} onClick={() => setMenuOpen(true)}>
                <User size={16} /> {playerName || me?.name || 'Me'}
                {secretDebugActive && <span className="menu-debug-pill">Debug</span>}
            </button>

            {/* Top-Right HUD: Pot, Timer, Mute, Report & Visible Leave Table Button */}
            <div className="table-top-right-hud">
                {(gameState.wagerPot ?? 0) > 0 && (
                    <div className="hud-pill hud-pot-pill" title="Bucks wager pot awarded to match winner">
                        🪙 Pot: <strong>{gameState.wagerPot}</strong>
                    </div>
                )}
                {turnSecondsLeft !== null && gameState.status === 'playing' && (
                    <div
                        className={`hud-pill hud-timer-pill ${turnSecondsLeft <= 5 ? 'timer-urgent' : ''}`}
                        title="Turn timer countdown"
                    >
                        ⏱️ {turnSecondsLeft}s
                    </div>
                )}
                <button
                    type="button"
                    className="hud-icon-btn glass-panel"
                    onClick={toggleMute}
                    aria-label={soundMuted ? 'Unmute table sound effects' : 'Mute table sound effects'}
                    title={soundMuted ? 'Unmute SFX' : 'Mute SFX'}
                >
                    {soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <button type="button" className="report-trigger glass-panel" onClick={() => setReportOpen(true)}>
                    <AlertTriangle size={16} /> Report Issue
                </button>
                <button
                    type="button"
                    className="leave-table-trigger glass-panel"
                    onClick={handleLeaveTableClick}
                    title="Leave table and return to lobby"
                >
                    <LogOut size={16} /> Leave Table
                </button>
            </div>

            {/* 2v2 Partner Signal / Subtle Tell Toast */}
            {partnerSignalToast && (
                <div className={`partner-signal-banner ${partnerSignalToast.isTell ? 'is-tell' : ''}`}>
                    <span className="partner-signal-icon">{partnerSignalToast.icon}</span>
                    <div>
                        <div className="partner-signal-title">
                            {partnerSignalToast.isTell ? 'Opponent Tell' : `${partnerSignalToast.senderName} (${partnerSignalToast.label})`}
                        </div>
                        <div className="partner-signal-hint">{partnerSignalToast.hint}</div>
                    </div>
                </div>
            )}

            {/* Mini Tricks Tracker Tab (Top-Left Fixed HUD, clear of Teacher Mode) */}
            <div className={`tricks-mini-tab glass-panel ${tricksTabExpanded ? 'expanded' : ''}`}>
                <button
                    type="button"
                    className="tricks-mini-tab-header"
                    onClick={() => setTricksTabExpanded((prev) => !prev)}
                    title="Click to toggle trick-by-trick history"
                >
                    <div className="tricks-mini-title-row">
                        <span className="tricks-mini-label">TRICKS TRACKER</span>
                        <span className="tricks-mini-stakes">{gameState.roundPoints} pt{gameState.roundPoints === 1 ? '' : 's'}</span>
                    </div>
                    <div className="tricks-mini-score-row">
                        <span className="team-1">
                            🔵 {isDuel ? team1DuelName : 'Team 1'}: <strong>{gameState.tricks.team1}</strong>
                        </span>
                        <span className="tricks-mini-vs">–</span>
                        <span className="team-2">
                            🔴 {isDuel ? team2DuelName : 'Team 2'}: <strong>{gameState.tricks.team2}</strong>
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
                            const winnerDisplay = record?.winnerTeam
                                ? formatTrickPlayerName(record.winningPlayerIndex, record.winnerName)
                                : null;
                            return (
                                <span
                                    key={idx}
                                    className={`trick-pip ${pipClass}`}
                                    title={
                                        !record
                                            ? `Trick ${idx + 1}: Not played yet`
                                            : record.winnerTeam
                                                ? `Trick ${idx + 1}: Won by ${winnerDisplay} (Team ${record.winnerTeam})`
                                                : `Trick ${idx + 1}: Tied`
                                    }
                                >
                                    {!record ? idx + 1 : record.winnerTeam === 1 ? '🔵' : record.winnerTeam === 2 ? '🔴' : '='}
                                </span>
                            );
                        })}
                        <span className="tricks-mini-chevron">{tricksTabExpanded ? '▾' : '▸'}</span>
                    </div>
                </button>

                {tricksTabExpanded && (
                    <div className="tricks-mini-body">
                        {trickHistoryList.length === 0 ? (
                            <div className="tricks-mini-empty">Play a trick to see cards &amp; winners here.</div>
                        ) : (
                            trickHistoryList.map((trick: any) => {
                                const winnerLabel = trick.winnerTeam
                                    ? formatTrickPlayerName(trick.winningPlayerIndex, trick.winnerName)
                                    : null;
                                return (
                                    <div key={trick.trickNumber} className="tricks-mini-history-item">
                                        <div className="tricks-mini-history-head">
                                            <span>Trick #{trick.trickNumber}</span>
                                            <span className={trick.winnerTeam === 1 ? 'team-1' : trick.winnerTeam === 2 ? 'team-2' : ''}>
                                                {trick.winnerTeam ? `🏆 ${winnerLabel}` : '🤝 Tie'}
                                            </span>
                                        </div>
                                        <div className="tricks-mini-history-cards">
                                            {trick.cards.map((entry: any, cIdx: number) => {
                                                const pLabel = formatTrickPlayerName(entry.playerIndex, entry.playerName);
                                                const isWinner = trick.winningPlayerIndex === entry.playerIndex;
                                                const isMaskedCov = Boolean(entry.card?.isCovered) && (entry.card?.rank === '?' || entry.card?.suit === 'hidden');
                                                return (
                                                    <span
                                                        key={cIdx}
                                                        className={`tricks-mini-card-entry ${isWinner ? 'winner-entry' : ''}`}
                                                    >
                                                        <span className={`tricks-mini-player-tag team-${entry.team}`}>{pLabel}:</span>
                                                        {isMaskedCov ? (
                                                            <span className="tricks-mini-card-chip covered-chip" title="Played face-down (-1 power)">🕵️?</span>
                                                        ) : (
                                                            <span className={`tricks-mini-card-chip ${getSuitColor(entry.card?.suit)} ${isWinner ? 'winner-chip' : ''}`}>
                                                                {entry.card?.isCovered ? '🕵️ ' : ''}{entry.card?.rank}{getSuitSymbol(entry.card?.suit)}
                                                            </span>
                                                        )}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* Bottom-Right Quick Emotes & 2v2 Partner Signals Bar (clear of bottom-left Teacher Mode) */}
            {me && gameState.status === 'playing' && (
                <div className="table-social-dock">
                    {emoteMenuOpen && (
                        <div className="social-popover glass-panel">
                            {QUICK_EMOTE_OPTIONS.map((em) => (
                                <button
                                    key={em.key}
                                    type="button"
                                    className="social-popover-item"
                                    onClick={() => handleSendEmote(em.key)}
                                >
                                    <span>{em.icon}</span>
                                    <span>{em.text}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {signalMenuOpen && !isDuel && (
                        <div className="social-popover glass-panel signals-popover">
                            <div className="social-popover-header">2v2 Partner Signal (35% tell risk!)</div>
                            {PARTNER_SIGNAL_OPTIONS.map((sig) => (
                                <button
                                    key={sig.key}
                                    type="button"
                                    className="social-popover-item"
                                    onClick={() => handleSendSignal(sig.key)}
                                >
                                    <span>{sig.icon}</span>
                                    <span><strong>{sig.label}:</strong> {sig.hint}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="social-dock-row">
                        <button
                            type="button"
                            className={`social-dock-btn glass-panel ${emoteMenuOpen ? 'active' : ''}`}
                            onClick={() => {
                                setEmoteMenuOpen((p) => !p);
                                setSignalMenuOpen(false);
                            }}
                        >
                            <Smile size={15} /> Emotes
                        </button>
                        {!isDuel && (
                            <button
                                type="button"
                                className={`social-dock-btn glass-panel ${signalMenuOpen ? 'active' : ''}`}
                                onClick={() => {
                                    setSignalMenuOpen((p) => !p);
                                    setEmoteMenuOpen(false);
                                }}
                                title="Send secret signal to your 2v2 partner"
                            >
                                😉 Signals
                            </button>
                        )}
                    </div>
                </div>
            )}

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

            {/* Native Dialog: Forfeit Confirmation */}
            <ModalDialog
                open={forfeitConfirmOpen}
                onClose={() => setForfeitConfirmOpen(false)}
                title="Forfeit Round?"
                className="forfeit-modal"
            >
                <p className="forfeit-modal-desc">
                    {gameState.maoDeFerroActive
                        ? 'Are you sure you want to forfeit Mão de Ferro? Your opponent will win the match immediately.'
                        : `Are you sure you want to give up this round? Your opponent will be awarded ${gameState.roundPoints} ${gameState.roundPoints === 1 ? 'point' : 'points'}.`}
                </p>
                <div className="forfeit-modal-actions">
                    <button
                        type="button"
                        className="btn btn-secondary"
                        autoFocus
                        onClick={() => setForfeitConfirmOpen(false)}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => {
                            handleCall('forfeit_round');
                            setForfeitConfirmOpen(false);
                        }}
                    >
                        Yes, Forfeit Round
                    </button>
                </div>
            </ModalDialog>

            {/* Native Dialog: Leave Table Confirmation */}
            <ModalDialog
                open={leaveConfirmOpen}
                onClose={() => setLeaveConfirmOpen(false)}
                title="Leave Table?"
                className="forfeit-modal"
            >
                <p className="forfeit-modal-desc">
                    {(gameState.wagerPot ?? 0) > 0 && gameState.status === 'playing'
                        ? `An active ${gameState.wagerPot} Bucks wager pot is on this table. Leaving now ends the match and refunds escrowed antes.`
                        : 'Are you sure you want to leave this table and return to the lobby?'}
                </p>
                <div className="forfeit-modal-actions">
                    <button
                        type="button"
                        className="btn btn-secondary"
                        autoFocus
                        onClick={() => setLeaveConfirmOpen(false)}
                    >
                        Stay at Table
                    </button>
                    <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => {
                            setLeaveConfirmOpen(false);
                            onLeave?.();
                        }}
                    >
                        <LogOut size={15} /> Leave Table
                    </button>
                </div>
            </ModalDialog>

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

            <div className={`table-felt ${feltTheme}`}>
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
                            {sidePileTricks.map((trick: any) => {
                                const winnerShortName = trick.winnerTeam
                                    ? formatTrickPlayerName(trick.winningPlayerIndex, trick.winnerName)
                                    : null;
                                return (
                                    <div
                                        key={`side-trick-${trick.trickNumber}`}
                                        className={`side-trick-cluster ${trick.winnerTeam === 1 ? 'won-team-1' : trick.winnerTeam === 2 ? 'won-team-2' : 'won-tie'}`}
                                        title={trick.winnerTeam ? `Trick #${trick.trickNumber} — Won by ${winnerShortName}` : `Trick #${trick.trickNumber} — Tied`}
                                    >
                                        <div className="side-trick-header">
                                            <span className="side-trick-badge">
                                                #{trick.trickNumber} {trick.winnerTeam === 1 ? '🔵' : trick.winnerTeam === 2 ? '🔴' : '🤝'}
                                            </span>
                                            <span className={`side-trick-winner ${trick.winnerTeam === 1 ? 'team-1' : trick.winnerTeam === 2 ? 'team-2' : ''}`}>
                                                {trick.winnerTeam ? `🏆 ${winnerShortName}` : 'Tie'}
                                            </span>
                                        </div>
                                        <div className="side-trick-cards">
                                            {trick.cards.map((entry: any, cIdx: number) => {
                                                const isWinningCard = trick.winningPlayerIndex === entry.playerIndex;
                                                const pLabel = formatTrickPlayerName(entry.playerIndex, entry.playerName);
                                                const isMaskedCov = Boolean(entry.card?.isCovered) && (entry.card?.rank === '?' || entry.card?.suit === 'hidden');
                                                return (
                                                    <div key={cIdx} className="side-trick-card-slot">
                                                        <div
                                                            className={`mini-table-card ${isWinningCard ? 'mini-card-winner' : ''} ${entry.card?.isManilha && !entry.card?.isCovered ? 'mini-card-manilha' : ''} ${isMaskedCov ? 'mini-card-covered' : ''}`}
                                                        >
                                                            {isMaskedCov ? (
                                                                <>
                                                                    <span className="mini-card-rank">🕵️</span>
                                                                    <span className="mini-card-suit">?</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <span className={`mini-card-rank ${getSuitColor(entry.card?.suit)}`}>{entry.card?.rank}</span>
                                                                    <span className={`mini-card-suit ${getSuitColor(entry.card?.suit)}`}>{getSuitSymbol(entry.card?.suit)}</span>
                                                                    {entry.card?.isCovered && <span className="mini-covered-tag">🕵️</span>}
                                                                </>
                                                            )}
                                                        </div>
                                                        <span className={`side-trick-player-name team-${entry.team}`}>{pLabel}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
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
                        <div className={`player-hand my-hand ${playCoveredNext ? 'covered-armed' : ''}`}>
                            {me.hand.length === 0 && gameState.status === 'playing' && gameState._phase === 'MAO_DE_ONZE_DECISION' && gameState.maoDeOnzeTeam !== me.team ? (
                                <div className="waiting-cards-indicator" style={{ color: '#94a3b8', fontStyle: 'italic', padding: '10px 16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.2)' }}>
                                    🎴 Cards will be dealt if opponent accepts the round
                                </div>
                            ) : (
                                me.hand.map((card: any, i: number) =>
                                    renderCard(card, i, false, isMyTurn ? () => handlePlayCard(i) : undefined, me.cardBack)
                                )
                            )}
                        </div>
                        <div className="player-info my-info glass-panel">
                            <div className={`player-avatar team-avatar-${me.team}`}>{me.name[0]}</div>
                            <span>{me.name} <span className="you-tag">(You)</span></span>
                            {me.titleLabel && <span className="player-title-pill">{me.titleLabel}</span>}
                            {(me.currentStreak ?? 0) > 0 && (
                                <span className="player-streak-pill" title={`${me.currentStreak} win streak`}>
                                    🔥{me.currentStreak}
                                </span>
                            )}
                            <span className={`team-tag team-${me.team}`}>{me.team === 1 ? '🔵 T1' : '🔴 T2'}</span>
                            {isMyTurn && <span className="turn-indicator">Your Turn!</span>}
                            {activeEmotes[me.id] && (
                                <div key={activeEmotes[me.id].id} className="player-emote-bubble">
                                    <span>{activeEmotes[me.id].icon}</span>
                                    <span>{activeEmotes[me.id].text}</span>
                                </div>
                            )}
                        </div>

                        {/* Card played by me */}
                        {(() => {
                            const myPlayedCard = getCardOnTable(getGlobalIndex(me));
                            return myPlayedCard ? (
                                <div
                                    key={`played-me-${myPlayedCard.rank}-${myPlayedCard.suit}-${myPlayedCard.isCovered ? 'cov' : 'open'}`}
                                    className="played-card-near played-near-bottom played-card-animate"
                                >
                                    {renderCard(myPlayedCard, 99, false, undefined, me.cardBack)}
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

                        {/* ── Truco / Respond & Covered Card toggle buttons ── */}
                        {gameState.status === 'playing' && !gameState.callState.type && allPlayersReady && isMyTurn && (
                            <div className="action-buttons">
                                {canPlayCovered && (
                                    <button
                                        type="button"
                                        className={`btn btn-covered-toggle ${playCoveredNext ? 'active' : ''}`}
                                        onClick={() => setPlayCoveredNext((prev) => !prev)}
                                        title="Play your next card face-down (-1 power, hidden from opponents until round end)"
                                    >
                                        {playCoveredNext ? '🕵️ Face-Down: ON' : '🕵️ Play Face-Down'}
                                    </button>
                                )}
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
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                        <button className="btn btn-primary" onClick={() => handleCall('accept')}>Accept ✅</button>
                                        {gameState.callState.type === 'truco' && (
                                            <button className="btn btn-truco" onClick={() => handleCall('raise_double')}>Raise DOUBLE! (6) 🔥</button>
                                        )}
                                        {gameState.callState.type === 'double' && (
                                            <button className="btn btn-truco" onClick={() => handleCall('raise_triple')}>Raise TRIPLE! (9) 🔥</button>
                                        )}
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
