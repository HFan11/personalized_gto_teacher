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

    try {
        const resp = await fetch(SOLVER_URL + '/api/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
        });

        const data = await resp.json();
        return res.status(resp.status).json(data);
    } catch (e) {
        return res.status(502).json({ error: 'C++ solver unavailable: ' + e.message });
    }
};
