import React, { useCallback, useEffect, useState } from 'react';
import { ChartNoAxesColumn, History } from 'lucide-react';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import type { User } from '../context/AuthContext';

interface MatchHistory {
    stats: { gamesPlayed: number; gamesWon: number; winRate: number };
    matches: Array<{
        id: string;
        roomId: string;
        teammates: string[];
        opponents: string[];
        winnerTeam: number;
        playerTeam: number;
        score: { team1: number; team2: number };
        completedAt: number;
    }>;
}

export const MatchHistoryPanel: React.FC<{ user: User }> = ({ user }) => {
    const [history, setHistory] = useState<MatchHistory | null>(null);
    const [error, setError] = useState('');

    const loadHistory = useCallback(async () => {
        try {
            const response = await fetch(`${getApiBaseUrl()}/api/matches`, { credentials: 'include' });
            if (!response.ok) throw new Error('Could not load match history.');
            setHistory(await response.json() as MatchHistory);
            setError('');
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Could not load match history.');
        }
    }, []);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory, user.id]);

    return (
        <section className="social-panel glass-panel" aria-labelledby="match-history-title">
            <div className="social-panel__header">
                <div>
                    <h2 id="match-history-title"><History size={20} /> Match history</h2>
                    <p>Your completed account matches and record.</p>
                </div>
                <ChartNoAxesColumn size={20} aria-hidden="true" />
            </div>
            {error ? <p className="social-message is-error" role="alert">{error}</p> : !history ? (
                <p className="social-muted">Loading match history…</p>
            ) : (
                <>
                    <div className="match-stats">
                        <div><strong>{history.stats.gamesPlayed}</strong><span>Played</span></div>
                        <div><strong>{history.stats.gamesWon}</strong><span>Won</span></div>
                        <div><strong>{history.stats.winRate}%</strong><span>Win rate</span></div>
                    </div>
                    {history.matches.length === 0 ? (
                        <p className="social-muted">No completed matches yet. Your account games will appear here.</p>
                    ) : (
                        <ol className="match-history-list">
                            {history.matches.map(match => {
                                const won = match.playerTeam === match.winnerTeam;
                                return (
                                    <li key={match.id} className="match-history-row">
                                        <span className={`match-result ${won ? 'is-win' : 'is-loss'}`}>{won ? 'Win' : 'Loss'}</span>
                                        <span className="match-history-details">
                                            <strong>Room {match.roomId} · {match.score.team1}–{match.score.team2}</strong>
                                            <small>
                                                Team {match.playerTeam}
                                                {match.teammates.length > 0 ? ` with ${match.teammates.join(', ')}` : ''}
                                                {match.opponents.length > 0 ? ` vs ${match.opponents.join(', ')}` : ''}
                                            </small>
                                        </span>
                                        <time dateTime={new Date(match.completedAt).toISOString()}>
                                            {new Date(match.completedAt).toLocaleDateString()}
                                        </time>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </>
            )}
        </section>
    );
};
