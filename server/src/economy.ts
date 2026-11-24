import { JsonDatabase } from './database';

// ─── Constants ─────────────────────────────────────────────────────────────────

export const STARTER_BUCKS = 1000;
export const MATCH_WIN_REWARD = 50;
export const MATCH_LOSS_REWARD = 10;

export type CosmeticCategory = 'felt' | 'cardBack' | 'title';

export interface ShopItem {
    id: string;
    category: CosmeticCategory;
    name: string;
    description: string;
    price: number;
    preview: string;
}

export const SHOP_CATALOG: ShopItem[] = [
    // Table Felt Themes
    { id: 'felt_emerald', category: 'felt', name: 'Classic Emerald', description: 'Traditional Brazilian Truco green felt.', price: 0, preview: '#166534' },
    { id: 'felt_midnight', category: 'felt', name: 'Midnight Casino', description: 'Deep indigo-slate high-stakes felt.', price: 150, preview: '#1e1b4b' },
    { id: 'felt_crimson', category: 'felt', name: 'Crimson Velvet', description: 'Rich royal burgundy casino cloth.', price: 250, preview: '#7f1d1d' },
    { id: 'felt_gold', category: 'felt', name: 'Golden VIP', description: 'Obsidian & burnished gold championship table.', price: 500, preview: '#78350f' },

    // Card Back Styles
    { id: 'back_slate', category: 'cardBack', name: 'Classic Slate', description: 'Clean dark diagonal weave.', price: 0, preview: '#1e293b' },
    { id: 'back_royal', category: 'cardBack', name: 'Royal Gold', description: 'Gilded crown diamond lattice.', price: 120, preview: '#b45309' },
    { id: 'back_cyber', category: 'cardBack', name: 'Neon Cyber', description: 'Electric cyan circuit grid.', price: 220, preview: '#0891b2' },
    { id: 'back_flame', category: 'cardBack', name: 'Inferno Flame', description: 'Blazing crimson & amber deck.', price: 350, preview: '#dc2626' },

    // Player Titles
    { id: 'title_rookie', category: 'title', name: 'Rookie', description: 'Fresh at the table.', price: 0, preview: '🃏' },
    { id: 'title_shark', category: 'title', name: 'Card Shark', description: 'Always knows what Vira is coming.', price: 100, preview: '🦈' },
    { id: 'title_bluffer', category: 'title', name: 'Bluff Master', description: 'Calls Mão Real with a 4 of Diamonds.', price: 200, preview: '🎭' },
    { id: 'title_highroller', category: 'title', name: 'High Roller', description: 'Never folds to a Triple Truco.', price: 400, preview: '💎' },
    { id: 'title_legend', category: 'title', name: 'Truco Legend', description: 'Feared across 1v1 and 2v2 tables.', price: 750, preview: '👑' },
];

export const DEFAULT_EQUIPPED = {
    felt: 'felt_emerald',
    cardBack: 'back_slate',
    title: 'title_rookie',
} as const;

export const DEFAULT_OWNED_ITEMS = ['felt_emerald', 'back_slate', 'title_rookie'];

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EquippedCosmetics {
    felt: string;
    cardBack: string;
    title: string;
}

export interface PlayerProfile {
    /** Stable client-generated UUID or account ID — persists across reconnects. */
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
    /** Mode-specific wins & highlight stats. */
    duelWins?: number;
    classicWins?: number;
    currentStreak?: number;
    bestStreak?: number;
    zapsPlayed?: number;
    snipesLanded?: number;
    bluffsCaught?: number;
    /** Owned cosmetic IDs. */
    ownedItems?: string[];
    /** Currently equipped cosmetics. */
    equipped?: EquippedCosmetics;
    /** Whether the one-time starter Bucks grant has already been awarded. */
    starterGranted: boolean;
    /** Unix timestamp (ms) when the profile was first created. */
    createdAt: number;
    /** Unix timestamp (ms) of the last profile update. */
    updatedAt: number;
}

export interface LeaderboardEntry {
    id: string;
    displayName: string;
    bucksBalance: number;
    gamesPlayed: number;
    gamesWon: number;
    duelWins: number;
    classicWins: number;
    currentStreak: number;
    bestStreak: number;
    zapsPlayed: number;
    snipesLanded: number;
    bluffsCaught: number;
    titleLabel: string;
}

export type TransactionType =
    | 'starter_grant'
    | 'match_win'
    | 'match_loss'
    | 'wager_escrow'
    | 'wager_payout'
    | 'wager_refund'
    | 'shop_purchase'
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
    /** Optional room / match context for match-related transactions. */
    roomId?: string;
    /** Unix timestamp (ms) when the transaction was recorded. */
    createdAt: number;
}

export function getTitleLabel(titleId?: string): string {
    const item = SHOP_CATALOG.find((entry) => entry.id === titleId && entry.category === 'title');
    return item ? `${item.preview} ${item.name}` : '🃏 Rookie';
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class EconomyService {
    private profileDb: JsonDatabase<PlayerProfile>;
    private transactionDb: JsonDatabase<BucksTransaction>;

    constructor() {
        this.profileDb = new JsonDatabase<PlayerProfile>('profiles.json');
        this.transactionDb = new JsonDatabase<BucksTransaction>('transactions.json');
    }

    private normalizeProfile(profile: PlayerProfile): PlayerProfile {
        const ownedSet = new Set([...DEFAULT_OWNED_ITEMS, ...(profile.ownedItems ?? [])]);
        const equipped: EquippedCosmetics = {
            felt: profile.equipped?.felt && ownedSet.has(profile.equipped.felt) ? profile.equipped.felt : DEFAULT_EQUIPPED.felt,
            cardBack: profile.equipped?.cardBack && ownedSet.has(profile.equipped.cardBack) ? profile.equipped.cardBack : DEFAULT_EQUIPPED.cardBack,
            title: profile.equipped?.title && ownedSet.has(profile.equipped.title) ? profile.equipped.title : DEFAULT_EQUIPPED.title,
        };
        return {
            ...profile,
            duelWins: profile.duelWins ?? 0,
            classicWins: profile.classicWins ?? 0,
            currentStreak: profile.currentStreak ?? 0,
            bestStreak: profile.bestStreak ?? 0,
            zapsPlayed: profile.zapsPlayed ?? 0,
            snipesLanded: profile.snipesLanded ?? 0,
            bluffsCaught: profile.bluffsCaught ?? 0,
            ownedItems: Array.from(ownedSet),
            equipped,
        };
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
            const normalized = this.normalizeProfile({
                ...existing,
                displayName: displayName.trim() || existing.displayName,
            });
            this.profileDb.set(normalized);
            return normalized;
        }

        const now = Date.now();
        const profile: PlayerProfile = this.normalizeProfile({
            id: playerId,
            displayName: displayName.trim(),
            bucksBalance: 0,
            totalEarned: 0,
            totalSpent: 0,
            gamesPlayed: 0,
            gamesWon: 0,
            duelWins: 0,
            classicWins: 0,
            currentStreak: 0,
            bestStreak: 0,
            zapsPlayed: 0,
            snipesLanded: 0,
            bluffsCaught: 0,
            ownedItems: [...DEFAULT_OWNED_ITEMS],
            equipped: { ...DEFAULT_EQUIPPED },
            starterGranted: false,
            createdAt: now,
            updatedAt: now,
        });
        this.profileDb.set(profile);

        // Award starter Bucks — deduplicated by checking existing transactions.
        this._awardStarterGrant(profile);

        return this.normalizeProfile(this.profileDb.get(playerId)!);
    }

    /** Returns the profile for a known player, or undefined if not found. */
    getProfile(playerId: string): PlayerProfile | undefined {
        if (!playerId) return undefined;
        const found = this.profileDb.get(playerId);
        return found ? this.normalizeProfile(found) : undefined;
    }

    getShopCatalog(): ShopItem[] {
        return SHOP_CATALOG;
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
        const rawProfile = this.profileDb.get(playerId);
        if (!rawProfile) {
            throw new Error(`Profile not found for playerId: ${playerId}`);
        }
        const profile = this.normalizeProfile(rawProfile);
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

    purchaseItem(playerId: string, itemId: string): { profile: PlayerProfile; transaction: BucksTransaction } {
        const profile = this.getProfile(playerId);
        if (!profile) {
            throw new Error('Profile not found');
        }
        const item = SHOP_CATALOG.find((entry) => entry.id === itemId);
        if (!item) {
            throw new Error('Cosmetic item not found');
        }
        const owned = new Set(profile.ownedItems ?? DEFAULT_OWNED_ITEMS);
        if (owned.has(item.id)) {
            throw new Error('You already own this item');
        }
        if (profile.bucksBalance < item.price) {
            throw new Error(`Not enough Bucks (need ${item.price} Bucks)`);
        }

        const tx = this.addTransaction(
            playerId,
            'shop_purchase',
            -item.price,
            `Purchased ${item.name} (${item.category})`,
        );

        const refreshed = this.getProfile(playerId)!;
        owned.add(item.id);
        const nextEquipped: EquippedCosmetics = {
            ...(refreshed.equipped ?? DEFAULT_EQUIPPED),
            [item.category]: item.id,
        };

        const saved: PlayerProfile = {
            ...refreshed,
            ownedItems: Array.from(owned),
            equipped: nextEquipped,
            updatedAt: Date.now(),
        };
        this.profileDb.set(saved);
        return { profile: saved, transaction: tx };
    }

    equipItem(playerId: string, itemId: string): PlayerProfile {
        const profile = this.getProfile(playerId);
        if (!profile) {
            throw new Error('Profile not found');
        }
        const item = SHOP_CATALOG.find((entry) => entry.id === itemId);
        if (!item) {
            throw new Error('Cosmetic item not found');
        }
        const owned = new Set(profile.ownedItems ?? DEFAULT_OWNED_ITEMS);
        if (item.price > 0 && !owned.has(item.id)) {
            throw new Error('You do not own this item yet');
        }

        const saved: PlayerProfile = {
            ...profile,
            equipped: {
                ...(profile.equipped ?? DEFAULT_EQUIPPED),
                [item.category]: item.id,
            },
            updatedAt: Date.now(),
        };
        this.profileDb.set(saved);
        return saved;
    }

    /**
     * Escrows a room ante from a player's wallet when a wagered match starts.
     * Idempotent per matchKey (`${roomId}:${matchIndex}`).
     */
    escrowAnte(playerId: string, matchKey: string, amount: number): boolean {
        if (amount <= 0) return true;
        const profile = this.getProfile(playerId);
        if (!profile) return false;

        const alreadyEscrowed = this.transactionDb
            .getAll()
            .some(tx => tx.playerId === playerId && tx.roomId === matchKey && tx.type === 'wager_escrow');
        if (alreadyEscrowed) return true;

        if (profile.bucksBalance < amount) {
            return false;
        }

        this.addTransaction(
            playerId,
            'wager_escrow',
            -amount,
            `Table ante locked: -${amount} Bucks`,
            matchKey,
        );
        return true;
    }

    refundAnte(playerId: string, matchKey: string, amount: number): void {
        if (amount <= 0) return;
        const profile = this.getProfile(playerId);
        if (!profile) return;

        const hadEscrow = this.transactionDb
            .getAll()
            .some(tx => tx.playerId === playerId && tx.roomId === matchKey && tx.type === 'wager_escrow');
        if (!hadEscrow) return;

        const alreadyResolved = this.transactionDb
            .getAll()
            .some(tx => tx.playerId === playerId && tx.roomId === matchKey &&
                (tx.type === 'wager_refund' || tx.type === 'wager_payout'));
        if (alreadyResolved) return;

        this.addTransaction(
            playerId,
            'wager_refund',
            amount,
            `Table ante refunded (match cancelled): +${amount} Bucks`,
            matchKey,
        );
    }

    payoutWagerPot(winnerAccountIds: string[], matchKey: string, totalPot: number): void {
        if (totalPot <= 0 || winnerAccountIds.length === 0) return;
        const share = Math.floor(totalPot / winnerAccountIds.length);
        if (share <= 0) return;

        for (const accountId of winnerAccountIds) {
            const profile = this.getProfile(accountId);
            if (!profile) continue;
            const alreadyPaid = this.transactionDb
                .getAll()
                .some(tx => tx.playerId === accountId && tx.roomId === matchKey && tx.type === 'wager_payout');
            if (alreadyPaid) continue;

            this.addTransaction(
                accountId,
                'wager_payout',
                share,
                `Won table wager pot: +${share} Bucks`,
                matchKey,
            );
        }
    }

    incrementStat(playerId: string | undefined, stat: 'zapsPlayed' | 'snipesLanded' | 'bluffsCaught'): void {
        if (!playerId) return;
        const profile = this.getProfile(playerId);
        if (!profile) return;
        this.profileDb.set({
            ...profile,
            [stat]: (profile[stat] ?? 0) + 1,
            updatedAt: Date.now(),
        });
    }

    /**
     * Records Bucks reward and win/streak stats for match completion.
     * Idempotent per playerId + roomId (or matchKey).
     */
    recordMatchResult(
        playerId: string,
        roomId: string,
        isWinner: boolean,
        mode?: 'duel' | 'classic',
    ): { transaction: BucksTransaction | null; profile: PlayerProfile; alreadyRecorded: boolean } {
        const profile = this.getProfile(playerId);
        if (!profile) {
            throw new Error(`Profile not found for playerId: ${playerId}`);
        }

        // Idempotency check: skip if a match_win or match_loss already exists for this room/matchKey.
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

        const refreshed = this.getProfile(playerId)!;
        const nextStreak = isWinner ? (refreshed.currentStreak ?? 0) + 1 : 0;
        const nextBestStreak = Math.max(refreshed.bestStreak ?? 0, nextStreak);

        const updated: PlayerProfile = {
            ...refreshed,
            gamesPlayed: refreshed.gamesPlayed + 1,
            gamesWon: isWinner ? refreshed.gamesWon + 1 : refreshed.gamesWon,
            duelWins: isWinner && mode === 'duel' ? (refreshed.duelWins ?? 0) + 1 : (refreshed.duelWins ?? 0),
            classicWins: isWinner && mode === 'classic' ? (refreshed.classicWins ?? 0) + 1 : (refreshed.classicWins ?? 0),
            currentStreak: nextStreak,
            bestStreak: nextBestStreak,
            updatedAt: Date.now(),
        };
        this.profileDb.set(updated);

        return { transaction: tx, profile: updated, alreadyRecorded: false };
    }

    getLeaderboard(limit = 20): LeaderboardEntry[] {
        return this.profileDb
            .getAll()
            .map((raw) => this.normalizeProfile(raw))
            .sort((a, b) => {
                if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
                if ((b.currentStreak ?? 0) !== (a.currentStreak ?? 0)) return (b.currentStreak ?? 0) - (a.currentStreak ?? 0);
                return b.bucksBalance - a.bucksBalance;
            })
            .slice(0, limit)
            .map((p) => ({
                id: p.id,
                displayName: p.displayName,
                bucksBalance: p.bucksBalance,
                gamesPlayed: p.gamesPlayed,
                gamesWon: p.gamesWon,
                duelWins: p.duelWins ?? 0,
                classicWins: p.classicWins ?? 0,
                currentStreak: p.currentStreak ?? 0,
                bestStreak: p.bestStreak ?? 0,
                zapsPlayed: p.zapsPlayed ?? 0,
                snipesLanded: p.snipesLanded ?? 0,
                bluffsCaught: p.bluffsCaught ?? 0,
                titleLabel: getTitleLabel(p.equipped?.title),
            }));
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    private _awardStarterGrant(profile: PlayerProfile): void {
        if (profile.starterGranted) return;

        this.addTransaction(
            profile.id,
            'starter_grant',
            STARTER_BUCKS,
            `Welcome! Here are your ${STARTER_BUCKS} starter Bucks.`,
        );

        const updated = this.profileDb.get(profile.id);
        if (updated) {
            this.profileDb.set({ ...updated, starterGranted: true });
        }
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const economyService = new EconomyService();
