// ============================================================
// CFR+ Core Solver Engine — Node.js CommonJS module
// Adapted from web/js/cfr-solver.js for server-side use
// ============================================================

function seededRandom(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function hashSeed(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

class InfoSet {
    constructor(numActions) {
        this.numActions = numActions;
        this.regretSum = new Float64Array(numActions);
        this.strategySum = new Float64Array(numActions);
    }

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

    getAverageStrategy() {
        const avgStrategy = new Float64Array(this.numActions);
        let normalizingSum = 0;
        for (let a = 0; a < this.numActions; a++) normalizingSum += this.strategySum[a];
        for (let a = 0; a < this.numActions; a++) {
            avgStrategy[a] = normalizingSum > 0 ? this.strategySum[a] / normalizingSum : 1.0 / this.numActions;
        }
        return avgStrategy;
    }
}

const NodeType = { TERMINAL: 'terminal', CHANCE: 'chance', PLAYER: 'player' };

class GameNode {
    constructor(type, player, actions, pot, stacks) {
        this.type = type;
        this.player = player;
        this.actions = actions;
        this.children = {};
        this.pot = pot;
        this.stacks = stacks;
        this.payoffs = null;
        this.chanceOutcomes = null;
        this._actionPath = null;
    }
}

class CFRSolver {
    constructor(config = {}) {
        this.infoSets = new Map();
        this.iterations = config.iterations || 2000;
    }

    getOrCreateInfoSet(key, numActions) {
        let infoSet = this.infoSets.get(key);
        if (!infoSet) {
            infoSet = new InfoSet(numActions);
            this.infoSets.set(key, infoSet);
        }
        return infoSet;
    }

    solve(root, hands, infoSetKeyFn, options = {}) {
        const iters = options.iterations || this.iterations;
        const samplesPerIter = options.samplesPerIter || 0;
        const n0 = hands[0].length, n1 = hands[1].length;
        const seed = options.seed || 42;
        const rng = seededRandom(seed);

        // Strategy convergence: stop early if strategies stabilize
        let prevSnapshot = null;
        const convergenceInterval = Math.max(100, Math.floor(iters / 10));

        for (let t = 0; t < iters; t++) {
            if (samplesPerIter > 0 && n0 * n1 > samplesPerIter) {
                for (let s = 0; s < samplesPerIter; s++) {
                    const h0 = hands[0][Math.floor(rng() * n0)];
                    const h1 = hands[1][Math.floor(rng() * n1)];
                    if (options.conflictFn && options.conflictFn(h0, h1)) continue;
                    this._cfr(root, [h0, h1], [1.0, 1.0], infoSetKeyFn);
                }
            } else {
                for (let i0 = 0; i0 < n0; i0++) {
                    for (let i1 = 0; i1 < n1; i1++) {
                        if (options.conflictFn && options.conflictFn(hands[0][i0], hands[1][i1])) continue;
                        this._cfr(root, [hands[0][i0], hands[1][i1]], [1.0, 1.0], infoSetKeyFn);
                    }
                }
            }
            // Convergence check
            if (t > 0 && t % convergenceInterval === 0 && t >= convergenceInterval * 2) {
                const snap = this._extractStrategies();
                if (prevSnapshot) {
                    let maxDelta = 0;
                    for (const [key, strat] of snap) {
                        const prev = prevSnapshot.get(key);
                        if (prev) { for (let a = 0; a < strat.length; a++) maxDelta = Math.max(maxDelta, Math.abs(strat[a] - (prev[a]||0))); }
                    }
                    if (maxDelta < 0.02) break;
                }
                prevSnapshot = snap;
            }
        }
        return this._extractStrategies();
    }

    _cfr(node, playerHands, reachProbs, infoSetKeyFn) {
        if (node.type === NodeType.TERMINAL) return node.payoffs(playerHands[0], playerHands[1]);
        if (node.type === NodeType.CHANCE) {
            const values = [0, 0];
            for (const outcome of node.chanceOutcomes) {
                const cv = this._cfr(outcome.child, playerHands, reachProbs, infoSetKeyFn);
                values[0] += outcome.prob * cv[0];
                values[1] += outcome.prob * cv[1];
            }
            return values;
        }

        const player = node.player;
        const hand = playerHands[player];
        const infoSetKey = infoSetKeyFn(node, hand, player);
        const numActions = node.actions.length;
        const infoSet = this.getOrCreateInfoSet(infoSetKey, numActions);
        const strategy = infoSet.getStrategy(reachProbs[player]);
        const actionValues = new Array(numActions);
        const nodeValue = [0, 0];

        const newReachProbs = [reachProbs[0], reachProbs[1]];
        const savedReach = reachProbs[player];
        for (let a = 0; a < numActions; a++) {
            newReachProbs[player] = savedReach * strategy[a];
            actionValues[a] = this._cfr(node.children[node.actions[a]], playerHands, newReachProbs, infoSetKeyFn);
            nodeValue[0] += strategy[a] * actionValues[a][0];
            nodeValue[1] += strategy[a] * actionValues[a][1];
        }
        newReachProbs[player] = savedReach;

        const opponent = 1 - player;
        for (let a = 0; a < numActions; a++) {
            const regret = actionValues[a][player] - nodeValue[player];
            infoSet.regretSum[a] = Math.max(0, infoSet.regretSum[a] + reachProbs[opponent] * regret);
        }
        return nodeValue;
    }

    _extractStrategies() {
        const strategies = new Map();
        for (const [key, infoSet] of this.infoSets) {
            strategies.set(key, infoSet.getAverageStrategy());
        }
        return strategies;
    }

    getStrategy(key) {
        const infoSet = this.infoSets.get(key);
        return infoSet ? infoSet.getAverageStrategy() : null;
    }

    reset() {
        this.infoSets.clear();
    }
}

module.exports = { InfoSet, NodeType, GameNode, CFRSolver, seededRandom, hashSeed };
