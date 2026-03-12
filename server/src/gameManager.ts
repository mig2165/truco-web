import { Server, Socket } from 'socket.io';
import { GameState, Card, createDeck, shuffleDeck, getManilhaRank, setManilhas, compareCards, Player } from './gameLogic';

export class TrucoGameManager {
    private rooms: Map<string, GameState> = new Map();
    private io: Server;

    constructor(io: Server) {
        this.io = io;
    }

    public handleConnection(socket: Socket) {
        socket.on('createRoom', (playerName: string, callback: (roomId: string) => void) => {
            const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
            callback(roomId);
        });
        socket.on('joinRoom', (roomId: string, playerName: string, chosenTeam: 1 | 2) => this.joinRoom(socket, roomId, playerName, chosenTeam));
        socket.on('playCard', (roomId: string, cardIndex: number) => this.handlePlayCard(socket, roomId, cardIndex));
        socket.on('call', (roomId: string, callType: string) => this.handleCall(socket, roomId, callType));
    }

    private addNotification(state: GameState, message: string, team: number) {
        // Ephemeral: clear old notifications before adding new one
        state.notifications = [{ id: Math.random().toString(36).substring(7), message, team }];
    }

    private joinRoom(socket: Socket, roomId: string, playerName: string, chosenTeam: 1 | 2) {
        let state = this.rooms.get(roomId);
        if (!state) {
            state = {
                roomId,
                players: [],
                deck: [],
                vira: null,
                manilhaRank: null,
                currentTurnIndex: 0,
                points: { team1: 0, team2: 0 },
                roundPoints: 1,
                tricks: { team1: 0, team2: 0 },
                table: [],
                startingPlayerIndex: 0,
                status: 'waiting',
                callState: { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null },
                lastTrickWinner: null,
                lastTrickWinnerName: null,
                notifications: [],
                _phase: 'WAITING_FOR_HAND_PHASE',
                _maoActive: false
            };
            this.rooms.set(roomId, state);
        }

        if (state.players.find(p => p.id === socket.id)) {
            this.emitState(state);
            return;
        }

        if (state.players.length >= 4) return;

        let team = chosenTeam;
        const team1Count = state.players.filter(p => p.team === 1).length;
        const team2Count = state.players.filter(p => p.team === 2).length;

        if (chosenTeam === 1 && team1Count >= 2) team = 2;
        if (chosenTeam === 2 && team2Count >= 2) team = 1;

        state.players.push({
            id: socket.id,
            name: playerName,
            hand: [],
            team,
            exposedHand: false,
            maoBaixaReady: false
        });

        socket.join(roomId);

        if (state.players.length === 4) {
            this.startGame(roomId);
        } else {
            this.emitState(state);
        }
    }

    private startGame(roomId: string) {
        const state = this.rooms.get(roomId);
        if (!state || state.players.length !== 4) return;

        // Seating enforcement: 0 -> T1, 1 -> T2, 2 -> T1, 3 -> T2
        const t1 = state.players.filter(p => p.team === 1);
        const t2 = state.players.filter(p => p.team === 2);

        state.players = [t1[0]!, t2[0]!, t1[1]!, t2[1]!];
        state.startingPlayerIndex = 0;
        state.points = { team1: 0, team2: 0 };

        this.startNewRound(state);
    }

    private startNewRound(state: GameState) {
        // Guard: if score already past 11 (e.g. from +3 Mão de Onze), end game
        if (state.points.team1 > 11 || state.points.team2 > 11) {
            state.status = 'game_end';
            this.emitState(state);
            return;
        }

        state.deck = shuffleDeck(createDeck());
        state.vira = state.deck.pop()!;
        state.manilhaRank = getManilhaRank(state.vira.rank);

        for (const player of state.players) {
            player.hand = [state.deck.pop()!, state.deck.pop()!, state.deck.pop()!];
            player.hand = setManilhas(player.hand, state.manilhaRank);
            player.exposedHand = false;
            player.maoBaixaReady = false;
        }

        state.table = [];
        state.tricks = { team1: 0, team2: 0 };
        state.roundPoints = 1;
        state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };
        state.lastTrickWinner = null;
        state.lastTrickWinnerName = null;
        state.status = 'playing';

        // Reset special modes
        state._maoActive = false;
        state._maoType = undefined;
        state._maoCallerId = undefined;
        state.maoDeOnzeActive = false;
        state.maoDeOnzeTeam = null;
        state.maoDeFerroActive = false;

        state.currentTurnIndex = state.startingPlayerIndex;
        state.notifications = [];

        // Check for Mão de Ferro (11-11)
        if (state.points.team1 === 11 && state.points.team2 === 11) {
            state._phase = 'MAO_DE_FERRO';
            state.maoDeFerroActive = true;
            // Skip straight to trick phase — no calls, no hand choosing, blind play
            for (const p of state.players) p.maoBaixaReady = true;
            state._phase = 'TRICK_PHASE';
            this.addNotification(state, '🔥 MÃO DE FERRO! All cards hidden. Winner takes the game!', 0);
            this.emitState(state);
            return;
        }

        // Check for Mão de Onze (exactly one team at 11)
        const team1Has11 = state.points.team1 === 11;
        const team2Has11 = state.points.team2 === 11;
        if (team1Has11 || team2Has11) {
            const onzeTeam = team1Has11 ? 1 : 2;
            state._phase = 'MAO_DE_ONZE_DECISION';
            state.maoDeOnzeTeam = onzeTeam;
            this.addNotification(state, `⚡ MÃO DE ONZE! Team ${onzeTeam} must decide: Play or Run!`, onzeTeam);
            this.emitState(state);
            return;
        }

        // Normal round
        state._phase = 'WAITING_FOR_HAND_PHASE';
        this.emitState(state);
    }

    private handleCall(socket: Socket, roomId: string, callType: string) {
        const state = this.rooms.get(roomId);
        if (!state || state.status !== 'playing') return;

        const playerIndex = state.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) return;
        const player = state.players[playerIndex]!;

        // ── Mão de Onze Decision Phase ──
        if (state._phase === 'MAO_DE_ONZE_DECISION') {
            // Only the 11-point team can decide
            if (player.team !== state.maoDeOnzeTeam) return;

            if (callType === 'mao_de_onze_run') {
                // RUN: opponents get +1 point, round ends
                const opponentTeam = state.maoDeOnzeTeam === 1 ? 2 : 1;
                this.addNotification(state, `Team ${state.maoDeOnzeTeam} runs from Mão de Onze!`, player.team);
                state.maoDeOnzeTeam = null;
                // Award 1 point directly (not roundPoints)
                this.awardPoints(state, opponentTeam, 1);
                state.status = 'round_end';
                state._phase = 'ROUND_END';
                this.emitState(state);
                setTimeout(() => {
                    // Always proceed to next round — startNewRound will detect
                    // if Mão de Onze or Mão de Ferro should trigger again
                    const winnerIdx = state.players.findIndex(p => p.team === opponentTeam);
                    state.startingPlayerIndex = winnerIdx >= 0 ? winnerIdx : (state.startingPlayerIndex + 1) % 4;
                    this.startNewRound(state);
                }, 3000);
                return;
            }

            if (callType === 'mao_de_onze_play') {
                // PLAY: proceed with the hand, 3 pts to opponent on loss
                state.maoDeOnzeActive = true;
                this.addNotification(state, `Team ${state.maoDeOnzeTeam} accepts Mão de Onze!`, player.team);
                // Transition normally into the hand phase so players can keep/call Mao/Baixa
                state._phase = 'WAITING_FOR_HAND_PHASE';
                this.emitState(state);
                return;
            }

            return; // Ignore other calls during this phase
        }

        if (state._phase === 'WAITING_FOR_HAND_PHASE') {

            // Block Mão/Baixa/Real calls during Mão de Ferro
            if (state.maoDeFerroActive) {
                if (['mao_baixa', 'mao_real'].includes(callType)) return;
            }

            if (state._maoActive) {
                const callerIndex = state.players.findIndex(p => p.id === state._maoCallerId);
                const caller = state.players[callerIndex]!;
                if (caller.team === player.team) return; // Only opponents respond

                if (callType === 'call_bluff') {
                    this.addNotification(state, `${player.name} challenges the call! Revealing hand...`, player.team);

                    // --- REVEAL PHASE ---
                    caller.exposedHand = true;
                    state._phase = 'MAO_REVEAL'; // Block all other calls during the delay
                    this.emitState(state);

                    setTimeout(() => {
                        const isTruth = this.evaluateMaoTruth(caller, state._maoType!);

                        if (isTruth) {
                            this.addNotification(state, `Call was TRUE! Team ${caller.team} gets 1 point.`, caller.team);

                            // Scenario A: True call + called out → caller's team +1, switch hands, re-choose
                            this.awardPoints(state, caller.team, 1);
                            if (state.points.team1 >= 11 || state.points.team2 >= 11) {
                                state.status = 'round_end';
                                state._phase = 'ROUND_END';
                                state._maoActive = false;
                                this.emitState(state);
                                setTimeout(() => {
                                    state.startingPlayerIndex = callerIndex;
                                    this.startNewRound(state);
                                }, 3000);
                                return;
                            }

                            if (state.deck.length >= 3) {
                                caller.hand = setManilhas([state.deck.pop()!, state.deck.pop()!, state.deck.pop()!], state.manilhaRank!);
                                caller.maoBaixaReady = false; // Re-choose with new cards
                            } else {
                                caller.maoBaixaReady = true; // No cards to switch, mark as done
                            }
                            // Hide the new hand again
                            caller.exposedHand = false;

                            state.currentTurnIndex = callerIndex;
                            state.startingPlayerIndex = callerIndex; // Caller starts next

                            // Caller gets to choose again with new cards (or stays ready if deck empty)
                            state._maoActive = false;
                            state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };

                            state._phase = 'WAITING_FOR_HAND_PHASE';
                            if (state.players.every(p => p.maoBaixaReady)) {
                                state._phase = 'TRICK_PHASE';
                            }

                            state.notifications = [];
                            this.emitState(state);
                            return;

                        } else {
                            this.addNotification(state, `Call was FALSE! Team ${player.team} gets 1 point.`, player.team);

                            // Scenario B: Bluff + called out → opposing team +1, hand remains revealed
                            this.awardPoints(state, player.team, 1);
                            if (state.points.team1 >= 11 || state.points.team2 >= 11) {
                                state.status = 'round_end';
                                state._phase = 'ROUND_END';
                                state._maoActive = false;
                                this.emitState(state);
                                setTimeout(() => {
                                    state.startingPlayerIndex = playerIndex;
                                    this.startNewRound(state);
                                }, 3000);
                                return;
                            }

                            // Hand remains exposed (caller.exposedHand is already true from the reveal phase)
                            // Caller does NOT switch cards
                            state.currentTurnIndex = playerIndex;
                            state.startingPlayerIndex = playerIndex; // Challenger starts next

                            state._maoActive = false;
                            caller.maoBaixaReady = true; // Bluff caught, caller choice is forced to 'keep'
                            state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };

                            state._phase = 'WAITING_FOR_HAND_PHASE';
                            if (state.players.every(p => p.maoBaixaReady)) {
                                state._phase = 'TRICK_PHASE';
                            }

                            state.notifications = [];
                            this.emitState(state);
                            return;
                        }
                    }, 3000);
                    return; // Return immediately to block standard emitState until setTimeout fires
                } else if (callType === 'accept') {
                    // Scenarios C & D: Switch allowed → NO points awarded regardless of truth
                    this.addNotification(state, `${player.name} allows the switch!`, player.team);
                    if (state.deck.length >= 3) {
                        caller.hand = setManilhas([state.deck.pop()!, state.deck.pop()!, state.deck.pop()!], state.manilhaRank!);
                        caller.maoBaixaReady = false; // Re-choose with new cards
                    } else {
                        caller.maoBaixaReady = true; // No cards to switch, mark as done
                    }
                    caller.exposedHand = false;
                    state.currentTurnIndex = callerIndex;
                    state.startingPlayerIndex = callerIndex; // Caller starts next

                    // Stay in WAITING_FOR_HAND_PHASE (or advance if all ready)
                    state._maoActive = false;
                    state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };
                    if (state.players.every(p => p.maoBaixaReady)) {
                        state._phase = 'TRICK_PHASE';
                    }
                    state.notifications = [];
                    this.emitState(state);
                    return;
                } else {
                    return; // Unknown action while mao is active
                }
            }

            if (callType === 'keep_hand' || callType === 'keep') {
                // Ignore if Mão is pending from another player, or if player already chose
                if (state._maoActive) return;
                if (player.maoBaixaReady) return;

                player.maoBaixaReady = true;
                this.addNotification(state, `${player.name} keeps hand`, player.team);

                if (state.players.every(p => p.maoBaixaReady)) {
                    state._phase = 'TRICK_PHASE';
                }
                this.emitState(state);
                return;
            }

            if (callType === 'mao_baixa' || callType === 'mao_real') {
                if (player.maoBaixaReady) return; // Already made their choice
                const friendlyName = callType === 'mao_baixa' ? 'Mão Baixa' : 'Mão Real';
                this.addNotification(state, `${player.name} calls ${friendlyName}!`, player.team);
                player.maoBaixaReady = true; // They've made their choice
                state._maoActive = true;
                state._maoCallerId = player.id;
                state._maoType = callType;

                // Keep front-end in sync
                state.callState = {
                    type: callType,
                    callingTeam: player.team,
                    awaitingResponseFromTeam: player.team === 1 ? 2 : 1,
                    lastCallTeam: player.team
                };

                this.emitState(state);
                return;
            }
        }

        if (state._phase === 'TRICK_PHASE') {
            // Block ALL escalation calls during Mão de Onze and Mão de Ferro
            if (state.maoDeOnzeActive || state.maoDeFerroActive) {
                if (['truco', 'double', 'triple', 'mao_baixa', 'mao_real'].includes(callType)) return;
            }

            if (['truco', 'double', 'triple'].includes(callType)) {
                // Not allowed in hacky Trick 1 scenario if tricks = 0, but relying on phase is better
                const totalTricks = state.tricks.team1 + state.tricks.team2;
                if (totalTricks === 0 && callType === 'truco') return;

                if (state.callState.lastCallTeam === player.team) {
                    return; // Cannot raise own call
                }

                if ((callType === 'truco' && state.roundPoints === 1) ||
                    (callType === 'double' && state.roundPoints === 3) ||
                    (callType === 'triple' && state.roundPoints === 6)) {

                    let callName = 'TRUCO';
                    if (callType === 'double') callName = 'DOUBLE TRUCO';
                    if (callType === 'triple') callName = 'TRIPLE TRUCO';

                    this.addNotification(state, `${player.name} calls ${callName}!`, player.team);

                    state.callState = {
                        type: callType as any,
                        callingTeam: player.team,
                        awaitingResponseFromTeam: player.team === 1 ? 2 : 1,
                        lastCallTeam: player.team
                    };
                    this.emitState(state);
                }
                return;
            }

            if (state.callState.awaitingResponseFromTeam === player.team) {
                if (callType === 'accept') {
                    this.addNotification(state, `${player.name} accepts!`, player.team);
                    if (state.callState.type === 'truco') state.roundPoints = 3;
                    if (state.callState.type === 'double') state.roundPoints = 6;
                    if (state.callState.type === 'triple') state.roundPoints = 9;

                    // Preserve lastCallTeam so only the opposing team can escalate
                    const preservedLastCallTeam = state.callState.lastCallTeam;
                    state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: preservedLastCallTeam };
                    this.emitState(state);

                } else if (callType === 'decline' || callType === 'fold') {
                    const callingTeam = state.callState.callingTeam!;
                    this.addNotification(state, `${player.name} folds`, player.team);
                    state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };
                    this.endRound(state, callingTeam);
                }
            }
        }
    }

    private handlePlayCard(socket: Socket, roomId: string, cardIndex: number) {
        const state = this.rooms.get(roomId);
        if (!state) { console.log(`[handlePlayCard] FAILED: No state`); return; }
        if (state.status !== 'playing') { console.log(`[handlePlayCard] FAILED: Not playing`); return; }
        if (state._phase !== 'TRICK_PHASE') { console.log(`[handlePlayCard] FAILED: Not TRICK_PHASE`); return; }

        const playerIndex = state.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) { console.log(`[handlePlayCard] FAILED: Invalid playerIndex`); return; }
        if (playerIndex !== state.currentTurnIndex) { console.log(`[handlePlayCard] FAILED: Turn mismatch. Expected ${state.currentTurnIndex}, got ${playerIndex}`); return; }

        if (state.table.length >= 4) { console.log(`[handlePlayCard] FAILED: Table full`); return; }
        if (state.callState.awaitingResponseFromTeam !== null) { console.log(`[handlePlayCard] FAILED: Awaiting response`); return; }

        const player = state.players[playerIndex]!;
        if (!player) { console.log(`[handlePlayCard] FAILED: Player missing`); return; }
        if (cardIndex < 0 || cardIndex >= player.hand.length) { console.log(`[handlePlayCard] FAILED: Invalid cardIndex ${cardIndex} for hand length ${player.hand.length}`); return; }

        console.log(`[handlePlayCard] SUCCESS: Player ${playerIndex} played card ${cardIndex}`);
        const card = player.hand.splice(cardIndex, 1)[0]!;
        state.table.push({ playerIndex, card: { ...card } });

        if (state.table.length < 4) {
            state.currentTurnIndex = (state.currentTurnIndex + 1) % 4;
            this.emitState(state);
        } else {
            this.evaluateTrick(state);
        }
    }

    private evaluateTrick(state: GameState) {
        let winningEntryIndex = 0;
        for (let i = 1; i < 4; i++) {
            const currentCard = state.table[i]!.card;
            const winningCard = state.table[winningEntryIndex]!.card;
            if (compareCards(currentCard, winningCard) > 0) {
                winningEntryIndex = i;
            }
        }

        const winningEntry = state.table[winningEntryIndex]!;
        const winningPlayerIndex = winningEntry.playerIndex;
        const winningTeam = state.players[winningPlayerIndex]!.team;
        const winningPlayerName = state.players[winningPlayerIndex]!.name;

        // Simplified tie resolution: if tied, original leader starts next.
        const allTied = state.table.every(e => compareCards(e.card, state.table[0]!.card) === 0);
        const winnerTeamFinal: number | null = allTied ? null : winningTeam;

        if (winnerTeamFinal === 1) state.tricks.team1++;
        if (winnerTeamFinal === 2) state.tricks.team2++;

        state.lastTrickWinner = winnerTeamFinal;
        state.lastTrickWinnerName = winnerTeamFinal ? winningPlayerName : null;

        const tricksPlayed = 3 - state.players[0]!.hand.length;

        if (winnerTeamFinal) {
            this.addNotification(state, `${winningPlayerName} won the trick!`, winningTeam);
        } else {
            this.addNotification(state, `Tied trick!`, 0);
        }

        this.emitState(state);

        const roundWinner = state.tricks.team1 > state.tricks.team2 ? 1 : state.tricks.team2 > state.tricks.team1 ? 2 : null;

        if (state.tricks.team1 >= 2 || state.tricks.team2 >= 2 || tricksPlayed >= 3) {
            setTimeout(() => {
                // Final determination: Most tricks wins; tie = team that won trick 1, fallback to callerTeam
                this.endRound(state, roundWinner ?? (state.startingPlayerIndex % 2 === 0 ? 1 : 2));
            }, 2500);
        } else {
            setTimeout(() => {
                state.table = [];
                state.notifications = [];
                // Use -1 instead of null to signal 'no result yet' without triggering frontend tie display
                state.lastTrickWinner = -1 as any;
                state.lastTrickWinnerName = null;
                state.currentTurnIndex = winnerTeamFinal ? winningPlayerIndex : state._trickLeaderIndex || state.startingPlayerIndex;
                state._trickLeaderIndex = state.currentTurnIndex;
                this.emitState(state);
            }, 2500);
        }
    }

    private evaluateMaoTruth(player: Player, type: 'mao_baixa' | 'mao_real'): boolean {
        if (type === 'mao_real') {
            return player.hand.every(c => ['A', 'K', 'J', 'Q'].includes(c.rank));
        } else {
            return player.hand.every(c => ['2', '3', '4', '5', '6', '7'].includes(c.rank));
        }
    }

    private awardPoints(state: GameState, team: number, amount: number) {
        if (team === 1) {
            state.points.team1 = Math.min(state.points.team1 + amount, 11);
        } else if (team === 2) {
            state.points.team2 = Math.min(state.points.team2 + amount, 11);
        }
    }

    private endRound(state: GameState, winningTeam: number) {
        // Mão de Ferro: winner wins the game immediately
        if (state.maoDeFerroActive) {
            this.addNotification(state, `🏆 Team ${winningTeam} wins MÃO DE FERRO and the GAME!`, winningTeam);
            state.maoDeFerroActive = false;
            // Set winning team to >= 12 to trigger game_end
            if (winningTeam === 1) state.points.team1 = 12;
            if (winningTeam === 2) state.points.team2 = 12;
            state.status = 'round_end';
            state._phase = 'ROUND_END';
            this.emitState(state);
            setTimeout(() => {
                state.status = 'game_end';
                this.emitState(state);
            }, 3000);
            return;
        }

        // Mão de Onze: special scoring
        if (state.maoDeOnzeActive) {
            if (winningTeam === state.maoDeOnzeTeam) {
                // 11-point team wins → they win the game immediately
                if (winningTeam === 1) state.points.team1 = 12;
                if (winningTeam === 2) state.points.team2 = 12;
                state.maoDeOnzeActive = false;
                state.maoDeOnzeTeam = null;
                state.status = 'round_end';
                state._phase = 'ROUND_END';
                this.emitState(state);
                setTimeout(() => {
                    state.status = 'game_end';
                    this.emitState(state);
                }, 3000);
                return;
            } else {
                // Opponents win → they get 3 points
                this.awardPoints(state, winningTeam, 3);
                state.maoDeOnzeActive = false;
                state.maoDeOnzeTeam = null;
                state.status = 'round_end';
                state._phase = 'ROUND_END';
                this.emitState(state);
                setTimeout(() => {
                    // Delegate to startNewRound — it detects 11-11 (Mão de Ferro) or >= 12 (game_end)
                    const winnerIdx = state.players.findIndex(p => p.team === winningTeam);
                    state.startingPlayerIndex = winnerIdx >= 0 ? winnerIdx : (state.startingPlayerIndex + 1) % 4;
                    this.startNewRound(state);
                }, 3000);
                return;
            }
        }

        // Normal round scoring
        this.awardPoints(state, winningTeam, state.roundPoints);

        state.status = 'round_end';
        state._phase = 'ROUND_END';
        this.emitState(state);

        setTimeout(() => {
            // Delegate to startNewRound — it detects 11-11 (Mão de Ferro) or >= 12 (game_end)
            // or exactly 11 (Mão de Onze)
            const winnerIdx = state.players.findIndex(p => p.team === winningTeam);
            state.startingPlayerIndex = winnerIdx >= 0 ? winnerIdx : (state.startingPlayerIndex + 1) % 4;
            this.startNewRound(state);
        }, 3000);
    }

    private emitState(state: GameState) {
        for (const player of state.players) {
            const privateState = {
                ...state,
                players: state.players.map(p => {
                    // Mão de Ferro: hide ALL cards from ALL players
                    if (state.maoDeFerroActive) {
                        return { ...p, hand: p.hand.map(() => ({ suit: 'hidden' as any, rank: '?' as any, value: 0, isManilha: false, manilhaValue: 0 })) };
                    }
                    // Mão de Onze decision: teammates on 11-point team can see each other's cards
                    if (state.maoDeOnzeTeam && player.team === state.maoDeOnzeTeam && p.team === state.maoDeOnzeTeam) {
                        return { ...p, hand: p.hand }; // Teammate sees cards
                    }
                    // Normal visibility
                    return {
                        ...p,
                        hand: (p.id === player.id || p.exposedHand) ? p.hand : []
                    };
                })
            };
            this.io.to(player.id).emit('gameStateUpdate', privateState);
        }
    }
}
