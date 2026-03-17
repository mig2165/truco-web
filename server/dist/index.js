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
const bugReport_1 = require("./bugReport");
const economy_1 = require("./economy");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const clientBuildPath = path_1.default.join(__dirname, '../../client/dist');
const economyDataPath = path_1.default.resolve(__dirname, '../data/economy.json');
app.set('trust proxy', true);
// Logging middleware keeps local debugging simple on Render and during dev.
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});
app.use((0, cors_1.default)());
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
function createSnapshotForRoom(gameManager, roomId) {
    const gameState = gameManager.getGameState(roomId);
    if (gameState) {
        return bugReport_1.bugReportManager.createSnapshot(gameState);
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
function getRequestBaseUrl(req) {
    if (process.env.PUBLIC_APP_URL) {
        return process.env.PUBLIC_APP_URL.replace(/\/+$/, '');
    }
    const forwardedProtoHeader = req.headers['x-forwarded-proto'];
    const forwardedProto = Array.isArray(forwardedProtoHeader)
        ? forwardedProtoHeader[0]
        : forwardedProtoHeader?.split(',')[0];
    const protocol = forwardedProto?.trim() || req.protocol;
    return `${protocol}://${req.get('host')}`;
}
function findPlayerBySocket(ioServer, socketId) {
    const socket = ioServer.sockets.sockets.get(socketId);
    if (!socket)
        return undefined;
    for (const roomId of socket.rooms) {
        if (roomId === socketId)
            continue;
        const gameState = gameManager.getGameState(roomId);
        if (gameState) {
            const player = gameState.players.find((candidate) => candidate.id === socketId);
            if (player) {
                return { id: player.id, name: player.name };
            }
        }
    }
    return undefined;
}
function sendReactApp(res) {
    res.sendFile(path_1.default.join(clientBuildPath, 'index.html'));
}
let gameManager;
async function bootstrap() {
    const economy = await economy_1.EconomyService.create(economyDataPath, process.env.STRIPE_SECRET_KEY);
    const stripe = economy.getStripeClient();
    const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    // Stripe requires the exact raw request body for webhook signature verification.
    app.post('/api/payments/webhook', express_1.default.raw({ type: 'application/json' }), (req, res) => {
        if (!stripe) {
            res.status(503).json({ error: 'Stripe is not configured on this server.' });
            return;
        }
        try {
            const signature = req.headers['stripe-signature'];
            let event;
            if (stripeWebhookSecret) {
                if (!signature || Array.isArray(signature)) {
                    res.status(400).send('Missing Stripe signature.');
                    return;
                }
                event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
            }
            else {
                event = JSON.parse(req.body.toString('utf8'));
            }
            if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
                const session = event.data.object;
                economy.fulfillCheckoutSession(session);
            }
            res.json({ received: true });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Webhook processing failed.';
            console.error('[StripeWebhookError]', message);
            res.status(400).send(`Webhook Error: ${message}`);
        }
    });
    app.use(express_1.default.json());
    gameManager = new gameManager_1.TrucoGameManager(io, economy);
    app.get('/health', (_req, res) => {
        res.send('OK');
    });
    app.get('/api/economy/catalog', (_req, res) => {
        res.json(economy.getCatalog());
    });
    app.get('/api/economy/profile/:profileId', (req, res) => {
        try {
            const profile = economy.getProfile(req.params.profileId, typeof req.query.displayName === 'string' ? req.query.displayName : undefined);
            res.json({
                catalog: economy.getCatalog(),
                profile
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to load profile.';
            res.status(400).json({ error: message });
        }
    });
    app.post('/api/economy/profile/sync', (req, res) => {
        const { profileId, displayName, receiptEmail } = req.body;
        if (!profileId) {
            res.status(400).json({ error: 'profileId is required.' });
            return;
        }
        try {
            const profile = economy.syncProfile(profileId, displayName, receiptEmail);
            res.json({
                catalog: economy.getCatalog(),
                profile
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to sync profile.';
            res.status(400).json({ error: message });
        }
    });
    app.post('/api/economy/store/open-case', (req, res) => {
        const { profileId, displayName, caseId } = req.body;
        if (!profileId || !caseId) {
            res.status(400).json({ error: 'profileId and caseId are required.' });
            return;
        }
        try {
            const openedCase = economy.openCase(profileId, caseId, displayName);
            res.json({
                openedItem: openedCase.openedItem,
                openedCase: openedCase.openedCase,
                profile: openedCase.profile
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to open case.';
            res.status(400).json({ error: message });
        }
    });
    app.post('/api/economy/store/equip-item', (req, res) => {
        const { profileId, displayName, instanceId } = req.body;
        if (!profileId || !instanceId) {
            res.status(400).json({ error: 'profileId and instanceId are required.' });
            return;
        }
        try {
            const equipResult = economy.equipItem(profileId, instanceId, displayName);
            res.json({
                equippedItem: equipResult.equippedItem,
                profile: equipResult.profile
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to equip cosmetic.';
            res.status(400).json({ error: message });
        }
    });
    app.post('/api/economy/checkout-sessions', async (req, res) => {
        if (!stripe) {
            res.status(503).json({ error: 'Stripe is not configured on this server.' });
            return;
        }
        const { profileId, displayName, packageId, receiptEmail } = req.body;
        if (!profileId || !packageId) {
            res.status(400).json({ error: 'profileId and packageId are required.' });
            return;
        }
        try {
            const { profile, tokenPackage } = economy.createCheckoutRecord(profileId, packageId, displayName);
            const syncedProfile = economy.syncProfile(profile.id, displayName, receiptEmail);
            const baseUrl = getRequestBaseUrl(req);
            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                client_reference_id: profile.id,
                customer_email: syncedProfile.receiptEmail ?? undefined,
                success_url: `${baseUrl}/wallet?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${baseUrl}/wallet?checkout=cancelled`,
                line_items: [
                    {
                        quantity: 1,
                        price_data: {
                            currency: 'eur',
                            unit_amount: tokenPackage.priceEurCents,
                            product_data: {
                                name: `${tokenPackage.tokenAmount} Truco Tokens`,
                                description: tokenPackage.description
                            }
                        }
                    }
                ],
                metadata: {
                    profileId: profile.id,
                    packageId: tokenPackage.id,
                    tokenAmount: String(tokenPackage.tokenAmount)
                }
            });
            if (!session.url) {
                res.status(500).json({ error: 'Stripe did not return a checkout URL.' });
                return;
            }
            economy.recordCreatedCheckoutSession({
                sessionId: session.id,
                profileId: profile.id,
                packageId: tokenPackage.id,
                amountEurCents: tokenPackage.priceEurCents,
                tokenAmount: tokenPackage.tokenAmount
            });
            res.json({
                checkoutUrl: session.url,
                sessionId: session.id
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to create checkout session.';
            res.status(400).json({ error: message });
        }
    });
    app.get('/api/economy/checkout-sessions/:sessionId', async (req, res) => {
        if (!stripe) {
            res.status(503).json({ error: 'Stripe is not configured on this server.' });
            return;
        }
        const checkoutRecord = economy.getCheckoutStatus(req.params.sessionId);
        if (!checkoutRecord) {
            res.status(404).json({ error: 'Checkout session not found.' });
            return;
        }
        try {
            const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
            const maybeFulfilled = session.payment_status === 'paid'
                ? economy.fulfillCheckoutSession(session)
                : null;
            res.json({
                sessionId: session.id,
                paymentStatus: session.payment_status,
                checkoutStatus: economy.getCheckoutStatus(session.id)?.status ?? checkoutRecord.status,
                tokenAmount: checkoutRecord.tokenAmount,
                profile: maybeFulfilled?.profile ?? economy.getProfile(checkoutRecord.profileId),
                customerEmail: session.customer_details?.email ?? null
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to inspect checkout session.';
            res.status(400).json({ error: message });
        }
    });
    // ── REST API Endpoints ─────────────────────────────────────────────────────
    app.post('/api/reports', (req, res) => {
        const { roomId, playerId, playerName, description, category, screenshotData } = req.body;
        if (!roomId || !playerId || !playerName || !description || !category) {
            res.status(400).json({ error: 'Missing required fields: roomId, playerId, playerName, description, category' });
            return;
        }
        const report = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            roomId,
            playerId,
            playerName,
            description,
            category: category,
            screenshotData,
            gameSnapshot: createSnapshotForRoom(gameManager, roomId),
            timestamp: Date.now(),
            status: 'pending',
        };
        const submitted = bugReport_1.bugReportManager.submitReport(report);
        res.json(submitted);
    });
    app.get('/api/reports', (_req, res) => {
        res.json(bugReport_1.bugReportManager.getReports());
    });
    app.get('/api/reports/:id', (req, res) => {
        const report = bugReport_1.bugReportManager.getReport(req.params.id);
        if (!report) {
            res.status(404).json({ error: 'Report not found' });
            return;
        }
        res.json(report);
    });
    app.get('/api/simulations', (_req, res) => {
        res.json(bugReport_1.bugReportManager.getSimulationResults());
    });
    app.post('/api/simulations/run', (_req, res) => {
        const result = bugReport_1.bugReportManager.runRuleSimulation();
        res.json(result);
    });
    app.get('/api/admin/dashboard', (_req, res) => {
        const reports = bugReport_1.bugReportManager.getReports();
        const simulations = bugReport_1.bugReportManager.getSimulationResults();
        const dashboard = {
            totalReports: reports.length,
            invalidReports: reports.filter((report) => report.status === 'invalid').length,
            needsInvestigation: reports.filter((report) => report.status === 'needs_investigation').length,
            confirmedBugs: reports.filter((report) => report.status === 'confirmed').length,
            simulationsPassed: simulations.filter((simulation) => simulation.passed).length,
            simulationsFailed: simulations.filter((simulation) => !simulation.passed).length,
            recentReports: reports.slice(-10),
            recentSimulations: simulations.slice(-10),
        };
        res.json(dashboard);
    });
    app.use(express_1.default.static(clientBuildPath));
    app.get('/', (_req, res) => sendReactApp(res));
    app.get('/room/:id', (_req, res) => sendReactApp(res));
    app.get('/admin', (_req, res) => sendReactApp(res));
    app.get('/store', (_req, res) => sendReactApp(res));
    app.get('/wallet', (_req, res) => sendReactApp(res));
    // ── Socket.io ──────────────────────────────────────────────────────────────
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);
        gameManager.handleConnection(socket);
        gameManager.broadcastLobbySnapshot();
        socket.on('chatMessage', (roomId, msg) => {
            io.to(roomId).emit('chatMessage', { ...msg, timestamp: Date.now() });
        });
        socket.on('submitBugReport', (data, callback) => {
            const player = findPlayerBySocket(io, socket.id);
            const report = {
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                roomId: data.roomId,
                playerId: player?.id ?? socket.id,
                playerName: player?.name ?? 'Unknown',
                description: data.description,
                category: data.category,
                screenshotData: data.screenshotData,
                gameSnapshot: createSnapshotForRoom(gameManager, data.roomId),
                timestamp: Date.now(),
                status: 'pending',
            };
            const submitted = bugReport_1.bugReportManager.submitReport(report);
            if (submitted.validationResult?.isValid) {
                bugReport_1.bugReportManager.investigateReport(submitted);
            }
            if (typeof callback === 'function') {
                callback(submitted);
            }
        });
    });
    // ── Periodic Rule Simulation (every 5 minutes) ────────────────────────────
    setInterval(() => {
        const result = bugReport_1.bugReportManager.runRuleSimulation();
        console.log(`[RuleSimulation] ${result.passed ? 'PASSED' : 'FAILED'} - ${result.violations.length} violation(s)`);
    }, 5 * 60 * 1000);
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`Server listening on 0.0.0.0:${PORT}`);
    });
}
bootstrap().catch((error) => {
    console.error('[BootstrapError]', error);
    process.exit(1);
});
