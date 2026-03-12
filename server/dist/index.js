"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const gameManager_1 = require("./gameManager");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
const PORT = process.env.PORT || 3001;
// Serve React build
const clientBuildPath = path_1.default.join(__dirname, '../../client/dist');
app.use(express_1.default.static(clientBuildPath));
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(clientBuildPath, 'index.html'));
});
// Catch-all for React Router (client-side routes like /room/:id)
app.get('/room/:id', (req, res) => {
    res.sendFile(path_1.default.join(clientBuildPath, 'index.html'));
});
const gameManager = new gameManager_1.TrucoGameManager(io);
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    gameManager.handleConnection(socket);
    // Chat — broadcast to all players in the room
    socket.on('chatMessage', (roomId, msg) => {
        io.to(roomId).emit('chatMessage', { ...msg, timestamp: Date.now() });
    });
});
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on 0.0.0.0:${PORT}`);
});
