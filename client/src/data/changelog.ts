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
        version: '0.3.0',
        date: '24th of November',
        title: '🔥 Wagers, Cosmetics, Partner Signals, Emotes & Tactical Play',
        sections: [
            {
                title: '✨ New Table Features',
                items: [
                    'Added a direct Leave Table button in the top-right table HUD (and Leave Room in waiting lobbies) with safe confirmation dialogs.',
                    'Added synthesized Web Audio sound effects for card plays, covered cards, Truco slams, ZAP, SNIPED!, emotes, and turn timer ticks, plus a mute toggle.',
                    'Added Quick Emote bubbles above seats and 2v2 Classic Partner Signals (Sinais) with a 35% chance of giving opponents a subtle glance tell.',
                    'Added direct counter-raises: respond to Truco with Raise Double (6) or respond to Double with Raise Triple (9).',
                    'Added Carta Coberta (Play Face-Down) after trick 1: conceal a throwaway card from opponents until round end.',
                    'Added optional Turn Timers (Off, 20s, 30s) and Bucks Wager tables (Free, 25, or 100 Bucks ante).',
                ],
            },
            {
                title: '🛍️ Cosmetics & Leaderboard',
                items: [
                    'Added the Cosmetic Shop: unlock and equip Table Felt themes, Card Backs, and Player Titles using Bucks.',
                    'Added Win Streaks, Hall of Fame Leaderboard, and live streak/title badges at the table.',
                ],
            },
        ],
    },
    {
        version: '0.2.1',
        date: '19th of November',
        title: '⚡ 1v1 Mão de Onze & Endgame Cap',
        sections: [
            {
                title: '✨ 1v1 Endgame Rules',
                items: [
                    'Points in 1v1 are hard capped at 11: players must play Mão de Onze to win the match.',
                    'The 11-point duelist receives cards first to decide whether to Play or ask for a Reshuffle.',
                    'The losing duelist has their cards withheld until the 11-point player accepts the round.',
                    'Asking for a Reshuffle awards 1 point to the opponent and deals a fresh round.',
                    'Accepting the round makes it worth 3 points, deals cards to the opponent, and the 11-point player leads trick 1 (unless hand switch occurs).',
                    'Winning any point in Mão de Onze reaches 12 points and wins the entire match!',
                    'At 11-11, the match enters Mão de Ferro (face-down cards) to decide the victor.',
                ],
            },
        ],
    },
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
