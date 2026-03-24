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

const CATEGORIES: { value: string; label: string }[] = [
    { value: 'gameplay_bug', label: 'Gameplay bug' },
    { value: 'ui_bug', label: 'UI bug' },
    { value: 'scoring_bug', label: 'Scoring bug' },
    { value: 'hand_call_bug', label: 'Hand call / bluff bug' },
    { value: 'other', label: 'Other' },
];

export default function ReportModal({ socket, roomId, playerName, gameState, onClose }: ReportModalProps) {
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState(CATEGORIES[0].value);
    const [screenshotData, setScreenshotData] = useState<string | null>(null);
    const [screenshotError, setScreenshotError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
    const pendingTimeoutRef = React.useRef<number | undefined>(undefined);

    // Cancel any in-flight timeout when the modal unmounts.
    React.useEffect(() => {
        return () => { window.clearTimeout(pendingTimeoutRef.current); };
    }, []);

    const MAX_SCREENSHOT_BYTES = 500 * 1024; // 500 KB – safe under Socket.IO 1 MB default

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        setScreenshotError(null);
        if (!file) { setScreenshotData(null); return; }

        if (file.size > MAX_SCREENSHOT_BYTES) {
            e.target.value = '';
            setScreenshotData(null);
            setScreenshotError(`Image too large (${Math.round(file.size / 1024)} KB). Please use an image under 500 KB.`);
            return;
        }

        const reader = new FileReader();
        reader.onload = () => setScreenshotData(reader.result as string);
        reader.readAsDataURL(file);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim() || !socket) return;

        setSubmitting(true);
        let settled = false;

        pendingTimeoutRef.current = window.setTimeout(() => {
            if (!settled) {
                settled = true;
                pendingTimeoutRef.current = undefined;
                setSubmitting(false);
                setResult({ ok: false, message: 'Submission timed out. Please check your connection and try again.' });
            }
        }, 10000);

        socket.emit(
            'submitBugReport',
            { roomId, description: description.trim(), category, screenshotData },
            (response: { id: string; status: string }) => {
                if (!settled) {
                    settled = true;
                    window.clearTimeout(pendingTimeoutRef.current);
                    pendingTimeoutRef.current = undefined;
                    setSubmitting(false);
                    if (response?.id) {
                        setResult({ ok: true, message: `Report submitted (ID: ${response.id}). Status: ${response.status}` });
                    } else {
                        setResult({ ok: false, message: 'Failed to submit report. Please try again.' });
                    }
                }
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
                                <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                        </select>

                        <label className="report-label" htmlFor="report-screenshot">Screenshot (optional, max 500 KB)</label>
                        <input
                            id="report-screenshot"
                            className="report-file"
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                        />
                        {screenshotError && (
                            <p className="report-field-error">{screenshotError}</p>
                        )}

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
