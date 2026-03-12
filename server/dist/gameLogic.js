"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareCards = exports.setManilhas = exports.getManilhaRank = exports.shuffleDeck = exports.createDeck = void 0;
// 8, 9, 10 are removed
const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const SUITS = ['diamonds', 'spades', 'hearts', 'clubs'];
const createDeck = () => {
    const deck = [];
    for (const suit of SUITS) {
        for (let i = 0; i < RANKS.length; i++) {
            const rank = RANKS[i];
            if (!rank)
                continue;
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
exports.createDeck = createDeck;
const shuffleDeck = (deck) => {
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
exports.shuffleDeck = shuffleDeck;
// Next rank logic: 4->5, 7->Q, Q->J, J->K, K->A, A->2, 2->3, 3->4
const getManilhaRank = (viraRank) => {
    const index = RANKS.indexOf(viraRank);
    const nextIndex = (index + 1) % RANKS.length;
    return RANKS[nextIndex];
};
exports.getManilhaRank = getManilhaRank;
const setManilhas = (deck, manilhaRank) => {
    return deck.map(card => {
        if (card.rank === manilhaRank) {
            // diamonds -> spades -> hearts -> clubs (0 -> 1 -> 2 -> 3)
            return { ...card, isManilha: true, manilhaValue: SUITS.indexOf(card.suit) };
        }
        return { ...card, isManilha: false, manilhaValue: 0 };
    });
};
exports.setManilhas = setManilhas;
const SUIT_RANK = {
    clubs: 4,
    hearts: 3,
    spades: 2,
    diamonds: 1
};
// Returns > 0 if card A wins, < 0 if card B wins, 0 if tie.
const compareCards = (cardA, cardB) => {
    if (cardA.isManilha && !cardB.isManilha)
        return 1;
    if (!cardA.isManilha && cardB.isManilha)
        return -1;
    if (cardA.isManilha && cardB.isManilha) {
        return cardA.manilhaValue - cardB.manilhaValue;
    }
    const valDiff = cardA.value - cardB.value;
    if (valDiff !== 0)
        return valDiff;
    return SUIT_RANK[cardA.suit] - SUIT_RANK[cardB.suit];
};
exports.compareCards = compareCards;
