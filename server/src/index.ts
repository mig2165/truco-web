import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { TrucoGameManager } from './gameManager';
import { bugReportManager, BugCategory, BugReport, GameSnapshot } from './bugReport';

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
  socket.on('submitBugReport', (data: { roomId: string; description: string; category: string; screenshotData?: string }, callback?: (report: BugReport) => void) => {
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
      bugReportManager.investigateReport(submitted);
    }

    if (typeof callback === 'function') {
      callback(submitted);
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

httpServer.listen(PORT as number, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});
