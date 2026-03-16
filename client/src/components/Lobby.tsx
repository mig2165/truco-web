import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useNavigate } from 'react-router-dom';
import { Play, Users, Spade, Bug } from 'lucide-react';
import { ChangelogLauncher } from './ChangelogLauncher';
import './Lobby.css';

export const Lobby: React.FC = () => {
    const { socket, isConnected } = useSocket();
    const navigate = useNavigate();
    const [playerName, setPlayerName] = useState('');
    const [roomIdToJoin, setRoomIdToJoin] = useState('');
    const [devSeed, setDevSeed] = useState('');
    const [error, setError] = useState('');
    const searchParams = new URLSearchParams(window.location.search);
    const isDevQueryEnabled = searchParams.get('dev') === '1';
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const devRoomsAvailable = isDevQueryEnabled && (import.meta.env.DEV || isLocalHost || import.meta.env.VITE_ENABLE_DEV_ROOMS === 'true');

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
                    {!isConnected && <p className="connecting">Connecting to server...</p>}
                </div>

                <div className="lobby-forms">
                    {error && <div className="error-message">{error}</div>}

                    <div className="input-group">
                        <label>Your Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Joao"
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            maxLength={15}
                        />
                    </div>

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
