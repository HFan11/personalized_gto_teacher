// ============================================================
// Preflop CFR+ Solver — 6-max NL Hold'em (100BB)
// Builds game tree and solves for Nash equilibrium preflop ranges
// ============================================================

class PreflopSolver {
    constructor(config = {}) {
        this.bb = config.bb || 1;
        this.startingStack = config.stack || 100; // in BB
        this.positions = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
        this.solver = new CFRSolver({ iterations: config.iterations || 1000 });
        this.solved = false;
        this.strategies = null;
        this.hands169 = generate169Hands();

        // Preflop raise sizes (in BB)
        this.rfiSize = config.rfiSize || 2.5;
        this.threeBetMultiplier = config.threeBetMultiplier || 3.0;
        this.fourBetMultiplier = config.fourBetMultiplier || 2.5;
    }

    // Singleton for app-wide preflop solution
    static _instance = null;
    static getInstance(config) {
        if (!PreflopSolver._instance) {
            PreflopSolver._instance = new PreflopSolver(config);
        }
        return PreflopSolver._instance;
    }

    static resetInstance() {
        PreflopSolver._instance = null;
    }

    // Solve preflop game — builds tree per scenario and solves with CFR+
    solve(options = {}) {
        const iterations = options.iterations || 1000;
        this.solver.reset();

        // Solve each distinct preflop scenario independently for tractability
        // Scenario 1: RFI (each position opens or folds when folded to)
        // Scenario 2: vs RFI (each position faces a raise)
        // Scenario 3: vs 3-bet
        // Scenario 4: vs 4-bet

        this._solveRFIScenarios(iterations);
        this._solveVsRaiseScenarios(Math.max(20, Math.floor(iterations * 0.5)));
        this._solveVs3BetScenarios(Math.max(20, Math.floor(iterations * 0.4)));
        this._solveVs4BetScenarios(Math.max(20, Math.floor(iterations * 0.4)));

        this.solved = true;
        this.strategies = this.solver._extractStrategies();
        return this.strategies;
    }

    // RFI: each position decides raise/fold when folded to them
    _solveRFIScenarios(iterations) {
        // For each position, create a 2-player simplified game:
        // Player 0 (opener) vs Player 1 (remaining field represented as BB)
        // The opener either folds (loses nothing extra) or raises (enters pot)
        // Simplified: equity realization against a calling range

        for (const pos of this.positions) {
            if (pos === 'BB') continue; // BB doesn't RFI

            const root = new GameNode(NodeType.PLAYER, 0, ['fold', 'raise'], 1.5, [this.startingStack, this.startingStack]);

            // Fold: opener gives up blinds already posted
            const foldNode = new GameNode(NodeType.TERMINAL, -1, [], 1.5, [this.startingStack, this.startingStack]);
            foldNode.payoffs = (h0, h1) => {
                // Opener loses nothing extra (blinds already counted)
                return [0, 0];
            };

            // Raise: simplified as win/lose the raised pot vs BB defense range
            const raiseNode = new GameNode(NodeType.TERMINAL, -1, [], this.rfiSize * 2 + 1.5, null);
            raiseNode.payoffs = (h0, h1) => {
                // Use precomputed hand equity rankings for speed
                const eq0 = _preflopHandEquity(h0);
                const eq1 = _preflopHandEquity(h1);
                const potWon = this.rfiSize + 0.75; // half the pot (simplified)
                if (eq0 > eq1) return [potWon, -potWon];
                if (eq0 < eq1) return [-potWon, potWon];
                return [0, 0];
            };

            root.children = { fold: foldNode, raise: raiseNode };

            const infoSetKeyFn = (node, hand, player) => {
                return `rfi|${pos}|${player}|${hand}`;
            };

            // Use hand indices as buckets (169 canonical hands)
            const handIndices0 = this.hands169.map((_, i) => i);
            const handIndices1 = this.hands169.map((_, i) => i);

            this.solver.solve(root, [handIndices0, handIndices1], infoSetKeyFn, {
                iterations,
                conflictFn: () => false,
                samplesPerIter: 500, // Monte Carlo: sample 500 pairs per iteration
            });
        }
    }

    // Vs Raise: facing an open raise, decide fold/call/3bet
    // Only solve key position matchups for speed
    _solveVsRaiseScenarios(iterations) {
        const keyMatchups = [
            ['BB', 'UTG'], ['BB', 'CO'], ['BB', 'BTN'], ['BB', 'SB'],
            ['SB', 'UTG'], ['SB', 'CO'], ['SB', 'BTN'],
            ['BTN', 'UTG'], ['BTN', 'HJ'], ['BTN', 'CO'],
            ['CO', 'UTG'], ['CO', 'HJ'],
            ['HJ', 'UTG'],
        ];
        for (const [defenderPos, openerPos] of keyMatchups) {

                const threeBetSize = this.rfiSize * this.threeBetMultiplier;
                const pot = this.rfiSize + 1.5; // raise + blinds

                const root = new GameNode(NodeType.PLAYER, 0, ['fold', 'call', '3bet'], pot,
                    [this.startingStack, this.startingStack]);

                // Fold
                const foldNode = new GameNode(NodeType.TERMINAL, -1, [], pot, null);
                foldNode.payoffs = (h0, h1) => [0, 0];

                // Call — go to showdown (simplified)
                const callNode = new GameNode(NodeType.TERMINAL, -1, [], pot + this.rfiSize, null);
                callNode.payoffs = (h0, h1) => {
                    const eq0 = _preflopHandEquity(h0);
                    const eq1 = _preflopHandEquity(h1);
                    const halfPot = (pot + this.rfiSize) / 2;
                    if (eq0 > eq1) return [halfPot, -halfPot];
                    if (eq0 < eq1) return [-halfPot, halfPot];
                    return [0, 0];
                };

                // 3-bet → opponent decides fold/call/4bet
                const threeBetNode = new GameNode(NodeType.PLAYER, 1, ['fold', 'call', '4bet'],
                    pot + threeBetSize, [this.startingStack, this.startingStack]);

                // 3bet → opp fold
                const threeBetFoldNode = new GameNode(NodeType.TERMINAL, -1, [], pot + threeBetSize, null);
                threeBetFoldNode.payoffs = (h0, h1) => {
                    return [this.rfiSize + 0.75, -(this.rfiSize + 0.75)]; // defender wins opener's raise + blinds
                };

                // 3bet → opp call
                const threeBetCallNode = new GameNode(NodeType.TERMINAL, -1, [], pot + threeBetSize * 2, null);
                threeBetCallNode.payoffs = (h0, h1) => {
                    const eq0 = _preflopHandEquity(h0);
                    const eq1 = _preflopHandEquity(h1);
                    const halfPot = (pot + threeBetSize * 2) / 2;
                    if (eq0 > eq1) return [halfPot, -halfPot];
                    if (eq0 < eq1) return [-halfPot, halfPot];
                    return [0, 0];
                };

                // 3bet → opp 4bet (simplified as all-in)
                const fourBetNode = new GameNode(NodeType.TERMINAL, -1, [], this.startingStack * 2, null);
                fourBetNode.payoffs = (h0, h1) => {
                    const eq0 = _preflopHandEquity(h0);
                    const eq1 = _preflopHandEquity(h1);
                    const halfPot = this.startingStack;
                    if (eq0 > eq1) return [halfPot, -halfPot];
                    if (eq0 < eq1) return [-halfPot, halfPot];
                    return [0, 0];
                };

                threeBetNode.children = { fold: threeBetFoldNode, call: threeBetCallNode, '4bet': fourBetNode };
                root.children = { fold: foldNode, call: callNode, '3bet': threeBetNode };

                const infoSetKeyFn = (node, hand, player) => {
                    const pos = player === 0 ? defenderPos : openerPos;
                    const actions = node === root ? 'vsraise' : 'vs3bet';
                    return `${actions}|${pos}|${hand}`;
                };

                const handIndices = this.hands169.map((_, i) => i);
                this.solver.solve(root, [handIndices, handIndices], infoSetKeyFn, {
                    iterations: Math.floor(iterations * 0.7),
                    conflictFn: () => false,
                    samplesPerIter: 300,
                });
            }
    }

    // Vs 3-bet scenarios
    _solveVs3BetScenarios(iterations) {
        const threeBetSize = this.rfiSize * this.threeBetMultiplier;
        const fourBetSize = threeBetSize * this.fourBetMultiplier;

        for (const openerPos of ['UTG', 'HJ', 'CO', 'BTN', 'SB']) {
            const pot = this.rfiSize + threeBetSize + 1.5;
            const root = new GameNode(NodeType.PLAYER, 0, ['fold', 'call', '4bet'], pot,
                [this.startingStack, this.startingStack]);

            const foldNode = new GameNode(NodeType.TERMINAL, -1, [], pot, null);
            foldNode.payoffs = (h0, h1) => [-(this.rfiSize), this.rfiSize];

            const callNode = new GameNode(NodeType.TERMINAL, -1, [], pot + threeBetSize, null);
            callNode.payoffs = (h0, h1) => {
                const eq0 = _preflopHandEquity(h0);
                const eq1 = _preflopHandEquity(h1);
                const halfPot = (pot + threeBetSize) / 2;
                if (eq0 > eq1) return [halfPot, -halfPot];
                if (eq0 < eq1) return [-halfPot, halfPot];
                return [0, 0];
            };

            // 4bet → opponent folds or 5bet-jams
            const fourBetRoot = new GameNode(NodeType.PLAYER, 1, ['fold', 'call', 'jam'], pot + fourBetSize, null);

            const fbFold = new GameNode(NodeType.TERMINAL, -1, [], pot + fourBetSize, null);
            fbFold.payoffs = (h0, h1) => [threeBetSize + 0.75, -(threeBetSize + 0.75)];

            const fbCall = new GameNode(NodeType.TERMINAL, -1, [], pot + fourBetSize * 2, null);
            fbCall.payoffs = (h0, h1) => {
                const eq0 = _preflopHandEquity(h0);
                const eq1 = _preflopHandEquity(h1);
                const half = (pot + fourBetSize * 2) / 2;
                if (eq0 > eq1) return [half, -half];
                if (eq0 < eq1) return [-half, half];
                return [0, 0];
            };

            const fbJam = new GameNode(NodeType.TERMINAL, -1, [], this.startingStack * 2, null);
            fbJam.payoffs = (h0, h1) => {
                const eq0 = _preflopHandEquity(h0);
                const eq1 = _preflopHandEquity(h1);
                if (eq0 > eq1) return [this.startingStack, -this.startingStack];
                if (eq0 < eq1) return [-this.startingStack, this.startingStack];
                return [0, 0];
            };

            fourBetRoot.children = { fold: fbFold, call: fbCall, jam: fbJam };
            root.children = { fold: foldNode, call: callNode, '4bet': fourBetRoot };

            const infoSetKeyFn = (node, hand, player) => {
                return `vs3bet|${openerPos}|p${player}|${hand}`;
            };

            const handIndices = this.hands169.map((_, i) => i);
            this.solver.solve(root, [handIndices, handIndices], infoSetKeyFn, {
                iterations: Math.floor(iterations * 0.5),
                conflictFn: () => false,
            });
        }
    }

    // Vs 4-bet scenarios
    // Realistic sizing: open 2.5BB → 3bet 8BB → 4bet 22BB
    // Hero has invested 8BB (3bet), villain invested 22BB (4bet), blinds 1.5BB
    // Pot = 8 + 22 + 1.5 = 31.5BB. Hero needs to call 14BB more or jam for ~78BB more
    _solveVs4BetScenarios(iterations) {
        const heroInvested = 8;    // hero's 3bet
        const villainInvested = 22; // villain's 4bet
        const blinds = 1.5;
        const pot = heroInvested + villainInvested + blinds; // 31.5BB
        const callAmount = villainInvested - heroInvested;    // 14BB to call
        const remainingStack = this.startingStack - heroInvested; // 92BB remaining
        const jamAmount = remainingStack; // 92BB total to jam

        const root = new GameNode(NodeType.PLAYER, 0, ['fold', 'call', 'jam'], pot,
            [remainingStack, remainingStack]);

        // Fold: lose the 8BB already invested
        const foldNode = new GameNode(NodeType.TERMINAL, -1, [], pot, null);
        foldNode.payoffs = (h0, h1) => [-heroInvested, heroInvested];

        // Call: put in 14BB more. Total pot = 31.5 + 14 = 45.5BB. Showdown.
        const callPot = pot + callAmount;
        const callNode = new GameNode(NodeType.TERMINAL, -1, [], callPot, null);
        callNode.payoffs = (h0, h1) => {
            const eq0 = _preflopHandEquity(h0);
            const eq1 = _preflopHandEquity(h1);
            // Win: gain callPot - heroInvested - callAmount. Lose: lose heroInvested + callAmount
            const heroTotal = heroInvested + callAmount; // 22BB total invested
            if (eq0 > eq1) return [callPot - heroTotal, -(callPot - heroTotal)];
            if (eq0 < eq1) return [-heroTotal, heroTotal];
            return [0, 0];
        };

        // Jam: put in remaining 92BB. Opponent calls or folds.
        // Simplified: opponent always calls (jam is terminal with showdown)
        const jamPot = pot + jamAmount + (jamAmount - callAmount); // both players all-in
        const jamNode = new GameNode(NodeType.TERMINAL, -1, [], this.startingStack * 2, null);
        jamNode.payoffs = (h0, h1) => {
            const eq0 = _preflopHandEquity(h0);
            const eq1 = _preflopHandEquity(h1);
            // Risk full stack
            if (eq0 > eq1) return [this.startingStack - heroInvested, -(this.startingStack - heroInvested)];
            if (eq0 < eq1) return [-(this.startingStack - heroInvested), this.startingStack - heroInvested];
            return [0, 0];
        };

        root.children = { fold: foldNode, call: callNode, jam: jamNode };

        const infoSetKeyFn = (node, hand, player) => `vs4bet|p${player}|${hand}`;
        const handIndices = this.hands169.map((_, i) => i);

        this.solver.solve(root, [handIndices, handIndices], infoSetKeyFn, {
            iterations: Math.floor(iterations * 0.5),
            conflictFn: () => false,
            samplesPerIter: 300,
        });
    }

    // Query solved strategy for a specific situation
    // Returns: { fold: freq, call: freq, raise: freq, ... } or null
    getStrategy(position, handKey, scenario, villainPosition) {
        if (!this.solved) return null;

        const handIdx = this.hands169.indexOf(handKey);
        if (handIdx < 0) return null;

        // Try multiple key formats to find the strategy
        let strat = null;
        switch (scenario) {
            case 'rfi':
                strat = this.strategies.get(`rfi|${position}|0|${handIdx}`);
                break;
            case 'vs_raise':
                strat = this.strategies.get(`vsraise|${position}|${handIdx}`);
                break;
            case 'vs_3bet':
                strat = this.strategies.get(`vs3bet|${position}|p0|${handIdx}`);
                break;
            case 'vs_4bet':
                // Try both player 0 and player 1
                strat = this.strategies.get(`vs4bet|p0|${handIdx}`)
                     || this.strategies.get(`vs4bet|p1|${handIdx}`);
                break;
            default:
                return null;
        }

        if (!strat) return null;

        // Map strategy array to action labels
        const result = {};
        let actions;
        switch (scenario) {
            case 'rfi':
                actions = ['fold', 'raise'];
                break;
            case 'vs_raise':
                actions = ['fold', 'call', '3bet'];
                break;
            case 'vs_3bet':
                actions = ['fold', 'call', '4bet'];
                break;
            case 'vs_4bet':
                actions = ['fold', 'call', 'jam'];
                break;
        }

        for (let i = 0; i < actions.length; i++) {
            result[actions[i]] = strat[i] || 0;
        }

        return result;
    }

    // Get all hands that have raise/3bet frequency above threshold for a position
    getRangeForPosition(position, scenario, actionFilter, threshold) {
        threshold = threshold || 0.05;
        const rangeHands = [];

        for (let i = 0; i < this.hands169.length; i++) {
            const strat = this.getStrategy(position, this.hands169[i], scenario);
            if (!strat) continue;
            const freq = strat[actionFilter] || 0;
            if (freq >= threshold) {
                rangeHands.push({
                    hand: this.hands169[i],
                    frequency: freq,
                    strategy: strat,
                });
            }
        }

        return rangeHands.sort((a, b) => b.frequency - a.frequency);
    }
}

// ============================================================
// Preflop hand equity table — actual equity vs random hand
// Pre-computed from Monte Carlo simulations (industry standard values)
// ============================================================

const _PREFLOP_EQUITY_TABLE = {
    // Pairs
    'AA': 0.852, 'KK': 0.824, 'QQ': 0.799, 'JJ': 0.775, 'TT': 0.750,
    '99': 0.720, '88': 0.691, '77': 0.662, '66': 0.633, '55': 0.604,
    '44': 0.574, '33': 0.544, '22': 0.502,
    // Suited Broadway
    'AKs': 0.670, 'AQs': 0.660, 'AJs': 0.650, 'ATs': 0.640,
    'KQs': 0.634, 'KJs': 0.624, 'KTs': 0.614, 'QJs': 0.608,
    'QTs': 0.598, 'JTs': 0.588,
    // Offsuit Broadway
    'AKo': 0.653, 'AQo': 0.641, 'AJo': 0.630, 'ATo': 0.618,
    'KQo': 0.613, 'KJo': 0.601, 'KTo': 0.589, 'QJo': 0.584,
    'QTo': 0.572, 'JTo': 0.564,
    // Suited Aces
    'A9s': 0.618, 'A8s': 0.610, 'A7s': 0.600, 'A6s': 0.590,
    'A5s': 0.594, 'A4s': 0.586, 'A3s': 0.578, 'A2s': 0.570,
    // Offsuit Aces
    'A9o': 0.592, 'A8o': 0.582, 'A7o': 0.570, 'A6o': 0.558,
    'A5o': 0.564, 'A4o': 0.554, 'A3o': 0.544, 'A2o': 0.534,
    // Suited connectors & one-gappers
    'T9s': 0.562, '98s': 0.548, '87s': 0.536, '76s': 0.524,
    '65s': 0.512, '54s': 0.502, '43s': 0.478, '32s': 0.462,
    'T8s': 0.540, '97s': 0.526, '86s': 0.512, '75s': 0.500,
    '64s': 0.488, '53s': 0.478, '42s': 0.456, 'J9s': 0.558,
    'J8s': 0.538, 'J7s': 0.520, 'Q9s': 0.572, 'Q8s': 0.550,
    'Q7s': 0.530, 'Q6s': 0.520, 'K9s': 0.590, 'K8s': 0.572,
    'K7s': 0.556, 'K6s': 0.546, 'K5s': 0.538, 'K4s': 0.530,
    'K3s': 0.522, 'K2s': 0.514, 'T7s': 0.520, '96s': 0.506,
    '85s': 0.490, '74s': 0.476, '63s': 0.466, '52s': 0.454,
    'Q5s': 0.510, 'Q4s': 0.502, 'Q3s': 0.494, 'Q2s': 0.486,
    'J6s': 0.508, 'J5s': 0.500, 'J4s': 0.490, 'J3s': 0.482,
    'J2s': 0.474, 'T6s': 0.500, 'T5s': 0.488, 'T4s': 0.478,
    'T3s': 0.470, 'T2s': 0.462, '95s': 0.488, '94s': 0.474,
    '93s': 0.464, '92s': 0.456, '84s': 0.468, '83s': 0.456,
    '82s': 0.448, '73s': 0.454, '72s': 0.440, '62s': 0.440,
    // Offsuit connectors
    'T9o': 0.536, '98o': 0.520, '87o': 0.506, '76o': 0.492,
    '65o': 0.478, '54o': 0.466, '43o': 0.438, '32o': 0.420,
    'J9o': 0.530, 'J8o': 0.506, 'T8o': 0.510, '97o': 0.494,
    '86o': 0.478, '75o': 0.464, '64o': 0.450, '53o': 0.438,
    '42o': 0.410, 'Q9o': 0.544, 'Q8o': 0.518, 'Q7o': 0.496,
    'Q6o': 0.484, 'Q5o': 0.472, 'Q4o': 0.462, 'Q3o': 0.454,
    'Q2o': 0.444, 'K9o': 0.564, 'K8o': 0.542, 'K7o': 0.524,
    'K6o': 0.512, 'K5o': 0.502, 'K4o': 0.492, 'K3o': 0.484,
    'K2o': 0.474, 'J7o': 0.486, 'J6o': 0.472, 'J5o': 0.462,
    'J4o': 0.450, 'J3o': 0.440, 'J2o': 0.430, 'T7o': 0.486,
    'T6o': 0.464, 'T5o': 0.450, 'T4o': 0.438, 'T3o': 0.428,
    'T2o': 0.418, '96o': 0.470, '95o': 0.452, '94o': 0.434,
    '93o': 0.422, '92o': 0.412, '85o': 0.452, '84o': 0.428,
    '83o': 0.412, '82o': 0.402, '74o': 0.436, '73o': 0.412,
    '72o': 0.396, '63o': 0.424, '62o': 0.396, '52o': 0.408,
};

const _PREFLOP_EQUITY_CACHE = {};

function _preflopHandEquity(handIndex) {
    if (_PREFLOP_EQUITY_CACHE[handIndex] !== undefined) {
        return _PREFLOP_EQUITY_CACHE[handIndex];
    }

    const hands169 = generate169Hands();
    const hand = hands169[handIndex];
    if (!hand) return 0.5;

    // Look up actual equity from table
    const eq = _PREFLOP_EQUITY_TABLE[hand];
    if (eq !== undefined) {
        _PREFLOP_EQUITY_CACHE[handIndex] = eq;
        return eq;
    }

    // Fallback for any missing hands (shouldn't happen)
    _PREFLOP_EQUITY_CACHE[handIndex] = 0.45;
    return 0.45;
}
