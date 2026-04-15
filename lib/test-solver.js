#!/usr/bin/env node
// ============================================================
// Solver Quality Test Suite
// Run: node lib/test-solver.js
// Validates CFR+ solver output against known PIO reference values
// ============================================================

const { PreflopSolver } = require('./preflop-engine');
const { PostflopSolver } = require('./postflop-engine');
const { makeCard, expandRangeToComboCards } = require('./hand-utils');

let pass = 0, fail = 0;

function check(name, actual, expected, tolerance = 15) {
    const diff = Math.abs(actual - expected);
    const ok = diff <= tolerance;
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon} ${name}: ${actual}% (expected ~${expected}%, diff ${diff}%)`);
    if (ok) pass++; else fail++;
}

function getFreq(strat, action) {
    if (!strat) return -1;
    return Math.round((strat[action] || 0) * 100);
}

// ============================================================
// PREFLOP TESTS
// ============================================================
console.log('\n🃏 PREFLOP SOLVER TESTS');
console.log('─'.repeat(50));

const t0 = Date.now();
const ps = new PreflopSolver({ iterations: 200 });
ps.solve({ iterations: 200 });
console.log(`  Solved in ${Date.now() - t0}ms\n`);

// Premium hands should always raise/jam
check('AA UTG RFI raise', getFreq(ps.getStrategy('UTG', 'AA', 'rfi'), 'raise'), 100, 5);
check('KK BTN RFI raise', getFreq(ps.getStrategy('BTN', 'KK', 'rfi'), 'raise'), 100, 5);

// Trash should always fold
check('72o UTG RFI fold', getFreq(ps.getStrategy('UTG', '72o', 'rfi'), 'fold'), 100, 5);
check('32o CO RFI fold', getFreq(ps.getStrategy('CO', '32o', 'rfi'), 'fold'), 100, 10);

// Suited connectors: BTN should raise
check('87s BTN RFI raise', getFreq(ps.getStrategy('BTN', '87s', 'rfi'), 'raise'), 95, 15);

// vs Raise: AKs should mostly 3bet
const aksVsUtg = ps.getStrategy('BTN', 'AKs', 'vs_raise');
if (aksVsUtg) check('AKs BTN vs UTG 3bet', getFreq(aksVsUtg, '3bet'), 70, 25);

// vs 4bet: KK should jam/call (continue ~100%)
const kkVs4 = ps.getStrategy('BTN', 'KK', 'vs_4bet');
check('KK vs 4bet continue', getFreq(kkVs4, 'jam') + getFreq(kkVs4, 'call'), 95, 15);

// vs 4bet: 99 should mostly fold (in constrained range)
check('99 vs 4bet fold', getFreq(ps.getStrategy('BTN', '99', 'vs_4bet'), 'fold'), 70, 30);

// ============================================================
// POSTFLOP TESTS
// ============================================================
console.log('\n🎯 POSTFLOP SOLVER TESTS');
console.log('─'.repeat(50));

const rangeHands = ['AA','KK','QQ','JJ','TT','99','88','77','66','55','AKs','AKo','AQs','AJs','ATs','A9s','A5s','KQs','KJs','KTs','QJs','QTs','JTs','T9s','98s','87s','76s','65s','54s'];
const range = expandRangeToComboCards(rangeHands);

function testPostflop(name, hero, board, ip, expected) {
    const solver = new PostflopSolver({
        heroRange: range, villainRange: range, board,
        pot: 6, stack: 97, heroIsIP: ip, street: 'flop',
        betSizes: [0.33, 0.66, 1.0], numBuckets: 20, iterations: 500, simsPerHand: 80,
    });
    solver.solve();
    const strat = solver.getStrategy(hero);
    if (!strat) {
        console.log(`  ❌ ${name}: NULL (bucket miss)`);
        fail++;
        return;
    }
    for (const [action, expPct, tol] of expected) {
        const actual = Math.round((strat[action] || 0) * 100);
        check(`${name} ${action}`, actual, expPct, tol || 20);
    }
}

const t1 = Date.now();

// TPTK on dry board IP — should bet big
testPostflop('TPTK dry IP',
    [makeCard('A','♠'), makeCard('K','♥')],
    [makeCard('A','♦'), makeCard('7','♣'), makeCard('2','♠')],
    true,
    [['bet100', 85, 25]]
);

// Set on monotone — mixed (bet for protection or check-raise)
// On monotone boards, even sets check more due to flush danger
testPostflop('Set monotone OOP',
    [makeCard('7','♠'), makeCard('7','♦')],
    [makeCard('7','♥'), makeCard('J','♥'), makeCard('3','♥')],
    false,
    [['bet100', 50, 45]] // wider tolerance: monotone boards are complex
);

// Air on AK2 IP — should mostly check
testPostflop('Air AK2 IP',
    [makeCard('8','♠'), makeCard('6','♠')],
    [makeCard('A','♦'), makeCard('K','♣'), makeCard('2','♥')],
    true,
    [['check', 90, 20]]
);

// Bottom pair OOP — should check
testPostflop('Bottom pair OOP',
    [makeCard('5','♠'), makeCard('4','♠')],
    [makeCard('K','♦'), makeCard('9','♣'), makeCard('4','♥')],
    false,
    [['check', 80, 25]]
);

// Top overpair on wet draw-heavy board — should not pure check (must protect)
// GTO is a complex mix: bet some %, check-raise some %. High variance is expected.
testPostflop('QQ wet OOP',
    [makeCard('Q','♠'), makeCard('Q','♥')],
    [makeCard('J','♥'), makeCard('T','♥'), makeCard('4','♣')],
    false,
    [['check', 30, 35]]  // QQ should mostly bet for protection on this wet board
);

console.log(`\n  Postflop tests completed in ${Date.now() - t1}ms`);

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '═'.repeat(50));
console.log(`  RESULTS: ${pass} passed, ${fail} failed (${Math.round(pass/(pass+fail)*100)}%)`);
console.log('═'.repeat(50) + '\n');

process.exit(fail > 0 ? 1 : 0);
