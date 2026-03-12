import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3001';

async function run() {
    return new Promise((resolve) => {
        let p1 = io(SERVER_URL);
        let p2, p3, p4;
        let roomId;

        p1.on('connect', () => {
            console.log("Connected directly! Creating room.");
            p1.emit('createRoom', 'T1', (resId) => {
                roomId = resId;
                console.log("Room created! Joining bots.");
                p1.emit('joinRoom', roomId, 'T1', 1);

                p2 = io(SERVER_URL); p2.on('connect', () => { p2.emit('joinRoom', roomId, 'T2', 2); });
                p3 = io(SERVER_URL); p3.on('connect', () => { p3.emit('joinRoom', roomId, 'T3', 1); });
                p4 = io(SERVER_URL); p4.on('connect', () => { 
                    p4.emit('joinRoom', roomId, 'T4', 2); 
                    setTimeout(() => {
                        console.log("Starting game...");
                        p1.emit('startGame', roomId);
                    }, 500);
                });

                let phase = null;
                p1.on('gameStateUpdate', (state) => {
                    if (state._phase !== phase) {
                        console.log(`Phase changed to ${state._phase}`);
                        phase = state._phase;
                    }

                    if (state.status === 'playing' && state._phase === 'WAITING_FOR_HAND_PHASE') {
                        // Everyone accept
                        setTimeout(() => {
                            p1.emit('call', roomId, 'keep_hand');
                            p2.emit('call', roomId, 'keep_hand');
                            p3.emit('call', roomId, 'keep_hand');
                            p4.emit('call', roomId, 'keep_hand');
                        }, 500);
                    }

                    if (state.status === 'playing' && state._phase === 'TRICK_PHASE') {
                        let turnSocket = [p1, p2, p3, p4][state.currentTurnIndex];
                        if (state.table.length < 4) {
                            console.log(`Turn ${state.currentTurnIndex}. Table length: ${state.table.length}. Emitting playCard(0) for socket`);
                            turnSocket.emit('playCard', roomId, 0);
                        } else {
                            console.log(`Table is 4 cards! Awaiting timeout resolving the trick...`);
                        }
                    }

                    if (state._phase === 'ROUND_END') {
                        console.log("SUCCESS! ROUND ENDED!");
                        process.exit(0);
                    }
                });
            });
        });

        setTimeout(() => {
            console.log("Test hit fatal 5-second timeout. Trick resolution hung.");
            process.exit(1);
        }, 15000); // 15s to be safe
    });
}
run();
