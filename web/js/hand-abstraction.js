// ============================================================
// Hand Abstraction — Equity Buckets for CFR Solver
// Maps 1326 hand combos → N equity buckets for tractable solving
// ============================================================

// ============================================================
// Preflop: 169 canonical hand types (no further abstraction needed)
// ============================================================

// Convert two hole cards to canonical key: "AKs", "AKo", "AA" etc.
function handToCanonical(card1, card2) {
    const rv = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const r1 = rv[card1.rank], r2 = rv[card2.rank];
    const high = r1 >= r2 ? card1.rank : card2.rank;
    const low = r1 >= r2 ? card2.rank : card1.rank;

    if (card1.rank === card2.rank) return high + low;           // "AA"
    if (card1.suit === card2.suit) return high + low + 's';     // "AKs"
    return high + low + 'o';                                     // "AKo"
}

// Generate all 169 canonical preflop hands
function generate169Hands() {
    const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    const hands = [];
    for (let i = 0; i < ranks.length; i++) {
        for (let j = i; j < ranks.length; j++) {
            if (i === j) {
                hands.push(ranks[i] + ranks[j]); // pair
            } else {
                hands.push(ranks[i] + ranks[j] + 's'); // suited
                hands.push(ranks[i] + ranks[j] + 'o'); // offsuit
            }
        }
    }
    return hands;
}

// Number of combos for each canonical hand type
function combosForHand(handKey) {
    if (handKey.length === 2) return 6;      // pair: C(4,2) = 6
    if (handKey.endsWith('s')) return 4;      // suited: 4
    return 12;                                // offsuit: 12
}

// ============================================================
// Postflop: Equity-based bucketing
// ============================================================

// Fast equity estimate: Monte Carlo with small sample for bucketing
function fastEquityEstimate(holeCards, boardCards, villainRange, sims) {
    sims = sims || 200; // fewer sims for bucketing (speed)
    const usedIds = new Set([...holeCards, ...boardCards].map(c => c.id));
    const deck = fullDeck().filter(c => !usedIds.has(c.id));
    const boardNeed = 5 - boardCards.length;
    let wins = 0, ties = 0, total = 0;

    for (let i = 0; i < sims; i++) {
        const shuffled = shuffleDeck(deck);
        let idx = 0;
        const simBoard = [...boardCards];
        for (let j = 0; j < boardNeed; j++) simBoard.push(shuffled[idx++]);

        // Pick villain hand
        let vCards;
        if (villainRange && villainRange.length > 0) {
            const simUsed = new Set([...holeCards, ...simBoard].map(c => c.id));
            const avail = villainRange.filter(h => !simUsed.has(h[0].id) && !simUsed.has(h[1].id));
            if (avail.length === 0) continue;
            vCards = avail[Math.floor(Math.random() * avail.length)];
        } else {
            vCards = [shuffled[idx++], shuffled[idx++]];
        }

        const heroEval = evaluateBest(holeCards, simBoard);
        const villEval = evaluateBest(vCards, simBoard);
        if (heroEval.score > villEval.score) wins++;
        else if (heroEval.score === villEval.score) ties++;
        total++;
    }

    return total > 0 ? (wins + ties * 0.5) / total : 0.5;
}

// Compute equity buckets for a set of hands against a villain range on a given board
// Returns: { buckets: Map<comboKey, bucketId>, equities: Map<comboKey, equity>, numBuckets }
function computeEquityBuckets(hands, boardCards, villainRange, numBuckets, simsPerHand) {
    numBuckets = numBuckets || 30;
    simsPerHand = simsPerHand || 200;

    const equities = new Map();
    const usedBoard = new Set(boardCards.map(c => c.id));

    // Calculate equity for each hand
    for (const hand of hands) {
        // Skip hands that conflict with board
        if (usedBoard.has(hand[0].id) || usedBoard.has(hand[1].id)) continue;
        const key = hand[0].id + '|' + hand[1].id;
        const eq = fastEquityEstimate(hand, boardCards, villainRange, simsPerHand);
        equities.set(key, eq);
    }

    // Sort by equity and assign to equal-frequency buckets
    const sorted = [...equities.entries()].sort((a, b) => a[1] - b[1]);
    const buckets = new Map();
    const bucketSize = Math.max(1, Math.ceil(sorted.length / numBuckets));

    for (let i = 0; i < sorted.length; i++) {
        const bucketId = Math.min(numBuckets - 1, Math.floor(i / bucketSize));
        buckets.set(sorted[i][0], bucketId);
    }

    return { buckets, equities, numBuckets: Math.min(numBuckets, sorted.length) };
}

// Get bucket ID for a specific hand
function getHandBucket(hand, bucketMap) {
    const key = hand[0].id + '|' + hand[1].id;
    const b = bucketMap.get(key);
    if (b !== undefined) return b;
    // Try reversed order
    const keyRev = hand[1].id + '|' + hand[0].id;
    return bucketMap.get(keyRev) || 0;
}

// ============================================================
// Range utilities
// ============================================================

// Expand a canonical hand key to all specific combos
// e.g., "AKs" → [{rank:'A',suit:'♠'},{rank:'K',suit:'♠'}], ...
function expandHandToComboCards(handKey) {
    const suits = ['♠', '♥', '♦', '♣'];
    const combos = [];

    if (handKey.length === 2) {
        // Pair
        const r = handKey[0];
        for (let i = 0; i < 4; i++) {
            for (let j = i + 1; j < 4; j++) {
                combos.push([
                    makeCard(r, suits[i]),
                    makeCard(r, suits[j])
                ]);
            }
        }
    } else if (handKey.endsWith('s')) {
        // Suited
        const r1 = handKey[0], r2 = handKey[1];
        for (const s of suits) {
            combos.push([makeCard(r1, s), makeCard(r2, s)]);
        }
    } else {
        // Offsuit
        const r1 = handKey[0], r2 = handKey[1];
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                if (i !== j) {
                    combos.push([makeCard(r1, suits[i]), makeCard(r2, suits[j])]);
                }
            }
        }
    }

    return combos;
}

// Expand an array of canonical hand keys to all combos
function expandRangeToComboCards(rangeKeys) {
    const combos = [];
    for (const key of rangeKeys) {
        combos.push(...expandHandToComboCards(key));
    }
    return combos;
}

// Check if two hands share any cards
function handsConflict(hand1, hand2) {
    return hand1[0].id === hand2[0].id || hand1[0].id === hand2[1].id ||
           hand1[1].id === hand2[0].id || hand1[1].id === hand2[1].id;
}

// Check if a hand conflicts with board cards
function handConflictsWithBoard(hand, boardCards) {
    const boardIds = new Set(boardCards.map(c => c.id));
    return boardIds.has(hand[0].id) || boardIds.has(hand[1].id);
}
