import React, { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import { ModalDialog } from './ModalDialog';
import './ShopModal.css';

interface LeaderboardRow {
    id: string;
    displayName: string;
    bucksBalance: number;
    gamesPlayed: number;
    gamesWon: number;
    duelWins: number;
    classicWins: number;
    currentStreak: number;
    bestStreak: number;
    zapsPlayed: number;
    snipesLanded: number;
    bluffsCaught: number;
    titleLabel: string;
}

interface LeaderboardModalProps {
    open: boolean;
    onClose: () => void;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({ open, onClose }) => {
    const [rows, setRows] = useState<LeaderboardRow[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        fetch(`${getApiBaseUrl()}/api/leaderboard`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : []))
            .then((data: LeaderboardRow[]) => setRows(Array.isArray(data) ? data : []))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
    }, [open]);

    return (
        <ModalDialog
            open={open}
            onClose={onClose}
            title={<><Trophy size={20} /> Leaderboard &amp; Hall of Fame</>}
        >
            {loading ? (
                <div style={{ color: '#94a3b8', padding: '1rem', textAlign: 'center' }}>Loading rankings…</div>
            ) : rows.length === 0 ? (
                <div style={{ color: '#94a3b8', padding: '1rem', textAlign: 'center' }}>
                    No ranked matches recorded yet. Sign in and win a match to claim #1!
                </div>
            ) : (
                <div className="leaderboard-table-wrap">
                    <table className="leaderboard-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Player</th>
                                <th>Wins (1v1 / 2v2)</th>
                                <th>Streak</th>
                                <th>⚡ ZAPs</th>
                                <th>🎯 Snipes</th>
                                <th>🤨 Bluffs</th>
                                <th>🪙 Bucks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, idx) => (
                                <tr key={row.id}>
                                    <td className="leaderboard-rank">
                                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                                    </td>
                                    <td>
                                        <strong>{row.displayName}</strong>
                                        <span className="leaderboard-title-pill">{row.titleLabel}</span>
                                    </td>
                                    <td>
                                        <strong>{row.gamesWon}</strong>/{row.gamesPlayed}{' '}
                                        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                            ({row.duelWins}D · {row.classicWins}C)
                                        </span>
                                    </td>
                                    <td className="leaderboard-streak">
                                        {row.currentStreak > 0 ? `🔥 ${row.currentStreak}` : '—'}
                                        {row.bestStreak > 0 && (
                                            <span style={{ color: '#64748b', fontSize: '0.72rem', fontWeight: 400 }}> (best {row.bestStreak})</span>
                                        )}
                                    </td>
                                    <td>{row.zapsPlayed}</td>
                                    <td>{row.snipesLanded}</td>
                                    <td>{row.bluffsCaught}</td>
                                    <td style={{ color: '#fde68a', fontWeight: 700 }}>{row.bucksBalance.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </ModalDialog>
    );
};
