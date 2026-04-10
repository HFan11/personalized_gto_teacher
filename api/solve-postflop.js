const { PostflopSolver } = require('../lib/postflop-engine');
const { expandRangeToComboCards, makeCard } = require('../lib/hand-utils');

// LRU cache for postflop solutions (survives across warm invocations)
const POSTFLOP_CACHE = new Map();
const MAX_CACHE = 30;

function cacheKey(body) {
    const bk = (body.board || []).map(c => c.rank + c.suit).sort().join('');
    const hk = (body.heroRange || []).sort().join(',').substring(0, 50);
    return `${bk}|${body.heroIsIP}|${body.pot}|${body.stack}|${hk}`;
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    try {
        const body = req.body;

        // Parse board cards from string format: [{rank:'A', suit:'h'}, ...]
        // Accept both unicode suits (♠♥♦♣) and letter suits (s/h/d/c)
        const suitMap = { s: '♠', h: '♥', d: '♦', c: '♣', '♠': '♠', '♥': '♥', '♦': '♦', '♣': '♣' };
        const board = (body.board || []).map(c => makeCard(c.rank, suitMap[c.suit] || c.suit));

        // Parse ranges: array of canonical hand keys like ['AA', 'AKs', ...]
        const heroRange = expandRangeToComboCards(body.heroRange || []);
        const villainRange = expandRangeToComboCards(body.villainRange || []);

        // Vercel Hobby plan: 10s limit. Use conservative defaults
        // Pro plan: increase to numBuckets:50, iterations:2500, simsPerHand:300
        const config = {
            heroRange,
            villainRange,
            board,
            pot: body.pot || 6,
            stack: body.stack || 100,
            heroIsIP: body.heroIsIP !== undefined ? body.heroIsIP : true,
            street: body.street || 'flop',
            betSizes: body.betSizes || [0.33, 0.66, 1.0],
            numBuckets: body.numBuckets || 25,
            iterations: body.iterations || 800,
            simsPerHand: body.simsPerHand || 100,
        };

        // Check LRU cache
        const ck = cacheKey(body);
        if (POSTFLOP_CACHE.has(ck) && !body.holeCards) {
            const cached = POSTFLOP_CACHE.get(ck);
            return res.json({ ...cached, cached: true });
        }

        const t0 = Date.now();
        const solver = new PostflopSolver(config);
        solver.solve();
        const solveTimeMs = Date.now() - t0;

        // Get strategy for specific hand if provided
        if (body.holeCards) {
            const holeCards = body.holeCards.map(c => makeCard(c.rank, suitMap[c.suit] || c.suit));
            const strategy = solver.getStrategy(holeCards);
            let facingBetStrategy = null;
            if (body.facingBet && body.betSizePct) {
                facingBetStrategy = solver.getStrategyFacingBet(holeCards, body.betSizePct);
            }
            return res.json({ strategy, facingBetStrategy, solveTimeMs, config: { numBuckets: config.numBuckets, iterations: config.iterations } });
        }

        // Return all strategies and cache result
        const allStrategies = solver.getAllStrategies();
        const result = { strategies: allStrategies, solveTimeMs, config: { numBuckets: config.numBuckets, iterations: config.iterations } };
        if (POSTFLOP_CACHE.size >= MAX_CACHE) POSTFLOP_CACHE.delete(POSTFLOP_CACHE.keys().next().value);
        POSTFLOP_CACHE.set(ck, result);
        return res.json(result);
    } catch (err) {
        console.error('Postflop solver error:', err);
        return res.status(500).json({ error: err.message });
    }
};
