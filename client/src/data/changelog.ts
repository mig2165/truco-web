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
        version: '0.2.0',
        date: '3rd of November',
        title: '⚔️ 1v1 Duel & 2v2 Classic Modes',
        sections: [
            {
                title: '✨ New features',
                items: [
                    'Choose between 1v1 Duel mode (invite 1 friend) and 2v2 Classic mode (invite 3 friends).',
                    'Sign in with an account or play instantly as Guest in either mode.',
                    'In 1v1 Duel: Choose between 3-card and 5-card versions. Truco (3 pts), Double (6 pts), and Triple (9 pts) multiply stakes towards 12 points to win!',
                    'In 2v2 Classic: traditional 4-player team Truco, 3 cards per hand, first to 12 points.',
                    'Dynamic rules modal adapting to 1v1 Duel or 2v2 Classic rules.',
                    'Solo Dev Mode support for both 1v1 (1 bot opponent) and 2v2 (3 bots).',
                ],
            },
        ],
    },
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
                    'Added teacher mode.',
                    'Added dev mode.',
                ],
            },
            {
                title: '🛠️ Bug fixes',
                items: [
                    'Fixed round skipping Mao de 11.',
                    'Fixed calling Truco on Mao de Ferro.',
                    'Removed the trick lead panel because it could block the hand decision controls.',
                ],
            },
        ],
        footer: '-Jin',
    },
];
