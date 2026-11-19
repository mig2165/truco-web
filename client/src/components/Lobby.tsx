import React, { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Play, Users, Spade, Bug, Eye, Radio, ChevronDown, ChevronUp, BookOpen, Swords } from 'lucide-react';
import { ChangelogLauncher } from './ChangelogLauncher';
import { EconomyWidget } from './EconomyWidget';
import { AuthUI } from './AuthUI';
import { RulesPanel } from './RulesPanel';
import './Lobby.css';

type LobbyRoomPlayer = {
    name: string;
    team: 1 | 2;
    isBot: boolean;
};

type LobbyRoom = {
    roomId: string;
    status: 'waiting' | 'dealing' | 'playing' | 'round_end' | 'game_end';
    hostPlayerName: string | null;
    isDevRoom: boolean;
    mode: 'classic' | 'duel';
    duelCardCount?: 3 | 5;
    seatedPlayers: number;
    openSeats: number;
    players: LobbyRoomPlayer[];
};

type LobbySnapshot = {
    onlinePlayers: number;
    activeRooms: LobbyRoom[];
};

export const Lobby: React.FC = () => {
    const { socket, isConnected } = useSocket();
    const { user, isLoading } = useAuth();
    const navigate = useNavigate();
    const [playerName, setPlayerName] = useState('');
    const [selectedMode, setSelectedMode] = useState<'duel' | 'classic'>('duel');
    const [duelCardCount, setDuelCardCount] = useState<3 | 5>(3);
    const [roomIdToJoin, setRoomIdToJoin] = useState('');
    const [devSeed, setDevSeed] = useState('');
    const [devRoomMode, setDevRoomMode] = useState<'duel' | 'classic'>('duel');
    const [error, setError] = useState('');
    const [showActiveRooms, setShowActiveRooms] = useState(false);
    const [rulesOpen, setRulesOpen] = useState(false);
    const [lobbySnapshot, setLobbySnapshot] = useState<LobbySnapshot>({
        onlinePlayers: 0,
        activeRooms: []
    });
    const searchParams = new URLSearchParams(window.location.search);
    const isDevQueryEnabled = searchParams.get('dev') === '1';
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const devRoomsAvailable = isDevQueryEnabled && (import.meta.env.DEV || isLocalHost || import.meta.env.VITE_ENABLE_DEV_ROOMS === 'true');

    useEffect(() => {
        if (user) {
            setPlayerName(user.displayName);
        } else {
            setPlayerName('');
        }
    }, [user]);

    useEffect(() => {
        const rootElement = document.getElementById('root');

        // The game routes use a viewport-locked shell, but the lobby needs normal page scrolling.
        document.documentElement.classList.add('lobby-scroll-enabled');
        document.body.classList.add('lobby-scroll-enabled');
        rootElement?.classList.add('lobby-scroll-enabled');

        return () => {
            document.documentElement.classList.remove('lobby-scroll-enabled');
            document.body.classList.remove('lobby-scroll-enabled');
            rootElement?.classList.remove('lobby-scroll-enabled');
        };
    }, []);

    useEffect(() => {
        if (!socket) return;

        const handleLobbySnapshot = (snapshot: LobbySnapshot) => {
            setLobbySnapshot(snapshot);
        };

        socket.on('lobbySnapshot', handleLobbySnapshot);
        socket.emit('getLobbySnapshot');

        return () => {
            socket.off('lobbySnapshot', handleLobbySnapshot);
        };
    }, [socket]);

    const describeRoomStatus = (room: LobbyRoom) => {
        if (room.status === 'playing') return 'Playing now';
        if (room.status === 'dealing') return 'Dealing cards';
        if (room.status === 'round_end') return 'Between rounds';
        if (room.status === 'game_end') return 'Match finished';
        return room.seatedPlayers === 0 ? 'Reserved room' : 'Waiting for players';
    };

    const handleCreateRoom = (modeToCreate: 'duel' | 'classic' = selectedMode) => {
        if (!playerName.trim()) {
            setError('Please enter your name or sign in first');
            return;
        }
        if (socket) {
            socket.emit('createRoom', {
                playerName,
                mode: modeToCreate,
                duelCardCount: modeToCreate === 'duel' ? duelCardCount : undefined
            }, (roomId: string) => {
                navigate(`/room/${roomId}?name=${encodeURIComponent(playerName)}&create=1&mode=${modeToCreate}${modeToCreate === 'duel' ? `&cards=${duelCardCount}` : ''}`);
            });
        }
    };

    const handleJoinRoom = () => {
        if (!playerName.trim() || !roomIdToJoin.trim()) {
            setError('Please enter your name and a room code');
            return;
        }
        if (socket) {
            // Validation happens in the room component but we can navigate now
            navigate(`/room/${roomIdToJoin}?name=${encodeURIComponent(playerName)}`);
        }
    };

    const handleCreateDevRoom = () => {
        if (!playerName.trim()) {
            setError('Please enter your name first');
            return;
        }
        if (!socket) return;

        socket.emit('createRoom', {
            playerName,
            devMode: true,
            mode: devRoomMode,
            duelCardCount: devRoomMode === 'duel' ? duelCardCount : undefined,
            seed: devSeed.trim() || undefined
        }, (roomId: string) => {
            if (!roomId) {
                setError('Dev solo mode is disabled on this server.');
                return;
            }

            navigate(`/room/${roomId}?name=${encodeURIComponent(playerName)}&create=1&dev=1&mode=${devRoomMode}${devRoomMode === 'duel' ? `&cards=${duelCardCount}` : ''}`);
        });
    };

    return (
        <div className="lobby-container">
            <div className="lobby-content glass-panel">
                <div className="lobby-header">
                    <Spade className="logo-icon" size={48} />
                    <h1>Truco Online</h1>
                    <p className="subtitle">1v1 Duel & 2v2 Classic • Mão Baixa, Truco, and Manilhas</p>
                    <div className="lobby-stats" aria-live="polite">
                        <div className="lobby-stat-pill">
                            <Radio size={14} />
                            <span>{lobbySnapshot.onlinePlayers} online</span>
                        </div>
                        <div className="lobby-stat-pill">
                            <Users size={14} />
                            <span>{lobbySnapshot.activeRooms.length} active rooms</span>
                        </div>
                    </div>
                    {user && !isLoading && (
                        <div className="lobby-economy-row">
                            <EconomyWidget playerId={user.id} playerName={user.displayName} />
                        </div>
                    )}
                    <button
                        type="button"
                        className="btn btn-secondary rules-lobby-btn"
                        onClick={() => setRulesOpen(true)}
                        title="View Truco Rules"
                    >
                        <BookOpen size={16} /> View Game Rules (1v1 & 2v2)
                    </button>
                    {!isConnected && <p className="connecting">Connecting to server...</p>}
                </div>

                <div className="lobby-forms">
                    {error && <div className="error-message">{error}</div>}

                    {/* Guest or Account Sign-in */}
                    <AuthUI onGuestNameChange={setPlayerName} />

                    {/* Mode Selector */}
                    <div className="mode-selector">
                        <label className="mode-selector-label">Choose Game Mode</label>
                        <div className="mode-cards-grid">
                            <div
                                className={`mode-card ${selectedMode === 'duel' ? 'selected' : ''}`}
                                onClick={() => setSelectedMode('duel')}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMode('duel'); }}
                            >
                                <div className="mode-card-header">
                                    <span className="mode-card-title">
                                        <Swords size={18} /> 1v1 Duel
                                    </span>
                                    <span className="mode-card-badge">Invite 1 Friend</span>
                                </div>
                                <p className="mode-card-desc">
                                    Head-to-head match • {duelCardCount} cards per hand • Truco multiplies round (3, 6, 9 pts) • Capped at 11 for Mão de Onze • First to 12 pts wins!
                                </p>
                            </div>

                            <div
                                className={`mode-card ${selectedMode === 'classic' ? 'selected' : ''}`}
                                onClick={() => setSelectedMode('classic')}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedMode('classic'); }}
                            >
                                <div className="mode-card-header">
                                    <span className="mode-card-title">
                                        <Users size={18} /> 2v2 Classic
                                    </span>
                                    <span className="mode-card-badge badge-classic">Invite 3 Friends</span>
                                </div>
                                <p className="mode-card-desc">
                                    Traditional 4-player team Truco • 3 cards per hand • First team to reach 12 points wins!
                                </p>
                            </div>
                        </div>

                        {selectedMode === 'duel' && (
                            <div className="duel-variant-selector">
                                <span className="duel-variant-label">1v1 Hand Size:</span>
                                <div className="duel-variant-buttons">
                                    <button
                                        type="button"
                                        className={`duel-variant-btn ${duelCardCount === 3 ? 'active' : ''}`}
                                        onClick={() => setDuelCardCount(3)}
                                    >
                                        🃏 3 Cards (Fast • Best of 3 Tricks)
                                    </button>
                                    <button
                                        type="button"
                                        className={`duel-variant-btn ${duelCardCount === 5 ? 'active' : ''}`}
                                        onClick={() => setDuelCardCount(5)}
                                    >
                                        🖐️ 5 Cards (Classic • Best of 5 Tricks)
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="actions-divider">
                        <button
                            className="btn btn-primary"
                            onClick={() => handleCreateRoom(selectedMode)}
                            disabled={!isConnected}
                        >
                            {selectedMode === 'duel' ? (
                                <>
                                    <Swords size={20} /> Create 1v1 ({duelCardCount} Cards) Duel (Invite 1 friend)
                                </>
                            ) : (
                                <>
                                    <Users size={20} /> Create 2v2 Game (Invite 3 friends)
                                </>
                            )}
                        </button>
                    </div>

                    <div className="join-section">
                        <p className="or-divider"><span>OR JOIN WITH CODE</span></p>
                        <div className="input-group join-group">
                            <input
                                type="text"
                                placeholder="Room Code (e.g. AB12CD)"
                                value={roomIdToJoin}
                                onChange={(e) => setRoomIdToJoin(e.target.value.toUpperCase())}
                                maxLength={6}
                            />
                            <button
                                className="btn btn-secondary"
                                onClick={handleJoinRoom}
                                disabled={!isConnected}
                            >
                                <Play size={20} /> Join Game
                            </button>
                        </div>
                    </div>

                    <div className="rooms-panel">
                        <button
                            type="button"
                            className="btn btn-secondary rooms-toggle-btn"
                            onClick={() => setShowActiveRooms((currentValue) => !currentValue)}
                            disabled={!isConnected}
                            aria-expanded={showActiveRooms}
                        >
                            <Eye size={18} />
                            {showActiveRooms ? 'Hide Active Rooms' : 'View Active Rooms'}
                            {showActiveRooms ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </button>

                        {showActiveRooms && (
                            <div className="rooms-panel-body glass-panel">
                                {lobbySnapshot.activeRooms.length === 0 ? (
                                    <p className="rooms-empty-state">No rooms are active right now.</p>
                                ) : (
                                    <div className="rooms-list">
                                        {lobbySnapshot.activeRooms.map((room) => (
                                            <article key={room.roomId} className="room-summary-card">
                                                <div className="room-summary-header">
                                                    <div>
                                                        <div className="room-summary-title-row">
                                                            <h3>{room.roomId}</h3>
                                                            <span className={`room-mode-badge ${room.mode === 'duel' ? 'mode-duel' : 'mode-classic'}`}>
                                                                {room.mode === 'duel' ? `1v1 Duel (${room.duelCardCount ?? 3} cards)` : '2v2 Classic'}
                                                            </span>
                                                            {room.isDevRoom && <span className="room-dev-badge">DEV</span>}
                                                        </div>
                                                        <p className="room-summary-meta">{describeRoomStatus(room)}</p>
                                                    </div>
                                                    <div className="room-summary-count">
                                                        <span>{room.seatedPlayers}/{room.mode === 'duel' ? 2 : 4} seated</span>
                                                        {room.openSeats > 0 && <small>{room.openSeats} open</small>}
                                                    </div>
                                                </div>

                                                {room.hostPlayerName && (
                                                    <p className="room-host-line">Host: {room.hostPlayerName}</p>
                                                )}

                                                {room.players.length > 0 ? (
                                                    <div className="room-team-grid">
                                                        <div className="room-team-column">
                                                            <p className="room-team-label">Team 1</p>
                                                            {room.players.filter((player) => player.team === 1).map((player) => (
                                                                <span key={`${room.roomId}-${player.team}-${player.name}`} className="room-player-chip">
                                                                    {player.name}
                                                                    {player.isBot ? ' (bot)' : ''}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className="room-team-column">
                                                            <p className="room-team-label">Team 2</p>
                                                            {room.players.filter((player) => player.team === 2).map((player) => (
                                                                <span key={`${room.roomId}-${player.team}-${player.name}`} className="room-player-chip">
                                                                    {player.name}
                                                                    {player.isBot ? ' (bot)' : ''}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <p className="room-player-placeholder">No one has joined this room yet.</p>
                                                )}
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {devRoomsAvailable && (
                        <div className="dev-card">
                            <div className="dev-card-header">
                                <div>
                                    <p className="dev-card-kicker">Hidden Debug Flow</p>
                                    <h3><Bug size={16} /> Solo Dev Room</h3>
                                </div>
                                <span className="dev-card-badge">?dev=1</span>
                            </div>
                            <p className="dev-card-copy">
                                Launch a seeded solo room and auto-fill remaining seat(s) with server bots (1 bot for 1v1 Duel, 3 bots for 2v2 Classic).
                            </p>
                            <div className="dev-mode-select">
                                <button
                                    type="button"
                                    className={`dev-mode-btn ${devRoomMode === 'duel' ? 'active' : ''}`}
                                    onClick={() => setDevRoomMode('duel')}
                                >
                                    ⚔️ 1v1 Duel (1 Bot)
                                </button>
                                <button
                                    type="button"
                                    className={`dev-mode-btn ${devRoomMode === 'classic' ? 'active' : ''}`}
                                    onClick={() => setDevRoomMode('classic')}
                                >
                                    👥 2v2 Classic (3 Bots)
                                </button>
                            </div>
                            <div className="input-group">
                                <label>Optional Seed</label>
                                <input
                                    type="text"
                                    placeholder="e.g. bug-11-11"
                                    value={devSeed}
                                    onChange={(event) => setDevSeed(event.target.value)}
                                    maxLength={30}
                                />
                            </div>
                            <button
                                className="btn btn-secondary dev-room-btn"
                                onClick={handleCreateDevRoom}
                                disabled={!isConnected}
                            >
                                <Bug size={18} /> Create Solo Dev Room ({devRoomMode === 'duel' ? '1v1' : '2v2'})
                            </button>
                        </div>
                    )}

                    <ChangelogLauncher
                        className="btn changelog-update-btn changelog-trigger"
                        label="UPDATE! View changelog"
                    />
                </div>
            </div>

            {/* Rules Modal in Lobby */}
            {rulesOpen && (
                <RulesPanel
                    onClose={() => setRulesOpen(false)}
                    mode={selectedMode}
                />
            )}
        </div>
    );
};
