import React, { createContext, useContext, useEffect, useState } from 'react';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import { getOrCreatePersistentPlayerId } from '../lib/playerIdentity';

export interface User {
    id: string;
    username: string;
    displayName: string;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    login: (user: User) => void;
    logout: () => void;
    /** Returns the authenticated user's ID, or a fallback guest ID if not logged in. */
    playerId: string;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    isLoading: true,
    login: () => {},
    logout: () => {},
    playerId: '',
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    // Cache the guest ID once so it doesn't rotate unexpectedly during a sesson
    const [guestId] = useState(() => getOrCreatePersistentPlayerId());

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const res = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
                    credentials: 'include',
                });
                if (res.ok) {
                    const data = await res.json();
                    setUser(data);
                }
            } catch (err) {
                // Not authenticated or network error
            } finally {
                setIsLoading(false);
            }
        };

        void checkAuth();
    }, []);

    const login = (newUser: User) => {
        setUser(newUser);
    };

    const logout = async () => {
        try {
            await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch (err) {
            // Ignore network errors
        }
        setUser(null);
    };

    const playerId = user ? user.id : guestId;

    return (
        <AuthContext.Provider value={{ user, isLoading, login, logout, playerId }}>
            {children}
        </AuthContext.Provider>
    );
};
