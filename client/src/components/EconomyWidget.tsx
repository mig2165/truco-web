import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import './EconomyWidget.css';

interface PlayerProfile {
    id: string;
    displayName: string;
    bucksBalance: number;
    gamesPlayed: number;
    gamesWon: number;
    totalEarned: number;
}

interface BucksTransaction {
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: number;
}

interface EconomyWidgetProps {
    playerId: string;
    playerName: string;
}

export const EconomyWidget: React.FC<EconomyWidgetProps> = ({ playerId, playerName }) => {
    const [profile, setProfile] = useState<PlayerProfile | null>(null);
    const [transactions, setTransactions] = useState<BucksTransaction[]>([]);
    const [showLedger, setShowLedger] = useState(false);
    const [loading, setLoading] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchProfile = useCallback(async () => {
        if (!playerId) return;
        try {
            const base = getApiBaseUrl();
            const res = await fetch(`${base}/api/economy/profile/${playerId}`);
            if (res.ok) {
                const data = await res.json() as PlayerProfile;
                setProfile(data);
            }
        } catch {
            // silently ignore network errors
        }
    }, [playerId]);

    const fetchTransactions = useCallback(async () => {
        if (!playerId) return;
        setLoading(true);
        try {
            const base = getApiBaseUrl();
            const res = await fetch(`${base}/api/economy/profile/${playerId}/transactions`);
            if (res.ok) {
                const data = await res.json() as BucksTransaction[];
                setTransactions(data.slice().reverse()); // newest first
            }
        } catch {
            // silently ignore
        } finally {
            setLoading(false);
        }
    }, [playerId]);

    // Bootstrap profile on mount and poll for balance updates.
    useEffect(() => {
        if (!playerId || !playerName) return;

        // Create profile if it doesn't exist yet.
        const base = getApiBaseUrl();
        void fetch(`${base}/api/economy/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId, displayName: playerName }),
        }).then(() => fetchProfile());

        pollRef.current = setInterval(() => { void fetchProfile(); }, 30_000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [playerId, playerName, fetchProfile]);

    const handleToggleLedger = () => {
        if (!showLedger) {
            void fetchTransactions();
        }
        setShowLedger(prev => !prev);
    };

    const formatDate = (ms: number) =>
        new Date(ms).toLocaleString(undefined, {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });

    const txTypeLabel = (type: string) => {
        switch (type) {
            case 'starter_grant': return '🎁 Starter';
            case 'match_win':     return '🏆 Win';
            case 'match_loss':    return '🎮 Match';
            case 'admin_adjustment': return '⚙️ Admin';
            default:              return type;
        }
    };

    if (!profile) return null;

    return (
        <div className="economy-widget">
            <button
                className="economy-widget__balance"
                onClick={handleToggleLedger}
                title="Click to view transaction history"
            >
                <span className="economy-widget__coin">🪙</span>
                <span className="economy-widget__amount">{profile.bucksBalance.toLocaleString()}</span>
                <span className="economy-widget__label">Bucks</span>
                <span className="economy-widget__chevron">{showLedger ? '▲' : '▼'}</span>
            </button>

            {showLedger && (
                <div className="economy-widget__ledger">
                    <div className="economy-widget__ledger-header">
                        <div className="economy-widget__stats">
                            <span>{profile.gamesPlayed} played</span>
                            <span>·</span>
                            <span>{profile.gamesWon} won</span>
                        </div>
                        <button className="economy-widget__close" onClick={() => setShowLedger(false)}>✕</button>
                    </div>
                    {loading ? (
                        <div className="economy-widget__loading">Loading…</div>
                    ) : transactions.length === 0 ? (
                        <div className="economy-widget__empty">No transactions yet.</div>
                    ) : (
                        <ul className="economy-widget__tx-list">
                            {transactions.map(tx => (
                                <li key={tx.id} className={`economy-widget__tx economy-widget__tx--${tx.amount >= 0 ? 'credit' : 'debit'}`}>
                                    <span className="economy-widget__tx-type">{txTypeLabel(tx.type)}</span>
                                    <span className="economy-widget__tx-desc">{tx.description}</span>
                                    <span className="economy-widget__tx-amount">
                                        {tx.amount >= 0 ? '+' : ''}{tx.amount}
                                    </span>
                                    <span className="economy-widget__tx-balance">{tx.balanceAfter.toLocaleString()} 🪙</span>
                                    <span className="economy-widget__tx-date">{formatDate(tx.createdAt)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};
