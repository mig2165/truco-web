import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest(gameIndex: number) {
    return new Promise<void>((resolve, reject) => {
        let p1: Socket, p2: Socket, p3: Socket, p4: Socket;
        let roomId = '';
        let gameEnded = false;
        let currentState: any = null;

        p1 = io(SERVER_URL);
        p1.on('connect', () => {
            // Create room
            p1.emit('createRoom', 'Bot1', (resId: string) => {
                roomId = resId;
                p1.emit('joinRoom', roomId, 'Bot1', 1);

                p2 = io(SERVER_URL);
                p2.on('connect', () => { p2.emit('joinRoom', roomId, 'Bot2', 2); });

                p3 = io(SERVER_URL);
                p3.on('connect', () => { p3.emit('joinRoom', roomId, 'Bot3', 1); });

                p4 = io(SERVER_URL);
                p4.on('connect', () => {
                    p4.emit('joinRoom', roomId, 'Bot4', 2);
                    // once p4 joins, p1 starts game
                    setTimeout(() => { p1.emit('startGame', roomId); }, 500);
                });

                const takeAction = () => {
                    if (gameEnded || !currentState) return;
                    const sockets = [p1, p2, p3, p4];
                    const turnIndex = currentState.currentTurnIndex;
                    const activeBot = sockets[turnIndex];

                    if (!activeBot || currentState.status !== 'playing') return;

                    // if mao de onze
                    if (currentState._phase === 'MAO_DE_ONZE_DECISION') {
                        activeBot.emit('call', roomId, 'mao_de_onze_play');
                        return;
                    }

                    if (currentState.callState?.type) {
                        activeBot.emit('call', roomId, 'accept');
                        return;
                    }

                    if (currentState._phase === 'WAITING_FOR_HAND_PHASE') {
                        const me = currentState.players.find((p: any) => p.id === activeBot.id);
                        if (me && !me.maoBaixaReady) {
                            activeBot.emit('call', roomId, 'keep_hand');
                        }
                        return;
                    }

                    if (currentState._phase === 'TRICK_PHASE') {
                        // Play first card
                        const hand = currentState.players[turnIndex].hand;
                        const validCardIndex = hand.findIndex((c: any) => c !== null);
                        if (validCardIndex !== -1) {
                            activeBot.emit('playCard', roomId, validCardIndex);
                        }
                    }
                };

                const stateHandler = (state: any) => {
                    currentState = state;
                    if (state.status === 'game_end') {
                        if (!gameEnded) {
                            gameEnded = true;
                            console.log(`[Game ${gameIndex}] Finished cleanly! Score: ${state.points.team1} - ${state.points.team2}`);
                            p1.disconnect(); p2.disconnect(); p3.disconnect(); p4.disconnect();
                            resolve();
                        }
                    } else if (state.status === 'playing') {
                        setTimeout(takeAction, 20);
                    }
                };

                p1.on('gameStateUpdate', stateHandler);
                p2.on('gameStateUpdate', stateHandler);
                p3.on('gameStateUpdate', stateHandler);
                p4.on('gameStateUpdate', stateHandler);
            });
        });

        // Safety max timeout
        setTimeout(() => {
            if (!gameEnded) {
                console.log(`[Game ${gameIndex}] TIMEOUT! Game got stuck. Phase: ${currentState?._phase}, CallState: ${currentState?.callState?.type}`);
                gameEnded = true;
                p1?.disconnect(); p2?.disconnect(); p3?.disconnect(); p4?.disconnect();
                reject(new Error("Timeout"));
            }
        }, 15000);
    });
}

async function main() {
    let successes = 0;
    for (let i = 1; i <= 200; i++) {
        try {
            await runTest(i);
            successes++;
        } catch (e: any) {
            console.error(`[Game ${i}] Failed: ${e.message}`);
            break;
        }
    }
    console.log(`\nSimulation complete! ${successes} games ran successfully without crashing/stalling.`);
    process.exit(0);
}

main();
