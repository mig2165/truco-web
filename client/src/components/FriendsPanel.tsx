import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Users, X } from 'lucide-react';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import type { User } from '../context/AuthContext';
import type { Socket } from 'socket.io-client';
import './SocialPanels.css';

interface Friend {
    id: string;
    username: string;
    displayName: string;
    online: boolean;
}

interface FriendRequest {
    id: string;
    username: string;
    displayName: string;
    createdAt: number;
}

interface SearchResult {
    id: string;
    username: string;
    displayName: string;
}

interface FriendsPanelProps {
    user: User;
    socket: Socket | null;
}

export const FriendsPanel: React.FC<FriendsPanelProps> = ({ user, socket }) => {
    const navigate = useNavigate();
    const [friends, setFriends] = useState<Friend[]>([]);
    const [requests, setRequests] = useState<FriendRequest[]>([]);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(true);

    const loadSocialData = useCallback(async () => {
        setLoading(true);
        try {
            const [friendsResponse, requestsResponse] = await Promise.all([
                fetch(`${getApiBaseUrl()}/api/social/friends`, { credentials: 'include' }),
                fetch(`${getApiBaseUrl()}/api/social/requests`, { credentials: 'include' }),
            ]);
            if (!friendsResponse.ok || !requestsResponse.ok) {
                throw new Error('Could not load your friends right now.');
            }
            setFriends(await friendsResponse.json() as Friend[]);
            setRequests(await requestsResponse.json() as FriendRequest[]);
            setError('');
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Could not load your friends.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSocialData();
    }, [loadSocialData]);

    useEffect(() => {
        if (!socket) return;
        const updatePresence = ({ accountId, online }: { accountId: string; online: boolean }) => {
            setFriends(current => current.map(friend => friend.id === accountId ? { ...friend, online } : friend));
        };
        socket.on('friendPresence', updatePresence);
        socket.on('friendRequestUpdated', loadSocialData);
        return () => {
            socket.off('friendPresence', updatePresence);
            socket.off('friendRequestUpdated', loadSocialData);
        };
    }, [socket, loadSocialData]);

    const search = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setNotice('');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/social/search?q=${encodeURIComponent(query)}`, {
                credentials: 'include',
            });
            const data = await response.json() as SearchResult[] | { error?: string };
            if (!response.ok) throw new Error('error' in data ? data.error : 'Search failed.');
            setResults(data as SearchResult[]);
            if ((data as SearchResult[]).length === 0) setNotice('No new accounts found for that username.');
        } catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : 'Search failed.');
        }
    };

    const sendRequest = async (username: string) => {
        setError('');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/social/requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username }),
            });
            const data = await response.json() as { error?: string; status?: 'accepted' | 'pending' };
            if (!response.ok) throw new Error(data.error || 'Could not send friend request.');
            setResults(current => current.filter(result => result.username !== username));
            setNotice(data.status === 'accepted' ? `You and ${username} are now friends.` : `Friend request sent to ${username}.`);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Could not send friend request.');
        }
    };

    const respondToRequest = async (requestId: string, accept: boolean) => {
        setError('');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/social/requests/${encodeURIComponent(requestId)}${accept ? '/accept' : ''}`, {
                method: accept ? 'POST' : 'DELETE',
                credentials: 'include',
            });
            const data = await response.json() as { error?: string };
            if (!response.ok) throw new Error(data.error || 'Could not update friend request.');
            await loadSocialData();
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Could not update friend request.');
        }
    };

    const removeFriend = async (friend: Friend) => {
        setError('');
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/social/friends/${encodeURIComponent(friend.id)}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!response.ok) throw new Error('Could not remove this friend.');
            await loadSocialData();
        } catch (removeError) {
            setError(removeError instanceof Error ? removeError.message : 'Could not remove this friend.');
        }
    };

    const inviteToRoom = (friend: Friend) => {
        if (!socket || !friend.online) return;
        socket.emit('createRoom', user.displayName, (roomId: string) => {
            if (!roomId) {
                setError('Could not create a room for your invite.');
                return;
            }
            socket.emit('inviteFriend', { friendId: friend.id, roomId });
            navigate(`/room/${roomId}?name=${encodeURIComponent(user.displayName)}&create=1`);
        });
    };

    return (
        <section className="social-panel glass-panel" aria-labelledby="friends-title">
            <div className="social-panel__header">
                <div>
                    <h2 id="friends-title"><Users size={20} /> Friends</h2>
                    <p>Find friends by their account username and invite them to a game.</p>
                </div>
                <span className="social-panel__count">{friends.filter(friend => friend.online).length} online</span>
            </div>

            <form className="social-search" onSubmit={event => void search(event)}>
                <label className="sr-only" htmlFor="friend-search">Search usernames</label>
                <input
                    id="friend-search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search username (2+ characters)"
                    minLength={2}
                />
                <button className="btn btn-secondary" type="submit" disabled={query.trim().length < 2}>Search</button>
            </form>
            {results.length > 0 && (
                <ul className="social-list">
                    {results.map(result => (
                        <li key={result.id} className="social-list__row">
                            <span><strong>{result.displayName}</strong><small>@{result.username}</small></span>
                            <button className="btn btn-secondary social-action" onClick={() => void sendRequest(result.username)}>
                                <UserPlus size={16} /> Add
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {requests.length > 0 && (
                <div className="social-subsection">
                    <h3>Friend requests <span>{requests.length}</span></h3>
                    <ul className="social-list">
                        {requests.map(request => (
                            <li key={request.id} className="social-list__row">
                                <span><strong>{request.displayName}</strong><small>@{request.username}</small></span>
                                <div className="social-row-actions">
                                    <button className="btn btn-primary social-action" onClick={() => void respondToRequest(request.id, true)}>Accept</button>
                                    <button className="social-icon-button" aria-label={`Decline request from ${request.username}`} onClick={() => void respondToRequest(request.id, false)}><X size={17} /></button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="social-subsection">
                <h3>Your friends</h3>
                {loading ? <p className="social-muted">Loading friends…</p> : friends.length === 0 ? (
                    <p className="social-muted">No friends yet. Search for someone by username to get started.</p>
                ) : (
                    <ul className="social-list">
                        {friends.map(friend => (
                            <li key={friend.id} className="social-list__row">
                                <span className="social-friend-name">
                                    <span className={`social-presence ${friend.online ? 'is-online' : ''}`} />
                                    <span><strong>{friend.displayName}</strong><small>@{friend.username} · {friend.online ? 'Online' : 'Offline'}</small></span>
                                </span>
                                <div className="social-row-actions">
                                    <button className="btn btn-primary social-action" disabled={!friend.online || !socket} onClick={() => inviteToRoom(friend)}>Invite</button>
                                    <button className="social-icon-button" aria-label={`Remove ${friend.username} from friends`} onClick={() => void removeFriend(friend)}><X size={17} /></button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {error && <p className="social-message is-error" role="alert">{error}</p>}
            {notice && <p className="social-message" role="status">{notice}</p>}
        </section>
    );
};
