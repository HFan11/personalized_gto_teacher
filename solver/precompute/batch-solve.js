#!/usr/bin/env node
// ============================================================
// Batch Pre-computation Script
// Runs flop + turn solves via Railway C++ API, saves results as JSON
// Usage: node solver/precompute/batch-solve.js [--flop] [--turn] [--url URL]
// ============================================================

const fs = require('fs');
const path = require('path');
const { FLOP_BOARDS } = require('./boards');

const API_URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
    || 'https://personalizedgtoteacher-production.up.railway.app';
const DO_FLOP = process.argv.includes('--flop') || (!process.argv.includes('--turn'));
const DO_TURN = process.argv.includes('--turn');
const OUTPUT_DIR = path.join(__dirname, '../../web/data/precomputed');

// LAG range (widest standard range)
const RANGE_IP = 'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A5s,A4s,A3s,A2s,KQs,KJs,KTs,K9s,K8s,QJs,QTs,Q9s,Q8s,JTs,J9s,J8s,T9s,T8s,T7s,98s,97s,87s,86s,76s,75s,65s,64s,54s,53s,43s,AKo,AQo,AJo,ATo,A9o,KQo,KJo,KTo,QJo,QTo,JTo';
const RANGE_OOP = 'AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,KQs,KJs,KTs,K9s,K8s,K7s,K6s,K5s,QJs,QTs,Q9s,Q8s,Q7s,JTs,J9s,J8s,T9s,T8s,T7s,98s,97s,96s,87s,86s,76s,75s,65s,64s,54s,53s,43s,AKo,AQo,AJo,ATo,KQo,KJo,QJo,JTo,T9o,98o';

// Bet sizes (simplified for manageable tree size)
const BET_SIZES = {
    ip_flop_bet: [33, 66],
    ip_flop_raise: [100],
    oop_flop_bet: [33, 66],
    oop_flop_raise: [100],
    ip_turn_bet: [50, 100],
    ip_turn_raise: [100],
    oop_turn_bet: [50, 100],
    oop_turn_raise: [100],
    ip_river_bet: [66, 100],
    ip_river_raise: [100],
    oop_river_bet: [66, 100],
    oop_river_raise: [100],
};

async function solveBoard(board, round, iterations, threads) {
    const body = {
        range_ip: RANGE_IP,
        range_oop: RANGE_OOP,
        board,
        round,
        oop_commit: 3,
        ip_commit: 3,
        stack: 100,
        iterations,
        threads,
        dump_depth: 1,
        ...BET_SIZES,
    };

    const resp = await fetch(API_URL + '/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (data.error || data.code) {
        throw new Error(data.error || data.message || `HTTP ${data.code}`);
    }
    return data;
}

function boardToFilename(board) {
    return board.replace(/,/g, '_').replace(/\s/g, '');
}

async function runFlopBatch() {
    console.log(`\n🃏 FLOP BATCH: ${FLOP_BOARDS.length} boards`);
    console.log('=' .repeat(50));

    fs.mkdirSync(path.join(OUTPUT_DIR, 'flop'), { recursive: true });

    let done = 0, failed = 0;
    const startTime = Date.now();

    for (const { board, category } of FLOP_BOARDS) {
        const filename = boardToFilename(board) + '.json';
        const filepath = path.join(OUTPUT_DIR, 'flop', filename);

        // Skip if already computed
        if (fs.existsSync(filepath)) {
            console.log(`  ⏭ ${board} (${category}) — already exists`);
            done++;
            continue;
        }

        try {
            console.log(`  🔄 ${board} (${category})...`);
            const result = await solveBoard(board, 1, 50, 8);

            // Extract root strategy (compact format)
            const rootStrat = result.strategy?.strategy;
            const compact = {
                board,
                category,
                round: 1,
                iterations: result.iterations,
                solve_time_ms: result.solve_time_ms,
                actions: rootStrat?.actions || [],
                strategy: rootStrat?.strategy || {},
                // Also store first-level children (villain bet responses)
                children: {},
            };

            // Store children strategies (for facing-bet scenarios)
            const children = result.strategy?.childrens || {};
            for (const [action, child] of Object.entries(children)) {
                if (child?.strategy) {
                    compact.children[action] = {
                        actions: child.strategy.actions || [],
                        strategy: child.strategy.strategy || {},
                        player: child.player,
                    };
                }
            }

            fs.writeFileSync(filepath, JSON.stringify(compact));
            console.log(`  ✅ ${board} — ${Math.round(result.solve_time_ms / 1000)}s`);
            done++;
        } catch (e) {
            console.log(`  ❌ ${board} — ${e.message}`);
            failed++;
        }

        // Progress
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = (elapsed / (done + failed)) * (FLOP_BOARDS.length - done - failed);
        console.log(`  [${done + failed}/${FLOP_BOARDS.length}] ETA: ${Math.round(remaining / 60)} min`);
    }

    console.log(`\nFlop batch complete: ${done} done, ${failed} failed`);
}

async function runTurnBatch() {
    console.log(`\n🎯 TURN BATCH`);
    console.log('=' .repeat(50));

    fs.mkdirSync(path.join(OUTPUT_DIR, 'turn'), { recursive: true });

    const TURN_CARDS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
    const SUITS = ['c','d','h','s'];

    let done = 0, failed = 0, skipped = 0;
    const startTime = Date.now();

    for (const { board: flopBoard } of FLOP_BOARDS) {
        const flopCards = flopBoard.split(',');
        const flopRanks = flopCards.map(c => c[0]);
        const flopSuits = flopCards.map(c => c[1]);

        // Generate all possible turn cards (not already on board)
        for (const rank of TURN_CARDS) {
            // Use one representative suit (suit isomorphism for turn)
            const suit = flopSuits.includes('c') ? (flopSuits.includes('d') ? 'h' : 'd') : 'c';
            const turnCard = rank + suit;

            // Skip if turn card conflicts with flop
            if (flopCards.includes(turnCard)) continue;
            // Skip duplicate ranks (suit isomorphism — one suit per rank is enough)
            if (flopRanks.includes(rank)) {
                // For paired turn cards, use a different suit
                const altSuit = SUITS.find(s => !flopCards.some(fc => fc === rank + s));
                if (!altSuit) continue;
            }

            const turnBoard = flopBoard + ',' + turnCard;
            const filename = boardToFilename(turnBoard) + '.json';
            const filepath = path.join(OUTPUT_DIR, 'turn', filename);

            if (fs.existsSync(filepath)) {
                skipped++;
                continue;
            }

            try {
                const result = await solveBoard(turnBoard, 2, 100, 4);

                const rootStrat = result.strategy?.strategy;
                const compact = {
                    board: turnBoard,
                    flop: flopBoard,
                    round: 2,
                    iterations: result.iterations,
                    solve_time_ms: result.solve_time_ms,
                    actions: rootStrat?.actions || [],
                    strategy: rootStrat?.strategy || {},
                    children: {},
                };

                const children = result.strategy?.childrens || {};
                for (const [action, child] of Object.entries(children)) {
                    if (child?.strategy) {
                        compact.children[action] = {
                            actions: child.strategy.actions || [],
                            strategy: child.strategy.strategy || {},
                        };
                    }
                }

                fs.writeFileSync(filepath, JSON.stringify(compact));
                done++;

                if (done % 10 === 0) {
                    const elapsed = (Date.now() - startTime) / 1000;
                    console.log(`  Turn: ${done} done, ${failed} failed, ${skipped} skipped — ${Math.round(elapsed/60)}min elapsed`);
                }
            } catch (e) {
                failed++;
            }
        }
    }

    console.log(`\nTurn batch complete: ${done} done, ${failed} failed, ${skipped} skipped`);
}

async function main() {
    console.log(`API: ${API_URL}`);
    console.log(`Output: ${OUTPUT_DIR}`);
    console.log(`Ranges: IP=${RANGE_IP.split(',').length} hands, OOP=${RANGE_OOP.split(',').length} hands`);

    if (DO_FLOP) await runFlopBatch();
    if (DO_TURN) await runTurnBatch();

    console.log('\n✅ All batches complete!');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
