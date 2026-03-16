export type Suit = 'diamonds' | 'spades' | 'hearts' | 'clubs';
export type Rank = '4' | '5' | '6' | '7' | 'Q' | 'J' | 'K' | 'A' | '2' | '3';

export interface Card {
    suit: Suit;
    rank: Rank;
    value: number; // Base value based on rank
    isManilha: boolean;
    manilhaValue: number; // Value if it's a manilha based on suit
}

export type Player = {
    id: string;
    name: string;
    hand: Card[];
    team: number; // 1 or 2
    isBot: boolean;
    exposedHand: boolean; // True if player lied on Mao Baixa/Real and their hand must be shown to all
    maoBaixaReady: boolean; // True if player has confirmed keeping their hand
};

export type DebugCommand =
    | { type: 'pauseBots' }
    | { type: 'resumeBots' }
    | { type: 'stepBots' }
    | { type: 'setBotSpeed'; speedMs: number }
    | { type: 'setScore'; score: { team1: number; team2: number } };

export type DevState = {
    enabled: boolean;
    seed: string;
    botsPaused: boolean;
    botSpeedMs: number;
    log: string[];
};

export interface GameState {
    roomId: string;
    players: Player[];
    deck: Card[];
    vira: Card | null;
    manilhaRank: Rank | null;
    currentTurnIndex: number;
    points: { team1: number; team2: number };
    roundPoints: number;
    tricks: { team1: number; team2: number };
    table: { playerIndex: number; card: Card }[];
    startingPlayerIndex: number;
    status: 'waiting' | 'dealing' | 'playing' | 'round_end' | 'game_end';
    callState: {
        type: 'truco' | 'double' | 'triple' | 'mao_baixa' | 'mao_real' | null;
        callingTeam: number | null;
        awaitingResponseFromTeam: number | null;
        lastCallTeam: number | null; // Keeps track of who called the current string of Trucos
    };
    lastTrickWinner: number | null;      // team number that won the last trick
    lastTrickWinnerName: string | null;  // name of the player who won it
    notifications: { id: string; message: string; team: number }[]; // Feed of recent actions

    // Internal FSM fields added for tracking Strict State Machine without breaking old UI variables:
    _phase?: 'WAITING_FOR_HAND_PHASE' | 'TRICK_PHASE' | 'ROUND_END' | 'MAO_DE_ONZE_DECISION' | 'MAO_DE_FERRO' | 'MAO_REVEAL';
    _maoActive?: boolean;
    _maoCallerId?: string;
    _maoType?: 'mao_baixa' | 'mao_real';
    _trickLeaderIndex?: number;

    // Mão de Onze / Mão de Ferro
    maoDeOnzeActive?: boolean;
    maoDeOnzeTeam?: number | null;  // Team that has 11 points
    maoDeFerroActive?: boolean;
    dev?: DevState;
}


// 8, 9, 10 are removed
const RANKS: Rank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const SUITS: Suit[] = ['diamonds', 'spades', 'hearts', 'clubs'];

export const createDeck = (): Card[] => {
    const deck: Card[] = [];
    for (const suit of SUITS) {
        for (let i = 0; i < RANKS.length; i++) {
            const rank = RANKS[i];
            if (!rank) continue;
            // J is better than Q, so we adjust the base value slightly here
            // The array order: '4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'
            // Index basically represents the power.
            deck.push({
                suit,
                rank,
                value: i,
                isManilha: false,
                manilhaValue: 0
            });
        }
    }
    return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = deck[i];
        const temp2 = deck[j];
        if (temp && temp2) {
            deck[i] = temp2;
            deck[j] = temp;
        }
    }
    return deck;
};

// Next rank logic: 4->5, 7->Q, Q->J, J->K, K->A, A->2, 2->3, 3->4
export const getManilhaRank = (viraRank: Rank): Rank => {
    const index = RANKS.indexOf(viraRank);
    const nextIndex = (index + 1) % RANKS.length;
    return RANKS[nextIndex] as Rank;
}

export const setManilhas = (deck: Card[], manilhaRank: Rank): Card[] => {
    return deck.map(card => {
        if (card.rank === manilhaRank) {
            // diamonds -> spades -> hearts -> clubs (0 -> 1 -> 2 -> 3)
            return { ...card, isManilha: true, manilhaValue: SUITS.indexOf(card.suit) };
        }
        return { ...card, isManilha: false, manilhaValue: 0 };
    });
}

const SUIT_RANK: Record<string, number> = {
    clubs: 4,
    hearts: 3,
    spades: 2,
    diamonds: 1
};

// Returns > 0 if card A wins, < 0 if card B wins, 0 if tie.
export const compareCards = (cardA: Card, cardB: Card): number => {
    if (cardA.isManilha && !cardB.isManilha) return 1;
    if (!cardA.isManilha && cardB.isManilha) return -1;
    if (cardA.isManilha && cardB.isManilha) {
        return cardA.manilhaValue - cardB.manilhaValue;
    }
    const valDiff = cardA.value - cardB.value;
    if (valDiff !== 0) return valDiff;

    return SUIT_RANK[cardA.suit] - SUIT_RANK[cardB.suit];
};
