import React, { useState } from 'react';
import { Socket } from 'socket.io-client';
import { X } from 'lucide-react';
import './ReportModal.css';

interface ReportModalProps {
    socket: Socket | null;
    roomId: string;
    playerName: string;
    gameState: any;
    onClose: () => void;
}

const CATEGORIES = [
    'Gameplay bug',
    'UI bug',
    'Scoring bug',
    'Hand call / bluff bug',
    'Other',
];

export default function ReportModal({ socket, roomId, playerName, gameState, onClose }: ReportModalProps) {
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState(CATEGORIES[0]);
    const [screenshotData, setScreenshotData] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) { setScreenshotData(null); return; }

        const reader = new FileReader();
        reader.onload = () => setScreenshotData(reader.result as string);
        reader.readAsDataURL(file);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim() || !socket) return;

        setSubmitting(true);
        socket.emit(
            'submitBugReport',
            { roomId, description: description.trim(), category, screenshotData },
            (res: { ok: boolean; message: string }) => {
                setSubmitting(false);
                setResult(res);
            },
        );
    };

    const score = gameState?.points ?? { team1: 0, team2: 0 };
    const roundState = gameState?.roundState ?? 'N/A';
    const currentPhase = gameState?.phase ?? 'N/A';

    return (
        <div className="report-overlay" onClick={onClose}>
            <div className="report-modal glass-panel" onClick={e => e.stopPropagation()}>
                <button className="report-close" onClick={onClose}>
                    <X size={20} />
                </button>

                <h2 className="report-title">Report an Issue</h2>

                {result ? (
                    <div className={`report-result ${result.ok ? 'report-success' : 'report-error'}`}>
                        <p>{result.message}</p>
                        <button className="btn btn-secondary" onClick={onClose}>Close</button>
                    </div>
                ) : (
                    <form className="report-form" onSubmit={handleSubmit}>
                        <label className="report-label" htmlFor="report-desc">
                            Issue Description <span className="required">*</span>
                        </label>
                        <textarea
                            id="report-desc"
                            className="report-textarea"
                            placeholder="Describe the issue you encountered..."
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={4}
                            required
                        />

                        <label className="report-label" htmlFor="report-category">Category</label>
                        <select
                            id="report-category"
                            className="report-select"
                            value={category}
                            onChange={e => setCategory(e.target.value)}
                        >
                            {CATEGORIES.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>

                        <label className="report-label" htmlFor="report-screenshot">Screenshot (optional)</label>
                        <input
                            id="report-screenshot"
                            className="report-file"
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                        />

                        <div className="report-auto-info">
                            <p><strong>Auto-collected info</strong></p>
                            <span>Reporter: {playerName}</span>
                            <span>Score: Team 1 {score.team1} – Team 2 {score.team2}</span>
                            <span>Round state: {roundState}</span>
                            <span>Phase: {currentPhase}</span>
                        </div>

                        <button
                            type="submit"
                            className="btn btn-primary report-submit"
                            disabled={submitting || !description.trim()}
                        >
                            {submitting ? 'Submitting…' : 'Submit Report'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
