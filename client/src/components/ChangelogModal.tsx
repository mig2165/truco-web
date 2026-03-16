import React from 'react';
import { ScrollText, X } from 'lucide-react';
import { CHANGELOG } from '../data/changelog';
import './ChangelogModal.css';

interface ChangelogModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) {
        return null;
    }

    return (
        <>
            <div className="changelog-overlay" onClick={onClose} />
            <div
                className="changelog-modal glass-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="changelog-title"
            >
                <div className="changelog-header">
                    <div className="changelog-title-group">
                        <ScrollText size={22} />
                        <div>
                            <h2 id="changelog-title">Changelog</h2>
                            <p>Latest updates for Truco Online.</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="changelog-close-btn"
                        onClick={onClose}
                        aria-label="Close changelog"
                    >
                        <X size={18} />
                    </button>
                </div>

                {CHANGELOG.length === 0 ? (
                    <div className="changelog-empty-state">
                        <p>No changelog entries yet.</p>
                        <p className="changelog-empty-hint">
                            Add entries in <code>client/src/data/changelog.ts</code>.
                        </p>
                    </div>
                ) : (
                    <div className="changelog-list">
                        {CHANGELOG.map((entry) => (
                            <section key={`${entry.version}-${entry.date}`} className="changelog-entry">
                                <div className="changelog-entry-header">
                                    <span className="changelog-date-badge">{entry.date}</span>
                                </div>
                                <h3>{entry.title}</h3>
                                <div className="changelog-sections">
                                    {entry.sections.map((section) => (
                                        <div key={section.title} className="changelog-section">
                                            <h4>{section.title}</h4>
                                            <ul>
                                                {section.items.map((item) => (
                                                    <li key={item}>{item}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                                {entry.footer && <p className="changelog-footer">{entry.footer}</p>}
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};
