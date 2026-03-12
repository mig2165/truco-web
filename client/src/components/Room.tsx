import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { Users, Info, MessageSquare, Copy, BookOpen } from 'lucide-react';
import './Room.css';
import { GameTable } from './GameTable';
import { ChatPanel } from './ChatPanel';
import { RulesPanel } from './RulesPanel';

export const Room: React.FC = () => {
    const { roomId } = useParams<{ roomId: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const { socket } = useSocket();

    const [gameState, setGameState] = useState<any>(null);
    const [error, setError] = useState('');
    const [teamPick, setTeamPick] = useState<null | 1 | 2>(null);
    const [copied, setCopied] = useState(false);
    const hasJoined = useRef(false);

    const [chatOpen, setChatOpen] = useState(false);
    const [rulesOpen, setRulesOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<any[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);

    const playerName = new URLSearchParams(location.search).get('name') || 'Player';
    const isCreating = new URLSearchParams(location.search).get('create') === '1';

    // Auto-pick Team 1 for the room creator; others see team selection
    useEffect(() => {
        if (isCreating) setTeamPick(1);
    }, [isCreating]);

    // Join the room only ONCE when team has been chosen
    useEffect(() => {
        if (!socket || !roomId || !teamPick) return;

        // Attach listeners every mount
        const onStateUpdate = (state: any) => setGameState(state);
        const onError = (msg: string) => setError(msg);
        const onChat = (msg: any) => {
            setChatMessages(prev => [...prev, msg]);
            // If chat panel is closed, increment unread
            setChatOpen(open => {
                if (!open) setUnreadCount(c => c + 1);
                return open;
            });
        };

        socket.on('gameStateUpdate', onStateUpdate);
        socket.on('error', onError);
        socket.on('chatMessage', onChat);

        // Only emit joinRoom once
        if (!hasJoined.current) {
            hasJoined.current = true;
            socket.emit('joinRoom', roomId, playerName, teamPick);
        }

        return () => {
            socket.off('gameStateUpdate', onStateUpdate);
            socket.off('error', onError);
            socket.off('chatMessage', onChat);
        };
    }, [socket, roomId, playerName, teamPick]);

    const handleStartGame = () => {
        if (socket && roomId) socket.emit('startGame', roomId);
    };

    const handleLeave = () => {
        navigate('/');
    };

    const copyCode = () => {
        if (roomId) {
            navigator.clipboard.writeText(roomId);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

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
                    <div className="team-options">
                        <button className="team-btn team-1-btn" onClick={() => setTeamPick(1)}>Team 1 🔵</button>
                        <button className="team-btn team-2-btn" onClick={() => setTeamPick(2)}>Team 2 🔴</button>
                    </div>
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

    const isHost = gameState.players[0]?.id === socket?.id;
    const isWaiting = gameState.status === 'waiting';

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
                        <h2>Waiting for players... ({gameState.players.length}/4)</h2>
                    ) : (
                        <h2>Truco</h2>
                    )}
                </div>
                <div className="header-right">
                    <div className="points-badge">
                        <span className="team1">Team 1: {gameState.points.team1}</span>
                        <span className="divider">|</span>
                        <span className="team2">Team 2: {gameState.points.team2}</span>
                    </div>
                    <button className="icon-btn" onClick={() => setRulesOpen(true)} title="Game Rules">
                        <BookOpen size={20} />
                    </button>
                    <button className="icon-btn" onClick={() => { setChatOpen(!chatOpen); setUnreadCount(0); }} title="Chat" style={{ position: 'relative' }}>
                        <MessageSquare size={20} />
                        {unreadCount > 0 && <span className="chat-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                    </button>
                </div>
            </header>

            {/* Main Game Area */}
            <main className="game-area">
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
                            <p>Share this code with your friends:</p>
                            <div className="invite-code" onClick={copyCode}>
                                {roomId} {copied ? '✓' : <Copy size={14} />}
                            </div>
                        </div>

                        {isHost && gameState.players.length === 4 && (
                            <button className="btn btn-primary start-btn" onClick={handleStartGame}>
                                Start Match
                            </button>
                        )}
                        {isHost && gameState.players.length < 4 && (
                            <p className="hint">Need {4 - gameState.players.length} more player(s)...</p>
                        )}
                        {!isHost && (
                            <p className="hint">Waiting for host to start the game...</p>
                        )}
                    </div>
                ) : (
                    <GameTable gameState={gameState} socket={socket} currentPlayerId={socket?.id} playerName={playerName} onLeave={handleLeave} />
                )}
            </main>

            {/* Chat Panel */}
            {chatOpen && (
                <>
                    <div className="chat-overlay" onClick={() => setChatOpen(false)} />
                    <ChatPanel
                        socket={socket}
                        roomId={roomId || ''}
                        playerName={playerName}
                        playerTeam={gameState.players.find((p: any) => p.id === socket?.id)?.team || 0}
                        messages={chatMessages}
                        onClose={() => setChatOpen(false)}
                    />
                </>
            )}

            {/* Rules Panel */}
            {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
        </div>
    );
};
