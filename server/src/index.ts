import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { TrucoGameManager } from './gameManager';
import { bugReportManager, BugCategory, BugReport, GameSnapshot } from './bugReport';
import { reportDb, fixDb, prDb } from './database';
import { bugFixer } from './bugFixer';
import { gitIntegration } from './gitIntegration';

const app = express();
const PORT = process.env.PORT || 3001;

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.get('/health', (req, res) => {
  res.send('OK');
});

// Serve React build
const clientBuildPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientBuildPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

const gameManager = new TrucoGameManager(io);

// ── REST API Endpoints ─────────────────────────────────────────────────────────

function createSnapshotForRoom(roomId: string): GameSnapshot {
  const gameState = gameManager.getGameState(roomId);
  if (gameState) {
    return bugReportManager.createSnapshot(gameState);
  }
  return {
    score: { team1: 0, team2: 0 },
    roundState: 'unknown',
    playerHands: [],
    last20Events: [],
    callHistory: [],
    trickHistory: [],
    vira: null,
    manilhaRank: null,
    currentPhase: 'unknown',
    maoDeFerroActive: false,
    maoDeOnzeActive: false,
    roundPoints: 0,
    tricks: { team1: 0, team2: 0 },
  };
}

app.post('/api/reports', (req, res) => {
  const { roomId, playerId, playerName, description, category, screenshotData } = req.body;

  if (!roomId || !playerId || !playerName || !description || !category) {
    res.status(400).json({ error: 'Missing required fields: roomId, playerId, playerName, description, category' });
    return;
  }

  const report: BugReport = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    roomId,
    playerId,
    playerName,
    description,
    category: category as BugCategory,
    screenshotData,
    gameSnapshot: createSnapshotForRoom(roomId),
    timestamp: Date.now(),
    status: 'pending',
  };

  const submitted = bugReportManager.submitReport(report);
  res.json(submitted);
});

app.get('/api/reports', (_req, res) => {
  res.json(bugReportManager.getReports());
});

app.get('/api/reports/:id', (req, res) => {
  const report = bugReportManager.getReport(req.params.id);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json(report);
});

app.get('/api/simulations', (_req, res) => {
  res.json(bugReportManager.getSimulationResults());
});

app.post('/api/simulations/run', (_req, res) => {
  const result = bugReportManager.runRuleSimulation();
  res.json(result);
});

app.get('/api/admin/dashboard', (_req, res) => {
  const reports = bugReportManager.getReports();
  const simulations = bugReportManager.getSimulationResults();

  const dashboard = {
    totalReports: reports.length,
    invalidReports: reports.filter(r => r.status === 'invalid').length,
    needsInvestigation: reports.filter(r => r.status === 'needs_investigation').length,
    confirmedBugs: reports.filter(r => r.status === 'confirmed').length,
    simulationsPassed: simulations.filter(s => s.passed).length,
    simulationsFailed: simulations.filter(s => !s.passed).length,
    recentReports: reports.slice(-10),
    recentSimulations: simulations.slice(-10),
  };

  res.json(dashboard);
});

// Admin route — serves the React app
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Catch-all for React Router (client-side routes like /room/:id)
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// ── Bugfix Pipeline API Endpoints ─────────────────────────────────────────────

app.get('/api/bugfix-dashboard', (_req, res) => {
  const reports = bugReportManager.getReports();
  const fixes = fixDb.getAll();
  const prs = prDb.getAll();

  res.json({
    reports: reports.map(r => ({
      id: r.id,
      category: r.category,
      status: r.status,
      description: r.description,
      playerName: r.playerName,
      timestamp: r.timestamp,
      fixId: r.fixId,
      prId: r.prId,
      prUrl: r.prUrl,
      violations: r.investigationResult?.ruleViolations.length ?? 0,
    })),
    fixes,
    prs,
    stats: buildBugfixStats(reports, fixes, prs),
  });
});

app.get('/api/bugfix/stats', (_req, res) => {
  const reports = bugReportManager.getReports();
  const fixes = fixDb.getAll();
  const prs = prDb.getAll();
  res.json(buildBugfixStats(reports, fixes, prs));
});

app.get('/api/bugfix/:reportId/timeline', (req, res) => {
  const report = bugReportManager.getReport(req.params.reportId);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  const fix = report.fixId ? fixDb.get(report.fixId) : undefined;
  const pr = report.prId ? prDb.get(report.prId) : undefined;

  res.json({
    report,
    investigation: report.investigationResult ?? null,
    fix: fix ?? null,
    pr: pr ?? null,
    timeline: buildTimeline(report, fix, pr),
  });
});

app.post('/api/bugfix/:reportId/generate-fix', async (req, res) => {
  const report = bugReportManager.getReport(req.params.reportId);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  // Run investigation if not done yet
  if (!report.investigationResult) {
    report.investigationResult = bugReportManager.investigateReport(report);
  }

  // Confirm and generate fix
  bugReportManager.confirmReport(report.id);

  try {
    const fix = await bugFixer.generateFix(report);
    fixDb.set(fix);
    report.fixId = fix.id;
    report.status = 'fix_generated';
    bugReportManager.persistReport(report);
    console.log(`[Pipeline] Manual fix generated for report ${report.id}: fix ${fix.id}`);
    res.json({ report, fix });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Pipeline] Fix generation failed:', message);
    res.status(500).json({ error: message });
  }
});

app.post('/api/bugfix/:reportId/skip', (req, res) => {
  const { reason } = req.body as { reason?: string };
  const report = bugReportManager.skipReport(
    req.params.reportId,
    reason ?? 'Manually skipped via API',
  );
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json(report);
});

// ── Helper Functions ───────────────────────────────────────────────────────────

function buildBugfixStats(
  reports: BugReport[],
  fixes: ReturnType<typeof fixDb.getAll>,
  prs: ReturnType<typeof prDb.getAll>,
) {
  return {
    totalReports: reports.length,
    pendingReports: reports.filter(r => r.status === 'needs_investigation').length,
    confirmedBugs: reports.filter(r => r.status === 'confirmed').length,
    fixesGenerated: fixes.length,
    fixesSucceeded: fixes.filter(f => f.status === 'generated' || f.status === 'applied').length,
    prsCreated: prs.length,
    prsSucceeded: prs.filter(p => p.status === 'created' || p.status === 'merged').length,
    skipped: reports.filter(r => r.status === 'skipped').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
    autoFixRate: reports.length > 0
      ? ((fixes.length / Math.max(1, reports.filter(r => r.status !== 'invalid').length)) * 100).toFixed(1) + '%'
      : '0%',
  };
}

function buildTimeline(
  report: BugReport,
  fix: ReturnType<typeof fixDb.get>,
  pr: ReturnType<typeof prDb.get>,
): Array<{ timestamp: number; event: string; detail: string }> {
  const events: Array<{ timestamp: number; event: string; detail: string }> = [];

  events.push({ timestamp: report.timestamp, event: 'reported', detail: `Bug report submitted by ${report.playerName}` });

  if (report.validationResult) {
    events.push({
      timestamp: report.timestamp + 1,
      event: 'validated',
      detail: report.validationResult.isValid ? 'Report validated as genuine' : `Marked invalid: ${report.validationResult.reason}`,
    });
  }

  if (report.investigationResult) {
    const v = report.investigationResult.ruleViolations.length;
    events.push({
      timestamp: report.timestamp + 2,
      event: 'investigated',
      detail: v > 0 ? `${v} rule violation(s) found — status: confirmed` : 'No violations — report may be cosmetic',
    });
  }

  if (fix) {
    events.push({ timestamp: fix.timestamp, event: 'fix_generated', detail: `Patch generated for ${fix.targetFile} (confidence ${(fix.confidence * 100).toFixed(0)}%)` });
  }

  if (pr) {
    events.push({
      timestamp: pr.timestamp,
      event: 'pr_created',
      detail: pr.prUrl ? `PR created: ${pr.prUrl}` : `PR creation ${pr.status === 'failed' ? 'failed' : 'queued'}`,
    });
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Socket.io ──────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  gameManager.handleConnection(socket);
  // Keep the shared lobby presence counter in sync for all connected clients.
  gameManager.broadcastLobbySnapshot();

  // Chat — broadcast to all players in the room
  socket.on('chatMessage', (roomId: string, msg: { sender: string; message: string; team: number }) => {
    io.to(roomId).emit('chatMessage', { ...msg, timestamp: Date.now() });
  });

  // Real-time bug report submission
  socket.on('submitBugReport', (data: { roomId: string; description: string; category: string; screenshotData?: string }, callback?: (response: { id: string; status: string }) => void) => {
    try {
      const player = findPlayerBySocket(socket.id);

      const report: BugReport = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        roomId: data.roomId,
        playerId: player?.id ?? socket.id,
        playerName: player?.name ?? 'Unknown',
        description: data.description,
        category: data.category as BugCategory,
        screenshotData: data.screenshotData,
        gameSnapshot: createSnapshotForRoom(data.roomId),
        timestamp: Date.now(),
        status: 'pending',
      };

      const submitted = bugReportManager.submitReport(report);

      if (submitted.validationResult?.isValid) {
        const investigation = bugReportManager.investigateReport(submitted);
        submitted.investigationResult = investigation;
        bugReportManager.persistReport(submitted);
      }

      if (typeof callback === 'function') {
        // Send a minimal ack (no screenshotData) to avoid large payloads.
        callback({ id: submitted.id, status: submitted.status });
      }
    } catch (err) {
      console.error('[submitBugReport] Unexpected error:', err);
      if (typeof callback === 'function') {
        callback({ id: '', status: 'error' });
      }
    }
  });
});

function findPlayerBySocket(socketId: string): { id: string; name: string } | undefined {
  // Search through all active game rooms for this socket
  // We iterate possible room IDs by checking the gameManager's state
  // Since we can't iterate private rooms directly, we use socket.rooms
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return undefined;

  for (const roomId of socket.rooms) {
    if (roomId === socketId) continue; // Skip the default self-room
    const gameState = gameManager.getGameState(roomId);
    if (gameState) {
      const player = gameState.players.find(p => p.id === socketId);
      if (player) return { id: player.id, name: player.name };
    }
  }
  return undefined;
}

// ── Periodic Rule Simulation (every 5 minutes) ────────────────────────────────

setInterval(() => {
  const result = bugReportManager.runRuleSimulation();
  console.log(`[RuleSimulation] ${result.passed ? 'PASSED' : 'FAILED'} — ${result.violations.length} violation(s)`);
}, 5 * 60 * 1000);

// ── Continuous Bug-Fix Pipeline Loop ─────────────────────────────────────────
// Tier 1 (30 s) : Check for new pending reports and run investigation
// Tier 2 (60 s) : Confirm investigated reports that have violations
// Tier 3 (2 min): Generate fixes for confirmed-but-unfixed reports
// Tier 4 (5 min): Create PRs for generated-but-un-PR'd fixes (batch)
// Tier 5 (10 min): Re-verify confirmed fixes by re-running simulation

let runningTiers: Set<number> = new Set();

async function runPipelineTick(tier: number): Promise<void> {
  if (runningTiers.has(tier)) return; // prevent overlapping runs of same tier
  if (tier >= 3 && runningTiers.size > 0) return; // heavy tiers skip if any tier is running
  const reports = bugReportManager.getReports();

  // --- Tier 1: Investigate pending reports ---
  if (tier === 1) {
    const pending = reports.filter(r => r.status === 'needs_investigation' && !r.investigationResult);
    for (const report of pending) {
      const result = bugReportManager.investigateReport(report);
      report.investigationResult = result;
      bugReportManager.persistReport(report);
      console.log(`[Pipeline:T1] Investigated report ${report.id} — ${result.ruleViolations.length} violation(s)`);
    }
  }

  // --- Tier 2: Confirm investigated reports with violations ---
  if (tier === 2) {
    const investigated = reports.filter(
      r => r.status === 'needs_investigation' && r.investigationResult
    );
    for (const report of investigated) {
      const violations = report.investigationResult!.ruleViolations.length;
      if (violations > 0) {
        bugReportManager.confirmReport(report.id);
        console.log(`[Pipeline:T2] Confirmed report ${report.id} (${violations} violations)`);
      }
    }
  }

  // --- Tier 3: Generate fixes for confirmed reports ---
  if (tier === 3) {
    runningTiers.add(3);
    try {
      const needsFix = reports.filter(r => r.status === 'confirmed' && !r.fixId);
      for (const report of needsFix) {
        try {
          const fix = await bugFixer.generateFix(report);
          fixDb.set(fix);
          report.fixId = fix.id;
          report.status = 'fix_generated';
          bugReportManager.persistReport(report);
          console.log(`[Pipeline:T3] Fix generated for report ${report.id} → fix ${fix.id}`);
        } catch (err) {
          console.error(`[Pipeline:T3] Fix generation failed for ${report.id}:`, err);
        }
      }
    } finally {
      runningTiers.delete(3);
    }
  }

  // --- Tier 4: Create PRs for fixed-but-un-PR'd reports ---
  if (tier === 4) {
    runningTiers.add(4);
    try {
      const needsPr = reports.filter(r => r.status === 'fix_generated' && r.fixId && !r.prId);
      for (const report of needsPr) {
        const fix = fixDb.get(report.fixId!);
        if (!fix) continue;
        try {
          const pr = await gitIntegration.createPullRequest(report, fix);
          prDb.set(pr);
          report.prId = pr.id;
          report.prUrl = pr.prUrl;
          report.status = 'pr_created';
          bugReportManager.persistReport(report);
          console.log(`[Pipeline:T4] PR created for report ${report.id} → ${pr.prUrl ?? 'simulated'}`);
        } catch (err) {
          console.error(`[Pipeline:T4] PR creation failed for ${report.id}:`, err);
        }
      }
    } finally {
      runningTiers.delete(4);
    }
  }

  // --- Tier 5: Re-verify all fixes by running simulation ---
  if (tier === 5) {
    const result = bugReportManager.runRuleSimulation();
    const fixedCount = reports.filter(r => r.status === 'pr_created' || r.status === 'resolved').length;
    console.log(
      `[Pipeline:T5] Re-verification simulation ${result.passed ? 'PASSED' : 'FAILED'} — ` +
      `${result.violations.length} violation(s), ${fixedCount} reports with PRs/resolved`
    );
  }
}

// Tier 1: every 30 seconds — investigate pending reports
setInterval(() => void runPipelineTick(1), 30 * 1000);
// Tier 2: every 60 seconds — confirm investigated reports
setInterval(() => void runPipelineTick(2), 60 * 1000);
// Tier 3: every 2 minutes — generate fixes
setInterval(() => void runPipelineTick(3), 2 * 60 * 1000);
// Tier 4: every 5 minutes — create PRs
setInterval(() => void runPipelineTick(4), 5 * 60 * 1000);
// Tier 5: every 10 minutes — re-verify
setInterval(() => void runPipelineTick(5), 10 * 60 * 1000);

httpServer.listen(PORT as number, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});
