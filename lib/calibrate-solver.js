#!/usr/bin/env node
// ============================================================
// Solver Calibration: JS solver vs C++ precomputed reference
// Measures systematic bias across hundreds of hands × boards
// ============================================================

const fs = require('fs');
const path = require('path');
const { PostflopSolver } = require('./postflop-engine');
const { makeCard, expandRangeToComboCards, evaluateBest, generate169Hands } = require('./hand-utils');

const FLOP_DIR = path.join(__dirname, '..', 'web', 'data', 'precomputed', 'flop');

// The range used in precomputed solutions
const IP_RANGE = ['AA','KK','QQ','JJ','TT','99','88','77','AKs','AKo','AQs','AJs','ATs','A9s','A5s','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','54s'];
const OOP_RANGE = [...IP_RANGE, '66','55','K9s','A4s','Q9s','J9s','J8s','Q8s','T8s','97s','86s','75s','64s','AQo','AJo','KQo'];

function parseBoard(boardStr) {
    // "As,Kd,7c" → [makeCard('A','♠'), makeCard('K','♦'), makeCard('7','♣')]
    const suitMap = { s: '♠', h: '♥', d: '♦', c: '♣' };
    return boardStr.split(',').map(s => {
        const rank = s[0];
        const suit = suitMap[s[1]];
        return makeCard(rank, suit);
    });
}

function handToComboKey(card1, card2) {
    return card1.id + '|' + card2.id;
}

function categorizeHand(hand, board) {
    const eval5 = evaluateBest(hand, board);
    if (!eval5) return 'unknown';
    const tiers = ['highcard', 'pair', 'twopair', 'trips', 'straight', 'flush', 'fullhouse', 'quads', 'straightflush'];
    return tiers[eval5.tier] || 'unknown';
}

// Load precomputed C++ solution and compare with JS solver
function calibrateBoard(filename) {
    const data = JSON.parse(fs.readFileSync(path.join(FLOP_DIR, filename), 'utf8'));
    const board = parseBoard(data.board);
    const cppActions = data.actions; // ["CHECK", "BET 3.000000", "BET 97.000000"]
    const cppStrategy = data.strategy; // { "AcKd": [check%, bet_small%, bet_large%], ... }

    // Map C++ actions to JS actions
    // C++ "CHECK" → JS "check", C++ "BET 3.0" → JS "bet33" or "bet66", C++ "BET 97.0" → JS "bet100"
    const cppCheckIdx = cppActions.indexOf('CHECK');
    const cppBetIdxs = cppActions.map((a, i) => i).filter(i => cppActions[i].startsWith('BET'));

    // Run JS solver on same board
    const ipRange = expandRangeToComboCards(IP_RANGE);
    const oopRange = expandRangeToComboCards(OOP_RANGE);

    const solver = new PostflopSolver({
        heroRange: oopRange, villainRange: ipRange,
        board, pot: 6, stack: 97, heroIsIP: false, street: 'flop',
        betSizes: [0.33, 0.66, 1.0], iterations: 500, simsPerHand: 80,
    });
    solver.solve();

    const results = [];
    const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

    // For each hand in C++ solution, compare with JS solution
    for (const oopCombo of oopRange) {
        if (board.some(b => b.id === oopCombo[0].id || b.id === oopCombo[1].id)) continue;

        // C++ key format: "AcKd" (rank+suit, no unicode)
        const cppKey = oopCombo[0].rank + suitMap[oopCombo[0].suit] + oopCombo[1].rank + suitMap[oopCombo[1].suit];
        const cppStrat = cppStrategy[cppKey];
        if (!cppStrat) continue;

        // C++ frequencies
        const cppCheck = cppStrat[cppCheckIdx] || 0;
        const cppBet = cppBetIdxs.reduce((s, i) => s + (cppStrat[i] || 0), 0);

        // JS strategy
        const jsStrat = solver.getStrategy(oopCombo);
        if (!jsStrat) continue;

        const jsCheck = jsStrat.check || 0;
        const jsBet = (jsStrat.bet33 || 0) + (jsStrat.bet66 || 0) + (jsStrat.bet100 || 0);

        const handCat = categorizeHand(oopCombo, board);

        results.push({
            board: data.board,
            hand: cppKey,
            category: handCat,
            cppCheck: Math.round(cppCheck * 100),
            cppBet: Math.round(cppBet * 100),
            jsCheck: Math.round(jsCheck * 100),
            jsBet: Math.round(jsBet * 100),
            checkDiff: Math.round((jsCheck - cppCheck) * 100),
            betDiff: Math.round((jsBet - cppBet) * 100),
        });
    }

    return results;
}

// === Main ===
const files = fs.readdirSync(FLOP_DIR).filter(f => f.endsWith('.json'));
const sampleFiles = files.length > 10 ? files.filter((_, i) => i % Math.floor(files.length / 10) === 0).slice(0, 10) : files;

console.log(`Calibrating JS solver against ${sampleFiles.length} C++ reference boards...\n`);

const allResults = [];
const categoryStats = {};
let totalHands = 0;
let totalAbsDiff = 0;

for (const file of sampleFiles) {
    const t0 = Date.now();
    const results = calibrateBoard(file);
    const ms = Date.now() - t0;

    let boardAbsDiff = 0;
    for (const r of results) {
        const absDiff = Math.abs(r.checkDiff);
        boardAbsDiff += absDiff;
        totalAbsDiff += absDiff;
        totalHands++;

        // Aggregate by category
        if (!categoryStats[r.category]) categoryStats[r.category] = { count: 0, totalCheckDiff: 0, totalAbsDiff: 0, overCheck: 0, overBet: 0 };
        const cs = categoryStats[r.category];
        cs.count++;
        cs.totalCheckDiff += r.checkDiff;
        cs.totalAbsDiff += absDiff;
        if (r.checkDiff > 10) cs.overCheck++;
        if (r.checkDiff < -10) cs.overBet++;
    }

    const avgAbsDiff = results.length > 0 ? (boardAbsDiff / results.length).toFixed(1) : 0;
    console.log(`  ${file.padEnd(25)} ${results.length} hands  avg|diff|=${avgAbsDiff}%  ${ms}ms`);
    allResults.push(...results);
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`TOTAL: ${totalHands} hands across ${sampleFiles.length} boards`);
console.log(`Average |check diff|: ${(totalAbsDiff / totalHands).toFixed(1)}%`);
console.log(`\nBias by hand category:`);
console.log(`${'Category'.padEnd(15)} ${'Count'.padStart(6)} ${'Avg Bias'.padStart(10)} ${'Avg |Diff|'.padStart(12)} ${'Over-check'.padStart(12)} ${'Over-bet'.padStart(12)}`);
console.log('─'.repeat(70));

for (const [cat, stats] of Object.entries(categoryStats).sort((a, b) => b[1].count - a[1].count)) {
    const avgBias = (stats.totalCheckDiff / stats.count).toFixed(1);
    const avgAbs = (stats.totalAbsDiff / stats.count).toFixed(1);
    const biasSign = parseFloat(avgBias) > 0 ? '+' : '';
    console.log(`${cat.padEnd(15)} ${(stats.count + '').padStart(6)} ${(biasSign + avgBias + '%').padStart(10)} ${(avgAbs + '%').padStart(12)} ${(stats.overCheck + '').padStart(12)} ${(stats.overBet + '').padStart(12)}`);
}

// Show worst 10 cases
console.log(`\nWorst 10 divergences (JS vs C++):`);
const worst = allResults.sort((a, b) => Math.abs(b.checkDiff) - Math.abs(a.checkDiff)).slice(0, 10);
for (const w of worst) {
    console.log(`  ${w.hand} on ${w.board.padEnd(12)} [${w.category}]: C++ check=${w.cppCheck}% JS check=${w.jsCheck}% (diff=${w.checkDiff > 0 ? '+' : ''}${w.checkDiff}%)`);
}
