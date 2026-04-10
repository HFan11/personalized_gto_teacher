const { PreflopSolver } = require('../lib/preflop-engine');

// Cache solved instance across warm invocations
let cachedSolver = null;
let cachedIterations = 0;

module.exports = async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'POST only' });
    }

    try {
        // Vercel Hobby plan: 10s limit. Use 100 iterations (~4-5s solve time)
        // Pro plan can use 2500 iterations with maxDuration: 60
        const { iterations = 100, hand, position, scenario, villainPosition } = req.body;

        const t0 = Date.now();

        // Solve (or reuse cached solution if same or higher iteration count)
        if (!cachedSolver || cachedIterations < iterations) {
            cachedSolver = new PreflopSolver({ iterations });
            cachedSolver.solve({ iterations });
            cachedIterations = iterations;
        }

        const solveTimeMs = Date.now() - t0;

        if (hand && position && scenario) {
            // Return strategy for a specific hand
            const strategy = cachedSolver.getStrategy(position, hand, scenario, villainPosition);
            return res.json({ strategy, solveTimeMs, iterations: cachedIterations, cached: solveTimeMs < 10 });
        }

        // Return all strategies for a position + scenario
        if (position && scenario) {
            const hands169 = cachedSolver.hands169;
            const strategies = {};
            for (const h of hands169) {
                const s = cachedSolver.getStrategy(position, h, scenario, villainPosition);
                if (s) strategies[h] = s;
            }
            return res.json({ strategies, solveTimeMs, iterations: cachedIterations });
        }

        return res.json({ solved: true, iterations: cachedIterations, solveTimeMs });
    } catch (err) {
        console.error('Preflop solver error:', err);
        return res.status(500).json({ error: err.message });
    }
};
