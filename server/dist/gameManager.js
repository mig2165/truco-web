"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrucoGameManager = void 0;
const gameLogic_1 = require("./gameLogic");
const bugReport_1 = require("./bugReport");
const economy_1 = require("./economy");
const BOT_NAMES = ['Dev Bot East', 'Dev Bot North', 'Dev Bot West'];
const DEFAULT_BOT_SPEED_MS = 600;
const MAX_DEV_LOG_ENTRIES = 30;
const ENDGAME_ENTRY_SCORE = 11;
const GAME_WIN_SCORE = 12;
const DEFAULT_SECRET_DEBUG_CODE = 'truco-local-debug';
class TrucoGameManager {
    rooms = new Map();
    io;
    botTimers = new Map();
    roomTasks = new Map();
    roomRngs = new Map();
    secretDebugPlayers = new Map();
    devRoomsEnabled;
    secretDebugEnabled;
    secretDebugCode;
    economy;
    constructor(io, economy) {
        this.io = io;
        this.economy = economy;
        this.devRoomsEnabled = process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEV_ROOMS === 'true';
        // The code stays server-only and the entire feature hard-disables in production.
        this.secretDebugEnabled = process.env.NODE_ENV !== 'production';
        this.secretDebugCode = process.env.SECRET_DEBUG_CODE?.trim() || DEFAULT_SECRET_DEBUG_CODE;
    }
    getGameState(roomId) {
        return this.rooms.get(roomId);
    }
    handleConnection(socket) {
        socket.on('createRoom', (payload, callback) => {
            this.createRoom(socket, payload, callback);
        });
        socket.on('getLobbySnapshot', () => this.sendLobbySnapshot(socket));
        socket.on('getRoomPreview', (roomId) => this.sendRoomPreview(socket, roomId));
        socket.on('joinRoom', (roomIdOrPayload, playerName, chosenTeam, profileId) => {
            try {
                this.joinRoom(socket, roomIdOrPayload, playerName, chosenTeam, profileId);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to join room.';
                socket.emit('error', message);
            }
        });
        socket.on('leaveRoom', (roomId) => this.leaveRoom(socket, roomId));
        socket.on('startRematch', (roomId) => this.startRematch(socket, roomId));
        socket.on('playCard', (roomId, cardIndex) => this.handlePlayCard(socket, roomId, cardIndex));
        socket.on('call', (roomId, callType) => this.handleCall(socket, roomId, callType));
        socket.on('activateSecretDebug', (roomId, secretCode) => this.activateSecretDebug(socket, roomId, secretCode));
        socket.on('debugCommand', (roomId, command) => this.handleDebugCommand(socket, roomId, command));
        socket.on('debugSetScore', (roomId, score) => {
            this.handleDebugCommand(socket, roomId, { type: 'setScore', score });
        });
        socket.on('disconnect', () => this.handleDisconnect(socket));
        // Prime newly connected clients with the current room list and presence counters.
        this.sendLobbySnapshot(socket);
    }
    broadcastLobbySnapshot() {
        this.io.emit('lobbySnapshot', this.buildLobbySnapshot());
    }
    createRoom(socket, payload, callback) {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const normalized = this.normalizeCreateRoomPayload(payload);
        if (normalized.devMode && !this.devRoomsEnabled) {
            socket.emit('error', 'Dev solo mode is disabled on this server.');
            callback('');
            return;
        }
        const state = this.createEmptyState(roomId, normalized.devMode ? this.normalizeSeed(normalized.seed) : undefined);
        state.hostPlayerId = socket.id;
        state.hostPlayerName = normalized.playerName;
        this.rooms.set(roomId, state);
        // Profile identity is created before the player actually joins so the room preview
        // already reflects the host's current cosmetic loadout.
        this.economy.syncProfile(normalized.profileId ?? socket.id, normalized.playerName);
        if (state.dev?.enabled) {
            this.roomRngs.set(roomId, this.createSeededRng(state.dev.seed));
            this.appendDevLog(state, `Reserved dev room for ${normalized.playerName || 'player'} (seed: ${state.dev.seed}).`);
        }
        callback(roomId);
        this.broadcastLobbySnapshot();
    }
    normalizeCreateRoomPayload(payload) {
        if (typeof payload === 'string') {
            return {
                playerName: payload,
                devMode: false,
                seed: undefined
            };
        }
        return {
            playerName: payload.playerName ?? 'Player',
            devMode: Boolean(payload.devMode),
            seed: payload.seed?.trim(),
            profileId: payload.profileId?.trim()
        };
    }
    normalizeJoinRoomPayload(roomIdOrPayload, playerName, chosenTeam, profileId) {
        if (typeof roomIdOrPayload === 'string') {
            if (!playerName || !chosenTeam) {
                throw new Error('Missing join payload.');
            }
            return {
                roomId: roomIdOrPayload,
                playerName,
                chosenTeam,
                profileId
            };
        }
        return {
            roomId: roomIdOrPayload.roomId,
            playerName: roomIdOrPayload.playerName,
            chosenTeam: 'chosenTeam' in roomIdOrPayload ? roomIdOrPayload.chosenTeam : roomIdOrPayload.team,
            profileId: roomIdOrPayload.profileId
        };
    }
    createEmptyState(roomId, devSeed) {
        return {
            roomId,
            hostPlayerId: null,
            hostPlayerName: null,
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
            winnerTeam: null,
            callState: { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null },
            lastTrickWinner: null,
            lastTrickWinnerName: null,
            notifications: [],
            _phase: 'WAITING_FOR_HAND_PHASE',
            _maoActive: false,
            _matchRewardGranted: false,
            dev: devSeed
                ? {
                    enabled: true,
                    seed: devSeed,
                    botsPaused: false,
                    botSpeedMs: DEFAULT_BOT_SPEED_MS,
                    log: []
                }
                : undefined
        };
    }
    createBotPlayer(roomId, seatIndex, team) {
        return {
            id: `bot:${roomId}:${seatIndex}`,
            name: BOT_NAMES[seatIndex - 1] ?? `Dev Bot ${seatIndex}`,
            hand: [],
            team,
            isBot: true,
            hat: this.economy.getEquippedHat(),
            exposedHand: false,
            maoBaixaReady: false
        };
    }
    addNotification(state, message, team) {
        // Notifications are ephemeral UI hints, but we mirror them into the dev log.
        state.notifications = [{ id: Math.random().toString(36).substring(2, 9), message, team }];
        bugReport_1.bugReportManager.logGameEvent(state.roomId, message);
        this.appendDevLog(state, message);
    }
    appendDevLog(state, message) {
        if (!state.dev?.enabled)
            return;
        const stamp = new Date().toISOString().slice(11, 19);
        state.dev.log = [...state.dev.log.slice(-(MAX_DEV_LOG_ENTRIES - 1)), `[${stamp}] ${message}`];
    }
    joinRoom(socket, roomIdOrPayload, playerName, chosenTeam, profileId) {
        const normalizedJoin = this.normalizeJoinRoomPayload(roomIdOrPayload, playerName, chosenTeam, profileId);
        const roomId = normalizedJoin.roomId;
        let state = this.rooms.get(roomId);
        if (!state) {
            state = this.createEmptyState(roomId);
            this.rooms.set(roomId, state);
        }
        if (state.players.find((player) => player.id === socket.id)) {
            this.emitState(state);
            return;
        }
        if (state.dev?.enabled) {
            this.joinDevRoom(state, socket, normalizedJoin.playerName, normalizedJoin.profileId);
            return;
        }
        if (state.players.length >= 4) {
            socket.emit('error', 'Game full!');
            return;
        }
        const team1Count = state.players.filter((player) => player.team === 1).length;
        const team2Count = state.players.filter((player) => player.team === 2).length;
        // Keep team selection explicit so the UI can behave like a true seat picker.
        if (normalizedJoin.chosenTeam === 1 && team1Count >= 2) {
            socket.emit('error', 'Team 1 is full.');
            return;
        }
        if (normalizedJoin.chosenTeam === 2 && team2Count >= 2) {
            socket.emit('error', 'Team 2 is full.');
            return;
        }
        // Joining a fresh room code should still establish a host for later rematches.
        if (!state.hostPlayerId) {
            state.hostPlayerId = socket.id;
            state.hostPlayerName = normalizedJoin.playerName;
        }
        state.players.push({
            id: socket.id,
            profileId: normalizedJoin.profileId,
            name: normalizedJoin.playerName,
            hand: [],
            team: normalizedJoin.chosenTeam,
            isBot: false,
            hat: this.economy.getEquippedHat(normalizedJoin.profileId, normalizedJoin.playerName),
            exposedHand: false,
            maoBaixaReady: false
        });
        // Keep the creator as the room host while refreshing the label clients can show.
        if (state.hostPlayerId === socket.id) {
            state.hostPlayerName = normalizedJoin.playerName;
        }
        this.economy.syncProfile(normalizedJoin.profileId ?? socket.id, normalizedJoin.playerName);
        socket.join(roomId);
        if (state.players.length === 4) {
            this.startGame(roomId);
        }
        else {
            this.emitState(state);
        }
    }
    sendRoomPreview(socket, roomId) {
        const state = this.rooms.get(roomId) ?? this.createEmptyState(roomId);
        // Preview payload stays lightweight and only exposes the waiting-room data
        // needed to render team rosters before a player commits to joining.
        socket.emit('roomPreview', {
            roomId: state.roomId,
            status: state.status,
            hostPlayerId: state.hostPlayerId,
            hostPlayerName: state.hostPlayerName,
            dev: state.dev,
            players: state.players.map((player) => ({
                id: player.id,
                name: player.name,
                team: player.team,
                isBot: player.isBot,
                hat: player.hat
            }))
        });
    }
    sendLobbySnapshot(socket) {
        socket.emit('lobbySnapshot', this.buildLobbySnapshot());
    }
    buildLobbySnapshot() {
        const activeRooms = Array.from(this.rooms.values())
            .filter((state) => state.players.length > 0 || Boolean(state.hostPlayerName))
            .map((state) => ({
            roomId: state.roomId,
            status: state.status,
            hostPlayerName: state.hostPlayerName,
            isDevRoom: Boolean(state.dev?.enabled),
            seatedPlayers: state.players.length,
            openSeats: Math.max(0, 4 - state.players.length),
            players: state.players.map((player) => ({
                name: player.name,
                // Public lobby data only needs the fixed two-team seating model.
                team: player.team,
                isBot: player.isBot,
                hat: player.hat
            }))
        }))
            .sort((leftRoom, rightRoom) => {
            if (leftRoom.status !== rightRoom.status) {
                return leftRoom.status === 'playing' ? -1 : 1;
            }
            if (leftRoom.seatedPlayers !== rightRoom.seatedPlayers) {
                return rightRoom.seatedPlayers - leftRoom.seatedPlayers;
            }
            return leftRoom.roomId.localeCompare(rightRoom.roomId);
        });
        return {
            onlinePlayers: this.io.sockets.sockets.size,
            activeRooms
        };
    }
    joinDevRoom(state, socket, playerName, profileId) {
        const humanPlayers = state.players.filter((player) => !player.isBot);
        if (humanPlayers.length >= 1) {
            socket.emit('error', 'Dev solo rooms only support one human player.');
            return;
        }
        state.players = [
            {
                id: socket.id,
                profileId,
                name: playerName,
                hand: [],
                team: 1,
                isBot: false,
                hat: this.economy.getEquippedHat(profileId, playerName),
                exposedHand: false,
                maoBaixaReady: false
            }
        ];
        this.economy.syncProfile(profileId ?? socket.id, playerName);
        socket.join(state.roomId);
        // The solo dev room is always seated as T1, T2, T1, T2.
        state.players.push(this.createBotPlayer(state.roomId, 1, 2));
        state.players.push(this.createBotPlayer(state.roomId, 2, 1));
        state.players.push(this.createBotPlayer(state.roomId, 3, 2));
        this.appendDevLog(state, `${playerName} joined the dev room. Filling the remaining seats with server bots.`);
        this.startGame(state.roomId);
    }
    leaveRoom(socket, roomId) {
        const state = this.rooms.get(roomId);
        if (!state)
            return;
        this.removeHumanPlayerFromRoom(roomId, socket.id);
        socket.leave(roomId);
    }
    startRematch(socket, roomId) {
        const state = this.rooms.get(roomId);
        if (!state || state.status !== 'game_end')
            return;
        if (!state.players.some((player) => player.id === socket.id))
            return;
        if (state.players.length !== 4)
            return;
        // Reuse the seated players so the rematch preserves the exact same teams.
        this.startGame(roomId);
    }
    startGame(roomId) {
        const state = this.rooms.get(roomId);
        if (!state || state.players.length !== 4)
            return;
        const team1Players = state.players.filter((player) => player.team === 1);
        const team2Players = state.players.filter((player) => player.team === 2);
        state.players = [team1Players[0], team2Players[0], team1Players[1], team2Players[1]];
        state.startingPlayerIndex = 0;
        state.points = { team1: 0, team2: 0 };
        state._matchRewardGranted = false;
        if (state.dev?.enabled && !this.roomRngs.has(roomId)) {
            this.roomRngs.set(roomId, this.createSeededRng(state.dev.seed));
        }
        this.appendDevLog(state, 'Starting a fresh match.');
        this.broadcastLobbySnapshot();
        this.startNewRound(state);
    }
    startNewRound(state) {
        bugReport_1.bugReportManager.logGameEvent(state.roomId, 'New round started.');
        this.clearRoomTasks(state.roomId);
        this.clearBotTimer(state.roomId);
        state.deck = (0, gameLogic_1.shuffleDeck)((0, gameLogic_1.createDeck)());
        state.vira = state.deck.pop();
        state.manilhaRank = (0, gameLogic_1.getManilhaRank)(state.vira.rank);
        for (const player of state.players) {
            player.hand = [state.deck.pop(), state.deck.pop(), state.deck.pop()];
            player.hand = (0, gameLogic_1.setManilhas)(player.hand, state.manilhaRank);
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
        state.winnerTeam = null;
        state.notifications = [];
        // Reset special modes at the start of every round.
        state._phase = 'WAITING_FOR_HAND_PHASE';
        state._maoActive = false;
        state._maoType = undefined;
        state._maoCallerId = undefined;
        state.maoDeOnzeActive = false;
        state.maoDeOnzeTeam = null;
        state.maoDeFerroActive = false;
        state.currentTurnIndex = state.startingPlayerIndex;
        this.appendDevLog(state, `Starting round at ${state.points.team1}-${state.points.team2}.`);
        if (state.points.team1 >= GAME_WIN_SCORE || state.points.team2 >= GAME_WIN_SCORE) {
            this.finalizeGame(state, state.points.team1 >= GAME_WIN_SCORE ? 1 : 2);
            return;
        }
        if (state.points.team1 >= ENDGAME_ENTRY_SCORE && state.points.team2 >= ENDGAME_ENTRY_SCORE) {
            state._phase = 'MAO_DE_FERRO';
            state.maoDeFerroActive = true;
            for (const player of state.players) {
                player.maoBaixaReady = true;
            }
            state._phase = 'TRICK_PHASE';
            this.addNotification(state, 'Mao de Ferro active. All cards are hidden and the winner takes the game.', 0);
            this.emitState(state);
            return;
        }
        const team1Has11 = state.points.team1 >= ENDGAME_ENTRY_SCORE;
        const team2Has11 = state.points.team2 >= ENDGAME_ENTRY_SCORE;
        if (team1Has11 || team2Has11) {
            const onzeTeam = team1Has11 ? 1 : 2;
            state._phase = 'MAO_DE_ONZE_DECISION';
            state.maoDeOnzeTeam = onzeTeam;
            this.addNotification(state, `Mao de Onze active. Team ${onzeTeam} must decide whether to play or run.`, onzeTeam);
            this.emitState(state);
            return;
        }
        this.emitState(state);
    }
    handleCall(socket, roomId, callType) {
        const state = this.rooms.get(roomId);
        if (!state || state.status !== 'playing')
            return;
        const playerIndex = state.players.findIndex((player) => player.id === socket.id);
        if (playerIndex === -1)
            return;
        this.handleCallAction(state, playerIndex, callType);
    }
    handleCallAction(state, playerIndex, callType) {
        if (state.status !== 'playing')
            return;
        const player = state.players[playerIndex];
        if (!player)
            return;
        if (state._phase === 'MAO_DE_ONZE_DECISION') {
            if (player.team !== state.maoDeOnzeTeam)
                return;
            if (callType === 'mao_de_onze_run') {
                const opponentTeam = state.maoDeOnzeTeam === 1 ? 2 : 1;
                this.addNotification(state, `Team ${state.maoDeOnzeTeam} ran from Mao de Onze.`, player.team);
                state.maoDeOnzeTeam = null;
                this.awardPoints(state, opponentTeam, 1);
                state.winnerTeam = opponentTeam;
                state.status = 'round_end';
                state._phase = 'ROUND_END';
                this.emitState(state);
                this.scheduleRoomTask(state.roomId, 3000, () => {
                    const winnerIndex = state.players.findIndex((candidate) => candidate.team === opponentTeam);
                    state.startingPlayerIndex = winnerIndex >= 0 ? winnerIndex : (state.startingPlayerIndex + 1) % 4;
                    this.startNewRound(state);
                });
                return;
            }
            if (callType === 'mao_de_onze_play') {
                state.maoDeOnzeActive = true;
                state.roundPoints = 3;
                this.addNotification(state, `Team ${state.maoDeOnzeTeam} accepted Mao de Onze.`, player.team);
                state._phase = 'WAITING_FOR_HAND_PHASE';
                this.emitState(state);
            }
            return;
        }
        if (state._phase === 'WAITING_FOR_HAND_PHASE') {
            if (state.maoDeFerroActive && ['mao_baixa', 'mao_real'].includes(callType)) {
                return;
            }
            if (state._maoActive) {
                const callerIndex = state.players.findIndex((candidate) => candidate.id === state._maoCallerId);
                const caller = state.players[callerIndex];
                if (!caller || caller.team === player.team)
                    return;
                if (callType === 'call_bluff') {
                    this.addNotification(state, `${player.name} challenged the call. Revealing ${caller.name}'s hand.`, player.team);
                    caller.exposedHand = true;
                    state._phase = 'MAO_REVEAL';
                    this.emitState(state);
                    this.scheduleRoomTask(state.roomId, 3000, () => {
                        const isTruth = this.evaluateMaoTruth(caller, state._maoType);
                        const winningTeam = isTruth ? caller.team : player.team;
                        const allowGameWin = state.maoDeOnzeActive || state.maoDeFerroActive;
                        if (isTruth) {
                            this.addNotification(state, `The call was true. Team ${caller.team} gains 1 point.`, caller.team);
                            this.awardPoints(state, caller.team, 1, { allowGameWin });
                        }
                        else {
                            this.addNotification(state, `The call was false. Team ${player.team} gains 1 point.`, player.team);
                            this.awardPoints(state, player.team, 1, { allowGameWin });
                        }
                        // Mid-hand Mao scoring should only restart the round when it creates a
                        // new endgame state. Otherwise, keep the same round and only redeal the caller.
                        if (this.shouldEndRoundAfterSpecialCall(state)) {
                            caller.exposedHand = false;
                            this.finishScoredRoundFromSpecialCall(state, winningTeam);
                            return;
                        }
                        if (state.maoDeOnzeActive) {
                            state.roundPoints = 3;
                        }
                        state._maoActive = false;
                        state._maoType = undefined;
                        state._maoCallerId = undefined;
                        state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };
                        if (isTruth) {
                            if (state.deck.length >= 3) {
                                caller.hand = (0, gameLogic_1.setManilhas)([state.deck.pop(), state.deck.pop(), state.deck.pop()], state.manilhaRank);
                                caller.maoBaixaReady = false;
                                caller.exposedHand = false;
                            }
                            state.currentTurnIndex = callerIndex;
                        }
                        else {
                            caller.maoBaixaReady = true;
                            state.currentTurnIndex = playerIndex;
                        }
                        if (state.players.every((candidate) => candidate.maoBaixaReady)) {
                            state._phase = 'TRICK_PHASE';
                        }
                        else {
                            state._phase = 'WAITING_FOR_HAND_PHASE';
                        }
                        this.emitState(state);
                    });
                    return;
                }
                if (callType === 'accept') {
                    this.addNotification(state, `${player.name} allowed the hand switch.`, player.team);
                    if (state.deck.length >= 3) {
                        caller.hand = (0, gameLogic_1.setManilhas)([state.deck.pop(), state.deck.pop(), state.deck.pop()], state.manilhaRank);
                        caller.maoBaixaReady = false;
                    }
                    else {
                        caller.maoBaixaReady = true;
                    }
                    caller.exposedHand = false;
                    state.currentTurnIndex = callerIndex;
                    state._maoActive = false;
                    state._maoType = undefined;
                    state._maoCallerId = undefined;
                    state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };
                    state.notifications = [];
                    if (state.players.every((candidate) => candidate.maoBaixaReady)) {
                        state._phase = 'TRICK_PHASE';
                        state.currentTurnIndex = callerIndex;
                    }
                    this.emitState(state);
                }
                return;
            }
            if (callType === 'keep_hand' || callType === 'keep') {
                if (player.maoBaixaReady)
                    return;
                player.maoBaixaReady = true;
                this.addNotification(state, `${player.name} keeps the current hand.`, player.team);
                if (state.players.every((candidate) => candidate.maoBaixaReady)) {
                    state._phase = 'TRICK_PHASE';
                }
                this.emitState(state);
                return;
            }
            if (callType === 'mao_baixa' || callType === 'mao_real') {
                if (player.maoBaixaReady)
                    return;
                const callName = callType === 'mao_baixa' ? 'Mao Baixa' : 'Mao Real';
                player.maoBaixaReady = true;
                state._maoActive = true;
                state._maoCallerId = player.id;
                state._maoType = callType;
                state.callState = {
                    type: callType,
                    callingTeam: player.team,
                    awaitingResponseFromTeam: player.team === 1 ? 2 : 1,
                    lastCallTeam: player.team
                };
                this.addNotification(state, `${player.name} called ${callName}.`, player.team);
                this.emitState(state);
            }
            return;
        }
        if (state._phase === 'TRICK_PHASE') {
            if (state.maoDeOnzeActive || state.maoDeFerroActive) {
                if (['truco', 'double', 'triple', 'mao_baixa', 'mao_real'].includes(callType))
                    return;
            }
            if (['truco', 'double', 'triple'].includes(callType)) {
                const totalTricks = state.tricks.team1 + state.tricks.team2;
                if (totalTricks === 0 && callType === 'truco')
                    return;
                if (state.callState.lastCallTeam === player.team) {
                    return;
                }
                const validRaise = (callType === 'truco' && state.roundPoints === 1) ||
                    (callType === 'double' && state.roundPoints === 3) ||
                    (callType === 'triple' && state.roundPoints === 6);
                if (validRaise) {
                    const raiseName = callType === 'double' ? 'Double Truco' : callType === 'triple' ? 'Triple Truco' : 'Truco';
                    this.addNotification(state, `${player.name} called ${raiseName}.`, player.team);
                    state.callState = {
                        type: callType,
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
                    this.addNotification(state, `${player.name} accepted the raise.`, player.team);
                    if (state.callState.type === 'truco')
                        state.roundPoints = 3;
                    if (state.callState.type === 'double')
                        state.roundPoints = 6;
                    if (state.callState.type === 'triple')
                        state.roundPoints = 9;
                    const preservedLastCallTeam = state.callState.lastCallTeam;
                    state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: preservedLastCallTeam };
                    this.emitState(state);
                }
                else if (callType === 'decline' || callType === 'fold') {
                    const callingTeam = state.callState.callingTeam;
                    this.addNotification(state, `${player.name} folded.`, player.team);
                    state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };
                    this.endRound(state, callingTeam);
                }
            }
        }
    }
    handlePlayCard(socket, roomId, cardIndex) {
        const state = this.rooms.get(roomId);
        if (!state)
            return;
        const playerIndex = state.players.findIndex((player) => player.id === socket.id);
        if (playerIndex === -1)
            return;
        this.playCardByIndex(state, playerIndex, cardIndex);
    }
    playCardByIndex(state, playerIndex, cardIndex) {
        if (state.status !== 'playing')
            return;
        if (state._phase !== 'TRICK_PHASE')
            return;
        if (playerIndex !== state.currentTurnIndex)
            return;
        if (state.table.length >= 4)
            return;
        if (state.callState.awaitingResponseFromTeam !== null)
            return;
        const player = state.players[playerIndex];
        if (!player)
            return;
        if (!Number.isFinite(cardIndex))
            return;
        if (cardIndex < 0 || cardIndex >= player.hand.length)
            return;
        // Mao de Ferro still hides every hand, but the acting player should choose the card they commit.
        const card = player.hand.splice(cardIndex, 1)[0];
        if (!card)
            return;
        state.table.push({ playerIndex, card: { ...card } });
        bugReport_1.bugReportManager.logGameEvent(state.roomId, `${player.name} played ${this.describeCard(card)}.`);
        this.appendDevLog(state, `${player.name} played ${this.describeCard(card)}.`);
        if (state.table.length < 4) {
            state.currentTurnIndex = (state.currentTurnIndex + 1) % 4;
            this.emitState(state);
        }
        else {
            this.evaluateTrick(state);
        }
    }
    evaluateTrick(state) {
        let winningEntryIndex = 0;
        for (let index = 1; index < 4; index++) {
            const currentCard = state.table[index].card;
            const winningCard = state.table[winningEntryIndex].card;
            if ((0, gameLogic_1.compareCards)(currentCard, winningCard) > 0) {
                winningEntryIndex = index;
            }
        }
        const winningEntry = state.table[winningEntryIndex];
        const winningPlayerIndex = winningEntry.playerIndex;
        const trickStarterIndex = state.table[0].playerIndex;
        const winningTeam = state.players[winningPlayerIndex].team;
        const winningPlayerName = state.players[winningPlayerIndex].name;
        const allTied = state.table.every((entry) => (0, gameLogic_1.compareCards)(entry.card, state.table[0].card) === 0);
        const winnerTeamFinal = allTied ? null : winningTeam;
        if (winnerTeamFinal === 1)
            state.tricks.team1++;
        if (winnerTeamFinal === 2)
            state.tricks.team2++;
        state.lastTrickWinner = winnerTeamFinal;
        state.lastTrickWinnerName = winnerTeamFinal ? winningPlayerName : null;
        const tricksPlayed = 3 - state.players[0].hand.length;
        if (winnerTeamFinal) {
            this.addNotification(state, `${winningPlayerName} won the trick.`, winningTeam);
        }
        else {
            this.addNotification(state, 'The trick ended in a tie.', 0);
        }
        this.emitState(state);
        const roundWinner = state.tricks.team1 > state.tricks.team2 ? 1 : state.tricks.team2 > state.tricks.team1 ? 2 : null;
        if (state.tricks.team1 >= 2 || state.tricks.team2 >= 2 || tricksPlayed >= 3) {
            this.scheduleRoomTask(state.roomId, 2500, () => {
                const nextStarter = winnerTeamFinal ? winningPlayerIndex : undefined;
                this.endRound(state, roundWinner ?? (state.startingPlayerIndex % 2 === 0 ? 1 : 2), nextStarter);
            });
        }
        else {
            this.scheduleRoomTask(state.roomId, 2500, () => {
                state.table = [];
                state.notifications = [];
                state.lastTrickWinner = -1;
                state.lastTrickWinnerName = null;
                state.currentTurnIndex = winnerTeamFinal ? winningPlayerIndex : trickStarterIndex;
                this.emitState(state);
            });
        }
    }
    evaluateMaoTruth(player, type) {
        if (type === 'mao_real') {
            return player.hand.every((card) => ['A', 'K', 'J', 'Q'].includes(card.rank));
        }
        return player.hand.every((card) => ['2', '3', '4', '5', '6', '7'].includes(card.rank));
    }
    awardPoints(state, team, amount, options) {
        // Normal scoring is capped at 11 so raised rounds still flow into Mao de Onze/Ferro.
        const scoreCap = options?.allowGameWin ? GAME_WIN_SCORE : ENDGAME_ENTRY_SCORE;
        if (team === 1) {
            state.points.team1 = Math.min(state.points.team1 + amount, scoreCap);
        }
        else if (team === 2) {
            state.points.team2 = Math.min(state.points.team2 + amount, scoreCap);
        }
    }
    shouldEndRoundAfterSpecialCall(state) {
        const reachedGameWin = state.points.team1 >= GAME_WIN_SCORE || state.points.team2 >= GAME_WIN_SCORE;
        const reachedMaoDeFerro = state.points.team1 >= ENDGAME_ENTRY_SCORE && state.points.team2 >= ENDGAME_ENTRY_SCORE;
        const reachedEndgameEntry = state.points.team1 >= ENDGAME_ENTRY_SCORE || state.points.team2 >= ENDGAME_ENTRY_SCORE;
        const inEndgameHand = state.maoDeOnzeActive || state.maoDeFerroActive;
        if (reachedGameWin || reachedMaoDeFerro) {
            return true;
        }
        return !inEndgameHand && reachedEndgameEntry;
    }
    finishScoredRoundFromSpecialCall(state, winningTeam) {
        // A point awarded mid-hand can push the match into Mao de Onze/Ferro.
        // Restart through startNewRound() so every 11-point score uses the same flow.
        state.status = 'round_end';
        state._phase = 'ROUND_END';
        state.winnerTeam = winningTeam;
        state._maoActive = false;
        state._maoType = undefined;
        state._maoCallerId = undefined;
        state.maoDeOnzeActive = false;
        state.maoDeOnzeTeam = null;
        state.callState = { type: null, callingTeam: null, awaitingResponseFromTeam: null, lastCallTeam: null };
        this.emitState(state);
        this.scheduleRoomTask(state.roomId, 3000, () => {
            if (state.points.team1 >= GAME_WIN_SCORE || state.points.team2 >= GAME_WIN_SCORE) {
                this.finalizeGame(state, state.points.team1 >= GAME_WIN_SCORE ? 1 : 2);
                return;
            }
            const winnerIndex = state.players.findIndex((candidate) => candidate.team === winningTeam);
            state.startingPlayerIndex = winnerIndex >= 0 ? winnerIndex : (state.startingPlayerIndex + 1) % 4;
            this.startNewRound(state);
        });
    }
    endRound(state, winningTeam, nextStarterIndex) {
        bugReport_1.bugReportManager.logGameEvent(state.roomId, `Round won by Team ${winningTeam}.`);
        state.winnerTeam = winningTeam;
        if (state.maoDeFerroActive) {
            this.addNotification(state, `Team ${winningTeam} won Mao de Ferro and the game.`, winningTeam);
            state.maoDeFerroActive = false;
            state.status = 'round_end';
            state._phase = 'ROUND_END';
            this.emitState(state);
            this.scheduleRoomTask(state.roomId, 3000, () => {
                this.finalizeGame(state, winningTeam);
            });
            return;
        }
        if (state.maoDeOnzeActive) {
            if (winningTeam === state.maoDeOnzeTeam) {
                if (winningTeam === 1)
                    state.points.team1 = GAME_WIN_SCORE;
                if (winningTeam === 2)
                    state.points.team2 = GAME_WIN_SCORE;
                state.maoDeOnzeActive = false;
                state.maoDeOnzeTeam = null;
                state.status = 'round_end';
                state._phase = 'ROUND_END';
                this.emitState(state);
                this.scheduleRoomTask(state.roomId, 3000, () => {
                    this.finalizeGame(state, winningTeam);
                });
                return;
            }
            // Beating a Mao de Onze is the only non-owning path that can still award a game-winning score.
            this.awardPoints(state, winningTeam, 3, { allowGameWin: true });
            state.maoDeOnzeActive = false;
            state.maoDeOnzeTeam = null;
            state.status = 'round_end';
            state._phase = 'ROUND_END';
            this.emitState(state);
            this.scheduleRoomTask(state.roomId, 3000, () => {
                if (state.points.team1 >= GAME_WIN_SCORE || state.points.team2 >= GAME_WIN_SCORE) {
                    this.finalizeGame(state, state.points.team1 >= GAME_WIN_SCORE ? 1 : 2);
                    return;
                }
                if (nextStarterIndex !== undefined) {
                    state.startingPlayerIndex = nextStarterIndex;
                }
                else {
                    const winnerIndex = state.players.findIndex((player) => player.team === winningTeam);
                    state.startingPlayerIndex = winnerIndex >= 0 ? winnerIndex : (state.startingPlayerIndex + 1) % 4;
                }
                this.startNewRound(state);
            });
            return;
        }
        this.awardPoints(state, winningTeam, state.roundPoints);
        state.status = 'round_end';
        state._phase = 'ROUND_END';
        this.emitState(state);
        this.scheduleRoomTask(state.roomId, 3000, () => {
            if (nextStarterIndex !== undefined) {
                state.startingPlayerIndex = nextStarterIndex;
            }
            else {
                const winnerIndex = state.players.findIndex((player) => player.team === winningTeam);
                state.startingPlayerIndex = winnerIndex >= 0 ? winnerIndex : (state.startingPlayerIndex + 1) % 4;
            }
            this.startNewRound(state);
        });
    }
    finalizeGame(state, winningTeam) {
        state.status = 'game_end';
        state.winnerTeam = winningTeam;
        if (!state._matchRewardGranted) {
            const winnerProfileIds = state.players
                .filter((player) => !player.isBot && player.team === winningTeam && player.profileId)
                .map((player) => player.profileId);
            this.economy.rewardMatchWin(winnerProfileIds, economy_1.WIN_REWARD_TK);
            state._matchRewardGranted = true;
            this.appendDevLog(state, `Awarded ${economy_1.WIN_REWARD_TK}tk to each human player on Team ${winningTeam}.`);
        }
        this.emitState(state);
    }
    emitState(state) {
        for (const viewer of state.players) {
            if (viewer.isBot)
                continue;
            const secretDebugActive = this.isSecretDebugPlayer(state.roomId, viewer.id);
            const privateState = {
                ...state,
                secretDebug: {
                    available: this.secretDebugEnabled,
                    active: secretDebugActive
                },
                players: state.players.map((player) => {
                    if (secretDebugActive) {
                        return { ...player, hand: player.hand };
                    }
                    if (state.maoDeFerroActive) {
                        return {
                            ...player,
                            hand: player.hand.map(() => ({ suit: 'hidden', rank: '?', value: 0, isManilha: false, manilhaValue: 0 }))
                        };
                    }
                    if (state.maoDeOnzeTeam && viewer.team === state.maoDeOnzeTeam && player.team === state.maoDeOnzeTeam) {
                        return { ...player, hand: player.hand };
                    }
                    return {
                        ...player,
                        hand: (player.id === viewer.id || player.exposedHand) ? player.hand : []
                    };
                })
            };
            this.io.to(viewer.id).emit('gameStateUpdate', privateState);
        }
        // Mirror room roster/status changes to lobby viewers without requiring a refresh.
        this.broadcastLobbySnapshot();
        this.maybeScheduleBotAction(state);
    }
    activateSecretDebug(socket, roomId, secretCode) {
        const state = this.rooms.get(roomId);
        if (!state)
            return;
        if (!this.secretDebugEnabled) {
            socket.emit('error', 'Secret debug mode is disabled on this server.');
            return;
        }
        const actor = state.players.find((player) => player.id === socket.id);
        if (!actor || actor.isBot) {
            socket.emit('error', 'Only seated human players can unlock secret debug mode.');
            return;
        }
        if (secretCode.trim() !== this.secretDebugCode) {
            socket.emit('error', 'Invalid secret debug code.');
            return;
        }
        const authorizedPlayers = this.secretDebugPlayers.get(roomId) ?? new Set();
        authorizedPlayers.add(socket.id);
        this.secretDebugPlayers.set(roomId, authorizedPlayers);
        this.appendDevLog(state, `${actor.name} unlocked secret debug mode.`);
        this.emitState(state);
    }
    isSecretDebugPlayer(roomId, playerId) {
        return this.secretDebugPlayers.get(roomId)?.has(playerId) ?? false;
    }
    canUseDebugTools(state, playerId) {
        return Boolean(state.dev?.enabled) || this.isSecretDebugPlayer(state.roomId, playerId);
    }
    isRank(value) {
        return gameLogic_1.RANKS.includes(value);
    }
    isSuit(value) {
        return gameLogic_1.SUITS.includes(value);
    }
    rebuildDebugHand(cards, manilhaRank) {
        return cards.map((card) => {
            if (!this.isRank(card.rank) || !this.isSuit(card.suit)) {
                throw new Error('Invalid card in debug hand update.');
            }
            return (0, gameLogic_1.buildCard)(card.rank, card.suit, manilhaRank);
        });
    }
    handleDebugCommand(socket, roomId, command) {
        const state = this.rooms.get(roomId);
        if (!state)
            return;
        if (!this.canUseDebugTools(state, socket.id)) {
            socket.emit('error', 'Debug commands are unavailable for this player.');
            return;
        }
        const actor = state.players.find((player) => player.id === socket.id);
        if (!actor || actor.isBot) {
            socket.emit('error', 'Only seated human players can use debug commands.');
            return;
        }
        switch (command.type) {
            case 'pauseBots':
                if (!state.dev?.enabled) {
                    socket.emit('error', 'Bot controls are only available in dev rooms.');
                    return;
                }
                state.dev.botsPaused = true;
                this.clearBotTimer(roomId);
                this.appendDevLog(state, `${actor.name} paused the bots.`);
                this.emitState(state);
                return;
            case 'resumeBots':
                if (!state.dev?.enabled) {
                    socket.emit('error', 'Bot controls are only available in dev rooms.');
                    return;
                }
                state.dev.botsPaused = false;
                this.appendDevLog(state, `${actor.name} resumed the bots.`);
                this.emitState(state);
                return;
            case 'stepBots': {
                if (!state.dev?.enabled) {
                    socket.emit('error', 'Bot controls are only available in dev rooms.');
                    return;
                }
                this.clearBotTimer(roomId);
                const actionTaken = this.runNextBotAction(roomId, true);
                if (!actionTaken) {
                    this.appendDevLog(state, 'Step requested, but there was no eligible bot action.');
                    this.emitState(state);
                }
                return;
            }
            case 'setBotSpeed':
                if (!state.dev?.enabled) {
                    socket.emit('error', 'Bot controls are only available in dev rooms.');
                    return;
                }
                state.dev.botSpeedMs = this.clampBotSpeed(command.speedMs);
                this.appendDevLog(state, `${actor.name} changed bot speed to ${state.dev.botSpeedMs}ms.`);
                this.emitState(state);
                return;
            case 'setScore':
                this.clearRoomTasks(roomId);
                this.clearBotTimer(roomId);
                state.points = {
                    team1: this.clampScore(command.score.team1),
                    team2: this.clampScore(command.score.team2)
                };
                state.startingPlayerIndex = 0;
                this.appendDevLog(state, `${actor.name} forced the score to ${state.points.team1}-${state.points.team2}. Resetting into a fresh round.`);
                this.startNewRound(state);
                return;
            case 'setPlayerHand': {
                const targetPlayer = state.players.find((player) => player.id === command.playerId);
                if (!targetPlayer) {
                    socket.emit('error', 'That player is no longer seated in the room.');
                    return;
                }
                if (!Array.isArray(command.cards)) {
                    socket.emit('error', 'Debug hand edits require a full replacement hand.');
                    return;
                }
                if (command.cards.length !== targetPlayer.hand.length) {
                    socket.emit('error', 'Debug hand edits must keep the current hand size unchanged.');
                    return;
                }
                try {
                    targetPlayer.hand = this.rebuildDebugHand(command.cards, state.manilhaRank);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : 'Unable to update that debug hand.';
                    socket.emit('error', message);
                    return;
                }
                this.appendDevLog(state, `${actor.name} changed ${targetPlayer.name}'s hand.`);
                this.emitState(state);
                return;
            }
        }
    }
    maybeScheduleBotAction(state) {
        this.clearBotTimer(state.roomId);
        if (!state.dev?.enabled || state.dev.botsPaused || state.status !== 'playing') {
            return;
        }
        const action = this.determineBotAction(state);
        if (!action)
            return;
        const timer = setTimeout(() => {
            this.botTimers.delete(state.roomId);
            this.runNextBotAction(state.roomId, false);
        }, state.dev.botSpeedMs);
        this.botTimers.set(state.roomId, timer);
    }
    runNextBotAction(roomId, ignorePause) {
        const state = this.rooms.get(roomId);
        if (!state?.dev?.enabled || state.status !== 'playing')
            return false;
        if (state.dev.botsPaused && !ignorePause)
            return false;
        const action = this.determineBotAction(state);
        if (!action)
            return false;
        this.appendDevLog(state, action.description);
        action.run();
        return true;
    }
    determineBotAction(state) {
        if (!state.dev?.enabled || state.status !== 'playing')
            return null;
        if (state._phase === 'MAO_REVEAL' || state.status !== 'playing')
            return null;
        if (state._phase === 'MAO_DE_ONZE_DECISION') {
            const onzeTeam = state.maoDeOnzeTeam;
            if (!onzeTeam || this.teamHasHuman(state, onzeTeam))
                return null;
            const playerIndex = state.players.findIndex((player) => player.isBot && player.team === onzeTeam);
            if (playerIndex === -1)
                return null;
            const shouldPlay = this.nextRandom(state) < 0.8;
            const actionType = shouldPlay ? 'mao_de_onze_play' : 'mao_de_onze_run';
            return {
                description: `${state.players[playerIndex].name} chose ${shouldPlay ? 'play' : 'run'} for Mao de Onze.`,
                run: () => this.handleCallAction(state, playerIndex, actionType)
            };
        }
        if (state._phase === 'WAITING_FOR_HAND_PHASE') {
            if (state._maoActive && state.callState.awaitingResponseFromTeam !== null) {
                const respondingTeam = state.callState.awaitingResponseFromTeam;
                if (this.teamHasHuman(state, respondingTeam))
                    return null;
                const playerIndex = state.players.findIndex((player) => player.isBot && player.team === respondingTeam);
                if (playerIndex === -1)
                    return null;
                const actionType = this.chooseBotMaoResponse(state);
                return {
                    description: `${state.players[playerIndex].name} responded with ${actionType}.`,
                    run: () => this.handleCallAction(state, playerIndex, actionType)
                };
            }
            const playerIndex = state.players.findIndex((player) => player.isBot && !player.maoBaixaReady);
            if (playerIndex === -1)
                return null;
            const actionType = this.chooseBotHandAction(state, state.players[playerIndex]);
            return {
                description: `${state.players[playerIndex].name} selected ${actionType}.`,
                run: () => this.handleCallAction(state, playerIndex, actionType)
            };
        }
        if (state._phase === 'TRICK_PHASE') {
            if (state.callState.awaitingResponseFromTeam !== null) {
                const respondingTeam = state.callState.awaitingResponseFromTeam;
                if (this.teamHasHuman(state, respondingTeam))
                    return null;
                const playerIndex = state.players.findIndex((player) => player.isBot && player.team === respondingTeam);
                if (playerIndex === -1)
                    return null;
                const actionType = this.chooseBotRaiseResponse(state);
                return {
                    description: `${state.players[playerIndex].name} answered with ${actionType}.`,
                    run: () => this.handleCallAction(state, playerIndex, actionType)
                };
            }
            const playerIndex = state.currentTurnIndex;
            const player = state.players[playerIndex];
            if (!player?.isBot)
                return null;
            const raiseType = this.chooseBotRaiseAction(state, player);
            if (raiseType) {
                return {
                    description: `${player.name} decided to call ${raiseType}.`,
                    run: () => this.handleCallAction(state, playerIndex, raiseType)
                };
            }
            if (player.hand.length === 0)
                return null;
            const cardIndex = Math.floor(this.nextRandom(state) * player.hand.length);
            return {
                description: `${player.name} is playing a random legal card.`,
                run: () => this.playCardByIndex(state, playerIndex, cardIndex)
            };
        }
        return null;
    }
    chooseBotHandAction(state, player) {
        const truthfulBaixa = this.evaluateMaoTruth(player, 'mao_baixa');
        const truthfulReal = this.evaluateMaoTruth(player, 'mao_real');
        const roll = this.nextRandom(state);
        if (truthfulReal && roll < 0.18)
            return 'mao_real';
        if (truthfulBaixa && roll < 0.35)
            return 'mao_baixa';
        if (!truthfulReal && roll < 0.08)
            return 'mao_real';
        if (!truthfulBaixa && roll < 0.16)
            return 'mao_baixa';
        return 'keep_hand';
    }
    chooseBotMaoResponse(state) {
        return this.nextRandom(state) < 0.7 ? 'accept' : 'call_bluff';
    }
    chooseBotRaiseResponse(state) {
        const foldChance = state.roundPoints >= 6 ? 0.4 : state.roundPoints >= 3 ? 0.25 : 0.15;
        return this.nextRandom(state) < foldChance ? 'fold' : 'accept';
    }
    chooseBotRaiseAction(state, player) {
        // Special endgame hands never allow Truco escalation.
        if (state.maoDeOnzeActive || state.maoDeFerroActive)
            return null;
        if (state.callState.type)
            return null;
        if (state.callState.lastCallTeam === player.team)
            return null;
        const totalTricks = state.tricks.team1 + state.tricks.team2;
        if (totalTricks < 1)
            return null;
        if (state.roundPoints === 1 && this.nextRandom(state) < 0.12)
            return 'truco';
        if (state.roundPoints === 3 && this.nextRandom(state) < 0.1)
            return 'double';
        if (state.roundPoints === 6 && this.nextRandom(state) < 0.08)
            return 'triple';
        return null;
    }
    teamHasHuman(state, team) {
        return state.players.some((player) => player.team === team && !player.isBot);
    }
    scheduleRoomTask(roomId, delayMs, callback) {
        const tasks = this.roomTasks.get(roomId) ?? new Set();
        const task = setTimeout(() => {
            tasks.delete(task);
            if (tasks.size === 0) {
                this.roomTasks.delete(roomId);
            }
            callback();
        }, delayMs);
        tasks.add(task);
        this.roomTasks.set(roomId, tasks);
        return task;
    }
    clearRoomTasks(roomId) {
        const tasks = this.roomTasks.get(roomId);
        if (!tasks)
            return;
        for (const task of tasks) {
            clearTimeout(task);
        }
        this.roomTasks.delete(roomId);
    }
    clearBotTimer(roomId) {
        const timer = this.botTimers.get(roomId);
        if (!timer)
            return;
        clearTimeout(timer);
        this.botTimers.delete(roomId);
    }
    removeHumanPlayerFromRoom(roomId, playerId) {
        const state = this.rooms.get(roomId);
        if (!state)
            return;
        const leavingPlayerIndex = state.players.findIndex((player) => player.id === playerId && !player.isBot);
        if (leavingPlayerIndex === -1)
            return;
        const leavingPlayer = state.players[leavingPlayerIndex];
        if (!leavingPlayer)
            return;
        // Any queued round transitions are invalid once the seated roster changes.
        this.clearRoomTasks(roomId);
        this.clearBotTimer(roomId);
        this.secretDebugPlayers.get(roomId)?.delete(playerId);
        state.players.splice(leavingPlayerIndex, 1);
        if (state.dev?.enabled) {
            this.roomRngs.delete(roomId);
            this.secretDebugPlayers.delete(roomId);
            this.rooms.delete(roomId);
            this.broadcastLobbySnapshot();
            return;
        }
        if (state.players.length === 0) {
            this.roomRngs.delete(roomId);
            this.secretDebugPlayers.delete(roomId);
            this.rooms.delete(roomId);
            this.broadcastLobbySnapshot();
            return;
        }
        this.refreshHostAssignment(state);
        // Public matches should not keep running with a missing seat. Reset to the
        // waiting-room state so the next join starts from a clean table.
        this.resetRoomToWaiting(state);
        this.appendDevLog(state, `${leavingPlayer.name} left the room.`);
        this.emitState(state);
    }
    refreshHostAssignment(state) {
        const nextHost = state.players.find((player) => !player.isBot) ?? null;
        state.hostPlayerId = nextHost?.id ?? null;
        state.hostPlayerName = nextHost?.name ?? null;
    }
    resetRoomToWaiting(state) {
        const waitingState = this.createEmptyState(state.roomId);
        state.players = state.players.map((player) => ({
            ...player,
            hand: [],
            exposedHand: false,
            maoBaixaReady: false
        }));
        state.deck = waitingState.deck;
        state.vira = waitingState.vira;
        state.manilhaRank = waitingState.manilhaRank;
        state.currentTurnIndex = waitingState.currentTurnIndex;
        state.points = waitingState.points;
        state.roundPoints = waitingState.roundPoints;
        state.tricks = waitingState.tricks;
        state.table = waitingState.table;
        state.startingPlayerIndex = waitingState.startingPlayerIndex;
        state.status = waitingState.status;
        state.winnerTeam = waitingState.winnerTeam;
        state.callState = waitingState.callState;
        state.lastTrickWinner = waitingState.lastTrickWinner;
        state.lastTrickWinnerName = waitingState.lastTrickWinnerName;
        state.notifications = waitingState.notifications;
        state._phase = waitingState._phase;
        state._maoActive = waitingState._maoActive;
        state._maoCallerId = waitingState._maoCallerId;
        state._maoType = waitingState._maoType;
        state._matchRewardGranted = waitingState._matchRewardGranted;
        state.maoDeOnzeActive = waitingState.maoDeOnzeActive;
        state.maoDeOnzeTeam = waitingState.maoDeOnzeTeam;
        state.maoDeFerroActive = waitingState.maoDeFerroActive;
    }
    handleDisconnect(socket) {
        for (const [roomId, state] of this.rooms.entries()) {
            const humanIndex = state.players.findIndex((player) => player.id === socket.id && !player.isBot);
            if (humanIndex === -1)
                continue;
            this.removeHumanPlayerFromRoom(roomId, socket.id);
            return;
        }
        this.broadcastLobbySnapshot();
    }
    clampScore(score) {
        return Math.max(0, Math.min(ENDGAME_ENTRY_SCORE, Math.trunc(score)));
    }
    clampBotSpeed(speedMs) {
        if (!Number.isFinite(speedMs))
            return DEFAULT_BOT_SPEED_MS;
        return Math.max(150, Math.min(1200, Math.trunc(speedMs)));
    }
    normalizeSeed(seed) {
        return seed?.trim() || Math.random().toString(36).slice(2, 10);
    }
    createSeededRng(seed) {
        let hash = 1779033703 ^ seed.length;
        for (let index = 0; index < seed.length; index++) {
            hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
            hash = (hash << 13) | (hash >>> 19);
        }
        let state = hash >>> 0;
        return () => {
            state += 0x6D2B79F5;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }
    nextRandom(state) {
        if (!state.dev?.enabled)
            return Math.random();
        let rng = this.roomRngs.get(state.roomId);
        if (!rng) {
            rng = this.createSeededRng(state.dev.seed);
            this.roomRngs.set(state.roomId, rng);
        }
        return rng();
    }
    describeCard(card) {
        const suitSymbols = {
            clubs: 'C',
            diamonds: 'D',
            hearts: 'H',
            spades: 'S'
        };
        return `${card.rank}${suitSymbols[card.suit]}`;
    }
}
exports.TrucoGameManager = TrucoGameManager;
