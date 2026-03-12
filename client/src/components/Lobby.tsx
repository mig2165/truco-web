import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useNavigate } from 'react-router-dom';
import { Play, Users, Spade } from 'lucide-react';
import './Lobby.css';

export const Lobby: React.FC = () => {
    const { socket, isConnected } = useSocket();
    const navigate = useNavigate();
    const [playerName, setPlayerName] = useState('');
    const [roomIdToJoin, setRoomIdToJoin] = useState('');
    const [error, setError] = useState('');

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
                </div>
            </div>
        </div>
    );
};
