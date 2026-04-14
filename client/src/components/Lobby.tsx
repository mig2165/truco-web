import React, { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Play, Users, Spade, Bug, Eye, Radio, ChevronDown, ChevronUp } from 'lucide-react';
import { ChangelogLauncher } from './ChangelogLauncher';
import { EconomyWidget } from './EconomyWidget';
import { AuthUI } from './AuthUI';
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
    const [roomIdToJoin, setRoomIdToJoin] = useState('');
    const [devSeed, setDevSeed] = useState('');
    const [error, setError] = useState('');
    const [showActiveRooms, setShowActiveRooms] = useState(false);
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

    const handleCreateRoom = () => {
        if (!playerName.trim()) {
            setError('Please enter your name first');
            return;
        }
        if (socket) {
            socket.emit('createRoom', playerName, (roomId: string) => {
                navigate(`/room/${roomId}?name=${encodeURIComponent(playerName)}&create=1`);
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
            seed: devSeed.trim() || undefined
        }, (roomId: string) => {
            if (!roomId) {
                setError('Dev solo mode is disabled on this server.');
                return;
            }

            navigate(`/room/${roomId}?name=${encodeURIComponent(playerName)}&create=1&dev=1`);
        });
    };

    return (
        <div className="lobby-container">
            <div className="lobby-content glass-panel">
                <div className="lobby-header">
                    <Spade className="logo-icon" size={48} />
                    <h1>Truco Online</h1>
                    <p className="subtitle">Mão Baixa, Truco, and Manilhas</p>
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
                    {!isConnected && <p className="connecting">Connecting to server...</p>}
                </div>

                <div className="lobby-forms">
                    {error && <div className="error-message">{error}</div>}

                    <AuthUI onGuestNameChange={setPlayerName} />

                    <div className="actions-divider">
                        <button
                            className="btn btn-primary"
                            onClick={handleCreateRoom}
                            disabled={!isConnected}
                        >
                            <Play size={20} /> Create New Game
                        </button>
                    </div>

                    <div className="join-section">
                        <p className="or-divider"><span>OR</span></p>
                        <div className="input-group join-group">
                            <input
                                type="text"
                                placeholder="Room Code"
                                value={roomIdToJoin}
                                onChange={(e) => setRoomIdToJoin(e.target.value.toUpperCase())}
                                maxLength={6}
                            />
                            <button
                                className="btn btn-secondary"
                                onClick={handleJoinRoom}
                                disabled={!isConnected}
                            >
                                <Users size={20} /> Join Game
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
                                                            {room.isDevRoom && <span className="room-dev-badge">DEV</span>}
                                                        </div>
                                                        <p className="room-summary-meta">{describeRoomStatus(room)}</p>
                                                    </div>
                                                    <div className="room-summary-count">
                                                        <span>{room.seatedPlayers}/4 seated</span>
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
                                Launch a seeded solo room and auto-fill the other three seats with server bots.
                            </p>
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
                                <Bug size={18} /> Create Solo Dev Room
                            </button>
                        </div>
                    )}

                    <ChangelogLauncher
                        className="btn changelog-update-btn changelog-trigger"
                        label="UPDATE! View changelog"
                    />
                </div>
            </div>
        </div>
    );
};
