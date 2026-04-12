#!/usr/bin/env node
// ============================================================
// Local Batch Solver — spawns solver process per board, kills after each
// Handles crashes gracefully. Run on M2 Pro 32GB.
// Usage: node solver/precompute/local-batch.js
// ============================================================

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { FLOP_BOARDS } = require('./boards');

const SOLVER_BIN = path.join(__dirname, '../build/solver_api');
const RESOURCES = path.join(__dirname, '../resources');
const OUTPUT_DIR = path.join(__dirname, '../../web/data/precomputed/flop');
const PORT = 9090;

const RANGE_IP = 'AA,KK,QQ,JJ,TT,99,88,77,AKs,AKo,AQs,AJs,ATs,A9s,A5s,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s,AQo,AJo,KQo';
const RANGE_OOP = 'AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AKo,AQs,AJs,ATs,A9s,A5s,A4s,KQs,KJs,KTs,K9s,QJs,QTs,Q9s,JTs,J9s,T9s,98s,87s,76s,65s,54s,AQo,AJo,KQo,KJo';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function killPort(port) {
    try { execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' }); } catch(e) {}
}

async function solveOneBoard(board, category, index, total) {
    const filename = board.replace(/,/g, '_') + '.json';
    const filepath = path.join(OUTPUT_DIR, filename);

    // Skip if exists
    if (fs.existsSync(filepath)) {
        console.log(`  ⏭ [${index}/${total}] ${board} — exists`);
        return true;
    }

    // Kill any leftover solver
    killPort(PORT);
    await sleep(1000);

    // Start solver
    const solver = spawn(SOLVER_BIN, ['--port', String(PORT), '--resources', RESOURCES], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for server ready
    let ready = false;
    for (let i = 0; i < 10; i++) {
        await sleep(1000);
        try {
            const resp = await fetch(`http://localhost:${PORT}/health`);
            if (resp.ok) { ready = true; break; }
        } catch(e) {}
    }

    if (!ready) {
        console.log(`  ❌ [${index}/${total}] ${board} — solver failed to start`);
        solver.kill('SIGKILL');
        return false;
    }

    // Solve
    console.log(`  🔄 [${index}/${total}] ${board} (${category})...`);
    const t0 = Date.now();

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600000); // 10 min

        const resp = await fetch(`http://localhost:${PORT}/api/solve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                range_ip: RANGE_IP, range_oop: RANGE_OOP,
                board, round: 1,
                oop_commit: 3, ip_commit: 3, stack: 100,
                iterations: 50, threads: 1,
                ip_flop_bet: [33,66], ip_flop_raise: [100],
                oop_flop_bet: [33,66], oop_flop_raise: [100],
                ip_turn_bet: [50], ip_turn_raise: [100],
                oop_turn_bet: [50], oop_turn_raise: [100],
                ip_river_bet: [66], ip_river_raise: [100],
                oop_river_bet: [66], oop_river_raise: [100],
                dump_depth: 1,
            }),
        });
        clearTimeout(timeout);

        const data = await resp.json();
        if (data.error || !data.strategy) throw new Error(data.error || 'No strategy');

        // Extract and save compact format
        const root = data.strategy?.strategy || {};
        const childrenRaw = data.strategy?.childrens || {};
        const compact = {
            board, category, round: 1,
            iterations: data.iterations,
            solve_time_ms: data.solve_time_ms,
            actions: root.actions || [],
            strategy: root.strategy || {},
            children: {},
        };

        for (const [k, v] of Object.entries(childrenRaw)) {
            if (v?.strategy) {
                compact.children[k] = {
                    actions: v.strategy.actions || [],
                    strategy: v.strategy.strategy || {},
                    player: v.player,
                };
            }
        }

        fs.writeFileSync(filepath, JSON.stringify(compact));
        const elapsed = Math.round((Date.now() - t0) / 1000);
        const remaining = Math.round(elapsed * (total - index) / 60);
        console.log(`  ✅ [${index}/${total}] ${board} — ${elapsed}s (ETA: ${remaining} min)`);

        solver.kill('SIGKILL');
        return true;
    } catch(e) {
        console.log(`  ❌ [${index}/${total}] ${board} — ${e.message}`);
        solver.kill('SIGKILL');
        return false;
    }
}

async function main() {
    console.log(`\n🃏 LOCAL FLOP BATCH — M2 Pro 32GB`);
    console.log(`Boards: ${FLOP_BOARDS.length} | Solver: ${SOLVER_BIN}`);
    console.log(`Output: ${OUTPUT_DIR}\n`);

    let done = 0, failed = 0;
    for (let i = 0; i < FLOP_BOARDS.length; i++) {
        const { board, category } = FLOP_BOARDS[i];
        const ok = await solveOneBoard(board, category, i + 1, FLOP_BOARDS.length);
        if (ok) done++; else failed++;
        await sleep(2000); // cool-down between solves
    }

    console.log(`\n✅ Batch complete: ${done} done, ${failed} failed`);
    killPort(PORT);
}

main();
