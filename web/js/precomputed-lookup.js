// ============================================================
// Precomputed Strategy Lookup
// Matches current board to nearest precomputed solution
// Zero-latency PIO-level accuracy for common boards
// ============================================================

class PrecomputedLookup {
    constructor() {
        this.flopCache = new Map(); // "As_7d_2c" → strategy data
        this.turnCache = new Map();
        this.loaded = false;
        this.index = null; // list of available boards
    }

    // Load index of available precomputed boards
    async loadIndex() {
        try {
            const resp = await fetch('/data/precomputed/index.json');
            if (!resp.ok) return false;
            this.index = await resp.json();
            this.loaded = true;
            console.log(`Precomputed index loaded: ${this.index.flop?.length || 0} flops, ${this.index.turn?.length || 0} turns`);
            return true;
        } catch (e) {
            console.warn('No precomputed data available');
            return false;
        }
    }

    // Find the closest precomputed board for a given board
    findClosestBoard(boardCards, round) {
        if (!this.index) return null;

        const boards = round === 1 ? this.index.flop : this.index.turn;
        if (!boards || boards.length === 0) return null;

        const targetRanks = boardCards.map(c => c.rank).sort();
        const targetSuited = this._getSuitPattern(boardCards);

        let bestMatch = null;
        let bestScore = -1;

        for (const entry of boards) {
            const entryCards = this._parseBoardStr(entry.board);
            const entryRanks = entryCards.map(c => c.rank).sort();
            const entrySuited = entry.suitPattern || this._getSuitPattern(entryCards);

            let score = 0;

            // Exact rank match is best
            const rankMatch = targetRanks.filter((r, i) => r === entryRanks[i]).length;
            score += rankMatch * 100;

            // Similar high card
            const rv = { 'A':14,'K':13,'Q':12,'J':11,'T':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2 };
            const targetHigh = Math.max(...targetRanks.map(r => rv[r]));
            const entryHigh = Math.max(...entryRanks.map(r => rv[r]));
            score += Math.max(0, 10 - Math.abs(targetHigh - entryHigh)) * 5;

            // Suit pattern match (rainbow, two-tone, monotone)
            if (targetSuited === entrySuited) score += 30;

            // Paired board match
            const targetPaired = this._isPaired(targetRanks);
            const entryPaired = this._isPaired(entryRanks);
            if (targetPaired === entryPaired) score += 20;

            // Connectedness
            const targetConnected = this._isConnected(targetRanks);
            const entryConnected = this._isConnected(entryRanks);
            if (targetConnected === entryConnected) score += 15;

            if (score > bestScore) {
                bestScore = score;
                bestMatch = entry;
            }
        }

        return bestMatch;
    }

    // Get precomputed strategy for hero's hand
    async getStrategy(boardCards, holeCards, heroIsIP, facingBet) {
        if (!this.loaded) await this.loadIndex();
        if (!this.index) return null;

        const round = boardCards.length === 3 ? 1 : boardCards.length === 4 ? 2 : 3;
        if (round === 3) return null; // River: use real-time C++

        const match = this.findClosestBoard(boardCards, round);
        if (!match) return null;

        // Load the precomputed file if not cached
        const cacheKey = match.file;
        let data;
        if (round === 1) {
            data = this.flopCache.get(cacheKey);
        } else {
            data = this.turnCache.get(cacheKey);
        }

        if (!data) {
            try {
                const dir = round === 1 ? 'flop' : 'turn';
                const resp = await fetch(`/data/precomputed/${dir}/${match.file}`);
                if (!resp.ok) return null;
                data = await resp.json();
                if (round === 1) this.flopCache.set(cacheKey, data);
                else this.turnCache.set(cacheKey, data);
            } catch (e) {
                return null;
            }
        }

        // Find hero's hand in the strategy
        const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
        const heroKey1 = holeCards[0].rank + suitMap[holeCards[0].suit] + holeCards[1].rank + suitMap[holeCards[1].suit];
        const heroKey2 = holeCards[1].rank + suitMap[holeCards[1].suit] + holeCards[0].rank + suitMap[holeCards[0].suit];

        // Determine which node to read
        let stratNode;
        if (!facingBet) {
            // Acting first (OOP) or IP after check — read root or CHECK child
            if (heroIsIP) {
                // IP after OOP checks — look in children.CHECK
                stratNode = data.children?.['CHECK'] || data;
            } else {
                stratNode = data;
            }
        } else {
            // Facing a bet — find the bet child
            for (const [key, child] of Object.entries(data.children || {})) {
                if (key.startsWith('BET')) {
                    stratNode = child;
                    break;
                }
            }
            if (!stratNode) stratNode = data;
        }

        const actions = stratNode.actions || [];
        const strategies = stratNode.strategy || {};
        const heroStrat = strategies[heroKey1] || strategies[heroKey2];
        if (!heroStrat) return null;

        // Convert to standard format
        const strategy = {};
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            const freq = heroStrat[i] || 0;
            if (action === 'CHECK') strategy.check = freq;
            else if (action === 'FOLD') strategy.fold = freq;
            else if (action === 'CALL') strategy.call = freq;
            else if (action.startsWith('BET')) strategy['bet_' + action] = freq;
            else if (action.startsWith('RAISE')) strategy['raise_' + action] = freq;
        }

        return {
            strategy,
            source: 'precomputed',
            matchedBoard: match.board,
            matchCategory: match.category,
        };
    }

    // Helpers
    _parseBoardStr(boardStr) {
        return boardStr.split(',').map(s => ({
            rank: s[0],
            suit: s[1] === 's' ? '♠' : s[1] === 'h' ? '♥' : s[1] === 'd' ? '♦' : '♣',
        }));
    }

    _getSuitPattern(cards) {
        const suits = cards.map(c => c.suit || c[1]);
        const unique = new Set(suits).size;
        if (unique === 1) return 'monotone';
        if (unique === 2) return 'two-tone';
        return 'rainbow';
    }

    _isPaired(ranks) {
        return new Set(ranks).size < ranks.length;
    }

    _isConnected(ranks) {
        const rv = { 'A':14,'K':13,'Q':12,'J':11,'T':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2 };
        const vals = ranks.map(r => rv[r]).sort((a, b) => a - b);
        const gap = vals[vals.length - 1] - vals[0];
        return gap <= 4;
    }
}

// Global instance
const precomputedLookup = new PrecomputedLookup();
