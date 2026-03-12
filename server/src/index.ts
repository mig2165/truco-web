import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { TrucoGameManager } from './gameManager';

const app = express();
const PORT = process.env.PORT || 3001;

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(cors());

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

// Catch-all for React Router (client-side routes like /room/:id)
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

const gameManager = new TrucoGameManager(io);

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  gameManager.handleConnection(socket);

  // Chat — broadcast to all players in the room
  socket.on('chatMessage', (roomId: string, msg: { sender: string; message: string; team: number }) => {
    io.to(roomId).emit('chatMessage', { ...msg, timestamp: Date.now() });
  });
});

httpServer.listen(PORT as number, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});
