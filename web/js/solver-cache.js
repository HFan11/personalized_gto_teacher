// ============================================================
// Solver Cache Manager — Progressive Pre-computation
// Pre-computes at each user step so results are ready when needed
// Core goal: save time on bucketing → invest in more CFR iterations → higher precision
// ============================================================

class SolverCache {
    constructor() {
        this.preflopSolver = null;
        this.preflopReady = false;
        this.preflopSolving = false;

        // Range cache: "profileId|position|potType|isAgg" → [card, card][] combos
        this.rangeComboCache = new Map();

        // Equity bucket cache: "boardKey|rangeHash" → { buckets, equities, numBuckets }
        this.equityBucketCache = new Map();

        // Postflop solver cache: "boardKey|heroRange|villainRange|ip|pot|stack" → PostflopSolver
        this.postflopSolverCache = new Map();
        this.maxPostflopCache = 20; // LRU limit

        this._profileManager = null;
    }

    setProfileManager(pm) {
        this._profileManager = pm;
    }

    // ============================================================
    // Phase 1: Profile selected → Pre-warm preflop solver
    // ============================================================
    onProfileSelected() {
        if (this.preflopReady || this.preflopSolving) return;
        this.preflopSolving = true;

        // Use requestIdleCallback to avoid blocking UI
        const doSolve = () => {
            try {
                const t0 = performance.now();
                this.preflopSolver = PreflopSolver.getInstance();
                if (!this.preflopSolver.solved) {
                    this.preflopSolver.solve({ iterations: 50 });
                }
                this.preflopReady = true;
                console.log(`[Cache] Preflop solver pre-warmed in ${Math.round(performance.now() - t0)}ms`);
            } catch (e) {
                console.warn('[Cache] Preflop pre-warm failed:', e);
            }
            this.preflopSolving = false;
        };

        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(doSolve, { timeout: 3000 });
        } else {
            setTimeout(doSolve, 100);
        }
    }

    // ============================================================
    // Phase 2: Position/pot type selected → Pre-expand range combos
    // ============================================================
    preloadRangeCombos(profileId, position, potType, isAggressor) {
        if (!this._profileManager) return null;
        const key = `${profileId}|${position}|${potType || 'srp'}|${isAggressor ? 1 : 0}`;
        if (this.rangeComboCache.has(key)) return this.rangeComboCache.get(key);

        try {
            let rangeKeys;
            if (typeof getVillainPostflopRange === 'function' && potType && potType !== 'srp') {
                rangeKeys = getVillainPostflopRange(this._profileManager, profileId, position, potType, isAggressor) || [];
            } else {
                rangeKeys = this._profileManager.getRange(profileId, position) || [];
            }

            if (rangeKeys.length === 0) return null;

            const combos = expandRangeToComboCards(rangeKeys);
            this.rangeComboCache.set(key, combos);
            console.log(`[Cache] Range expanded: ${key} → ${combos.length} combos`);
            return combos;
        } catch (e) {
            console.warn('[Cache] Range expansion failed:', e);
            return null;
        }
    }

    // ============================================================
    // Phase 3: Board dealt → Pre-compute equity buckets (most expensive step)
    // Uses higher bucket count since we have time before user acts
    // ============================================================
    precomputeEquityBuckets(board, heroRange, villainRange, numBuckets) {
        numBuckets = numBuckets || 50; // Higher than real-time default (25)
        const boardKey = board.map(c => c.id).sort().join(',');
        const heroKey = boardKey + '|hero|' + numBuckets;
        const villainKey = boardKey + '|villain|' + numBuckets;

        if (this.equityBucketCache.has(heroKey)) {
            console.log('[Cache] Equity buckets already cached');
            return {
                hero: this.equityBucketCache.get(heroKey),
                villain: this.equityBucketCache.get(villainKey),
            };
        }

        const t0 = performance.now();

        // Filter ranges for board conflicts
        const filteredHero = heroRange.filter(h => !handConflictsWithBoard(h, board));
        const filteredVillain = villainRange.filter(h => !handConflictsWithBoard(h, board));

        if (filteredHero.length === 0 || filteredVillain.length === 0) return null;

        // Higher simsPerHand for better bucket accuracy (we have time)
        const simsPerHand = 200;

        const heroBuckets = computeEquityBuckets(filteredHero, board, filteredVillain, numBuckets, simsPerHand);
        const villainBuckets = computeEquityBuckets(filteredVillain, board, filteredHero, numBuckets, simsPerHand);

        this.equityBucketCache.set(heroKey, heroBuckets);
        this.equityBucketCache.set(villainKey, villainBuckets);

        console.log(`[Cache] Equity buckets pre-computed in ${Math.round(performance.now() - t0)}ms (${numBuckets} buckets, ${simsPerHand} sims/hand)`);
        return { hero: heroBuckets, villain: villainBuckets };
    }

    // Async version: pre-compute in background without blocking UI
    precomputeEquityBucketsAsync(board, heroRange, villainRange, numBuckets) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const result = this.precomputeEquityBuckets(board, heroRange, villainRange, numBuckets);
                resolve(result);
            }, 0);
        });
    }

    // ============================================================
    // Phase 4: Get cached equity buckets for PostflopSolver
    // ============================================================
    getCachedBuckets(board, numBuckets) {
        numBuckets = numBuckets || 50;
        const boardKey = board.map(c => c.id).sort().join(',');
        const heroKey = boardKey + '|hero|' + numBuckets;
        const villainKey = boardKey + '|villain|' + numBuckets;

        const hero = this.equityBucketCache.get(heroKey);
        const villain = this.equityBucketCache.get(villainKey);

        if (hero && villain) return { hero, villain };
        return null;
    }

    // ============================================================
    // Postflop solver result cache (LRU)
    // ============================================================
    cachePostflopSolver(key, solver) {
        // LRU eviction
        if (this.postflopSolverCache.size >= this.maxPostflopCache) {
            const firstKey = this.postflopSolverCache.keys().next().value;
            this.postflopSolverCache.delete(firstKey);
        }
        this.postflopSolverCache.set(key, solver);
    }

    getCachedPostflopSolver(key) {
        return this.postflopSolverCache.get(key) || null;
    }

    makePostflopCacheKey(board, heroIsIP, pot, stack, street) {
        const boardKey = board.map(c => c.id).sort().join(',');
        return `${boardKey}|${heroIsIP ? 'IP' : 'OOP'}|${Math.round(pot)}|${Math.round(stack)}|${street}`;
    }

    // ============================================================
    // Clear caches (when profile or position changes significantly)
    // ============================================================
    clearPostflopCache() {
        this.postflopSolverCache.clear();
        this.equityBucketCache.clear();
        console.log('[Cache] Postflop caches cleared');
    }

    clearAll() {
        this.rangeComboCache.clear();
        this.equityBucketCache.clear();
        this.postflopSolverCache.clear();
        this.preflopReady = false;
        this.preflopSolver = null;
        console.log('[Cache] All caches cleared');
    }
}

// Global singleton
const solverCache = new SolverCache();
