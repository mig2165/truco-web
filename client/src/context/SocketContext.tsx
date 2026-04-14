import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import { useAuth } from './AuthContext';

interface SocketContextContextType {
    socket: Socket | null;
    isConnected: boolean;
    /** Stable player ID persisted in localStorage across reconnects. */
    persistentPlayerId: string;
}

const SocketContext = createContext<SocketContextContextType>({
    socket: null,
    isConnected: false,
    persistentPlayerId: '',
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { playerId, isLoading } = useAuth();
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        if (isLoading) return; // Wait for initial auth response

        // In dev (Vite on :5000), connect to the separate backend on :3001
        // In production / ngrok (served from Express), connect to same origin
        const serverUrl = getApiBaseUrl();
        const newSocket = io(serverUrl, {
            withCredentials: true
        });

        newSocket.on('connect', () => {
            setIsConnected(true);
            console.log('Connected to game server');
        });

        newSocket.on('disconnect', () => {
            setIsConnected(false);
            console.log('Disconnected from game server');
        });

        setSocket(newSocket);

        return () => {
            newSocket.close();
        };
    }, [isLoading]);

    return (
        <SocketContext.Provider value={{ socket, isConnected, persistentPlayerId: playerId }}>
            {children}
        </SocketContext.Provider>
    );
};
