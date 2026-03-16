import React, { useEffect, useState } from 'react';
import { Pause, Play, SkipForward, Bug, Gauge } from 'lucide-react';
import { Socket } from 'socket.io-client';
import './DevPanel.css';

type DebugCommand =
    | { type: 'pauseBots' }
    | { type: 'resumeBots' }
    | { type: 'stepBots' }
    | { type: 'setBotSpeed'; speedMs: number }
    | { type: 'setScore'; score: { team1: number; team2: number } };

interface DevPanelProps {
    gameState: any;
    roomId: string;
    socket: Socket | null;
}

const SPEED_OPTIONS = [150, 600, 1200];
const SCORE_PRESETS = [
    { label: '0-0', score: { team1: 0, team2: 0 } },
    { label: '10-10', score: { team1: 10, team2: 10 } },
    { label: '11-10', score: { team1: 11, team2: 10 } },
    { label: '11-11', score: { team1: 11, team2: 11 } }
];

export const DevPanel: React.FC<DevPanelProps> = ({ gameState, roomId, socket }) => {
    const [customScore, setCustomScore] = useState({
        team1: String(gameState.points.team1),
        team2: String(gameState.points.team2)
    });

    useEffect(() => {
        setCustomScore({
            team1: String(gameState.points.team1),
            team2: String(gameState.points.team2)
        });
    }, [gameState.points.team1, gameState.points.team2]);

    const sendCommand = (command: DebugCommand) => {
        if (!socket) return;
        socket.emit('debugCommand', roomId, command);
    };

    const applyCustomScore = () => {
        const team1 = Number.parseInt(customScore.team1, 10);
        const team2 = Number.parseInt(customScore.team2, 10);

        if (Number.isNaN(team1) || Number.isNaN(team2)) {
            return;
        }

        // Keep manual score forcing predictable even if the user types odd input.
        sendCommand({
            type: 'setScore',
            score: {
                // Endgame setup starts at 11, so manual score forcing should stay within that range.
                team1: Math.max(0, Math.min(11, team1)),
                team2: Math.max(0, Math.min(11, team2))
            }
        });
    };

    const currentTurnPlayer = gameState.players[gameState.currentTurnIndex];
    const devState = gameState.dev;

    return (
        <aside className="dev-panel glass-panel">
            <div className="dev-panel-header">
                <div>
                    <p className="dev-kicker">Secret Dev Room</p>
                    <h3><Bug size={16} /> Solo Test Mode</h3>
                </div>
                <span className={`dev-status ${devState.botsPaused ? 'paused' : 'running'}`}>
                    {devState.botsPaused ? 'Paused' : 'Running'}
                </span>
            </div>

            <div className="dev-meta">
                <div>
                    <span>Seed</span>
                    <strong>{devState.seed}</strong>
                </div>
                <div>
                    <span>Phase</span>
                    <strong>{gameState._phase || gameState.status}</strong>
                </div>
                <div>
                    <span>Turn</span>
                    <strong>{currentTurnPlayer ? currentTurnPlayer.name : 'Waiting'}</strong>
                </div>
            </div>

            <div className="dev-actions">
                <button
                    className="btn btn-secondary"
                    onClick={() => sendCommand({ type: devState.botsPaused ? 'resumeBots' : 'pauseBots' })}
                >
                    {devState.botsPaused ? <Play size={16} /> : <Pause size={16} />}
                    {devState.botsPaused ? 'Resume Bots' : 'Pause Bots'}
                </button>
                <button className="btn btn-secondary" onClick={() => sendCommand({ type: 'stepBots' })}>
                    <SkipForward size={16} />
                    Step One Bot Action
                </button>
            </div>

            <section className="dev-section">
                <div className="dev-section-title">
                    <Gauge size={14} />
                    Bot Speed
                </div>
                <div className="dev-chip-row">
                    {SPEED_OPTIONS.map((speedMs) => (
                        <button
                            key={speedMs}
                            className={`dev-chip ${devState.botSpeedMs === speedMs ? 'active' : ''}`}
                            onClick={() => sendCommand({ type: 'setBotSpeed', speedMs })}
                        >
                            {speedMs}ms
                        </button>
                    ))}
                </div>
            </section>

            <section className="dev-section">
                <div className="dev-section-title">Score Presets</div>
                <div className="dev-chip-row">
                    {SCORE_PRESETS.map((preset) => (
                        <button
                            key={preset.label}
                            className="dev-chip"
                            onClick={() => sendCommand({ type: 'setScore', score: preset.score })}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
                <div className="dev-custom-score">
                    <input
                        type="number"
                        min={0}
                        max={11}
                        value={customScore.team1}
                        onChange={(event) => setCustomScore((current) => ({ ...current, team1: event.target.value }))}
                    />
                    <span>-</span>
                    <input
                        type="number"
                        min={0}
                        max={11}
                        value={customScore.team2}
                        onChange={(event) => setCustomScore((current) => ({ ...current, team2: event.target.value }))}
                    />
                    <button className="btn btn-primary" onClick={applyCustomScore}>
                        Reset Round
                    </button>
                </div>
            </section>

            <section className="dev-section">
                <div className="dev-section-title">Debug Log</div>
                <div className="dev-log">
                    {devState.log.length === 0 ? (
                        <p className="dev-log-empty">No events yet.</p>
                    ) : (
                        devState.log.map((entry: string) => (
                            <div key={entry} className="dev-log-entry">{entry}</div>
                        ))
                    )}
                </div>
            </section>
        </aside>
    );
};
