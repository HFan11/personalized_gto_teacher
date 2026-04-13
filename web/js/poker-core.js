// ============================================================
// Poker Core Engine - Cards, Hand Evaluation, Equity
// ============================================================

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
const SUIT_COLORS = { '♠': '#333', '♥': '#e74c3c', '♦': '#3498db', '♣': '#2ecc71' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
const RANK_DISPLAY = { '2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','T':'10','J':'J','Q':'Q','K':'K','A':'A' };

const HAND_RANKS = [
    'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
    'Straight', 'Flush', 'Full House', 'Four of a Kind',
    'Straight Flush', 'Royal Flush'
];

const HAND_RANKS_CN = [
    '高牌', '一对', '两对', '三条',
    '顺子', '同花', '葫芦', '四条',
    '同花顺', '皇家同花顺'
];

// Card object: { rank: 'A', suit: '♠' }
function makeCard(rank, suit) {
    return { rank, suit, id: rank + suit };
}

function fullDeck() {
    const deck = [];
    for (const s of SUITS) {
        for (const r of RANKS) {
            deck.push(makeCard(r, s));
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}

// ============================================================
// 5-Card Hand Evaluation
// ============================================================

function evaluateFive(cards) {
    const ranks = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const isFlush = new Set(suits).size === 1;

    const counts = {};
    ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
    const sorted = Object.entries(counts)
        .map(([k, v]) => [parseInt(k), v])
        .sort((a, b) => b[1] !== a[1] ? b[1] - a[1] : b[0] - a[0]);

    const unique = [...new Set(ranks)].sort((a, b) => b - a);
    const isStraight = unique.length >= 5 && unique[0] - unique[4] === 4;
    const isWheel = new Set([14, 2, 3, 4, 5]).isSubsetOf ?
        [14, 2, 3, 4, 5].every(v => ranks.includes(v)) :
        [14, 2, 3, 4, 5].every(v => ranks.includes(v));

    // Royal Flush
    if (isFlush && isStraight && ranks.includes(14) && ranks.includes(13))
        return { tier: 9, name: 'Royal Flush', nameCN: '皇家同花顺', primary: 14, kickers: [], score: 9000000 + 14 };

    // Straight Flush
    if (isFlush && isStraight)
        return { tier: 8, name: 'Straight Flush', nameCN: '同花顺', primary: ranks[0], kickers: [], score: 8000000 + ranks[0] };
    if (isFlush && isWheel)
        return { tier: 8, name: 'Straight Flush', nameCN: '同花顺', primary: 5, kickers: [], score: 8000000 + 5 };

    // Four of a Kind
    if (sorted[0][1] === 4)
        return { tier: 7, name: 'Four of a Kind', nameCN: '四条', primary: sorted[0][0], kickers: [sorted[1][0]], score: 7000000 + sorted[0][0] * 100 + sorted[1][0] };

    // Full House
    if (sorted[0][1] === 3 && sorted[1][1] === 2)
        return { tier: 6, name: 'Full House', nameCN: '葫芦', primary: sorted[0][0], kickers: [sorted[1][0]], score: 6000000 + sorted[0][0] * 100 + sorted[1][0] };

    // Flush
    if (isFlush)
        return { tier: 5, name: 'Flush', nameCN: '同花', primary: ranks[0], kickers: ranks.slice(1), score: 5000000 + ranks[0] * 10000 + ranks[1] * 1000 + ranks[2] * 100 + ranks[3] * 10 + ranks[4] };

    // Straight
    if (isStraight)
        return { tier: 4, name: 'Straight', nameCN: '顺子', primary: ranks[0], kickers: [], score: 4000000 + ranks[0] };
    if (isWheel)
        return { tier: 4, name: 'Straight', nameCN: '顺子', primary: 5, kickers: [], score: 4000000 + 5 };

    // Three of a Kind
    if (sorted[0][1] === 3)
        return { tier: 3, name: 'Three of a Kind', nameCN: '三条', primary: sorted[0][0], kickers: sorted.slice(1).map(s => s[0]).sort((a,b) => b-a), score: 3000000 + sorted[0][0] * 10000 + sorted[1][0] * 100 + sorted[2][0] };

    // Two Pair
    if (sorted[0][1] === 2 && sorted[1][1] === 2) {
        const hi = Math.max(sorted[0][0], sorted[1][0]);
        const lo = Math.min(sorted[0][0], sorted[1][0]);
        return { tier: 2, name: 'Two Pair', nameCN: '两对', primary: hi, kickers: [lo, sorted[2][0]], score: 2000000 + hi * 10000 + lo * 100 + sorted[2][0] };
    }

    // One Pair
    if (sorted[0][1] === 2)
        return { tier: 1, name: 'One Pair', nameCN: '一对', primary: sorted[0][0], kickers: sorted.slice(1).map(s => s[0]).sort((a,b) => b-a), score: 1000000 + sorted[0][0] * 10000 + sorted[1][0] * 100 + sorted[2][0] * 10 + sorted[3][0] };

    // High Card
    return { tier: 0, name: 'High Card', nameCN: '高牌', primary: ranks[0], kickers: ranks.slice(1), score: ranks[0] * 10000 + ranks[1] * 1000 + ranks[2] * 100 + ranks[3] * 10 + ranks[4] };
}

function combinations(arr, k) {
    const result = [];
    function bt(start, cur) {
        if (cur.length === k) { result.push([...cur]); return; }
        for (let i = start; i < arr.length; i++) {
            cur.push(arr[i]);
            bt(i + 1, cur);
            cur.pop();
        }
    }
    bt(0, []);
    return result;
}

function evaluateBest(holeCards, boardCards) {
    const all = [...holeCards, ...boardCards];
    const combos = combinations(all, 5);
    let best = null;
    for (const combo of combos) {
        const ev = evaluateFive(combo);
        if (!best || ev.score > best.score) best = ev;
    }
    return best;
}

// ============================================================
// Equity Calculator (Monte Carlo)
// ============================================================

function calcEquity(holeCards, boardCards, villainRange, sims = 2000) {
    const usedIds = new Set([...holeCards, ...boardCards].map(c => c.id));
    const remainingDeck = fullDeck().filter(c => !usedIds.has(c.id));
    const boardNeed = 5 - boardCards.length;
    let wins = 0, ties = 0;

    for (let i = 0; i < sims; i++) {
        const shuffled = shuffleDeck(remainingDeck);
        let idx = 0;
        const simBoard = [...boardCards];
        for (let j = 0; j < boardNeed; j++) simBoard.push(shuffled[idx++]);

        // Deal villain cards (from range or random)
        let villainCards;
        if (villainRange && villainRange.length > 0) {
            // Pick a random hand from the range that doesn't conflict
            const usedInSim = new Set([...holeCards, ...simBoard].map(c => c.id));
            const available = villainRange.filter(h =>
                !usedInSim.has(h[0].id) && !usedInSim.has(h[1].id)
            );
            if (available.length > 0) {
                villainCards = available[Math.floor(Math.random() * available.length)];
            } else {
                villainCards = [shuffled[idx++], shuffled[idx++]];
            }
        } else {
            villainCards = [shuffled[idx++], shuffled[idx++]];
        }

        const heroEval = evaluateBest(holeCards, simBoard);
        const villainEval = evaluateBest(villainCards, simBoard);

        if (heroEval.score > villainEval.score) wins++;
        else if (heroEval.score === villainEval.score) ties++;
    }

    return (wins + ties * 0.5) / sims;
}

// ============================================================
// Postflop Hand Category
// ============================================================

function categorizeHand(holeCards, boardCards) {
    if (boardCards.length < 3) return { category: 'unknown', categoryCN: '未知', strength: 0 };

    const eval_ = evaluateBest(holeCards, boardCards);
    const boardRanks = boardCards.map(c => RANK_VALUES[c.rank]);
    const holeRanks = holeCards.map(c => RANK_VALUES[c.rank]);
    const highestBoard = Math.max(...boardRanks);
    const sortedBoardRanks = [...boardRanks].sort((a, b) => b - a);
    const secondHighestBoard = sortedBoardRanks.length >= 2 ? sortedBoardRanks[1] : 0;
    const isRiver = boardCards.length === 5;

    // === CRITICAL: Board flush detection ===
    // If board has 3+ of one suit and hero has ZERO of that suit,
    // any made hand (pair, two pair, set) is nearly worthless
    const boardSuitCounts = {};
    boardCards.forEach(c => boardSuitCounts[c.suit] = (boardSuitCounts[c.suit] || 0) + 1);
    const dominantSuit = Object.entries(boardSuitCounts).find(([_, cnt]) => cnt >= 3);
    if (dominantSuit) {
        const [flushSuit, flushCount] = dominantSuit;
        const heroHasFlushSuit = holeCards.some(c => c.suit === flushSuit);
        const heroHasFlush = eval_ && eval_.tier >= 5; // tier 5 = flush

        if (flushCount >= 4 && !heroHasFlush) {
            // 4+ flush cards on board and hero doesn't have a flush
            // Even TPTK/set is nearly worthless — anyone with one card of that suit beats you
            const catCN = eval_ ? eval_.nameCN : '高牌';
            return {
                category: 'weakMade', categoryCN: `${catCN}(同花面危险)`,
                strength: 0.15, eval: eval_,
                blockerInfo: { blocksNutFlush: false, blocksFlush: false, flushSuit, boardFlushCards: flushCount },
                flushDanger: true,
            };
        }
        if (flushCount >= 3 && !heroHasFlushSuit && !heroHasFlush) {
            // 3 flush cards, hero has none of that suit — vulnerable
            // Downgrade strength significantly but don't make it as bad as 4-flush
            // (opponent still needs 2 of that suit for flush on 3-flush board)
        }
    }

    // --- Flush draw detection helpers ---
    // Detect which suit has a flush draw and whether hero holds the ace of that suit
    function getFlushDrawInfo() {
        for (const suit of SUITS) {
            const h = holeCards.filter(c => c.suit === suit).length;
            const b = boardCards.filter(c => c.suit === suit).length;
            if (h >= 1 && h + b === 4) {
                const hasAceOfSuit = holeCards.some(c => c.suit === suit && c.rank === 'A');
                return { hasDraw: true, suit, isNutDraw: hasAceOfSuit };
            }
        }
        return { hasDraw: false, suit: null, isNutDraw: false };
    }

    // --- Blocker detection for river bluff recommendations ---
    // Check if hero blocks villain's nut flush draws (holds Ah when hearts on board, etc.)
    function getBlockerInfo() {
        const suitCounts = {};
        boardCards.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);
        // Find the most common suit on board (potential flush suit)
        let flushSuit = null;
        let maxCount = 0;
        for (const [s, cnt] of Object.entries(suitCounts)) {
            if (cnt > maxCount) { maxCount = cnt; flushSuit = s; }
        }
        const blocksNutFlush = maxCount >= 3 && holeCards.some(c => c.suit === flushSuit && c.rank === 'A');
        const blocksFlush = maxCount >= 3 && holeCards.some(c => c.suit === flushSuit);
        return { blocksNutFlush, blocksFlush, flushSuit, boardFlushCards: maxCount };
    }

    const blockerInfo = getBlockerInfo();

    switch (eval_.tier) {
        case 9: case 8: case 7:
            return { category: 'nuts', categoryCN: '坚果牌', strength: 1.0, eval: eval_, blockerInfo };
        case 6:
            return { category: 'nuts', categoryCN: '坚果牌', strength: 0.95, eval: eval_, blockerInfo };
        case 5: {
            // Flush — check if hero holds the highest card of the flush
            // If board has the A/K of flush suit, hero's flush is NOT the nut flush
            const heroHighFlush = Math.max(...holeRanks.filter((_, i) => {
                // Find which hole cards contribute to the flush
                const flushSuitCards = [...holeCards, ...boardCards].filter(c => c.suit === holeCards[0].suit || c.suit === holeCards[1].suit);
                return true; // simplified
            }));
            const heroHoldsAceOfFlush = holeCards.some(c => c.rank === 'A' &&
                [...boardCards, ...holeCards].filter(x => x.suit === c.suit).length >= 5);
            if (heroHoldsAceOfFlush) {
                return { category: 'nuts', categoryCN: '坚果同花', strength: 0.92, eval: eval_, blockerInfo };
            }
            const heroHighInFlush = Math.max(...holeRanks);
            if (heroHighInFlush >= 13) { // K or A in flush
                return { category: 'strongMade', categoryCN: '强同花', strength: 0.87, eval: eval_, blockerInfo };
            }
            return { category: 'strongMade', categoryCN: '同花', strength: 0.83, eval: eval_, blockerInfo };
        }
        case 4:
            return { category: 'strongMade', categoryCN: '强成牌', strength: 0.82, eval: eval_, blockerInfo };
        case 3: {
            const isSet = holeRanks.some(r => holeRanks.filter(x => x === r).length === 2);
            if (isSet) {
                return { category: 'nuts', categoryCN: '暗三条(Set)', strength: 0.92, eval: eval_, blockerInfo };
            }
            if (holeRanks.includes(eval_.primary)) {
                return { category: 'strongMade', categoryCN: '明三条(Trips)', strength: 0.78, eval: eval_, blockerInfo };
            }
            const trip_bestKicker = Math.max(...holeRanks);
            if (trip_bestKicker >= 14) return { category: 'weakMade', categoryCN: 'A踢脚(公牌三条)', strength: 0.45, eval: eval_, blockerInfo };
            if (trip_bestKicker >= 12) return { category: 'weakMade', categoryCN: '高踢脚(公牌三条)', strength: 0.35, eval: eval_, blockerInfo };
            return { category: 'air', categoryCN: '弱踢脚(公牌三条)', strength: 0.22, eval: eval_, blockerInfo };
        }
        case 2: {
            const tp_hi = eval_.primary;
            const tp_lo = eval_.kickers[0];
            const tp_holeContribHi = holeRanks.includes(tp_hi);
            const tp_holeContribLo = holeRanks.includes(tp_lo);
            const tp_boardHasHi = boardRanks.includes(tp_hi);
            const tp_boardHasLo = boardRanks.includes(tp_lo);

            if (tp_boardHasHi && tp_boardHasLo && !tp_holeContribHi && !tp_holeContribLo) {
                const bestHoleRank = Math.max(...holeRanks);
                const fdInfo = getFlushDrawInfo();
                const fd = !isRiver && fdInfo.hasDraw;
                const sd = !isRiver && hasStraightDraw(holeCards, boardCards);
                if (fd && sd) return { category: 'weakDraw', categoryCN: '听牌(公牌两对)', strength: 0.38, eval: eval_, blockerInfo };
                if (fd) return { category: fdInfo.isNutDraw ? 'strongDraw' : 'weakDraw', categoryCN: (fdInfo.isNutDraw ? '坚果' : '') + '同花听牌(公牌两对)', strength: fdInfo.isNutDraw ? 0.48 : 0.33, eval: eval_, blockerInfo };
                if (sd) return { category: 'weakDraw', categoryCN: '顺子听牌(公牌两对)', strength: 0.26, eval: eval_, blockerInfo };
                if (bestHoleRank >= 14) return { category: 'air', categoryCN: 'A高(公牌两对)', strength: 0.18, eval: eval_, blockerInfo };
                if (bestHoleRank >= 12) return { category: 'air', categoryCN: '高牌(公牌两对)', strength: 0.14, eval: eval_, blockerInfo };
                return { category: 'air', categoryCN: '空气(公牌两对)', strength: 0.07, eval: eval_, blockerInfo };
            }

            if (tp_holeContribHi && tp_holeContribLo) {
                // Both hole cards pair with the board
                // "Top two pair" = hero's pairs are the TOP TWO ranks on board (consecutive top)
                // "Top + bottom" = hero has top pair but second pair is NOT the 2nd highest board card
                if (tp_lo >= secondHighestBoard) {
                    // Hero's low pair is at or above 2nd board card → true top two (e.g., AK on AK7)
                    return { category: 'strongMade', categoryCN: '两对(双暗)', strength: 0.80, eval: eval_, blockerInfo };
                }
                // Hero's low pair is below 2nd board card → top + bottom (e.g., A7 on AK7)
                return { category: 'strongMade', categoryCN: '顶底两对', strength: 0.73, eval: eval_, blockerInfo };
            }
            if (tp_holeContribHi) {
                return { category: 'strongMade', categoryCN: '顶两对', strength: 0.75, eval: eval_, blockerInfo };
            }
            if (tp_holeContribLo) {
                return { category: 'mediumMade', categoryCN: '底两对', strength: 0.65, eval: eval_, blockerInfo };
            }
            return { category: 'mediumMade', categoryCN: '两对', strength: 0.68, eval: eval_, blockerInfo };
        }
        case 1: {
            const pairRank = eval_.primary;
            const boardHasPairRank = boardRanks.includes(pairRank);
            const holeHasPairRank = holeRanks.includes(pairRank);

            if (!boardHasPairRank) {
                // Pocket pair — pair rank not on board
                if (pairRank > highestBoard) {
                    // Overpair — differentiate by pair strength
                    if (pairRank >= 14) // AA
                        return { category: 'strongMade', categoryCN: '超对AA', strength: 0.82, eval: eval_, blockerInfo };
                    if (pairRank >= 13) // KK
                        return { category: 'strongMade', categoryCN: '超对KK', strength: 0.82, eval: eval_, blockerInfo };
                    if (pairRank >= 12) // QQ
                        return { category: 'strongMade', categoryCN: '超对QQ', strength: 0.76, eval: eval_, blockerInfo };
                    if (pairRank >= 11) // JJ
                        return { category: 'strongMade', categoryCN: '超对JJ', strength: 0.76, eval: eval_, blockerInfo };
                    // Smaller overpairs (TT-77 on low boards)
                    return { category: 'mediumMade', categoryCN: '小超对', strength: 0.70, eval: eval_, blockerInfo };
                }
                // Pocket pair below top card — differentiate by how close to top
                if (pairRank > secondHighestBoard) {
                    if (pairRank >= 13) {
                        // KK/QQ under an A — still very strong (only Ax beats you)
                        return { category: 'strongMade', categoryCN: `口袋${pairRank===13?'K':'Q'}K(A下)`, strength: 0.68, eval: eval_, blockerInfo };
                    }
                    if (pairRank >= 10) {
                        // TT-JJ under a higher card — decent
                        return { category: 'mediumMade', categoryCN: '中等口袋对', strength: 0.55, eval: eval_, blockerInfo };
                    }
                    return { category: 'mediumMade', categoryCN: '口袋对(超过第二大)', strength: 0.48, eval: eval_, blockerInfo };
                }
                // Below second highest board card: low underpair
                return { category: 'weakMade', categoryCN: '口袋小对', strength: 0.38, eval: eval_, blockerInfo };
            }

            if (!holeHasPairRank) {
                // Board is paired and hero doesn't contribute
                const bestHoleRank = Math.max(...holeRanks);
                const fdInfo = getFlushDrawInfo();
                const fd = !isRiver && fdInfo.hasDraw;
                const sd = !isRiver && hasStraightDraw(holeCards, boardCards);
                if (fd && sd) return { category: fdInfo.isNutDraw ? 'strongDraw' : 'weakDraw', categoryCN: (fdInfo.isNutDraw ? '坚果' : '') + '听牌(公牌对)', strength: fdInfo.isNutDraw ? 0.50 : 0.40, eval: eval_, blockerInfo };
                if (fd) return { category: fdInfo.isNutDraw ? 'strongDraw' : 'weakDraw', categoryCN: (fdInfo.isNutDraw ? '坚果' : '') + '同花听牌(公牌对)', strength: fdInfo.isNutDraw ? 0.48 : 0.35, eval: eval_, blockerInfo };
                if (sd) return { category: 'weakDraw', categoryCN: '顺子听牌(公牌对)', strength: 0.28, eval: eval_, blockerInfo };
                if (bestHoleRank >= 14) return { category: 'air', categoryCN: 'A高(公牌对)', strength: 0.18, eval: eval_, blockerInfo };
                if (bestHoleRank >= 12) return { category: 'air', categoryCN: '高牌(公牌对)', strength: 0.15, eval: eval_, blockerInfo };
                return { category: 'air', categoryCN: '空气(公牌对)', strength: 0.08, eval: eval_, blockerInfo };
            }

            // Hero's hole card matches the pair rank
            if (pairRank === highestBoard) {
                // Top pair — differentiate TPTK, TP good kicker, TP weak kicker
                const kicker = Math.max(...holeRanks.filter(r => r !== pairRank));
                // TPTK: When pair is Ace, K (13) is the best possible kicker.
                // When pair is non-Ace, A (14) is the best kicker.
                const isTrueTPTK = (pairRank === 14 && kicker >= 13) || (pairRank < 14 && kicker >= 14);
                if (isTrueTPTK) {
                    return { category: 'strongMade', categoryCN: '顶对顶踢脚(TPTK)', strength: 0.70, eval: eval_, blockerInfo };
                }
                if (kicker >= 12) {
                    // TP good kicker (Q or K kicker, when not TPTK)
                    return { category: 'mediumMade', categoryCN: '顶对强踢脚', strength: 0.62, eval: eval_, blockerInfo };
                }
                // TP weak kicker
                return { category: 'mediumMade', categoryCN: '顶对弱踢脚', strength: 0.52, eval: eval_, blockerInfo };
            }
            // Middle or bottom pair (hero contributes)
            return { category: 'weakMade', categoryCN: '中底对', strength: 0.35, eval: eval_, blockerInfo };
        }
        case 0: {
            const fdInfo = getFlushDrawInfo();
            const fd = !isRiver && fdInfo.hasDraw;
            const sd = !isRiver && hasStraightDraw(holeCards, boardCards);

            if (fd && sd) {
                // Combo draw: differentiate nut vs non-nut
                return fdInfo.isNutDraw
                    ? { category: 'strongDraw', categoryCN: '坚果同花顺听牌', strength: 0.58, eval: eval_, blockerInfo }
                    : { category: 'strongDraw', categoryCN: '同花顺听牌', strength: 0.50, eval: eval_, blockerInfo };
            }
            if (fd) {
                // Pure flush draw: nut vs non-nut
                return fdInfo.isNutDraw
                    ? { category: 'strongDraw', categoryCN: '坚果同花听牌', strength: 0.52, eval: eval_, blockerInfo }
                    : { category: 'weakDraw', categoryCN: '同花听牌', strength: 0.38, eval: eval_, blockerInfo };
            }
            if (sd) {
                return { category: 'weakDraw', categoryCN: '顺子听牌', strength: 0.35, eval: eval_, blockerInfo };
            }

            // No draw (or river — draws are now air)
            const overcards = holeRanks.filter(r => r > highestBoard).length;
            if (overcards === 2) {
                const highCard = Math.max(...holeRanks);
                const lowCard = Math.min(...holeRanks);
                // AK/AQ overcards = slightly stronger high card; others weaker
                if (highCard >= 14 && lowCard >= 12)
                    return { category: 'air', categoryCN: '两张强高牌', strength: 0.22, eval: eval_, blockerInfo };
                return { category: 'air', categoryCN: '两张高牌', strength: 0.18, eval: eval_, blockerInfo };
            }
            if (overcards === 1) return { category: 'air', categoryCN: '一张高牌', strength: 0.15, eval: eval_, blockerInfo };
            return { category: 'air', categoryCN: '空气牌', strength: 0.05, eval: eval_, blockerInfo };
        }
    }
    return { category: 'unknown', categoryCN: '未知', strength: 0 };
}

function hasFlushDraw(holeCards, boardCards) {
    for (const suit of SUITS) {
        const h = holeCards.filter(c => c.suit === suit).length;
        const b = boardCards.filter(c => c.suit === suit).length;
        if (h >= 1 && h + b === 4) return true;
    }
    return false;
}

function hasStraightDraw(holeCards, boardCards) {
    const allRanks = new Set([...holeCards, ...boardCards].map(c => RANK_VALUES[c.rank]));
    for (let base = 1; base <= 10; base++) {
        let have = 0;
        for (let i = base; i < base + 5; i++) {
            if (allRanks.has(i === 1 ? 14 : i)) have++;
        }
        if (have === 4) return true;
    }
    // Wheel
    let wheelCount = 0;
    for (const v of [14, 2, 3, 4, 5]) { if (allRanks.has(v)) wheelCount++; }
    if (wheelCount === 4) return true;
    return false;
}

// ============================================================
// Board Texture Analysis
// ============================================================

function analyzeBoardTexture(boardCards) {
    if (boardCards.length < 3) return null;

    const suitCounts = {};
    boardCards.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);
    const maxSuitCount = Math.max(...Object.values(suitCounts));

    const isMonotone = maxSuitCount >= 3 && boardCards.length === 3 ? maxSuitCount === 3 : maxSuitCount >= 3;
    const isTwoTone = maxSuitCount === 2;
    const isRainbow = maxSuitCount === 1;

    const rankVals = boardCards.map(c => RANK_VALUES[c.rank]).sort((a, b) => a - b);
    const uniqueRanks = [...new Set(rankVals)].sort((a, b) => a - b);
    const isPaired = uniqueRanks.length < boardCards.length;
    const hasHighCards = rankVals.some(r => r >= 10);

    // Connectedness
    let maxGap = 0;
    for (let i = 0; i < uniqueRanks.length - 1; i++) {
        maxGap = Math.max(maxGap, uniqueRanks[i + 1] - uniqueRanks[i]);
    }
    const connectedness = maxGap <= 2 ? 'connected' : maxGap <= 4 ? 'semi-connected' : 'disconnected';

    // Wetness score
    let wetScore = 0;
    if (maxSuitCount >= 2) wetScore += 2;
    if (isMonotone) wetScore += 2;
    if (connectedness === 'connected') wetScore += 2;
    if (connectedness === 'semi-connected') wetScore += 1;
    if (isPaired) wetScore -= 1;

    // Straight draw possible
    let straightPossible = false;
    for (let base = 2; base <= 10; base++) {
        let have = 0;
        for (let i = base; i < base + 5; i++) { if (uniqueRanks.includes(i)) have++; }
        if (have >= 2) { straightPossible = true; break; }
    }

    const wetness = wetScore >= 4 ? 'wet' : wetScore >= 2 ? 'medium' : 'dry';
    const wetnessCN = wetness === 'wet' ? '湿润' : wetness === 'medium' ? '中等' : '干燥';

    const suitDesc = isMonotone ? '同花面' : isTwoTone ? '双色' : '彩虹面';
    const connectDesc = connectedness === 'connected' ? '连接' : connectedness === 'semi-connected' ? '半连接' : '断裂';
    const highDesc = hasHighCards ? '高牌面' : '低牌面';

    return {
        wetness, wetnessCN, isMonotone, isTwoTone, isRainbow, isPaired,
        hasHighCards, connectedness, straightPossible,
        description: `${wetnessCN} | ${suitDesc} | ${highDesc} | ${connectDesc}${isPaired ? ' | 配对' : ''}`,
        suitDesc, connectDesc, highDesc
    };
}

// Export for modules
if (typeof module !== 'undefined') {
    module.exports = { SUITS, SUIT_COLORS, RANKS, RANK_VALUES, RANK_DISPLAY, makeCard, fullDeck, shuffleDeck, evaluateFive, evaluateBest, combinations, calcEquity, categorizeHand, analyzeBoardTexture, hasFlushDraw, hasStraightDraw };
}
