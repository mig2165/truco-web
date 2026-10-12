import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import './SocialPanels.css';

interface FriendInvite {
    roomId: string;
    inviterName: string;
}

export const FriendInviteListener: React.FC = () => {
    const { socket } = useSocket();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [invite, setInvite] = useState<FriendInvite | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!socket) return;
        const receiveInvite = (nextInvite: FriendInvite) => {
            setInvite(nextInvite);
            setError('');
        };
        const receiveError = (message: string) => {
            setError(message);
            window.setTimeout(() => setError(''), 5000);
        };
        socket.on('friendInvite', receiveInvite);
        socket.on('socialError', receiveError);
        return () => {
            socket.off('friendInvite', receiveInvite);
            socket.off('socialError', receiveError);
        };
    }, [socket]);

    return (
        <>
            {invite && (
                <div className="friend-invite-toast" role="status">
                    <div><strong>{invite.inviterName} invited you to Truco</strong><span>Room code: {invite.roomId}</span></div>
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            if (!user) return;
                            const name = user.displayName;
                            setInvite(null);
                            navigate(`/room/${invite.roomId}?name=${encodeURIComponent(name)}`);
                        }}
                    >Join</button>
                    <button className="social-icon-button" aria-label="Dismiss game invite" onClick={() => setInvite(null)}>×</button>
                </div>
            )}
            {error && <div className="friend-invite-error" role="alert">{error}</div>}
        </>
    );
};
