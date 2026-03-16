import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSocket() {
    return io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false
    });
}

function waitForConnect(socket) {
    return new Promise((resolve, reject) => {
        const onConnect = () => {
            cleanup();
            resolve();
        };
        const onError = (error) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
        };
        const cleanup = () => {
            socket.off('connect', onConnect);
            socket.off('connect_error', onError);
        };

        socket.on('connect', onConnect);
        socket.on('connect_error', onError);
    });
}

function createRoom(socket, payload) {
    return new Promise((resolve) => {
        socket.emit('createRoom', payload, (roomId) => resolve(roomId));
    });
}

function createStateWatcher(socket, roomId, humanName) {
    let latestState = null;
    let autoPlayEnabled = false;
    let pendingAction = false;

    const scheduleHumanAction = (state) => {
        if (!autoPlayEnabled || pendingAction) return;

        const me = state.players.find((player) => player.id === socket.id);
        if (!me) return;

        let action = null;
        if (state._phase === 'MAO_DE_ONZE_DECISION' && state.maoDeOnzeTeam === me.team) {
            action = () => socket.emit('call', roomId, 'mao_de_onze_play');
        } else if (state._phase === 'WAITING_FOR_HAND_PHASE') {
            if (state.callState.awaitingResponseFromTeam === me.team) {
                // The smoke test prefers the faster branch here so the room completes quickly.
                action = () => socket.emit('call', roomId, 'call_bluff');
            } else if (!state._maoActive && !me.maoBaixaReady) {
                action = () => socket.emit('call', roomId, 'keep_hand');
            }
        } else if (state._phase === 'TRICK_PHASE') {
            if (state.callState.awaitingResponseFromTeam === me.team) {
                action = () => socket.emit('call', roomId, 'accept');
            } else if (state.players[state.currentTurnIndex]?.id === socket.id && me.hand.length > 0 && !state.callState.type) {
                action = () => socket.emit('playCard', roomId, 0);
            }
        }

        if (!action) return;

        pendingAction = true;
        setTimeout(() => {
            pendingAction = false;
            action();
        }, 20);
    };

    socket.on('gameStateUpdate', (state) => {
        latestState = state;
        scheduleHumanAction(state);
    });

    socket.on('error', (message) => {
        console.error(`[${humanName}] socket error: ${message}`);
    });

    return {
        getState: () => latestState,
        setAutoPlayEnabled: (enabled) => {
            autoPlayEnabled = enabled;
            if (enabled && latestState) {
                scheduleHumanAction(latestState);
            }
        }
    };
}

async function waitForState(getState, predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = getState();
        if (state && predicate(state)) {
            return state;
        }
        await delay(50);
    }

    const state = getState();
    throw new Error(`Timed out waiting for ${label}. Last phase: ${state?._phase ?? 'n/a'}, score: ${state ? `${state.points.team1}-${state.points.team2}` : 'n/a'}`);
}

function roomProgressSignature(state) {
    return JSON.stringify({
        phase: state._phase,
        table: state.table.length,
        ready: state.players.map((player) => player.maoBaixaReady),
        hands: state.players.map((player) => player.hand.length),
        call: state.callState.type,
        turn: state.currentTurnIndex
    });
}

async function runDevRoomSmokeTest() {
    const socket = createSocket();
    await waitForConnect(socket);

    const roomId = await createRoom(socket, {
        playerName: 'Smoke Human',
        devMode: true,
        seed: 'smoke-seed'
    });

    assert.ok(roomId, 'Dev room creation should return a room id');

    const watcher = createStateWatcher(socket, roomId, 'Smoke Human');
    socket.emit('joinRoom', roomId, 'Smoke Human', 1);

    const firstPlayingState = await waitForState(
        watcher.getState,
        (state) => state.dev?.enabled && state.players.length === 4 && state.status === 'playing',
        6000,
        'dev room to auto-fill and start'
    );

    assert.equal(firstPlayingState.dev.seed, 'smoke-seed');
    assert.equal(firstPlayingState.players.filter((player) => !player.isBot).length, 1);
    assert.equal(firstPlayingState.players.filter((player) => player.isBot).length, 3);

    socket.emit('debugCommand', roomId, { type: 'pauseBots' });
    const pausedState = await waitForState(
        watcher.getState,
        (state) => state.dev?.botsPaused === true,
        3000,
        'bots to pause'
    );

    const beforeStepSignature = roomProgressSignature(pausedState);
    socket.emit('debugCommand', roomId, { type: 'stepBots' });
    await waitForState(
        watcher.getState,
        (state) => state.dev?.botsPaused === true && roomProgressSignature(state) !== beforeStepSignature,
        4000,
        'single bot step to change room state'
    );

    socket.emit('debugCommand', roomId, { type: 'setScore', score: { team1: 11, team2: 10 } });
    const maoDeOnzeState = await waitForState(
        watcher.getState,
        (state) => state.points.team1 === 11 && state.points.team2 === 10 && state._phase === 'MAO_DE_ONZE_DECISION',
        5000,
        '11-10 score reset to Mao de Onze'
    );
    assert.equal(maoDeOnzeState.maoDeOnzeTeam, 1);

    socket.emit('debugCommand', roomId, { type: 'setScore', score: { team1: 11, team2: 11 } });
    const maoDeFerroState = await waitForState(
        watcher.getState,
        (state) => state.points.team1 === 11 && state.points.team2 === 11 && state.maoDeFerroActive === true,
        5000,
        '11-11 score reset to Mao de Ferro'
    );
    assert.equal(maoDeFerroState._phase, 'TRICK_PHASE');

    socket.emit('debugCommand', roomId, { type: 'setScore', score: { team1: 11, team2: 10 } });
    await waitForState(
        watcher.getState,
        (state) => state.points.team1 === 11 && state.points.team2 === 10 && state.status === 'playing',
        5000,
        'fresh 11-10 round after score reset'
    );

    watcher.setAutoPlayEnabled(true);
    socket.emit('debugCommand', roomId, { type: 'setBotSpeed', speedMs: 150 });
    socket.emit('debugCommand', roomId, { type: 'resumeBots' });

    const finishedState = await waitForState(
        watcher.getState,
        (state) => state.status === 'game_end',
        45000,
        'dev room to finish a full game'
    );

    assert.ok(finishedState.winnerTeam === 1 || finishedState.winnerTeam === 2, 'A finished game should record the winning team');
    socket.disconnect();
}

async function runStandardRoomSmokeTest() {
    const sockets = [createSocket(), createSocket(), createSocket(), createSocket()];
    await Promise.all(sockets.map((socket) => waitForConnect(socket)));

    const roomId = await createRoom(sockets[0], 'Normal One');
    assert.ok(roomId, 'Normal room creation should return a room id');

    const watcher = createStateWatcher(sockets[0], roomId, 'Normal One');
    sockets[0].emit('joinRoom', roomId, 'Normal One', 1);
    sockets[1].emit('joinRoom', roomId, 'Normal Two', 2);
    sockets[2].emit('joinRoom', roomId, 'Normal Three', 1);
    sockets[3].emit('joinRoom', roomId, 'Normal Four', 2);

    const playingState = await waitForState(
        watcher.getState,
        (state) => state.status === 'playing' && state.players.length === 4,
        6000,
        'standard room to auto-start'
    );

    assert.ok(!playingState.dev?.enabled, 'Standard rooms should not expose dev metadata');
    sockets.forEach((socket) => socket.disconnect());
}

async function main() {
    await runDevRoomSmokeTest();
    await runStandardRoomSmokeTest();
    console.log('Dev solo smoke test passed.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
