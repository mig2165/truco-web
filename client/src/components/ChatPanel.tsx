import React, { useState, useRef, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { X, Send } from 'lucide-react';
import './ChatPanel.css';

interface ChatMessage {
    sender: string;
    message: string;
    timestamp: number;
    team?: number;
}

interface ChatPanelProps {
    socket: Socket | null;
    roomId: string;
    playerName: string;
    playerTeam: number;
    messages: ChatMessage[];
    onClose: () => void;
    docked?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    socket,
    roomId,
    playerName,
    playerTeam,
    messages,
    onClose,
    docked = false
}) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = () => {
        const trimmed = input.trim();
        if (!trimmed || !socket) return;
        socket.emit('chatMessage', roomId, { sender: playerName, message: trimmed, team: playerTeam });
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className={`chat-panel glass-panel ${docked ? 'docked' : ''}`}>
            <div className="chat-header">
                <span className="chat-title">💬 Chat</span>
                {!docked && <button className="chat-close" onClick={onClose}><X size={18} /></button>}
            </div>
            <div className="chat-messages">
                {messages.length === 0 && (
                    <div className="chat-empty">No messages yet. Say something!</div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`chat-msg team-msg-${msg.team || 0}`}>
                        <span className={`chat-sender team-${msg.team || 0}`}>{msg.sender}</span>
                        <span className="chat-text">{msg.message}</span>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-area">
                <input
                    className="chat-input"
                    type="text"
                    placeholder="Type a message..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={200}
                    autoFocus={!docked}
                />
                <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim()}>
                    <Send size={16} />
                </button>
            </div>
        </div>
    );
};
