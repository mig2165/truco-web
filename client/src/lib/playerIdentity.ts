/**
 * Manages a stable, persistent player identifier stored in localStorage.
 *
 * The ID is a UUID-like string generated once per browser profile and reused
 * across all sessions and reconnects, giving the server a stable key to anchor
 * player economy profiles to even after the ephemeral socket.id changes.
 */

const STORAGE_KEY = 'truco_persistent_player_id';

/** Generates a v4-style UUID without external dependencies. */
function generateUUID(): string {
    // Use crypto.randomUUID if available (modern browsers + Node 14.17+).
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    // Fallback for older environments.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Returns the persistent player ID from localStorage, creating and storing a
 * new UUID if one does not already exist.
 */
export function getOrCreatePersistentPlayerId(): string {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && stored.trim() !== '') {
            return stored;
        }
        const newId = generateUUID();
        localStorage.setItem(STORAGE_KEY, newId);
        return newId;
    } catch {
        // localStorage may be unavailable (private browsing restrictions, etc.).
        // Fall back to a session-scoped ID so the app still works.
        return generateUUID();
    }
}
