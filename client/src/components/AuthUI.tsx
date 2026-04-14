import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import './AuthUI.css';

export const AuthUI: React.FC<{ onGuestNameChange: (name: string) => void }> = ({ onGuestNameChange }) => {
    const { user, login, logout } = useAuth();
    const [mode, setMode] = useState<'guest' | 'login' | 'register'>('guest');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [guestName, setGuestName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    if (user) {
        return (
            <div className="auth-ui-logged-in glass-panel">
                <div className="auth-ui-user-info">
                    <span className="auth-ui-greeting">Signed in as <strong>{user.displayName}</strong></span>
                    <button className="btn btn-secondary auth-ui-logout" onClick={() => void logout()}>Log Out</button>
                </div>
            </div>
        );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
        const body = mode === 'login' 
            ? { username, password } 
            : { username, password, displayName };

        try {
            const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Failed to authenticate');
                return;
            }

            login(data);
        } catch (err) {
            setError('Network error connecting to auth server.');
        } finally {
            setLoading(false);
        }
    };

    const handleGuestChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setGuestName(e.target.value);
        onGuestNameChange(e.target.value);
    };

    return (
        <div className="auth-ui glass-panel">
            <div className="auth-ui-tabs">
                <button type="button" className={`auth-ui-tab ${mode === 'guest' ? 'active' : ''}`} onClick={() => setMode('guest')}>Guest</button>
                <button type="button" className={`auth-ui-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>Sign In</button>
                <button type="button" className={`auth-ui-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>Sign Up</button>
            </div>

            <div className="auth-ui-body">
                {error && <p className="auth-ui-error">{error}</p>}
                
                {mode === 'guest' ? (
                    <div className="auth-ui-guest">
                        <label>Play as Guest</label>
                        <input
                            type="text"
                            placeholder="e.g. Joao"
                            value={guestName}
                            onChange={handleGuestChange}
                            maxLength={15}
                        />
                        <p className="auth-ui-disclaimer">Guest mode: Bucks disabled.</p>
                    </div>
                ) : (
                    <form onSubmit={(e) => void handleSubmit(e)} className="auth-ui-form">
                        <label>Username</label>
                        <input
                            type="text"
                            placeholder="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                        {mode === 'register' && (
                            <>
                                <label>Display Name</label>
                                <input
                                    type="text"
                                    placeholder="Your Name"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    required
                                    maxLength={15}
                                />
                            </>
                        )}
                        <label>Password</label>
                        <input
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Create Account'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};
