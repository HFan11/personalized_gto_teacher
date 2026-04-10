// ============================================================
// CFR Solver Web Worker — runs solver in background thread
// Main thread stays responsive while solving
// ============================================================

importScripts(
    'poker-core.js',
    'cfr-solver.js',
    'hand-abstraction.js',
    'preflop-solver.js',
    'postflop-solver.js'
);

// Cached preflop solver (persists across messages in same worker)
let preflopSolver = null;

self.onmessage = function(e) {
    const { type, id, data } = e.data;

    try {
        if (type === 'solve-preflop') {
            if (!preflopSolver) {
                preflopSolver = PreflopSolver.getInstance();
                if (!preflopSolver.solved) {
                    preflopSolver.solve({ iterations: data.iterations || 50 });
                }
            }
            const strategy = preflopSolver.getStrategy(data.position, data.hand, data.scenario, data.villainPosition);
            self.postMessage({ id, type: 'result', data: { strategy } });

        } else if (type === 'solve-postflop') {
            const config = data;
            // Reconstruct card objects from serialized data
            const heroRange = config.heroRange; // already card objects from expandRangeToComboCards
            const villainRange = config.villainRange;
            const board = config.board;

            const solver = new PostflopSolver({
                heroRange,
                villainRange,
                board,
                pot: config.pot,
                stack: config.stack,
                heroIsIP: config.heroIsIP,
                street: config.street,
                betSizes: config.betSizes || [0.33, 0.66, 1.0],
                numBuckets: config.numBuckets || 30,
                iterations: config.iterations || 1500,
                simsPerHand: config.simsPerHand || 150,
            });

            const solveOptions = {};
            if (config.precomputedHeroBuckets) {
                solveOptions.precomputedHeroBuckets = config.precomputedHeroBuckets;
                solveOptions.precomputedVillainBuckets = config.precomputedVillainBuckets;
            }

            const t0 = performance.now();
            solver.solve(solveOptions);
            const solveTimeMs = Math.round(performance.now() - t0);

            // Get strategy for hero's hand
            let strategy = null;
            if (config.holeCards) {
                if (config.facingBet && config.betSizePct) {
                    strategy = solver.getStrategyFacingBet(config.holeCards, config.betSizePct);
                }
                if (!strategy) {
                    strategy = solver.getStrategy(config.holeCards);
                }
            }

            self.postMessage({ id, type: 'result', data: { strategy, solveTimeMs } });

        } else if (type === 'precompute-buckets') {
            const { board, heroRange, villainRange, numBuckets, simsPerHand } = data;
            const filteredHero = heroRange.filter(h => !handConflictsWithBoard(h, board));
            const filteredVillain = villainRange.filter(h => !handConflictsWithBoard(h, board));

            if (filteredHero.length === 0 || filteredVillain.length === 0) {
                self.postMessage({ id, type: 'result', data: null });
                return;
            }

            const t0 = performance.now();
            const heroBuckets = computeEquityBuckets(filteredHero, board, filteredVillain, numBuckets || 50, simsPerHand || 200);
            const villainBuckets = computeEquityBuckets(filteredVillain, board, filteredHero, numBuckets || 50, simsPerHand || 200);
            const precomputeTimeMs = Math.round(performance.now() - t0);

            self.postMessage({ id, type: 'result', data: { heroBuckets, villainBuckets, precomputeTimeMs } });
        }
    } catch (err) {
        self.postMessage({ id, type: 'error', error: err.message });
    }
};
