export interface ChangelogSection {
    title: string;
    items: string[];
}

export interface ChangelogEntry {
    version: string;
    date: string;
    title: string;
    sections: ChangelogSection[];
    footer?: string;
}

// Add new releases here.
// Keep the newest entry at the top so the modal shows the latest update first.
// Use sections to keep features and fixes grouped in the UI.
export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '0.0.0',
        date: '16th of March',
        title: '🚀 FRESH FEATURES AND BUG FIXES (16th of March) by Jin',
        sections: [
            {
                title: '✨ New features',
                items: [
                    'Gamblers can now view teams and their players before joining.',
                    'Gamblers are now notified when a room is full.',
                    'Added rematch.',
                    'Updated chat to always be displayed.',
                    '[Experimental] Gamblers can now view the current trick leading card and player. Please let Jin know if this is trash.',
                    'Added teacher mode.',
                    'Added dev mode.',
                ],
            },
            {
                title: '🛠️ Bug fixes',
                items: [
                    'Fixed round skipping Mao de 11.',
                    'Fixed calling Truco on Mao de Ferro.',
                ],
            },
        ],
        footer: '-Jin',
    },
];
