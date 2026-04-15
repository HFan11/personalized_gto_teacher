// ============================================================
// Postflop CFR+ Solver
// Builds per-street game trees with action/hand abstraction
// and solves using the CFR+ engine
// ============================================================

class PostflopSolver {
    constructor(config) {
        this.heroRange = config.heroRange || [];       // array of [card, card] combos
        this.villainRange = config.villainRange || [];
        this.board = config.board || [];               // [card, card, card, ...]
        this.pot = config.pot || 6;
        this.effectiveStack = config.stack || 100;
        this.heroIsIP = config.heroIsIP !== undefined ? config.heroIsIP : true;
        this.street = config.street || 'flop';
        this.betSizes = config.betSizes || [0.33, 0.66, 1.0];
        this.raiseMultiplier = config.raiseMultiplier || 2.5;
        this.numBuckets = config.numBuckets || 30;
        this.iterations = config.iterations || 2000;
        this.simsPerHand = config.simsPerHand || 80;

        this.solver = new CFRSolver({ iterations: this.iterations });
        this.heroBuckets = null;
        this.villainBuckets = null;
        this.solvedStrategies = null;
    }

    // Main solve method — returns strategies for the current street
    // options.precomputedHeroBuckets / precomputedVillainBuckets: inject pre-cached buckets
    // When buckets are injected, we skip the expensive bucketing step and use higher CFR iterations
    solve(options = {}) {
        let iters = options.iterations || this.iterations;

        // Step 1: Filter ranges to exclude hands conflicting with board
        const heroHands = this.heroRange.filter(h => !handConflictsWithBoard(h, this.board));
        const villainHands = this.villainRange.filter(h => !handConflictsWithBoard(h, this.board));

        if (heroHands.length === 0 || villainHands.length === 0) {
            return null;
        }

        // Step 2: Use pre-computed buckets if available, otherwise compute
        let heroBucketResult, villainBucketResult;

        if (options.precomputedHeroBuckets && options.precomputedVillainBuckets) {
            // Pre-cached buckets available → skip bucketing, invest time in more iterations
            heroBucketResult = options.precomputedHeroBuckets;
            villainBucketResult = options.precomputedVillainBuckets;
            this.numBuckets = Math.max(heroBucketResult.numBuckets, villainBucketResult.numBuckets);
            // Boost iterations since we saved bucketing time
            iters = Math.max(iters, 2500);
            console.log(`[Solver] Using pre-cached buckets (${this.numBuckets} buckets), boosted to ${iters} iterations`);
        } else {
            heroBucketResult = computeEquityBuckets(
                heroHands, this.board, villainHands, this.numBuckets, this.simsPerHand
            );
            villainBucketResult = computeEquityBuckets(
                villainHands, this.board, heroHands, this.numBuckets, this.simsPerHand
            );
        }

        this.heroBuckets = heroBucketResult;
        this.villainBuckets = villainBucketResult;

        // Step 3: Build game tree for current street
        const oopPlayer = this.heroIsIP ? 1 : 0; // who is OOP? if hero is IP, villain(1) is OOP... wait
        // Convention: player 0 = OOP, player 1 = IP
        // If hero is IP: hero = player 1, villain = player 0
        // If hero is OOP: hero = player 0, villain = player 1
        const root = this._buildStreetTree(this.pot, this.effectiveStack);

        // Step 4: Prepare hand buckets as integer indices for CFR
        const oopBuckets = this.heroIsIP ? villainBucketResult : heroBucketResult;
        const ipBuckets = this.heroIsIP ? heroBucketResult : villainBucketResult;

        const oopBucketIds = this._getUniqueBucketIds(oopBuckets);
        const ipBucketIds = this._getUniqueBucketIds(ipBuckets);

        // Step 5: Define info set key function
        const infoSetKeyFn = (node, handBucket, player) => {
            return `${this.street}|p${player}|b${handBucket}|${this._getActionPath(node)}`;
        };

        // Step 6: Run CFR+ with seeded Monte Carlo sampling
        // Seeded PRNG = deterministic (same board → same result)
        // Monte Carlo sampling = better mixed strategies in bucket abstraction
        // (full traversal over-converges to pure strategies in coarse buckets)
        const boardSeed = typeof hashSeed === 'function'
            ? hashSeed(this.board.map(c => c.id).join(','))
            : 42;

        const totalPairs = oopBucketIds.length * ipBucketIds.length;
        // Sample enough pairs for good coverage but cap at 500
        const samplesPerIter = Math.min(totalPairs, Math.max(200, totalPairs));

        // Store for incremental iterations (worker can call solver.solve() again)
        this._lastRoot = root;
        this._lastHands = [oopBucketIds, ipBucketIds];
        this._lastKeyFn = infoSetKeyFn;
        this._lastSeed = boardSeed;
        this._lastSamples = samplesPerIter;

        this.solver.reset();
        this.solvedStrategies = this.solver.solve(
            root,
            [oopBucketIds, ipBucketIds],
            infoSetKeyFn,
            {
                iterations: iters,
                conflictFn: (b0, b1) => false,
                seed: boardSeed,
                samplesPerIter: samplesPerIter,
            }
        );

        return this.solvedStrategies;
    }

    // Get strategy for specific hole cards
    // Returns: { check: freq, bet33: freq, bet66: freq, bet100: freq, fold: freq, call: freq, raise: freq }
    getStrategy(holeCards) {
        if (!this.solvedStrategies || !this.heroBuckets) return null;

        const heroPlayer = this.heroIsIP ? 1 : 0;
        const bucketMap = this.heroBuckets.buckets;
        const bucket = getHandBucket(holeCards, bucketMap);

        // Look up first decision point for this bucket
        // OOP decides at 'root', IP decides at 'root>check' (after OOP checks)
        const actionPath = heroPlayer === 0 ? 'root' : 'root>check';
        const key = `${this.street}|p${heroPlayer}|b${bucket}|${actionPath}`;
        let strat = this.solvedStrategies.get(key);

        if (!strat) {
            // Fallback: search for any matching key at the expected decision point
            const prefix = `${this.street}|p${heroPlayer}|b${bucket}|`;
            const suffix = heroPlayer === 0 ? 'root' : 'root>check';
            for (const [k, v] of this.solvedStrategies) {
                if (k.startsWith(prefix) && k.endsWith(suffix)) {
                    strat = v;
                    break;
                }
            }
            if (!strat) return null;
        }

        // Determine which action set this is
        const context = heroPlayer === 0 ? 'oop_first' : 'ip_facing_check';
        return this._formatStrategy(strat, context);
    }

    // Get strategy when facing a specific action
    getStrategyFacingBet(holeCards, betSizePct) {
        if (!this.solvedStrategies || !this.heroBuckets) return null;

        const heroPlayer = this.heroIsIP ? 1 : 0;
        const bucket = getHandBucket(holeCards, this.heroBuckets.buckets);

        // Find the strategy for facing a bet
        const betLabel = this._closestBetLabel(betSizePct);
        const actionPath = heroPlayer === 0
            ? `root>check>${betLabel}`    // OOP checked, IP bet, OOP responds
            : `root>${betLabel}`;          // OOP bet, IP responds

        const key = `${this.street}|p${heroPlayer}|b${bucket}|${actionPath}`;
        const strat = this.solvedStrategies.get(key);

        if (!strat) return null;
        return this._formatStrategy(strat, 'facing_bet');
    }

    // Get all strategies across all hands for range visualization
    getAllStrategies() {
        if (!this.solvedStrategies) return null;

        const result = {
            hero: [],
            villain: [],
        };

        const heroPlayer = this.heroIsIP ? 1 : 0;
        const villainPlayer = 1 - heroPlayer;

        const heroHands = this.heroIsIP ? this.heroRange : this.heroRange;
        const heroBMap = this.heroBuckets.buckets;

        for (const hand of heroHands) {
            if (handConflictsWithBoard(hand, this.board)) continue;
            const bucket = getHandBucket(hand, heroBMap);
            const key = `${this.street}|p${heroPlayer}|b${bucket}|root`;
            const strat = this.solvedStrategies.get(key);
            if (strat) {
                result.hero.push({
                    hand: [hand[0].id, hand[1].id],
                    canonical: handToCanonical(hand[0], hand[1]),
                    bucket,
                    equity: this.heroBuckets.equities.get(hand[0].id + '|' + hand[1].id) || 0.5,
                    strategy: this._formatStrategy(strat, heroPlayer === 0 ? 'oop_first' : 'ip_facing_check'),
                });
            }
        }

        return result;
    }

    // Build game tree for one street
    _buildStreetTree(pot, stack) {
        const spr = stack / pot;

        // Root: OOP acts first (player 0)
        const oopActions = ['check'];
        const oopBetActions = [];

        for (const size of this.betSizes) {
            if (pot * size <= stack) {
                oopBetActions.push(`bet${Math.round(size * 100)}`);
                oopActions.push(`bet${Math.round(size * 100)}`);
            }
        }

        // Add all-in if SPR < 3
        if (spr < 3 && stack > 0) {
            oopActions.push('allin');
        }

        const root = new GameNode(NodeType.PLAYER, 0, oopActions, pot, [stack, stack]);
        root._actionPath = 'root';

        // OOP checks → IP acts
        const ipAfterCheck = this._buildIPNode(pot, stack, 'root>check');
        root.children = { check: ipAfterCheck };

        // OOP bets → IP responds
        for (const betAction of oopBetActions) {
            const sizePct = parseInt(betAction.replace('bet', '')) / 100;
            const betAmount = Math.min(pot * sizePct, stack);
            const newPot = pot + betAmount;
            const newStack = stack - betAmount;

            const ipFacingBet = this._buildFacingBetNode(1, newPot, newStack, betAmount, `root>${betAction}`);
            root.children[betAction] = ipFacingBet;
        }

        // OOP all-in
        if (oopActions.includes('allin')) {
            const newPot = pot + stack;
            root.children['allin'] = this._buildFacingBetNode(1, newPot, 0, stack, 'root>allin');
        }

        return root;
    }

    // IP node after OOP checks
    _buildIPNode(pot, stack, pathPrefix) {
        const spr = stack / pot;
        const actions = ['check'];

        for (const size of this.betSizes) {
            if (pot * size <= stack) {
                actions.push(`bet${Math.round(size * 100)}`);
            }
        }

        if (spr < 3 && stack > 0) {
            actions.push('allin');
        }

        const node = new GameNode(NodeType.PLAYER, 1, actions, pot, [stack, stack]);
        node._actionPath = pathPrefix;

        // IP checks → terminal (showdown or next street)
        const checkTerminal = new GameNode(NodeType.TERMINAL, -1, [], pot, [stack, stack]);
        checkTerminal.payoffs = this._makeShowdownPayoffs(pot);
        node.children = { check: checkTerminal };

        // IP bets → OOP responds
        for (const action of actions) {
            if (action === 'check') continue;

            if (action === 'allin') {
                const newPot = pot + stack;
                node.children['allin'] = this._buildFacingBetNode(0, newPot, 0, stack, `${pathPrefix}>allin`);
            } else {
                const sizePct = parseInt(action.replace('bet', '')) / 100;
                const betAmount = Math.min(pot * sizePct, stack);
                const newPot = pot + betAmount;
                const newStack = stack - betAmount;

                node.children[action] = this._buildFacingBetNode(0, newPot, newStack, betAmount, `${pathPrefix}>${action}`);
            }
        }

        return node;
    }

    // Node for player facing a bet: fold / call / raise
    _buildFacingBetNode(player, pot, remainingStack, betToCall, pathPrefix) {
        const actions = ['fold', 'call'];

        // Can raise if enough stack
        const raiseAmount = betToCall * this.raiseMultiplier;
        if (remainingStack >= raiseAmount) {
            actions.push('raise');
        } else if (remainingStack > betToCall && remainingStack > 0) {
            actions.push('allin');
        }

        const node = new GameNode(NodeType.PLAYER, player, actions, pot, [remainingStack, remainingStack]);
        node._actionPath = pathPrefix;

        // Fold → opponent wins pot
        const foldNode = new GameNode(NodeType.TERMINAL, -1, [], pot, null);
        foldNode.payoffs = (h0, h1) => {
            // Player who folded loses their investment
            if (player === 0) return [-betToCall, betToCall]; // OOP folds, IP wins
            return [betToCall, -betToCall]; // IP folds, OOP wins
        };

        // Call → showdown (or next street — simplified as showdown)
        const callPot = pot + betToCall;
        const callStack = remainingStack - betToCall;
        const callNode = new GameNode(NodeType.TERMINAL, -1, [], callPot, [callStack, callStack]);
        callNode.payoffs = this._makeShowdownPayoffs(callPot);

        node.children = { fold: foldNode, call: callNode };

        // Raise
        if (actions.includes('raise')) {
            const newPot = pot + betToCall + raiseAmount;
            const newStack = remainingStack - betToCall - raiseAmount;
            // After raise, opponent faces the raise
            const opponent = 1 - player;
            node.children['raise'] = this._buildFacingBetNode(
                opponent, newPot, Math.max(0, newStack), raiseAmount, `${pathPrefix}>raise`
            );
        }

        // All-in
        if (actions.includes('allin')) {
            const allinAmount = remainingStack;
            const newPot = pot + betToCall + allinAmount;
            const opponent = 1 - player;
            // All-in → opponent can fold or call
            const allinNode = this._buildFacingBetNode(opponent, newPot, 0, allinAmount, `${pathPrefix}>allin`);
            node.children['allin'] = allinNode;
        }

        return node;
    }

    // Create showdown payoff function based on equity buckets
    _makeShowdownPayoffs(pot) {
        const halfPot = pot / 2;
        return (bucketOOP, bucketIP) => {
            // Use actual bucket count (may be less than configured numBuckets if range is small)
            const actualBuckets = Math.max(
                this.heroBuckets?.numBuckets || this.numBuckets,
                this.villainBuckets?.numBuckets || this.numBuckets,
                Math.max(bucketOOP, bucketIP) + 1 // at least enough to cover the bucket IDs
            );
            const eqOOP = (bucketOOP + 0.5) / actualBuckets;
            const eqIP = (bucketIP + 0.5) / actualBuckets;

            // Normalize to zero-sum
            const oopShare = eqOOP / (eqOOP + eqIP);
            return [
                pot * oopShare - halfPot,   // OOP payoff
                pot * (1 - oopShare) - halfPot  // IP payoff
            ];
        };
    }

    // Get action path for a node (for info set key)
    _getActionPath(node) {
        return node._actionPath || 'root';
    }

    // Get unique bucket IDs from bucket result
    _getUniqueBucketIds(bucketResult) {
        const ids = new Set(bucketResult.buckets.values());
        return [...ids].sort((a, b) => a - b);
    }

    // Find closest bet label for a given bet size percentage
    _closestBetLabel(pct) {
        let closest = this.betSizes[0];
        let minDiff = Math.abs(pct - closest);
        for (const size of this.betSizes) {
            const diff = Math.abs(pct - size);
            if (diff < minDiff) {
                minDiff = diff;
                closest = size;
            }
        }
        return `bet${Math.round(closest * 100)}`;
    }

    // Format raw strategy array into labeled object
    _formatStrategy(stratArray, context) {
        if (!stratArray) return null;

        const result = {};

        switch (context) {
            case 'oop_first': {
                // OOP acting first: check, bet sizes...
                const actions = ['check'];
                for (const size of this.betSizes) {
                    actions.push(`bet${Math.round(size * 100)}`);
                }
                for (let i = 0; i < Math.min(stratArray.length, actions.length); i++) {
                    result[actions[i]] = stratArray[i] || 0;
                }
                break;
            }
            case 'ip_facing_check': {
                // IP after OOP checks: check, bet sizes...
                const actions = ['check'];
                for (const size of this.betSizes) {
                    actions.push(`bet${Math.round(size * 100)}`);
                }
                for (let i = 0; i < Math.min(stratArray.length, actions.length); i++) {
                    result[actions[i]] = stratArray[i] || 0;
                }
                break;
            }
            case 'facing_bet': {
                // Facing a bet: fold, call, raise
                const actions = ['fold', 'call', 'raise'];
                for (let i = 0; i < Math.min(stratArray.length, actions.length); i++) {
                    result[actions[i]] = stratArray[i] || 0;
                }
                break;
            }
            default: {
                for (let i = 0; i < stratArray.length; i++) {
                    result[`action${i}`] = stratArray[i] || 0;
                }
            }
        }

        return result;
    }
}

// ============================================================
// Convenience: solve a specific postflop spot
// ============================================================

function solvePostflopSpot(config) {
    const solver = new PostflopSolver({
        heroRange: config.heroRange,
        villainRange: config.villainRange,
        board: config.board,
        pot: config.pot || 6,
        stack: config.stack || 100,
        heroIsIP: config.heroIsIP !== undefined ? config.heroIsIP : true,
        street: config.street || 'flop',
        betSizes: config.betSizes || [0.33, 0.66, 1.0],
        numBuckets: config.numBuckets || 30,
        iterations: config.iterations || 2000,
        simsPerHand: config.simsPerHand || 150,
    });

    solver.solve();
    return solver;
}
