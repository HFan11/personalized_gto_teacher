// ============================================================
// CFR+ Core Solver Engine
// Counterfactual Regret Minimization Plus for Poker
// ============================================================

// Deterministic PRNG (mulberry32) — same seed = same results
function seededRandom(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Hash a string to a 32-bit integer for seeding
function hashSeed(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

// Information Set: stores regret and strategy for one decision point
class InfoSet {
    constructor(numActions) {
        this.numActions = numActions;
        this.regretSum = new Float64Array(numActions);   // cumulative regret (CFR+ clips to 0)
        this.strategySum = new Float64Array(numActions);  // cumulative strategy (for averaging)
    }

    // Regret-matching: convert positive regrets into a probability distribution
    getStrategy(realizationWeight) {
        const strategy = new Float64Array(this.numActions);
        let normalizingSum = 0;

        for (let a = 0; a < this.numActions; a++) {
            strategy[a] = Math.max(0, this.regretSum[a]);
            normalizingSum += strategy[a];
        }

        for (let a = 0; a < this.numActions; a++) {
            if (normalizingSum > 0) {
                strategy[a] /= normalizingSum;
            } else {
                strategy[a] = 1.0 / this.numActions;
            }
            this.strategySum[a] += realizationWeight * strategy[a];
        }

        return strategy;
    }

    // Average strategy across all iterations — this is the Nash equilibrium approximation
    getAverageStrategy() {
        const avgStrategy = new Float64Array(this.numActions);
        let normalizingSum = 0;

        for (let a = 0; a < this.numActions; a++) {
            normalizingSum += this.strategySum[a];
        }

        for (let a = 0; a < this.numActions; a++) {
            if (normalizingSum > 0) {
                avgStrategy[a] = this.strategySum[a] / normalizingSum;
            } else {
                avgStrategy[a] = 1.0 / this.numActions;
            }
        }

        return avgStrategy;
    }
}

// Game tree node types
const NodeType = {
    TERMINAL: 'terminal',
    CHANCE: 'chance',
    PLAYER: 'player',
};

// Game tree node
class GameNode {
    constructor(type, player, actions, pot, stacks) {
        this.type = type;       // NodeType
        this.player = player;   // 0 (OOP) or 1 (IP)
        this.actions = actions; // string[] — action labels
        this.children = {};     // action → GameNode
        this.pot = pot;
        this.stacks = stacks;   // [oopStack, ipStack]
        // For terminal nodes:
        this.payoffs = null;    // function(handBucketOOP, handBucketIP) → [payoffOOP, payoffIP]
        // For chance nodes:
        this.chanceOutcomes = null; // [{prob, child}]
    }
}

// CFR+ Solver — works on any game tree with information sets
class CFRSolver {
    constructor(config = {}) {
        this.infoSets = new Map();  // key → InfoSet
        this.iterations = config.iterations || 2000;
        this.exploitabilityHistory = [];
    }

    getOrCreateInfoSet(key, numActions) {
        let infoSet = this.infoSets.get(key);
        if (!infoSet) {
            infoSet = new InfoSet(numActions);
            this.infoSets.set(key, infoSet);
        }
        return infoSet;
    }

    // Main solve loop: runs CFR+ for N iterations
    // NOTE: does NOT reset info sets — calling solve() multiple times
    // continues from previous state (incremental iterations)
    // Returns: Map of infoSetKey → average strategy
    solve(root, hands, infoSetKeyFn, options = {}) {
        const iters = options.iterations || this.iterations;
        const earlyStop = options.earlyStopThreshold || 0;
        const samplesPerIter = options.samplesPerIter || 0;
        const n0 = hands[0].length, n1 = hands[1].length;

        // Use seeded PRNG for deterministic results (same seed = same output)
        const seed = options.seed || 42;
        const rng = seededRandom(seed);

        for (let t = 0; t < iters; t++) {
            if (samplesPerIter > 0 && n0 * n1 > samplesPerIter) {
                for (let s = 0; s < samplesPerIter; s++) {
                    const h0 = hands[0][Math.floor(rng() * n0)];
                    const h1 = hands[1][Math.floor(rng() * n1)];
                    if (options.conflictFn && options.conflictFn(h0, h1)) continue;
                    this._cfr(root, [h0, h1], [1.0, 1.0], infoSetKeyFn);
                }
            } else {
                // Full traversal (for small games)
                for (let i0 = 0; i0 < n0; i0++) {
                    for (let i1 = 0; i1 < n1; i1++) {
                        if (options.conflictFn && options.conflictFn(hands[0][i0], hands[1][i1])) continue;
                        this._cfr(root, [hands[0][i0], hands[1][i1]], [1.0, 1.0], infoSetKeyFn);
                    }
                }
            }

            // Track convergence every 200 iterations
            if (earlyStop > 0 && t > 0 && t % 200 === 0) {
                const exploit = this._estimateExploitability(root, hands, infoSetKeyFn, options);
                this.exploitabilityHistory.push({ iteration: t, exploitability: exploit });
                if (exploit < earlyStop) break;
            }
        }

        return this._extractStrategies();
    }

    // Recursive CFR+ traversal
    _cfr(node, playerHands, reachProbs, infoSetKeyFn) {
        if (node.type === NodeType.TERMINAL) {
            return node.payoffs(playerHands[0], playerHands[1]);
        }

        if (node.type === NodeType.CHANCE) {
            // Average over chance outcomes
            const values = [0, 0];
            for (const outcome of node.chanceOutcomes) {
                const childValues = this._cfr(outcome.child, playerHands, reachProbs, infoSetKeyFn);
                values[0] += outcome.prob * childValues[0];
                values[1] += outcome.prob * childValues[1];
            }
            return values;
        }

        // Player node
        const player = node.player;
        const hand = playerHands[player];
        const infoSetKey = infoSetKeyFn(node, hand, player);
        const numActions = node.actions.length;
        const infoSet = this.getOrCreateInfoSet(infoSetKey, numActions);

        const strategy = infoSet.getStrategy(reachProbs[player]);
        const actionValues = new Array(numActions);
        const nodeValue = [0, 0];

        for (let a = 0; a < numActions; a++) {
            const childNode = node.children[node.actions[a]];
            const newReachProbs = [...reachProbs];
            newReachProbs[player] *= strategy[a];

            actionValues[a] = this._cfr(childNode, playerHands, newReachProbs, infoSetKeyFn);
            nodeValue[0] += strategy[a] * actionValues[a][0];
            nodeValue[1] += strategy[a] * actionValues[a][1];
        }

        // Update regrets for the acting player (CFR+: clip to 0)
        const opponent = 1 - player;
        for (let a = 0; a < numActions; a++) {
            const regret = actionValues[a][player] - nodeValue[player];
            // CFR+: clip cumulative regret to non-negative
            infoSet.regretSum[a] = Math.max(0, infoSet.regretSum[a] + reachProbs[opponent] * regret);
        }

        return nodeValue;
    }

    // Extract final average strategies from all info sets
    _extractStrategies() {
        const strategies = new Map();
        for (const [key, infoSet] of this.infoSets) {
            strategies.set(key, infoSet.getAverageStrategy());
        }
        return strategies;
    }

    // Rough exploitability estimate: max gain from best response
    _estimateExploitability(root, hands, infoSetKeyFn, options) {
        let totalExploit = 0;
        let count = 0;

        for (let h0 = 0; h0 < Math.min(hands[0].length, 20); h0++) {
            for (let h1 = 0; h1 < Math.min(hands[1].length, 20); h1++) {
                if (options.conflictFn && options.conflictFn(hands[0][h0], hands[1][h1])) continue;
                const playerHands = [hands[0][h0], hands[1][h1]];
                const ev = this._bestResponseValue(root, playerHands, 0, infoSetKeyFn);
                totalExploit += Math.max(0, ev);
                count++;
            }
        }

        return count > 0 ? totalExploit / count : 0;
    }

    _bestResponseValue(node, playerHands, brPlayer, infoSetKeyFn) {
        if (node.type === NodeType.TERMINAL) {
            return node.payoffs(playerHands[0], playerHands[1])[brPlayer];
        }

        if (node.type === NodeType.CHANCE) {
            let val = 0;
            for (const outcome of node.chanceOutcomes) {
                val += outcome.prob * this._bestResponseValue(outcome.child, playerHands, brPlayer, infoSetKeyFn);
            }
            return val;
        }

        const player = node.player;
        const hand = playerHands[player];
        const infoSetKey = infoSetKeyFn(node, hand, player);
        const numActions = node.actions.length;

        if (player === brPlayer) {
            // Best response: pick the best action
            let bestVal = -Infinity;
            for (let a = 0; a < numActions; a++) {
                const childNode = node.children[node.actions[a]];
                const val = this._bestResponseValue(childNode, playerHands, brPlayer, infoSetKeyFn);
                bestVal = Math.max(bestVal, val);
            }
            return bestVal;
        } else {
            // Opponent plays average strategy
            const infoSet = this.infoSets.get(infoSetKey);
            const strategy = infoSet ? infoSet.getAverageStrategy() : new Float64Array(numActions).fill(1.0 / numActions);
            let val = 0;
            for (let a = 0; a < numActions; a++) {
                const childNode = node.children[node.actions[a]];
                val += strategy[a] * this._bestResponseValue(childNode, playerHands, brPlayer, infoSetKeyFn);
            }
            return val;
        }
    }

    // Get strategy for a specific info set key
    getStrategy(key) {
        const infoSet = this.infoSets.get(key);
        if (!infoSet) return null;
        return infoSet.getAverageStrategy();
    }

    // Reset solver state
    reset() {
        this.infoSets.clear();
        this.exploitabilityHistory = [];
    }
}

// ============================================================
// Solver Backend Interface (local/remote abstraction)
// ============================================================

class SolverBackend {
    async solve(config) { throw new Error('Not implemented'); }
    getStrategy(hand) { throw new Error('Not implemented'); }
}

class LocalSolverBackend extends SolverBackend {
    constructor() {
        super();
        this.solver = new CFRSolver();
        this.lastResult = null;
    }

    async solve(config) {
        // config: { type, hands, root, infoSetKeyFn, options }
        this.solver.reset();
        this.solver.iterations = config.iterations || 2000;
        this.lastResult = this.solver.solve(
            config.root,
            config.hands,
            config.infoSetKeyFn,
            config.options || {}
        );
        return this.lastResult;
    }

    getStrategy(key) {
        if (!this.lastResult) return null;
        return this.lastResult.get(key) || null;
    }
}

// Placeholder for future remote solver
class RemoteSolverBackend extends SolverBackend {
    constructor(endpoint) {
        super();
        this.endpoint = endpoint || '/api/solve';
    }

    async solve(config) {
        // Future: POST to server for high-precision solving
        // const response = await fetch(this.endpoint, {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({
        //         ranges: config.ranges,
        //         board: config.board,
        //         pot: config.pot,
        //         stacks: config.stacks,
        //         iterations: config.iterations || 50000,
        //         betSizes: config.betSizes,
        //     })
        // });
        // return await response.json();
        throw new Error('Remote solver not yet implemented. Deploy server and configure endpoint.');
    }
}
