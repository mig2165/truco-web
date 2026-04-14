import { JsonDatabase } from './database';

// ─── Constants ─────────────────────────────────────────────────────────────────

export const STARTER_BUCKS = 1000;
export const MATCH_WIN_REWARD = 50;
export const MATCH_LOSS_REWARD = 10;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PlayerProfile {
    /** Stable client-generated UUID — persists across reconnects. */
    id: string;
    /** Player's chosen display name at the time of first profile creation. */
    displayName: string;
    /** Current Bucks balance. Always >= 0. */
    bucksBalance: number;
    /** Cumulative Bucks credited to this account (positive amounts only). */
    totalEarned: number;
    /** Cumulative Bucks debited from this account (stored as a positive number). */
    totalSpent: number;
    /** Total completed games associated with this profile. */
    gamesPlayed: number;
    /** Total games won. */
    gamesWon: number;
    /** Whether the one-time starter Bucks grant has already been awarded. */
    starterGranted: boolean;
    /** Unix timestamp (ms) when the profile was first created. */
    createdAt: number;
    /** Unix timestamp (ms) of the last profile update. */
    updatedAt: number;
}

export type TransactionType =
    | 'starter_grant'
    | 'match_win'
    | 'match_loss'
    | 'admin_adjustment';

export interface BucksTransaction {
    /** Server-generated unique transaction ID. */
    id: string;
    /** References PlayerProfile.id. */
    playerId: string;
    type: TransactionType;
    /** Positive = credit, negative = debit. */
    amount: number;
    /** Balance immediately before this transaction. */
    balanceBefore: number;
    /** Balance immediately after this transaction. */
    balanceAfter: number;
    /** Human-readable reason for the transaction. */
    description: string;
    /** Optional room context for match-related transactions. */
    roomId?: string;
    /** Unix timestamp (ms) when the transaction was recorded. */
    createdAt: number;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class EconomyService {
    private profileDb: JsonDatabase<PlayerProfile>;
    private transactionDb: JsonDatabase<BucksTransaction>;

    constructor() {
        this.profileDb = new JsonDatabase<PlayerProfile>('profiles.json');
        this.transactionDb = new JsonDatabase<BucksTransaction>('transactions.json');
    }

    /**
     * Returns an existing profile or creates a new one with a starter Bucks grant.
     * Safe to call on every reconnect — the starter grant is awarded only once.
     */
    getOrCreateProfile(playerId: string, displayName: string): PlayerProfile {
        if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
            throw new Error('playerId must be a non-empty string');
        }
        if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
            throw new Error('displayName must be a non-empty string');
        }

        const existing = this.profileDb.get(playerId);
        if (existing) {
            return existing;
        }

        const now = Date.now();
        const profile: PlayerProfile = {
            id: playerId,
            displayName: displayName.trim(),
            bucksBalance: 0,
            totalEarned: 0,
            totalSpent: 0,
            gamesPlayed: 0,
            gamesWon: 0,
            starterGranted: false,
            createdAt: now,
            updatedAt: now,
        };
        this.profileDb.set(profile);

        // Award starter Bucks — deduplicated by checking existing transactions.
        this._awardStarterGrant(profile);

        return this.profileDb.get(playerId)!;
    }

    /** Returns the profile for a known player, or undefined if not found. */
    getProfile(playerId: string): PlayerProfile | undefined {
        if (!playerId) return undefined;
        return this.profileDb.get(playerId);
    }

    /**
     * Returns all transactions for a player, ordered from oldest to newest.
     * Returns an empty array if the player has no transactions.
     */
    getTransactions(playerId: string): BucksTransaction[] {
        if (!playerId) return [];
        return this.transactionDb
            .getAll()
            .filter(tx => tx.playerId === playerId)
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    /**
     * Records a balance change and updates the player's profile totals.
     * Prevents the balance from going below zero for debit operations.
     * Returns the recorded transaction.
     */
    addTransaction(
        playerId: string,
        type: TransactionType,
        amount: number,
        description: string,
        roomId?: string,
    ): BucksTransaction {
        const profile = this.profileDb.get(playerId);
        if (!profile) {
            throw new Error(`Profile not found for playerId: ${playerId}`);
        }
        if (typeof amount !== 'number' || !isFinite(amount)) {
            throw new Error('amount must be a finite number');
        }

        const balanceBefore = profile.bucksBalance;
        // Clamp debits so the balance never goes negative.
        const effectiveAmount = amount < 0
            ? Math.max(amount, -balanceBefore)
            : amount;
        const balanceAfter = balanceBefore + effectiveAmount;

        const tx: BucksTransaction = {
            id: crypto.randomUUID(),
            playerId,
            type,
            amount: effectiveAmount,
            balanceBefore,
            balanceAfter,
            description,
            roomId,
            createdAt: Date.now(),
        };
        this.transactionDb.set(tx);

        const updatedProfile: PlayerProfile = {
            ...profile,
            bucksBalance: balanceAfter,
            totalEarned: effectiveAmount > 0 ? profile.totalEarned + effectiveAmount : profile.totalEarned,
            totalSpent: effectiveAmount < 0 ? profile.totalSpent + Math.abs(effectiveAmount) : profile.totalSpent,
            updatedAt: Date.now(),
        };
        this.profileDb.set(updatedProfile);

        return tx;
    }

    /**
     * Records Bucks reward for match completion. Idempotent: a second call with
     * the same playerId + roomId is a no-op that returns the existing transaction.
     * Win: +MATCH_WIN_REWARD Bucks. Loss/participation: +MATCH_LOSS_REWARD Bucks.
     */
    recordMatchResult(
        playerId: string,
        roomId: string,
        isWinner: boolean,
    ): { transaction: BucksTransaction | null; profile: PlayerProfile; alreadyRecorded: boolean } {
        const profile = this.profileDb.get(playerId);
        if (!profile) {
            throw new Error(`Profile not found for playerId: ${playerId}`);
        }

        // Idempotency check: skip if a match_win or match_loss already exists for this room.
        const existing = this.transactionDb
            .getAll()
            .find(tx => tx.playerId === playerId && tx.roomId === roomId &&
                (tx.type === 'match_win' || tx.type === 'match_loss'));
        if (existing) {
            return { transaction: null, profile, alreadyRecorded: true };
        }

        const amount = isWinner ? MATCH_WIN_REWARD : MATCH_LOSS_REWARD;
        const type: TransactionType = isWinner ? 'match_win' : 'match_loss';
        const description = isWinner
            ? `Match win reward: +${MATCH_WIN_REWARD} Bucks`
            : `Match participation: +${MATCH_LOSS_REWARD} Bucks`;

        const tx = this.addTransaction(playerId, type, amount, description, roomId);

        // Increment games counters on the profile.
        const updated = this.profileDb.get(playerId)!;
        this.profileDb.set({
            ...updated,
            gamesPlayed: updated.gamesPlayed + 1,
            gamesWon: isWinner ? updated.gamesWon + 1 : updated.gamesWon,
        });

        return { transaction: tx, profile: this.profileDb.get(playerId)!, alreadyRecorded: false };
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    private _awardStarterGrant(profile: PlayerProfile): void {
        // Guard against duplicate starter grants using the flag on the profile
        // itself — avoids a full transaction scan on every profile creation.
        if (profile.starterGranted) return;

        this.addTransaction(
            profile.id,
            'starter_grant',
            STARTER_BUCKS,
            `Welcome! Here are your ${STARTER_BUCKS} starter Bucks.`,
        );

        // Mark the grant as done so repeated calls are idempotent.
        const updated = this.profileDb.get(profile.id);
        if (updated) {
            this.profileDb.set({ ...updated, starterGranted: true });
        }
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const economyService = new EconomyService();
