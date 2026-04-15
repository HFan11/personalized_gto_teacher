#!/usr/bin/env node
// ============================================================
// Solver Calibration: JS solver vs C++ precomputed reference
// Measures systematic bias per hand category and board texture.
// Also tests facing-bet strategies (fold/call/raise vs C++ children).
// Usage: node lib/calibrate-solver.js [--all] [--verbose]
// ============================================================

const fs = require('fs');
const path = require('path');
const { PostflopSolver } = require('./postflop-engine');
const { makeCard, expandRangeToComboCards, evaluateBest } = require('./hand-utils');

const FLOP_DIR = path.join(__dirname, '..', 'web', 'data', 'precomputed', 'flop');
const ALL = process.argv.includes('--all');
const VERBOSE = process.argv.includes('--verbose');

const IP_RANGE = ['AA','KK','QQ','JJ','TT','99','88','77','AKs','AKo','AQs','AJs','ATs','A9s','A5s','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','54s'];
const OOP_RANGE = [...IP_RANGE, '66','55','K9s','A4s','Q9s','J9s','J8s','Q8s','T8s','97s','86s','75s','64s','AQo','AJo','KQo'];

const SUIT_MAP = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_REV = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

function parseBoard(boardStr) {
    return boardStr.split(',').map(s => makeCard(s[0], SUIT_MAP[s[1]]));
}

function handCategory(hand, board) {
    const e = evaluateBest(hand, board);
    return e ? ['highcard','pair','twopair','trips','straight','flush','fullhouse','quads','sf'][e.tier] : 'unknown';
}

function calibrateBoard(filename) {
    const data = JSON.parse(fs.readFileSync(path.join(FLOP_DIR, filename), 'utf8'));
    const board = parseBoard(data.board);
    const cppActions = data.actions;
    const cppStrat = data.strategy;

    const checkIdx = cppActions.indexOf('CHECK');
    const betIdxs = cppActions.map((a, i) => i).filter(i => cppActions[i].startsWith('BET'));

    const ipRange = expandRangeToComboCards(IP_RANGE);
    const oopRange = expandRangeToComboCards(OOP_RANGE);

    // OOP initial action
    const solver = new PostflopSolver({
        heroRange: oopRange, villainRange: ipRange, board,
        pot: 6, stack: 97, heroIsIP: false, street: 'flop',
        betSizes: [0.33, 0.66, 1.0], iterations: 500, simsPerHand: 80,
    });
    solver.solve();

    const results = [];

    for (const combo of oopRange) {
        if (board.some(b => b.id === combo[0].id || b.id === combo[1].id)) continue;
        const cppKey = combo[0].rank + SUIT_REV[combo[0].suit] + combo[1].rank + SUIT_REV[combo[1].suit];
        const cStrat = cppStrat[cppKey];
        if (!cStrat) continue;

        const cppCheck = cStrat[checkIdx] || 0;
        const cppBet = betIdxs.reduce((s, i) => s + (cStrat[i] || 0), 0);

        const jsStrat = solver.getStrategy(combo);
        if (!jsStrat) continue;
        const jsCheck = jsStrat.check || 0;
        const jsBet = (jsStrat.bet33 || 0) + (jsStrat.bet66 || 0) + (jsStrat.bet100 || 0);

        const cat = handCategory(combo, board);
        results.push({ hand: cppKey, cat, cppCheck, cppBet, jsCheck, jsBet, diff: jsCheck - cppCheck });
    }

    // Facing bet (OOP checked, IP bet, OOP responds)
    const fbResults = [];
    if (data.children) {
        const checkChild = data.children['CHECK'];
        if (checkChild && checkChild.strategy) {
            const fbActions = checkChild.actions || [];
            const fbFoldIdx = fbActions.findIndex(a => a === 'FOLD');
            const fbCallIdx = fbActions.findIndex(a => a === 'CALL');
            // Find closest bet action for the JS solver
            const cppBetAction = fbActions.find(a => a.startsWith('BET'));
            const betPct = cppBetAction ? parseFloat(cppBetAction.split(' ')[1]) / 6 : 0.66;

            for (const combo of oopRange) {
                if (board.some(b => b.id === combo[0].id || b.id === combo[1].id)) continue;
                const cppKey = combo[0].rank + SUIT_REV[combo[0].suit] + combo[1].rank + SUIT_REV[combo[1].suit];
                const cStrat = checkChild.strategy[cppKey];
                if (!cStrat) continue;

                const cppFold = fbFoldIdx >= 0 ? (cStrat[fbFoldIdx] || 0) : 0;
                const cppCall = fbCallIdx >= 0 ? (cStrat[fbCallIdx] || 0) : 0;

                const jsStrat = solver.getStrategyFacingBet(combo, betPct);
                if (!jsStrat) continue;
                const jsFold = jsStrat.fold || 0;
                const jsCall = jsStrat.call || 0;

                const cat = handCategory(combo, board);
                fbResults.push({ hand: cppKey, cat, cppFold, cppCall, jsFold, jsCall, foldDiff: jsFold - cppFold });
            }
        }
    }

    return { initial: results, facingBet: fbResults, board: data.board };
}

// === Main ===
const files = fs.readdirSync(FLOP_DIR).filter(f => f.endsWith('.json'));
const sampleFiles = ALL ? files : files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 15)) === 0).slice(0, 15);

console.log(`\n🎯 Calibrating JS vs C++ on ${sampleFiles.length} boards...\n`);

const catStats = {};
const fbCatStats = {};
let totalHands = 0, totalAbsDiff = 0;
let totalFBHands = 0, totalFBAbsDiff = 0;

for (const file of sampleFiles) {
    const t0 = Date.now();
    const { initial, facingBet, board } = calibrateBoard(file);
    const ms = Date.now() - t0;

    let boardDiff = 0;
    for (const r of initial) {
        const ad = Math.abs(r.diff);
        boardDiff += ad; totalAbsDiff += ad; totalHands++;
        if (!catStats[r.cat]) catStats[r.cat] = { n: 0, sumDiff: 0, sumAbs: 0 };
        catStats[r.cat].n++; catStats[r.cat].sumDiff += r.diff; catStats[r.cat].sumAbs += ad;
    }

    let fbDiff = 0;
    for (const r of facingBet) {
        const ad = Math.abs(r.foldDiff);
        fbDiff += ad; totalFBAbsDiff += ad; totalFBHands++;
        if (!fbCatStats[r.cat]) fbCatStats[r.cat] = { n: 0, sumDiff: 0, sumAbs: 0 };
        fbCatStats[r.cat].n++; fbCatStats[r.cat].sumDiff += r.foldDiff; fbCatStats[r.cat].sumAbs += ad;
    }

    const avgInit = initial.length > 0 ? (boardDiff / initial.length * 100).toFixed(0) : '-';
    const avgFB = facingBet.length > 0 ? (fbDiff / facingBet.length * 100).toFixed(0) : '-';
    console.log(`  ${board.padEnd(14)} init: ${(initial.length+'').padStart(3)} hands avg|${avgInit}%|  fb: ${(facingBet.length+'').padStart(3)} hands avg|${avgFB}%|  ${ms}ms`);
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`INITIAL ACTION (check/bet):  ${totalHands} hands, avg |diff| = ${(totalAbsDiff/totalHands*100).toFixed(1)}%`);
console.log(`FACING BET (fold/call/raise): ${totalFBHands} hands, avg |fold diff| = ${(totalFBAbsDiff/totalFBHands*100).toFixed(1)}%`);

console.log(`\n📊 Initial action bias by hand category:`);
console.log(`${'Category'.padEnd(12)} ${'N'.padStart(5)} ${'Bias'.padStart(8)} ${'|Diff|'.padStart(8)}  Direction`);
console.log('─'.repeat(55));
for (const [cat, s] of Object.entries(catStats).sort((a,b) => b[1].n - a[1].n)) {
    const bias = (s.sumDiff / s.n * 100).toFixed(1);
    const abs = (s.sumAbs / s.n * 100).toFixed(1);
    const dir = parseFloat(bias) > 5 ? '← JS over-checks' : parseFloat(bias) < -5 ? '← JS over-bets' : '≈ aligned';
    console.log(`${cat.padEnd(12)} ${(s.n+'').padStart(5)} ${(bias+'%').padStart(8)} ${(abs+'%').padStart(8)}  ${dir}`);
}

console.log(`\n📊 Facing-bet bias by hand category:`);
console.log(`${'Category'.padEnd(12)} ${'N'.padStart(5)} ${'Bias'.padStart(8)} ${'|Diff|'.padStart(8)}  Direction`);
console.log('─'.repeat(55));
for (const [cat, s] of Object.entries(fbCatStats).sort((a,b) => b[1].n - a[1].n)) {
    const bias = (s.sumDiff / s.n * 100).toFixed(1);
    const abs = (s.sumAbs / s.n * 100).toFixed(1);
    const dir = parseFloat(bias) > 5 ? '← JS over-folds' : parseFloat(bias) < -5 ? '← JS under-folds' : '≈ aligned';
    console.log(`${cat.padEnd(12)} ${(s.n+'').padStart(5)} ${(bias+'%').padStart(8)} ${(abs+'%').padStart(8)}  ${dir}`);
}
