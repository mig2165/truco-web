import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';

async function runTest(gameIndex) {
    return new Promise((resolve, reject) => {
        let p1, p2, p3, p4;
        let roomId = '';
        let gameEnded = false;
        let currentStates = [null, null, null, null];
        let actionInterval = null;
        let lastPhase = null;

        p1 = io(SERVER_URL);
        p1.on('connect', () => {
            p1.emit('createRoom', 'Bot1', (resId) => {
                roomId = resId;
                p1.emit('joinRoom', roomId, 'Bot1', 1);

                p2 = io(SERVER_URL);
                p2.on('connect', () => { p2.emit('joinRoom', roomId, 'Bot2', 2); });

                p3 = io(SERVER_URL);
                p3.on('connect', () => { p3.emit('joinRoom', roomId, 'Bot3', 1); });

                p4 = io(SERVER_URL);
                p4.on('connect', () => {
                    p4.emit('joinRoom', roomId, 'Bot4', 2);
                    setTimeout(() => { p1.emit('startGame', roomId); }, 500);
                });

                const takeAction = () => {
                    if (gameEnded) return;
                    const sockets = [p1, p2, p3, p4];

                    const globalState = currentStates[0];
                    if (!globalState || globalState.status !== 'playing') return;

                    if (globalState._phase === 'MAO_DE_ONZE_DECISION') {
                        const onzeTeam = globalState.maoDeOnzeTeam;
                        // Find any bot on the 11-point team to accept
                        const onzePlayer = globalState.players.find(p => p.team === onzeTeam);
                        if (onzePlayer) {
                            const activeBot = sockets.find(s => s.id === onzePlayer.id);
                            if (activeBot) activeBot.emit('call', roomId, 'mao_de_onze_play');
                        }
                        return;
                    }

                    if (globalState._phase === 'WAITING_FOR_HAND_PHASE') {
                        sockets.forEach((bot, idx) => {
                            const st = currentStates[idx];
                            if (!st) return;
                            const me = st.players.find(p => p.id === bot.id);
                            if (me && !me.maoBaixaReady) {
                                bot.emit('call', roomId, 'keep_hand');
                            }
                        });
                        return;
                    }

                    const turnIndex = globalState.currentTurnIndex;
                    const turnPlayer = globalState.players[turnIndex];
                    if (!turnPlayer) return;

                    const activeBot = sockets.find(s => s.id === turnPlayer.id);
                    if (!activeBot) return;

                    const botArrayIdx = sockets.indexOf(activeBot);
                    const activeState = currentStates[botArrayIdx];

                    if (!activeState) return;

                    if (activeState.callState && activeState.callState.type) {
                        activeBot.emit('call', roomId, 'accept');
                        return;
                    }

                    if (activeState._phase === 'TRICK_PHASE') {
                        if (activeState.table && activeState.table.length >= 4) return;

                        const myPlayerPayload = activeState.players.find(p => p.id === activeBot.id);
                        const hand = myPlayerPayload ? myPlayerPayload.hand : [];

                        if (hand && hand.length > 0) {
                            console.log(`[Game ${gameIndex}] Bot ${activeBot.id} attempting to play card 0. current Table: ${activeState.table.length}`);
                            activeBot.emit('playCard', roomId, 0);
                        } else {
                            console.log(`[Game ${gameIndex}] Bot ${activeBot.id} (turnIndex=${turnIndex}) has empty hand array but table length is ${activeState.table.length}`);
                        }
                    }
                };

                const createStateHandler = (botIndex) => (state) => {
                    currentStates[botIndex] = state;
                    if (botIndex === 0) {
                        if (state._phase !== lastPhase) {
                            lastPhase = state._phase;
                        }
                        if (state.status === 'game_end') {
                            if (!gameEnded) {
                                gameEnded = true;
                                clearInterval(actionInterval);
                                console.log(`[Game ${gameIndex}] Finished cleanly! Score: ${state.points.team1} - ${state.points.team2}`);
                                p1.disconnect(); p2.disconnect(); p3.disconnect(); p4.disconnect();
                                resolve();
                            }
                        }
                    }
                };

                actionInterval = setInterval(takeAction, 100);

                p1.on('gameStateUpdate', createStateHandler(0));
                p2.on('gameStateUpdate', createStateHandler(1));
                p3.on('gameStateUpdate', createStateHandler(2));
                p4.on('gameStateUpdate', createStateHandler(3));
            });
        });

        setTimeout(() => {
            if (!gameEnded) {
                const gs = currentStates[0];
                console.log(`[Game ${gameIndex}] TIMEOUT! Game got stuck. Phase: ${gs ? gs._phase : 'N/A'}, CallState: ${gs && gs.callState ? gs.callState.type : 'null'}, Table: ${gs && gs.table ? gs.table.length : 0}`);
                gameEnded = true;
                clearInterval(actionInterval);
                if (p1) p1.disconnect();
                if (p2) p2.disconnect();
                if (p3) p3.disconnect();
                if (p4) p4.disconnect();
                reject(new Error("Timeout"));
            }
        }, 300000);
    });
}

async function main() {
    let successes = 0;
    for (let i = 1; i <= 200; i++) {
        try {
            await runTest(i);
            successes++;
        } catch (e) {
            console.error(`[Game ${i}] Failed: ${e.message}`);
            break;
        }
    }
    console.log(`\nSimulation complete! ${successes} games ran successfully without crashing/stalling.`);
    process.exit(0);
}

main();
