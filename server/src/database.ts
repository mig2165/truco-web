import fs from 'fs';
import path from 'path';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FixRecord {
    id: string;
    reportId: string;
    timestamp: number;
    generatedPatch: string;
    targetFile: string;
    explanation: string;
    confidence: number;
    status: 'generated' | 'applied' | 'failed' | 'skipped';
    errorMessage?: string;
}

export interface PullRequestRecord {
    id: string;
    reportId: string;
    fixId: string;
    timestamp: number;
    branchName: string;
    prNumber?: number;
    prUrl?: string;
    status: 'created' | 'merged' | 'closed' | 'failed';
    errorMessage?: string;
}

// ─── Generic JSON Database ─────────────────────────────────────────────────────

interface DatabaseFile<T> {
    data: T[];
    lastUpdated: number;
}

export class JsonDatabase<T extends { id: string }> {
    private filePath: string;
    private cache: Map<string, T> = new Map();

    constructor(filename: string) {
        const dataDir = path.join(__dirname, '../../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this.filePath = path.join(dataDir, filename);
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const content = fs.readFileSync(this.filePath, 'utf-8');
                const parsed: DatabaseFile<T> = JSON.parse(content) as DatabaseFile<T>;
                this.cache = new Map(parsed.data.map(r => [r.id, r]));
                console.log(`[Database] Loaded ${this.cache.size} records from ${path.basename(this.filePath)}`);
            }
        } catch (err) {
            console.warn(`[Database] Could not load ${path.basename(this.filePath)}, starting fresh:`, err);
        }
    }

    private save(): void {
        try {
            const file: DatabaseFile<T> = {
                data: Array.from(this.cache.values()),
                lastUpdated: Date.now(),
            };
            fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
        } catch (err) {
            console.error(`[Database] Failed to save ${path.basename(this.filePath)}:`, err);
        }
    }

    set(item: T): T {
        this.cache.set(item.id, item);
        this.save();
        return item;
    }

    get(id: string): T | undefined {
        return this.cache.get(id);
    }

    getAll(): T[] {
        return Array.from(this.cache.values());
    }

    delete(id: string): boolean {
        const deleted = this.cache.delete(id);
        if (deleted) this.save();
        return deleted;
    }

    count(): number {
        return this.cache.size;
    }
}

// ─── Singleton Databases ───────────────────────────────────────────────────────

import type { BugReport } from './bugReport';

export const reportDb = new JsonDatabase<BugReport>('reports.json');
export const fixDb = new JsonDatabase<FixRecord>('fixes.json');
export const prDb = new JsonDatabase<PullRequestRecord>('pullrequests.json');
