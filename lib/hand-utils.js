// ============================================================
// hand-utils.js — CommonJS module
// Combines poker-core and hand-abstraction logic for Node.js
// ============================================================

// ============================================================
// Constants
// ============================================================

const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

// ============================================================
// Card Utilities
// ============================================================

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
    const isWheel = [14, 2, 3, 4, 5].every(v => ranks.includes(v));

    // Royal Flush
    if (isFlush && isStraight && ranks.includes(14) && ranks.includes(13))
        return { tier: 9, name: 'Royal Flush', nameCN: '\u7687\u5bb6\u540c\u82b1\u987a', primary: 14, kickers: [], score: 9000000 + 14 };

    // Straight Flush
    if (isFlush && isStraight)
        return { tier: 8, name: 'Straight Flush', nameCN: '\u540c\u82b1\u987a', primary: ranks[0], kickers: [], score: 8000000 + ranks[0] };
    if (isFlush && isWheel)
        return { tier: 8, name: 'Straight Flush', nameCN: '\u540c\u82b1\u987a', primary: 5, kickers: [], score: 8000000 + 5 };

    // Four of a Kind
    if (sorted[0][1] === 4)
        return { tier: 7, name: 'Four of a Kind', nameCN: '\u56db\u6761', primary: sorted[0][0], kickers: [sorted[1][0]], score: 7000000 + sorted[0][0] * 100 + sorted[1][0] };

    // Full House
    if (sorted[0][1] === 3 && sorted[1][1] === 2)
        return { tier: 6, name: 'Full House', nameCN: '\u846b\u82a6', primary: sorted[0][0], kickers: [sorted[1][0]], score: 6000000 + sorted[0][0] * 100 + sorted[1][0] };

    // Flush
    if (isFlush)
        return { tier: 5, name: 'Flush', nameCN: '\u540c\u82b1', primary: ranks[0], kickers: ranks.slice(1), score: 5000000 + ranks[0] * 10000 + ranks[1] * 1000 + ranks[2] * 100 + ranks[3] * 10 + ranks[4] };

    // Straight
    if (isStraight)
        return { tier: 4, name: 'Straight', nameCN: '\u987a\u5b50', primary: ranks[0], kickers: [], score: 4000000 + ranks[0] };
    if (isWheel)
        return { tier: 4, name: 'Straight', nameCN: '\u987a\u5b50', primary: 5, kickers: [], score: 4000000 + 5 };

    // Three of a Kind
    if (sorted[0][1] === 3)
        return { tier: 3, name: 'Three of a Kind', nameCN: '\u4e09\u6761', primary: sorted[0][0], kickers: sorted.slice(1).map(s => s[0]).sort((a,b) => b-a), score: 3000000 + sorted[0][0] * 10000 + sorted[1][0] * 100 + sorted[2][0] };

    // Two Pair
    if (sorted[0][1] === 2 && sorted[1][1] === 2) {
        const hi = Math.max(sorted[0][0], sorted[1][0]);
        const lo = Math.min(sorted[0][0], sorted[1][0]);
        return { tier: 2, name: 'Two Pair', nameCN: '\u4e24\u5bf9', primary: hi, kickers: [lo, sorted[2][0]], score: 2000000 + hi * 10000 + lo * 100 + sorted[2][0] };
    }

    // One Pair
    if (sorted[0][1] === 2)
        return { tier: 1, name: 'One Pair', nameCN: '\u4e00\u5bf9', primary: sorted[0][0], kickers: sorted.slice(1).map(s => s[0]).sort((a,b) => b-a), score: 1000000 + sorted[0][0] * 10000 + sorted[1][0] * 100 + sorted[2][0] * 10 + sorted[3][0] };

    // High Card
    return { tier: 0, name: 'High Card', nameCN: '\u9ad8\u724c', primary: ranks[0], kickers: ranks.slice(1), score: ranks[0] * 10000 + ranks[1] * 1000 + ranks[2] * 100 + ranks[3] * 10 + ranks[4] };
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

function calcEquity(holeCards, boardCards, villainRange, sims) {
    sims = sims || 2000;
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
// Draw Detection Helpers
// ============================================================

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
// Postflop Hand Category
// ============================================================

function categorizeHand(holeCards, boardCards) {
    if (boardCards.length < 3) return { category: 'unknown', categoryCN: '\u672a\u77e5', strength: 0 };

    const eval_ = evaluateBest(holeCards, boardCards);
    const boardRanks = boardCards.map(c => RANK_VALUES[c.rank]);
    const holeRanks = holeCards.map(c => RANK_VALUES[c.rank]);
    const highestBoard = Math.max(...boardRanks);
    const sortedBoardRanks = [...boardRanks].sort((a, b) => b - a);
    const secondHighestBoard = sortedBoardRanks.length >= 2 ? sortedBoardRanks[1] : 0;
    const isRiver = boardCards.length === 5;

    // --- Flush draw detection helpers ---
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

    // --- Blocker detection ---
    function getBlockerInfo() {
        const suitCounts = {};
        boardCards.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);
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
            return { category: 'nuts', categoryCN: '\u575a\u679c\u724c', strength: 1.0, eval: eval_, blockerInfo };
        case 6:
            return { category: 'nuts', categoryCN: '\u575a\u679c\u724c', strength: 0.95, eval: eval_, blockerInfo };
        case 5:
            return eval_.primary >= 13
                ? { category: 'nuts', categoryCN: '\u575a\u679c\u724c', strength: 0.92, eval: eval_, blockerInfo }
                : { category: 'strongMade', categoryCN: '\u5f3a\u6210\u724c', strength: 0.85, eval: eval_, blockerInfo };
        case 4:
            return { category: 'strongMade', categoryCN: '\u5f3a\u6210\u724c', strength: 0.82, eval: eval_, blockerInfo };
        case 3: {
            const isSet = holeRanks.some(r => holeRanks.filter(x => x === r).length === 2);
            if (isSet) {
                return { category: 'nuts', categoryCN: '\u6697\u4e09\u6761(Set)', strength: 0.92, eval: eval_, blockerInfo };
            }
            if (holeRanks.includes(eval_.primary)) {
                return { category: 'strongMade', categoryCN: '\u660e\u4e09\u6761(Trips)', strength: 0.78, eval: eval_, blockerInfo };
            }
            const trip_bestKicker = Math.max(...holeRanks);
            if (trip_bestKicker >= 14) return { category: 'weakMade', categoryCN: 'A\u8e22\u811a(\u516c\u724c\u4e09\u6761)', strength: 0.45, eval: eval_, blockerInfo };
            if (trip_bestKicker >= 12) return { category: 'weakMade', categoryCN: '\u9ad8\u8e22\u811a(\u516c\u724c\u4e09\u6761)', strength: 0.35, eval: eval_, blockerInfo };
            return { category: 'air', categoryCN: '\u5f31\u8e22\u811a(\u516c\u724c\u4e09\u6761)', strength: 0.22, eval: eval_, blockerInfo };
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
                if (fd && sd) return { category: 'weakDraw', categoryCN: '\u542c\u724c(\u516c\u724c\u4e24\u5bf9)', strength: 0.38, eval: eval_, blockerInfo };
                if (fd) return { category: fdInfo.isNutDraw ? 'strongDraw' : 'weakDraw', categoryCN: (fdInfo.isNutDraw ? '\u575a\u679c' : '') + '\u540c\u82b1\u542c\u724c(\u516c\u724c\u4e24\u5bf9)', strength: fdInfo.isNutDraw ? 0.48 : 0.33, eval: eval_, blockerInfo };
                if (sd) return { category: 'weakDraw', categoryCN: '\u987a\u5b50\u542c\u724c(\u516c\u724c\u4e24\u5bf9)', strength: 0.26, eval: eval_, blockerInfo };
                if (bestHoleRank >= 14) return { category: 'air', categoryCN: 'A\u9ad8(\u516c\u724c\u4e24\u5bf9)', strength: 0.18, eval: eval_, blockerInfo };
                if (bestHoleRank >= 12) return { category: 'air', categoryCN: '\u9ad8\u724c(\u516c\u724c\u4e24\u5bf9)', strength: 0.14, eval: eval_, blockerInfo };
                return { category: 'air', categoryCN: '\u7a7a\u6c14(\u516c\u724c\u4e24\u5bf9)', strength: 0.07, eval: eval_, blockerInfo };
            }

            if (tp_holeContribHi && tp_holeContribLo) {
                return { category: 'strongMade', categoryCN: '\u4e24\u5bf9(\u53cc\u6697)', strength: 0.80, eval: eval_, blockerInfo };
            }
            if (tp_holeContribHi) {
                return { category: 'strongMade', categoryCN: '\u9876\u4e24\u5bf9', strength: 0.75, eval: eval_, blockerInfo };
            }
            if (tp_holeContribLo) {
                return { category: 'mediumMade', categoryCN: '\u5e95\u4e24\u5bf9', strength: 0.65, eval: eval_, blockerInfo };
            }
            return { category: 'mediumMade', categoryCN: '\u4e24\u5bf9', strength: 0.68, eval: eval_, blockerInfo };
        }
        case 1: {
            const pairRank = eval_.primary;
            const boardHasPairRank = boardRanks.includes(pairRank);
            const holeHasPairRank = holeRanks.includes(pairRank);

            if (!boardHasPairRank) {
                if (pairRank > highestBoard) {
                    if (pairRank >= 14)
                        return { category: 'strongMade', categoryCN: '\u8d85\u5bf9AA', strength: 0.82, eval: eval_, blockerInfo };
                    if (pairRank >= 13)
                        return { category: 'strongMade', categoryCN: '\u8d85\u5bf9KK', strength: 0.82, eval: eval_, blockerInfo };
                    if (pairRank >= 12)
                        return { category: 'strongMade', categoryCN: '\u8d85\u5bf9QQ', strength: 0.76, eval: eval_, blockerInfo };
                    if (pairRank >= 11)
                        return { category: 'strongMade', categoryCN: '\u8d85\u5bf9JJ', strength: 0.76, eval: eval_, blockerInfo };
                    return { category: 'mediumMade', categoryCN: '\u5c0f\u8d85\u5bf9', strength: 0.70, eval: eval_, blockerInfo };
                }
                if (pairRank > secondHighestBoard) {
                    return { category: 'mediumMade', categoryCN: '\u53e3\u888b\u5bf9(\u8d85\u8fc7\u7b2c\u4e8c\u5927)', strength: 0.50, eval: eval_, blockerInfo };
                }
                return { category: 'weakMade', categoryCN: '\u53e3\u888b\u5c0f\u5bf9', strength: 0.40, eval: eval_, blockerInfo };
            }

            if (!holeHasPairRank) {
                const bestHoleRank = Math.max(...holeRanks);
                const fdInfo = getFlushDrawInfo();
                const fd = !isRiver && fdInfo.hasDraw;
                const sd = !isRiver && hasStraightDraw(holeCards, boardCards);
                if (fd && sd) return { category: fdInfo.isNutDraw ? 'strongDraw' : 'weakDraw', categoryCN: (fdInfo.isNutDraw ? '\u575a\u679c' : '') + '\u542c\u724c(\u516c\u724c\u5bf9)', strength: fdInfo.isNutDraw ? 0.50 : 0.40, eval: eval_, blockerInfo };
                if (fd) return { category: fdInfo.isNutDraw ? 'strongDraw' : 'weakDraw', categoryCN: (fdInfo.isNutDraw ? '\u575a\u679c' : '') + '\u540c\u82b1\u542c\u724c(\u516c\u724c\u5bf9)', strength: fdInfo.isNutDraw ? 0.48 : 0.35, eval: eval_, blockerInfo };
                if (sd) return { category: 'weakDraw', categoryCN: '\u987a\u5b50\u542c\u724c(\u516c\u724c\u5bf9)', strength: 0.28, eval: eval_, blockerInfo };
                if (bestHoleRank >= 14) return { category: 'air', categoryCN: 'A\u9ad8(\u516c\u724c\u5bf9)', strength: 0.18, eval: eval_, blockerInfo };
                if (bestHoleRank >= 12) return { category: 'air', categoryCN: '\u9ad8\u724c(\u516c\u724c\u5bf9)', strength: 0.15, eval: eval_, blockerInfo };
                return { category: 'air', categoryCN: '\u7a7a\u6c14(\u516c\u724c\u5bf9)', strength: 0.08, eval: eval_, blockerInfo };
            }

            if (pairRank === highestBoard) {
                const kicker = Math.max(...holeRanks.filter(r => r !== pairRank));
                const isTrueTPTK = (pairRank === 14 && kicker >= 13) || (pairRank < 14 && kicker >= 14);
                if (isTrueTPTK) {
                    return { category: 'strongMade', categoryCN: '\u9876\u5bf9\u9876\u8e22\u811a(TPTK)', strength: 0.70, eval: eval_, blockerInfo };
                }
                if (kicker >= 12) {
                    return { category: 'mediumMade', categoryCN: '\u9876\u5bf9\u5f3a\u8e22\u811a', strength: 0.62, eval: eval_, blockerInfo };
                }
                return { category: 'mediumMade', categoryCN: '\u9876\u5bf9\u5f31\u8e22\u811a', strength: 0.52, eval: eval_, blockerInfo };
            }
            return { category: 'weakMade', categoryCN: '\u4e2d\u5e95\u5bf9', strength: 0.35, eval: eval_, blockerInfo };
        }
        case 0: {
            const fdInfo = getFlushDrawInfo();
            const fd = !isRiver && fdInfo.hasDraw;
            const sd = !isRiver && hasStraightDraw(holeCards, boardCards);

            if (fd && sd) {
                return fdInfo.isNutDraw
                    ? { category: 'strongDraw', categoryCN: '\u575a\u679c\u540c\u82b1\u987a\u542c\u724c', strength: 0.58, eval: eval_, blockerInfo }
                    : { category: 'strongDraw', categoryCN: '\u540c\u82b1\u987a\u542c\u724c', strength: 0.50, eval: eval_, blockerInfo };
            }
            if (fd) {
                return fdInfo.isNutDraw
                    ? { category: 'strongDraw', categoryCN: '\u575a\u679c\u540c\u82b1\u542c\u724c', strength: 0.52, eval: eval_, blockerInfo }
                    : { category: 'weakDraw', categoryCN: '\u540c\u82b1\u542c\u724c', strength: 0.38, eval: eval_, blockerInfo };
            }
            if (sd) {
                return { category: 'weakDraw', categoryCN: '\u987a\u5b50\u542c\u724c', strength: 0.35, eval: eval_, blockerInfo };
            }

            const overcards = holeRanks.filter(r => r > highestBoard).length;
            if (overcards === 2) {
                const highCard = Math.max(...holeRanks);
                const lowCard = Math.min(...holeRanks);
                if (highCard >= 14 && lowCard >= 12)
                    return { category: 'air', categoryCN: '\u4e24\u5f20\u5f3a\u9ad8\u724c', strength: 0.22, eval: eval_, blockerInfo };
                return { category: 'air', categoryCN: '\u4e24\u5f20\u9ad8\u724c', strength: 0.18, eval: eval_, blockerInfo };
            }
            if (overcards === 1) return { category: 'air', categoryCN: '\u4e00\u5f20\u9ad8\u724c', strength: 0.15, eval: eval_, blockerInfo };
            return { category: 'air', categoryCN: '\u7a7a\u6c14\u724c', strength: 0.05, eval: eval_, blockerInfo };
        }
    }
    return { category: 'unknown', categoryCN: '\u672a\u77e5', strength: 0 };
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
    const wetnessCN = wetness === 'wet' ? '\u6e7f\u6da6' : wetness === 'medium' ? '\u4e2d\u7b49' : '\u5e72\u71e5';

    const suitDesc = isMonotone ? '\u540c\u82b1\u9762' : isTwoTone ? '\u53cc\u8272' : '\u5f69\u8679\u9762';
    const connectDesc = connectedness === 'connected' ? '\u8fde\u63a5' : connectedness === 'semi-connected' ? '\u534a\u8fde\u63a5' : '\u65ad\u88c2';
    const highDesc = hasHighCards ? '\u9ad8\u724c\u9762' : '\u4f4e\u724c\u9762';

    return {
        wetness, wetnessCN, isMonotone, isTwoTone, isRainbow, isPaired,
        hasHighCards, connectedness, straightPossible,
        description: `${wetnessCN} | ${suitDesc} | ${highDesc} | ${connectDesc}${isPaired ? ' | \u914d\u5bf9' : ''}`,
        suitDesc, connectDesc, highDesc
    };
}

// ============================================================
// Hand Abstraction — Canonical Hands, Equity Buckets
// ============================================================

function handToCanonical(card1, card2) {
    const rv = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const r1 = rv[card1.rank], r2 = rv[card2.rank];
    const high = r1 >= r2 ? card1.rank : card2.rank;
    const low = r1 >= r2 ? card2.rank : card1.rank;

    if (card1.rank === card2.rank) return high + low;           // "AA"
    if (card1.suit === card2.suit) return high + low + 's';     // "AKs"
    return high + low + 'o';                                     // "AKo"
}

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

function combosForHand(handKey) {
    if (handKey.length === 2) return 6;      // pair: C(4,2) = 6
    if (handKey.endsWith('s')) return 4;      // suited: 4
    return 12;                                // offsuit: 12
}

function fastEquityEstimate(holeCards, boardCards, villainRange, sims) {
    sims = sims || 200;
    const usedIds = new Set([...holeCards, ...boardCards].map(c => c.id));
    const deck = fullDeck().filter(c => !usedIds.has(c.id));
    const boardNeed = 5 - boardCards.length;
    let wins = 0, ties = 0, total = 0;

    for (let i = 0; i < sims; i++) {
        const shuffled = shuffleDeck(deck);
        let idx = 0;
        const simBoard = [...boardCards];
        for (let j = 0; j < boardNeed; j++) simBoard.push(shuffled[idx++]);

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

function computeEquityBuckets(hands, boardCards, villainRange, numBuckets, simsPerHand) {
    numBuckets = numBuckets || 30;
    simsPerHand = simsPerHand || 200;

    const equities = new Map();
    const usedBoard = new Set(boardCards.map(c => c.id));
    const strengthBonus = [0, 0, 0.04, 0.06, 0.08, 0.08, 0.10, 0.12, 0.15];

    for (const hand of hands) {
        if (usedBoard.has(hand[0].id) || usedBoard.has(hand[1].id)) continue;
        const key = hand[0].id + '|' + hand[1].id;
        let eq = fastEquityEstimate(hand, boardCards, villainRange, simsPerHand);
        const eval5 = evaluateBest(hand, boardCards);
        if (eval5 && eval5.tier >= 2) eq = Math.min(0.99, eq + (strengthBonus[eval5.tier] || 0));
        equities.set(key, eq);
    }

    const sorted = [...equities.entries()].sort((a, b) => a[1] - b[1]);
    const buckets = new Map();
    const bucketSize = Math.max(1, Math.ceil(sorted.length / numBuckets));

    for (let i = 0; i < sorted.length; i++) {
        const bucketId = Math.min(numBuckets - 1, Math.floor(i / bucketSize));
        buckets.set(sorted[i][0], bucketId);
    }

    return { buckets, equities, numBuckets: Math.min(numBuckets, sorted.length) };
}

function getHandBucket(hand, bucketMap) {
    const key = hand[0].id + '|' + hand[1].id;
    const b = bucketMap.get(key);
    if (b !== undefined) return b;
    const keyRev = hand[1].id + '|' + hand[0].id;
    return bucketMap.get(keyRev) || 0;
}

// ============================================================
// Range Utilities
// ============================================================

function expandHandToComboCards(handKey) {
    const suits = ['\u2660', '\u2665', '\u2666', '\u2663'];
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

function expandRangeToComboCards(rangeKeys) {
    const combos = [];
    for (const key of rangeKeys) {
        combos.push(...expandHandToComboCards(key));
    }
    return combos;
}

function handsConflict(hand1, hand2) {
    return hand1[0].id === hand2[0].id || hand1[0].id === hand2[1].id ||
           hand1[1].id === hand2[0].id || hand1[1].id === hand2[1].id;
}

function handConflictsWithBoard(hand, boardCards) {
    const boardIds = new Set(boardCards.map(c => c.id));
    return boardIds.has(hand[0].id) || boardIds.has(hand[1].id);
}

// ============================================================
// CommonJS Exports
// ============================================================

module.exports = {
    // Constants
    SUITS,
    RANKS,
    RANK_VALUES,
    // Card utilities
    makeCard,
    fullDeck,
    shuffleDeck,
    // Hand evaluation
    evaluateFive,
    combinations,
    evaluateBest,
    // Equity
    calcEquity,
    // Draw detection
    hasFlushDraw,
    hasStraightDraw,
    // Hand categorization
    categorizeHand,
    // Board texture
    analyzeBoardTexture,
    // Canonical hands
    handToCanonical,
    generate169Hands,
    combosForHand,
    // Equity buckets
    fastEquityEstimate,
    computeEquityBuckets,
    getHandBucket,
    // Range utilities
    expandHandToComboCards,
    expandRangeToComboCards,
    handsConflict,
    handConflictsWithBoard,
};
