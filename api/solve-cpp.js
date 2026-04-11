// Proxy to C++ TexasSolver on Railway
// Vercel → Railway (bypasses browser CORS/proxy issues)

const SOLVER_URL = 'https://personalizedgtoteacher-production.up.railway.app';

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const t0 = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000); // 9s safety margin

        const resp = await fetch(SOLVER_URL + '/api/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await resp.json();
        data._proxyTimeMs = Date.now() - t0;
        return res.status(resp.status).json(data);
    } catch (e) {
        const elapsed = Date.now() - t0;
        return res.status(502).json({
            error: `C++ solver: ${e.name === 'AbortError' ? 'timeout (9s)' : e.message}`,
            elapsed_ms: elapsed,
        });
    }
};
