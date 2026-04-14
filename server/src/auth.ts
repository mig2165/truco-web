import { JsonDatabase } from './database';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export interface Account {
    id: string; // The user's stable unique ID
    username: string; // Stored in lowercase for case-insensitive lookup
    displayName: string;
    passwordHash: string;
    createdAt: number;
    updatedAt: number;
}

export class AuthService {
    public accountDb: JsonDatabase<Account>;

    constructor() {
        this.accountDb = new JsonDatabase<Account>('accounts.json');
    }

    public getAccount(id: string): Account | undefined {
        return this.accountDb.get(id);
    }

    public getAccountByUsername(username: string): Account | undefined {
        const lower = username.toLowerCase();
        return this.accountDb.getAll().find(a => a.username === lower);
    }

    public register(username: string, displayName: string, passwordPlain: string): Account {
        const lowerUsername = username.toLowerCase();
        if (this.getAccountByUsername(lowerUsername)) {
            throw new Error('Username is already taken.');
        }

        const passwordHash = bcrypt.hashSync(passwordPlain, 10);
        const account: Account = {
            id: crypto.randomUUID(),
            username: lowerUsername,
            displayName: displayName.trim(),
            passwordHash,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        return this.accountDb.set(account);
    }

    public verifyCredentials(username: string, passwordPlain: string): Account | null {
        const lowerUsername = username.toLowerCase();
        const account = this.getAccountByUsername(lowerUsername);
        if (!account) return null;

        const isMatch = bcrypt.compareSync(passwordPlain, account.passwordHash);
        if (!isMatch) return null;

        return account;
    }
}

export const authService = new AuthService();
