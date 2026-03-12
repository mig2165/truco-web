import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';

async function runQaTest(gameIndex, stats) {
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
                        
                        // Occasionally call truco or bluff to trigger UI states? 
                        // Just play perfectly normally so the state validates standard flows.
                        if (hand && hand.length > 0) {
                            activeBot.emit('playCard', roomId, 0);
                        }
                    }
                };

                const createStateHandler = (botIndex) => (state) => {
                    currentStates[botIndex] = state;
                    if (botIndex === 0) {
                        if (state._phase !== lastPhase) {
                            lastPhase = state._phase;
                        }
                        
                        // --- QA VALIDATION HOOKS ---
                        const allCardsSeen = new Set();
                        
                        // 1. Check duplicate cards in hands
                        state.players.forEach(p => {
                            if (p.hand.length > 3) {
                                stats.handSizeErrors++;
                                console.log(`[QA Bug] Player ${p.name} has ${p.hand.length} cards (max should be 3).`);
                            }
                            p.hand.forEach(c => {
                                const cardId = `${c.rank}-${c.suit}`;
                                if (allCardsSeen.has(cardId)) {
                                    stats.duplicateCardsDetected++;
                                    console.log(`[QA Bug] Duplicate card detected in hands: ${cardId}`);
                                } else {
                                    allCardsSeen.add(cardId);
                                }
                            });
                        });
                        
                        // 2. Check table overfilling
                        if (state.table && state.table.length > 4) {
                            stats.tableSizeErrors++;
                            console.log(`[QA Bug] Table has ${state.table.length} cards! Expected <= 4.`);
                        }
                        
                        // 3. Check table cards for duplicates
                        if (state.table) {
                            state.table.forEach(entry => {
                                const c = entry.card;
                                const cardId = `${c.rank}-${c.suit}`;
                                if (allCardsSeen.has(cardId)) {
                                    stats.duplicateCardsDetected++;
                                    console.log(`[QA Bug] Duplicate card detected on table: ${cardId}`);
                                } else {
                                    allCardsSeen.add(cardId);
                                }
                            });
                        }

                        // 4. Check negative scores
                        if (state.points.team1 < 0 || state.points.team2 < 0 || state.points.team1 > 12 || state.points.team2 > 12) {
                            stats.scoreAnomalies++;
                            console.log(`[QA Bug] Invalid score detected: ${state.points.team1} - ${state.points.team2}`);
                        }

                        if (state.status === 'game_end') {
                            if (!gameEnded) {
                                gameEnded = true;
                                clearInterval(actionInterval);
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
                gameEnded = true;
                clearInterval(actionInterval);
                if (p1) p1.disconnect();
                if (p2) p2.disconnect();
                if (p3) p3.disconnect();
                if (p4) p4.disconnect();
                stats.timeouts++;
                resolve(); // resolve instead of reject so loop continues
            }
        }, 300000); // 5 minute timeout per game
    });
}

async function main() {
    let stats = {
        gamesPlayed: 0,
        timeouts: 0,
        duplicateCardsDetected: 0,
        handSizeErrors: 0,
        tableSizeErrors: 0,
        scoreAnomalies: 0,
    };

    console.log("Starting QA Test Suite for 30 Concurrent Games...");
    
    const promises = [];
    for (let i = 1; i <= 30; i++) {
        promises.push(
            runQaTest(i, stats).then(() => {
                stats.gamesPlayed++;
                console.log(`[Game ${i}] Done.`);
            })
        );
    }
    
    await Promise.all(promises);
    
    console.log("\n=== QA REPORT ===");
    console.log(`Total Games Simulated: ${stats.gamesPlayed}`);
    console.log(`Timeouts (Stalls): ${stats.timeouts}`);
    console.log(`Duplicate Cards Detected: ${stats.duplicateCardsDetected}`);
    console.log(`Hand Size Anomalies: ${stats.handSizeErrors}`);
    console.log(`Table Size Anomalies: ${stats.tableSizeErrors}`);
    console.log(`Score Anomalies: ${stats.scoreAnomalies}`);
    
    process.exit(0);
}

main();
