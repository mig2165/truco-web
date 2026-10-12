import { JsonDatabase } from './database';
import type { Account } from './auth';
import type { GameState } from './gameLogic';

export interface FriendRelation {
    id: string;
    requesterId: string;
    recipientId: string;
    status: 'pending' | 'accepted';
    createdAt: number;
    updatedAt: number;
}

export interface MatchRecord {
    id: string;
    matchId: string;
    playerId: string;
    roomId: string;
    playerName: string;
    teammates: string[];
    opponents: string[];
    winnerTeam: number;
    playerTeam: number;
    score: { team1: number; team2: number };
    completedAt: number;
}

export class SocialService {
    private friendDb = new JsonDatabase<FriendRelation>('friends.json');
    private matchDb = new JsonDatabase<MatchRecord>('matches.json');

    searchAccounts(accounts: Account[], query: string, excludedIds: Set<string>) {
        const normalized = query.trim().toLowerCase();
        if (normalized.length < 2) return [];
        return accounts
            .filter(account => account.username.includes(normalized) && !excludedIds.has(account.id))
            .slice(0, 10)
            .map(({ id, username, displayName }) => ({ id, username, displayName }));
    }

    getRelations(accountId: string) {
        return this.friendDb.getAll().filter(relation =>
            relation.requesterId === accountId || relation.recipientId === accountId
        );
    }

    getFriends(accountId: string) {
        return this.getRelations(accountId)
            .filter(relation => relation.status === 'accepted')
            .map(relation => relation.requesterId === accountId ? relation.recipientId : relation.requesterId);
    }

    getIncomingRequests(accountId: string) {
        return this.getRelations(accountId).filter(relation =>
            relation.recipientId === accountId && relation.status === 'pending'
        );
    }

    sendRequest(requesterId: string, recipientId: string) {
        if (requesterId === recipientId) throw new Error('You cannot add yourself as a friend.');
        const existing = this.friendDb.getAll().find(relation =>
            (relation.requesterId === requesterId && relation.recipientId === recipientId) ||
            (relation.requesterId === recipientId && relation.recipientId === requesterId)
        );
        if (existing?.status === 'accepted') throw new Error('You are already friends.');
        if (existing?.requesterId === recipientId) {
            const accepted = { ...existing, status: 'accepted' as const, updatedAt: Date.now() };
            this.friendDb.set(accepted);
            return accepted;
        }
        if (existing) throw new Error('A friend request is already pending.');

        const now = Date.now();
        return this.friendDb.set({
            id: crypto.randomUUID(),
            requesterId,
            recipientId,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
        });
    }

    respondToRequest(accountId: string, requestId: string, accept: boolean) {
        const request = this.friendDb.get(requestId);
        if (!request || request.recipientId !== accountId || request.status !== 'pending') {
            throw new Error('Friend request not found.');
        }
        if (accept) {
            return this.friendDb.set({ ...request, status: 'accepted', updatedAt: Date.now() });
        }
        this.friendDb.delete(requestId);
        return request;
    }

    removeFriend(accountId: string, friendId: string) {
        const relation = this.friendDb.getAll().find(item =>
            item.status === 'accepted' &&
            ((item.requesterId === accountId && item.recipientId === friendId) ||
                (item.recipientId === accountId && item.requesterId === friendId))
        );
        if (!relation) return false;
        return this.friendDb.delete(relation.id);
    }

    recordCompletedMatch(state: GameState, socketAccounts: Map<string, string>, completedAt: number) {
        if (state.winnerTeam == null) return;
        const matchId = `${state.roomId}:${completedAt}`;
        for (const player of state.players) {
            const accountId = socketAccounts.get(player.id);
            if (!accountId || player.isBot) continue;
            const id = `${matchId}:${accountId}`;
            if (this.matchDb.get(id)) continue;
            const teammates = state.players
                .filter(other => !other.isBot && other.team === player.team && other.id !== player.id)
                .map(other => other.name);
            const opponents = state.players
                .filter(other => !other.isBot && other.team !== player.team)
                .map(other => other.name);
            this.matchDb.set({
                id,
                matchId,
                playerId: accountId,
                roomId: state.roomId,
                playerName: player.name,
                teammates,
                opponents,
                winnerTeam: state.winnerTeam,
                playerTeam: player.team,
                score: { ...state.points },
                completedAt,
            });
        }
    }

    getMatchHistory(accountId: string) {
        const matches = this.matchDb.getAll()
            .filter(match => match.playerId === accountId)
            .sort((a, b) => b.completedAt - a.completedAt);
        return {
            stats: {
                gamesPlayed: matches.length,
                gamesWon: matches.filter(match => match.playerTeam === match.winnerTeam).length,
                winRate: matches.length
                    ? Math.round(matches.filter(match => match.playerTeam === match.winnerTeam).length / matches.length * 100)
                    : 0,
            },
            matches: matches.slice(0, 25),
        };
    }
}

export const socialService = new SocialService();
