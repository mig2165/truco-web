import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getOrCreatePersistentPlayerId } from '../lib/playerIdentity';

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
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    // Resolved once on mount so it is stable for the lifetime of the provider.
    const [persistentPlayerId] = useState<string>(() => getOrCreatePersistentPlayerId());

    useEffect(() => {
        // In dev (Vite on :5000), connect to the separate backend on :3001
        // In production / ngrok (served from Express), connect to same origin
        const serverUrl = import.meta.env.VITE_API_URL
            || (window.location.port === '5000' ? 'http://localhost:3001' : window.location.origin);
        const newSocket = io(serverUrl);

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
    }, []);

    return (
        <SocketContext.Provider value={{ socket, isConnected, persistentPlayerId }}>
            {children}
        </SocketContext.Provider>
    );
};
