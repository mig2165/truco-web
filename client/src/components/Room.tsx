import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Users, Info, Copy, BookOpen } from 'lucide-react';
import {
    getBrowserNotificationPermission,
    isBrowserNotificationSupported,
    requestBrowserNotificationPermission,
    sendBrowserNotification
} from '../lib/browserNotifications';
import type { BrowserNotificationPermission } from '../lib/browserNotifications';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import './Room.css';
import { GameTable } from './GameTable';
import { ChatPanel } from './ChatPanel';
import { RulesPanel } from './RulesPanel';
import { DevPanel } from './DevPanel';
import { ChangelogLauncher } from './ChangelogLauncher';
import { EconomyWidget } from './EconomyWidget';

type RoomPreviewPlayer = {
    id: string;
    name: string;
    team: number;
    isBot?: boolean;
};

type RoomPreviewState = {
    roomId: string;
    status: string;
    dev?: { enabled?: boolean };
    players: RoomPreviewPlayer[];
};

type PlayerActionRequirement = {
    key: string;
    body: string;
};

const isBrowserTabInactive = () =>
    typeof document !== 'undefined' && (document.visibilityState === 'hidden' || !document.hasFocus());

const getActionRequirement = (state: any, currentPlayerId: string | undefined): PlayerActionRequirement | null => {
    if (!state || !currentPlayerId || state.status !== 'playing') {
        return null;
    }

    const me = state.players.find((player: any) => player.id === currentPlayerId);
    if (!me) {
        return null;
    }

    if (state._phase === 'MAO_DE_ONZE_DECISION' && state.maoDeOnzeTeam === me.team) {
        return {
            key: 'mao-de-onze',
            body: 'Your team needs to decide whether to play or run in Mão de Onze.'
        };
    }

    if (state.callState?.awaitingResponseFromTeam === me.team) {
        const isMaoCall = state.callState.type === 'mao_baixa' || state.callState.type === 'mao_real';

        return {
            key: `respond-${state.callState.type ?? 'call'}`,
            body: isMaoCall
                ? `The other team called ${state.callState.type === 'mao_baixa' ? 'Mão Baixa' : 'Mão Real'}. You need to respond.`
                : `The other team called ${String(state.callState.type ?? 'Truco').toUpperCase()}. You need to respond.`
        };
    }

    if (state._phase === 'WAITING_FOR_HAND_PHASE' && !me.maoBaixaReady) {
        return {
            key: 'review-hand',
            body: 'Review your hand and choose whether to keep it or make a Mão call.'
        };
    }

    const allPlayersReady = state.players.every((player: any) => player.maoBaixaReady);
    const isMyTurn = state.players[state.currentTurnIndex]?.id === currentPlayerId;

    if (state._phase === 'TRICK_PHASE' && allPlayersReady && isMyTurn && state.callState?.awaitingResponseFromTeam == null) {
        return {
            key: 'play-turn',
            body: 'It is your turn to play a card or make a call.'
        };
    }

    return null;
};

const MATCH_REWARD_TOAST_DURATION_MS = 5000;

export const Room: React.FC = () => {
    const { roomId } = useParams<{ roomId: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const { socket, persistentPlayerId } = useSocket();
    const { user, isLoading } = useAuth();

    const [gameState, setGameState] = useState<any>(null);
    const [roomPreview, setRoomPreview] = useState<RoomPreviewState | null>(null);
    const [error, setError] = useState('');
    const [teamPick, setTeamPick] = useState<null | 1 | 2>(null);
    const [joinInFlight, setJoinInFlight] = useState(false);
    const [joinedRoom, setJoinedRoom] = useState(false);
    const [copied, setCopied] = useState(false);
    const hasJoined = useRef(false);

    const rewardedRoomId = useRef<string | null>(null);
    const [matchReward, setMatchReward] = useState<{ amount: number; isWinner: boolean } | null>(null);
    const tabInactiveRef = useRef(isBrowserTabInactive());
    const transitionSnapshotRef = useRef<{ roomId: string | null; status: string | null; actionKey: string | null }>({
        roomId: null,
        status: null,
        actionKey: null
    });

    const [rulesOpen, setRulesOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<any[]>([]);
    const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>(() => getBrowserNotificationPermission());

    const playerName = new URLSearchParams(location.search).get('name') || 'Player';
    const isCreating = new URLSearchParams(location.search).get('create') === '1';
    const notificationsSupported = isBrowserNotificationSupported();

    // Auto-pick Team 1 for the room creator; others see team selection
    useEffect(() => {
        if (isCreating) setTeamPick(1);
    }, [isCreating]);

    // Post-match reward: fires once when the game ends, idempotent per roomId.
    useEffect(() => {
        if (!gameState || gameState.status !== 'game_end' || !persistentPlayerId || !roomId) return;

        // Only apply reward once per match room.
        if (rewardedRoomId.current === roomId) return;

        const me = gameState.players.find((p: any) => p.id === socket?.id);
        if (!me) return; // spectators / bots don't get rewards

        // winnerTeam is always 1 or 2 when status === 'game_end', but guard for safety.
        if (gameState.winnerTeam == null) return;

        // Lock the ref only after we confirm we have a real seated player to reward.
        rewardedRoomId.current = roomId;

        const isWinner = (me.team as number) === (gameState.winnerTeam as number);

        void fetch(`${getApiBaseUrl()}/api/economy/match-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ playerId: persistentPlayerId, roomId, isWinner }),
        })
            .then(r => r.ok ? r.json() : null)
            .then((data: { alreadyRecorded: boolean; transaction: { amount: number } | null } | null) => {
                if (data && !data.alreadyRecorded && data.transaction) {
                    setMatchReward({ amount: data.transaction.amount, isWinner });
                    // Auto-dismiss after 5 seconds.
                    setTimeout(() => setMatchReward(null), MATCH_REWARD_TOAST_DURATION_MS);
                }
            })
            .catch(() => { /* silently ignore */ });
    }, [gameState, persistentPlayerId, roomId, socket?.id]);

    useEffect(() => {
        const syncBrowserAttentionState = () => {
            tabInactiveRef.current = isBrowserTabInactive();
            setNotificationPermission(getBrowserNotificationPermission());
        };

        syncBrowserAttentionState();
        document.addEventListener('visibilitychange', syncBrowserAttentionState);
        window.addEventListener('focus', syncBrowserAttentionState);
        window.addEventListener('blur', syncBrowserAttentionState);

        return () => {
            document.removeEventListener('visibilitychange', syncBrowserAttentionState);
            window.removeEventListener('focus', syncBrowserAttentionState);
            window.removeEventListener('blur', syncBrowserAttentionState);
        };
    }, []);

    // Start listening before the user joins so we can render the team picker with live room data.
    useEffect(() => {
        if (!socket || !roomId) return;

        const onStateUpdate = (state: any) => {
            setGameState(state);
            setRoomPreview({
                roomId: state.roomId,
                status: state.status,
                dev: state.dev,
                players: state.players.map((player: any) => ({
                    id: player.id,
                    name: player.name,
                    team: player.team,
                    isBot: player.isBot
                }))
            });

            // Once the server echoes us back in the roster, we know the join actually stuck.
            if (state.players.some((player: any) => player.id === socket.id)) {
                hasJoined.current = true;
                setJoinedRoom(true);
                setJoinInFlight(false);
            }
        };
        const onRoomPreview = (preview: RoomPreviewState) => setRoomPreview(preview);
        const onError = (msg: string) => {
            setJoinInFlight(false);

            // Full-room failures should surface as an explicit prompt, then bounce back to the lobby.
            if (msg === 'Game full!') {
                window.alert('Game full!');
                navigate('/');
                return;
            }

            // If a seat was taken between preview and click, return the user to the picker and refresh it.
            if (msg === 'Team 1 is full.' || msg === 'Team 2 is full.') {
                window.alert(msg);
                hasJoined.current = false;
                setJoinedRoom(false);
                setTeamPick(null);
                socket.emit('getRoomPreview', roomId);
                return;
            }

            setError(msg);
        };
        const onChat = (msg: any) => {
            setChatMessages(prev => [...prev, msg]);
        };

        socket.on('gameStateUpdate', onStateUpdate);
        socket.on('roomPreview', onRoomPreview);
        socket.on('error', onError);
        socket.on('chatMessage', onChat);
        socket.emit('getRoomPreview', roomId);

        return () => {
            socket.off('gameStateUpdate', onStateUpdate);
            socket.off('roomPreview', onRoomPreview);
            socket.off('error', onError);
            socket.off('chatMessage', onChat);
        };
    }, [socket, roomId, navigate]);

    // Join the room when the user actually clicks a team card.
    useEffect(() => {
        if (!socket || !roomId || !teamPick || joinInFlight || joinedRoom || hasJoined.current) return;

        if ((roomPreview?.players.length ?? 0) >= 4) {
            window.alert('Game full!');
            navigate('/');
            return;
        }

        setJoinInFlight(true);
        socket.emit('joinRoom', roomId, playerName, teamPick);
    }, [socket, roomId, playerName, teamPick, roomPreview, joinInFlight, joinedRoom, navigate]);

    useEffect(() => {
        if (!gameState || !socket?.id) {
            transitionSnapshotRef.current = {
                roomId: null,
                status: null,
                actionKey: null
            };
            return;
        }

        const currentRoomId = gameState.roomId ?? roomId ?? null;
        const currentAction = getActionRequirement(gameState, socket.id);
        const previousSnapshot = transitionSnapshotRef.current;

        // Reset transition detection when the user moves to another room or reconnects into a different state stream.
        if (previousSnapshot.roomId !== currentRoomId) {
            transitionSnapshotRef.current = {
                roomId: currentRoomId,
                status: gameState.status ?? null,
                actionKey: currentAction?.key ?? null
            };
            return;
        }

        const isLocalPlayerSeated = gameState.players.some((player: any) => player.id === socket.id);
        const gameJustStarted =
            isLocalPlayerSeated &&
            (previousSnapshot.status === 'waiting' || previousSnapshot.status === 'game_end') &&
            gameState.status === 'playing';
        const becameActionable =
            isLocalPlayerSeated &&
            previousSnapshot.actionKey === null &&
            currentAction !== null;

        if (gameJustStarted) {
            sendBrowserNotification({
                title: `Game started in room ${currentRoomId}`,
                body: 'All seats are filled and the match is live.',
                tag: `game-start:${currentRoomId}`
            });
        }

        if (becameActionable && tabInactiveRef.current) {
            sendBrowserNotification({
                title: `Your action is needed in room ${currentRoomId}`,
                body: currentAction.body,
                tag: `turn:${currentRoomId}`
            });
        }

        transitionSnapshotRef.current = {
            roomId: currentRoomId,
            status: gameState.status ?? null,
            actionKey: currentAction?.key ?? null
        };
    }, [gameState, roomId, socket?.id]);

    const requestNotifications = async () => {
        const nextPermission = await requestBrowserNotificationPermission();
        setNotificationPermission(nextPermission);
    };

    const handleLeave = () => {
        if (socket && roomId && hasJoined.current) {
            // Tell the server to free our seat immediately instead of waiting for a disconnect.
            socket.emit('leaveRoom', roomId);
            hasJoined.current = false;
            setJoinedRoom(false);
            setJoinInFlight(false);
        }
        navigate('/');
    };

    const copyCode = () => {
        if (roomId) {
            navigator.clipboard.writeText(roomId);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleTeamSelection = (team: 1 | 2) => {
        // Keep the click path explicit so users get a prompt instead of a dead button.
        if (roomIsFull) {
            window.alert('Game full!');
            navigate('/');
            return;
        }

        if (team === 1 && team1IsFull) {
            window.alert('Team 1 is full.');
            return;
        }

        if (team === 2 && team2IsFull) {
            window.alert('Team 2 is full.');
            return;
        }

        setTeamPick(team);

        // Ask at a moment that already comes from a user gesture so browsers accept the permission prompt.
        if (getBrowserNotificationPermission() === 'default') {
            void requestNotifications();
        }
    };

    const previewPlayers = roomPreview?.players ?? [];
    const team1PreviewPlayers = previewPlayers.filter((player) => player.team === 1);
    const team2PreviewPlayers = previewPlayers.filter((player) => player.team === 2);
    const roomIsFull = previewPlayers.length >= 4;
    const team1IsFull = team1PreviewPlayers.length >= 2;
    const team2IsFull = team2PreviewPlayers.length >= 2;

    const renderPickerSlots = (players: RoomPreviewPlayer[], team: 1 | 2) => (
        <>
            {players.map((player) => (
                <div key={player.id} className="player-pill">
                    <span className="player-avatar-sm">{player.name[0]}</span>
                    {player.name}
                </div>
            ))}
            {Array.from({ length: Math.max(0, 2 - players.length) }).map((_, index) => (
                <div key={`${team}-open-${index}`} className="player-pill empty">Open slot...</div>
            ))}
        </>
    );

    if (error) {
        return (
            <div className="room-container">
                <div className="error-panel glass-panel">
                    <h2>Error Joining Room</h2>
                    <p>{error}</p>
                    <a href="/" className="btn btn-primary">Return to Lobby</a>
                </div>
            </div>
        );
    }

    // Show team selection for non-creators before joining
    if (!teamPick && !isCreating) {
        return (
            <div className="room-container center">
                <div className="team-picker glass-panel">
                    <h2>Pick Your Team</h2>
                    <p className="subtitle">Room: <strong>{roomId}</strong></p>
                    <p className={`team-picker-status ${roomIsFull ? 'full' : ''}`}>
                        {roomIsFull ? 'Game full!' : `${previewPlayers.length}/4 players seated. Click a team to join.`}
                    </p>
                    <div className="team-pick-grid">
                        <button
                            className="team-seat-card team-1-card"
                            onClick={() => handleTeamSelection(1)}
                            disabled={joinInFlight}
                        >
                            <div className="team-seat-header">
                                <span>🔵 Team 1</span>
                                <span>{team1PreviewPlayers.length}/2</span>
                            </div>
                            <div className="team-seat-list">
                                {renderPickerSlots(team1PreviewPlayers, 1)}
                            </div>
                            <span className="team-seat-action">
                                {team1IsFull ? 'Team 1 full' : 'Click to join Team 1'}
                            </span>
                        </button>

                        <button
                            className="team-seat-card team-2-card"
                            onClick={() => handleTeamSelection(2)}
                            disabled={joinInFlight}
                        >
                            <div className="team-seat-header">
                                <span>🔴 Team 2</span>
                                <span>{team2PreviewPlayers.length}/2</span>
                            </div>
                            <div className="team-seat-list">
                                {renderPickerSlots(team2PreviewPlayers, 2)}
                            </div>
                            <span className="team-seat-action">
                                {team2IsFull ? 'Team 2 full' : 'Click to join Team 2'}
                            </span>
                        </button>
                    </div>
                    {roomIsFull && <p className="team-picker-warning">All four seats are already taken.</p>}
                    <ChangelogLauncher
                        className="btn changelog-update-btn team-picker-changelog-btn"
                        label="UPDATE! View changelog"
                    />
                </div>
            </div>
        );
    }

    if (!gameState) {
        return (
            <div className="room-container center">
                <div className="loading-spinner"></div>
                <p>Joining room...</p>
            </div>
        );
    }

    const isWaiting = gameState.status === 'waiting';
    const isDevRoom = Boolean(gameState.dev?.enabled);

    return (
        <div className="room-container">
            {/* Header Bar */}
            <header className="room-header glass-panel">
                <div className="header-left">
                    <div className="room-badge">
                        <Info size={16} /> Room:&nbsp;<strong>{roomId}</strong>
                        <button className="copy-btn" onClick={copyCode} title="Copy room code">
                            <Copy size={14} />
                            {copied ? ' Copied!' : ''}
                        </button>
                    </div>
                </div>
                <div className="header-center">
                    {isWaiting ? (
                        <h2>{isDevRoom ? 'Preparing dev room...' : `Waiting for players... (${gameState.players.length}/4)`}</h2>
                    ) : (
                        <h2>Truco</h2>
                    )}
                </div>
                <div className="header-right">
                    {user && !isLoading && (
                        <EconomyWidget playerId={user.id} playerName={user.displayName} />
                    )}
                    <div className="points-badge">
                        <span className="team1">Team 1: {gameState.points.team1}</span>
                        <span className="divider">|</span>
                        <span className="team2">Team 2: {gameState.points.team2}</span>
                    </div>
                    <button className="icon-btn" onClick={() => setRulesOpen(true)} title="Game Rules">
                        <BookOpen size={20} />
                    </button>
                </div>
            </header>

            {notificationsSupported && notificationPermission !== 'granted' && (
                <div className={`notification-banner glass-panel ${notificationPermission === 'denied' ? 'blocked' : ''}`}>
                    <div className="notification-banner-copy">
                        <strong>
                            {notificationPermission === 'denied'
                                ? 'Browser notifications are blocked.'
                                : 'Enable browser notifications.'}
                        </strong>
                        <span>
                            Get alerts when the match starts and when you need to act from another tab.
                        </span>
                    </div>
                    {notificationPermission === 'default' && (
                        <button className="btn btn-primary" onClick={() => void requestNotifications()}>
                            Enable Notifications
                        </button>
                    )}
                </div>
            )}

            {/* Match reward toast */}
            {matchReward && (
                <div className="match-reward-toast" role="status">
                    <span className="match-reward-toast__icon">{matchReward.isWinner ? '🏆' : '🎮'}</span>
                    <span className="match-reward-toast__text">
                        {matchReward.isWinner ? 'Victory!' : 'Good game!'}&nbsp;
                        <strong>+{matchReward.amount} Bucks</strong> added to your wallet.
                    </span>
                    <button className="match-reward-toast__close" onClick={() => setMatchReward(null)}>✕</button>
                </div>
            )}

            {/* Main Game Area */}
            <main className="game-area">
                <div className="room-content-shell">
                    <div className="room-main-panel">
                        {isWaiting ? (
                            <div className="waiting-lobby glass-panel">
                                <Users size={48} className="lobby-icon" />
                                <h3>Players ({gameState.players.length}/4)</h3>

                                <div className="teams-grid">
                                    <div className="team-col team-1-col">
                                        <div className="team-col-header">🔵 Team 1</div>
                                        {gameState.players.filter((p: any) => p.team === 1).map((p: any) => (
                                            <div key={p.id} className="player-pill">
                                                <span className="player-avatar-sm">{p.name[0]}</span>
                                                {p.name} {p.id === socket?.id ? '(You)' : ''}
                                            </div>
                                        ))}
                                        {Array.from({ length: Math.max(0, 2 - gameState.players.filter((p: any) => p.team === 1).length) }).map((_, i) => (
                                            <div key={i} className="player-pill empty">Open slot...</div>
                                        ))}
                                    </div>
                                    <div className="vs-divider">VS</div>
                                    <div className="team-col team-2-col">
                                        <div className="team-col-header">🔴 Team 2</div>
                                        {gameState.players.filter((p: any) => p.team === 2).map((p: any) => (
                                            <div key={p.id} className="player-pill">
                                                <span className="player-avatar-sm">{p.name[0]}</span>
                                                {p.name} {p.id === socket?.id ? '(You)' : ''}
                                            </div>
                                        ))}
                                        {Array.from({ length: Math.max(0, 2 - gameState.players.filter((p: any) => p.team === 2).length) }).map((_, i) => (
                                            <div key={i} className="player-pill empty">Open slot...</div>
                                        ))}
                                    </div>
                                </div>

                                <div className="room-invite">
                                    <p>{isDevRoom ? 'Debug room code:' : 'Share this code with your friends:'}</p>
                                    <div className="invite-code" onClick={copyCode}>
                                        {roomId} {copied ? '✓' : <Copy size={14} />}
                                    </div>
                                </div>

                                <ChangelogLauncher
                                    className="btn changelog-update-btn waiting-lobby-changelog-btn"
                                    label="UPDATE! View changelog"
                                />

                                {isDevRoom ? (
                                    <p className="hint">Server bots are being seated and the round will auto-start.</p>
                                ) : (
                                    <p className="hint">Need {4 - gameState.players.length} more player(s)...</p>
                                )}
                            </div>
                        ) : (
                            <div className={`live-game-shell ${isDevRoom ? 'with-dev-panel' : ''}`}>
                                <div className="live-game-stage">
                                    <GameTable gameState={gameState} socket={socket} currentPlayerId={socket?.id} playerName={playerName} onLeave={handleLeave} />
                                </div>
                                {isDevRoom && (
                                    <DevPanel
                                        gameState={gameState}
                                        roomId={roomId || ''}
                                        socket={socket}
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    <aside className="room-chat-sidebar">
                        <ChatPanel
                            socket={socket}
                            roomId={roomId || ''}
                            playerName={playerName}
                            playerTeam={gameState.players.find((p: any) => p.id === socket?.id)?.team || teamPick || 0}
                            messages={chatMessages}
                            onClose={() => undefined}
                            docked
                        />
                    </aside>
                </div>
            </main>

            {/* Rules Panel */}
            {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
        </div>
    );
};
