export interface ChangelogEntry {
    version: string;
    date: string;
    title: string;
    changes: string[];
}

// Add new releases here.
// Keep the newest entry at the top so the modal shows the latest update first.
export const CHANGELOG: ChangelogEntry[] = [];
