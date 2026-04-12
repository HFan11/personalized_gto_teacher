// ============================================================
// Postflop Practice / Training Mode
// - Correct postflop action order: OOP acts first, IP responds
// ============================================================

// Position order for postflop action (higher = later = IP)
const POS_ORDER = { SB: 0, BB: 1, UTG: 2, HJ: 3, CO: 4, BTN: 5 };

// Smooth sigmoid-based frequency curve (replaces step functions)
function smoothFreq(margin, center, scale, min, max) {
    const sigmoid = 2 / (1 + Math.exp(-scale * margin)) - 1; // maps to -1..1
    const raw = center + (max - center) * sigmoid;
    return Math.round(Math.max(min, Math.min(max, raw)));
}

class PracticeSession {
    constructor(profileManager) {
        this.pm = profileManager;
        this.currentProfile = null;
        this.heroPosition = null;
        this.villainPosition = null;
        this.heroCards = [];
        this.boardCards = [];
        this.street = 'preflop';
        this.potSize = 6;
        this.effectiveStack = 100;
        this.history = [];
        this.score = { correct: 0, total: 0 };
        this.deck = [];
        this.villainCards = [];
        this.villainRangeHands = [];

        // Action context
        this.heroIsIP = true;
        this.villainAction = null;
        this.villainBetSize = 0;
        this.facingBet = false;

        // Bayesian range tracking: weight for each combo in villain's range
        // Starts at 1.0, multiplied by action probability each street
        this.villainRangeWeights = [];
        this.villainActionHistory = []; // [{street, action, betSize, betPctOfPot}]

        // Snapshot stack for undo
        this.snapshots = [];
    }

    // Save a snapshot of the current state (for undo)
    _saveSnapshot(actionLogSnapshot) {
        this.snapshots.push({
            street: this.street,
            potSize: this.potSize,
            effectiveStack: this.effectiveStack,
            boardCards: [...this.boardCards],
            villainAction: this.villainAction,
            villainBetSize: this.villainBetSize,
            facingBet: this.facingBet,
            history: JSON.parse(JSON.stringify(this.history)),
            actionLog: actionLogSnapshot ? [...actionLogSnapshot] : [],
            villainRangeWeights: [...this.villainRangeWeights],
            villainActionHistory: JSON.parse(JSON.stringify(this.villainActionHistory)),
        });
    }

    // Restore the last snapshot (undo)
    undo(actionLogRef) {
        if (this.snapshots.length === 0) return null;
        const snap = this.snapshots.pop();
        this.street = snap.street;
        this.potSize = snap.potSize;
        this.effectiveStack = snap.effectiveStack;
        this.boardCards = snap.boardCards;
        this.villainAction = snap.villainAction;
        this.villainBetSize = snap.villainBetSize;
        this.facingBet = snap.facingBet;
        this.history = snap.history;
        this.villainRangeWeights = snap.villainRangeWeights;
        this.villainActionHistory = snap.villainActionHistory;
        // Recalculate score from restored history
        this.score.total = this.history.length;
        this.score.correct = this.history.filter(h => h.isCorrect).length;
        return { actionLog: snap.actionLog, state: this.getState() };
    }

    canUndo() {
        return this.snapshots.length > 0;
    }

    // Is hero in position postflop?
    _heroHasPosition() {
        return (POS_ORDER[this.heroPosition] || 0) > (POS_ORDER[this.villainPosition] || 0);
    }

    // Start a new practice hand
    // potType: 'srp' | 'threebet' | 'fourbet'
    // isVillainAggressor: true if villain was the last raiser preflop
    startNewHand(profileId, heroPos, heroProfileId, villainPos, potType, isVillainAggressor) {
        this.currentProfile = this.pm.getById(profileId);
        if (!this.currentProfile) return null;

        // Store hero profile for strategy adjustments
        this.heroProfile = heroProfileId ? this.pm.getById(heroProfileId) : null;

        // Store pot type info
        this.potType = potType || 'srp';
        this.isVillainAggressor = isVillainAggressor || false;

        const positions = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
        this.heroPosition = heroPos || positions[Math.floor(Math.random() * positions.length)];

        // Pick a villain position: use specified or random (different from hero)
        if (villainPos && villainPos !== this.heroPosition) {
            this.villainPosition = villainPos;
        } else {
            const otherPositions = positions.filter(p => p !== this.heroPosition);
            this.villainPosition = otherPositions[Math.floor(Math.random() * otherPositions.length)];
        }

        this.heroIsIP = this._heroHasPosition();

        // Get hero's preflop range based on pot type
        let heroRange;
        if (this.heroProfile) {
            if (typeof getVillainPostflopRange === 'function' && this.potType !== 'srp') {
                // Use pot-type adjusted range for hero too
                heroRange = getVillainPostflopRange(this.pm, heroProfileId, this.heroPosition, this.potType, !isVillainAggressor);
            } else {
                heroRange = this.pm.getRange(heroProfileId, this.heroPosition);
            }
        } else {
            heroRange = [];
        }
        const heroRangeHands = heroRange.length > 0 ? this.pm.rangeToHands(heroRange) : [];

        // Get villain's preflop range adjusted for pot type
        let villainRange;
        if (typeof getVillainPostflopRange === 'function') {
            villainRange = getVillainPostflopRange(this.pm, profileId, this.villainPosition, this.potType, isVillainAggressor);
        } else {
            villainRange = this.pm.getRange(profileId, this.villainPosition);
        }
        this.villainRangeHands = this.pm.rangeToHands(villainRange);

        // Deal hero from their range (if available), else random
        this.deck = shuffleDeck(fullDeck());
        if (heroRangeHands.length > 0) {
            this.heroCards = heroRangeHands[Math.floor(Math.random() * heroRangeHands.length)];
        } else {
            this.heroCards = [this.deck.pop(), this.deck.pop()];
        }

        // Deal villain from their range
        const usedIds = new Set(this.heroCards.map(c => c.id));
        const availableVillainHands = this.villainRangeHands.filter(
            h => !usedIds.has(h[0].id) && !usedIds.has(h[1].id)
        );

        if (availableVillainHands.length > 0) {
            this.villainCards = availableVillainHands[Math.floor(Math.random() * availableVillainHands.length)];
        } else {
            this.villainCards = [this.deck.pop(), this.deck.pop()];
        }

        const allUsed = new Set([...this.heroCards, ...this.villainCards].map(c => c.id));
        this.deck = this.deck.filter(c => !allUsed.has(c.id));

        this.boardCards = [];
        this.street = 'flop';

        // Set pot/stack based on pot type
        if (typeof GTO_PREFLOP !== 'undefined' && GTO_PREFLOP.pot_configs[this.potType]) {
            const cfg = GTO_PREFLOP.pot_configs[this.potType];
            this.potSize = cfg.potSize;
            this.effectiveStack = cfg.effectiveStack;
        } else {
            this.potSize = 6;
            this.effectiveStack = 97;
        }

        // Deal flop
        this.boardCards = [this.deck.pop(), this.deck.pop(), this.deck.pop()];

        this.history = [];

        // Initialize Bayesian range weights (1.0 for each combo)
        this.villainRangeWeights = new Array(this.villainRangeHands.length).fill(1.0);
        this.villainActionHistory = [];

        // Simulate villain's first action if villain is OOP
        this._simulateVillainAction();

        return this.getState();
    }

    // Deal next street
    dealNextStreet() {
        if (this.street === 'flop') {
            this.street = 'turn';
            this.boardCards.push(this.deck.pop());
        } else if (this.street === 'turn') {
            this.street = 'river';
            this.boardCards.push(this.deck.pop());
        }

        // Simulate villain's action on the new street
        this._simulateVillainAction();

        return this.getState();
    }

    // ============================================================
    // Simulate villain's action (OOP acts first, or IP responds)
    // ============================================================
    _simulateVillainAction() {
        // Evaluate villain's hand strength
        const villainEval = categorizeHand(this.villainCards, this.boardCards);
        const villainStr = villainEval.strength;
        const villainStyle = this.currentProfile.style;

        // Base c-bet / donk-bet frequency by villain style
        let betFreq;
        switch (villainStyle) {
            case 'LAG':  betFreq = 0.65; break;
            case 'TAG':  betFreq = 0.45; break;
            case 'REG':  betFreq = 0.50; break;
            case 'NIT':  betFreq = 0.30; break;
            case 'FISH': betFreq = 0.25; break;
            default:     betFreq = 0.40; break;
        }

        // Adjust by hand strength
        if (villainStr >= 0.7) betFreq += 0.3;       // strong hand → more likely to bet
        else if (villainStr >= 0.4) betFreq += 0.1;   // medium hand
        else if (villainStr <= 0.15) betFreq += 0.15;  // air → some bluffs
        else betFreq -= 0.1;                           // weak → check more

        // Clamp
        betFreq = Math.max(0.1, Math.min(0.9, betFreq));

        if (this.heroIsIP) {
            // Villain is OOP → villain acts first
            if (Math.random() < betFreq) {
                // Villain bets
                const sizingOptions = [0.33, 0.5, 0.66, 0.75, 1.0];
                const sizing = villainStr >= 0.7
                    ? sizingOptions[2 + Math.floor(Math.random() * 3)]  // bigger with strong hands
                    : sizingOptions[Math.floor(Math.random() * 3)];      // smaller otherwise
                this.villainBetSize = Math.min(
                    Math.round(this.potSize * sizing * 10) / 10,
                    this.effectiveStack // Can't bet more than remaining stack
                );
                this.villainAction = 'bet';
                this.facingBet = true;
                this._updateVillainRangeWeights('bet', sizing);
            } else {
                // Villain checks
                this.villainAction = 'check';
                this.villainBetSize = 0;
                this.facingBet = false;
                this._updateVillainRangeWeights('check', 0);
            }
        } else {
            // Hero is OOP → hero acts first, villain responds later
            this.villainAction = null;
            this.villainBetSize = 0;
            this.facingBet = false;
        }
    }

    // ============================================================
    // Bayesian Range Update — narrow villain's range after each action
    // Each combo gets a weight = probability that this hand takes the observed action
    // ============================================================
    _updateVillainRangeWeights(action, betSizePctOfPot) {
        if (!this.villainRangeHands || this.villainRangeHands.length === 0) return;

        const usedCards = new Set([...this.heroCards, ...this.boardCards].map(c => c.id));
        const villainStyle = this.currentProfile?.style || 'TAG';
        const board = this.boardCards;

        // Bet size polarization factor: bigger bets → more polarized range
        // 0 = maximally merged, 1 = maximally polarized
        const polarization = Math.min(1, (betSizePctOfPot || 0.5) / 1.0);

        for (let i = 0; i < this.villainRangeHands.length; i++) {
            const hand = this.villainRangeHands[i];
            if (usedCards.has(hand[0].id) || usedCards.has(hand[1].id)) {
                this.villainRangeWeights[i] = 0;
                continue;
            }

            const hc = categorizeHand(hand, board);
            const str = hc.strength;
            const cat = hc.category;

            // Calculate bet probability for this hand given villain's style
            let betProb = this._getHandBetProbability(str, cat, villainStyle, polarization);

            if (action === 'bet') {
                this.villainRangeWeights[i] *= betProb;
            } else if (action === 'check') {
                this.villainRangeWeights[i] *= (1 - betProb);
            } else if (action === 'call') {
                // Villain called hero's bet — update with call probability
                const callProb = this._getHandCallProbability(str, cat, villainStyle, betSizePctOfPot);
                this.villainRangeWeights[i] *= callProb;
            }
            // 'fold' ends the hand, no need to update
        }

        // Record action history
        this.villainActionHistory.push({
            street: this.street,
            action: action,
            betSize: this.villainBetSize,
            betPctOfPot: betSizePctOfPot || 0,
        });
    }

    // Get the probability a specific hand bets, given its strength and villain style
    _getHandBetProbability(strength, category, style, polarization) {
        let baseProb;
        const street = this.street;
        const isRiver = street === 'river';
        const boardTex = analyzeBoardTexture(this.boardCards);
        const isWet = boardTex && boardTex.wetness === 'wet';
        const isDry = boardTex && boardTex.wetness === 'dry';

        // Street polarization: later streets are more polarized
        const streetPol = isRiver ? 0.3 : (street === 'flop' ? -0.15 : 0);

        if (category === 'nuts' || strength >= 0.85) {
            baseProb = 0.78 + (polarization + streetPol) * 0.15;
        } else if (category === 'strongMade' || strength >= 0.65) {
            baseProb = 0.55 - polarization * 0.12 + (isWet ? 0.08 : 0);
        } else if (category === 'mediumMade' || (strength >= 0.40 && strength < 0.65)) {
            baseProb = 0.30 - polarization * 0.18 - (isDry ? 0.08 : 0) + (isRiver ? -0.05 : 0);
        } else if (category === 'strongDraw' || category === 'weakDraw') {
            if (isRiver) {
                // Busted draws on river become air
                baseProb = 0.22 + polarization * 0.12;
            } else {
                baseProb = 0.42 + (isWet ? 0.12 : 0) + polarization * 0.10;
            }
        } else if (category === 'weakMade') {
            baseProb = 0.12 - polarization * 0.06 + (isDry ? 0.04 : -0.03);
        } else {
            // Air: bluff frequency
            baseProb = 0.18 + polarization * 0.12 + (isRiver ? 0.05 : 0) + streetPol * 0.08;
        }

        const styleMultiplier = {
            LAG: 1.35, TAG: 1.00, REG: 1.10, NIT: 0.65, FISH: 0.70,
        };
        baseProb *= (styleMultiplier[style] || 1.0);
        return Math.max(0.03, Math.min(0.97, baseProb));
    }

    // Probability of calling a bet given hand strength, category, villain style, and bet size
    _getHandCallProbability(strength, category, style, betSizePctOfPot) {
        const sizing = betSizePctOfPot || 0.5;
        // Bigger bets require stronger hands to call
        // MDF (minimum defense frequency) = pot / (pot + bet)
        // At 1/3 pot: MDF=75%, 1/2 pot: 67%, 2/3 pot: 60%, pot: 50%
        let baseCall;

        if (category === 'nuts' || strength >= 0.85) {
            // Nuts: always calls (or raises, but we model call here)
            baseCall = 0.95;
        } else if (category === 'strongMade' || strength >= 0.65) {
            // Strong: almost always calls
            baseCall = 0.88 - sizing * 0.10; // 0.78–0.88
        } else if (category === 'mediumMade' || (strength >= 0.40 && strength < 0.65)) {
            // Medium: calls often vs small, less vs big
            baseCall = 0.65 - sizing * 0.25; // 0.40–0.65
        } else if (category === 'strongDraw' || category === 'weakDraw') {
            // Draws: call with good odds, fold to large
            baseCall = 0.60 - sizing * 0.20; // 0.40–0.60
        } else if (category === 'weakMade') {
            // Weak made: some calls vs small, rarely vs big
            baseCall = 0.35 - sizing * 0.20; // 0.15–0.35
        } else {
            // Air: almost never calls (might float small bets)
            baseCall = 0.10 - sizing * 0.05; // 0.05–0.10
        }

        // Style adjustments
        const styleMultiplier = {
            LAG:  1.20,  // LAG calls/floats wider
            TAG:  1.00,
            REG:  1.05,
            NIT:  0.70,  // NIT folds a lot
            FISH: 1.40,  // FISH calls way too much
        };
        baseCall *= (styleMultiplier[style] || 1.0);

        return Math.max(0.02, Math.min(0.98, baseCall));
    }

    // Bayesian-weighted equity calculation using villain range weights
    _calcWeightedEquity() {
        if (!this.villainRangeHands || this.villainRangeHands.length === 0) return 0.5;

        const totalWeight = this.villainRangeWeights.reduce((s, w) => s + w, 0);
        if (totalWeight < 0.001) return 0.5;

        const usedCards = new Set([...this.heroCards, ...this.boardCards].map(c => c.id));
        const deck = [];
        const allSuits = ['♠','♥','♦','♣'];
        const allRanks = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
        for (const r of allRanks) for (const s of allSuits) {
            const id = r + s;
            if (!usedCards.has(id)) deck.push({ rank: r, suit: s, id });
        }

        let wins = 0, ties = 0, sims = 0;
        const heroCards = this.heroCards;
        const boardCards = this.boardCards;
        const cardsNeeded = 5 - boardCards.length;

        for (let i = 0; i < 2000; i++) {
            // Weighted roulette selection of villain hand
            let r = Math.random() * totalWeight;
            let vIdx = 0;
            for (let j = 0; j < this.villainRangeWeights.length; j++) {
                r -= this.villainRangeWeights[j];
                if (r <= 0) { vIdx = j; break; }
            }
            const vHand = this.villainRangeHands[vIdx];
            if (!vHand || usedCards.has(vHand[0].id) || usedCards.has(vHand[1].id)) continue;

            // Build remaining deck excluding villain cards
            const remainDeck = deck.filter(c => c.id !== vHand[0].id && c.id !== vHand[1].id);
            if (remainDeck.length < cardsNeeded) continue;

            // Deal remaining community cards
            let runout = [...boardCards];
            const shuffled = remainDeck.slice();
            for (let k = shuffled.length - 1; k > 0; k--) {
                const swap = Math.floor(Math.random() * (k + 1));
                [shuffled[k], shuffled[swap]] = [shuffled[swap], shuffled[k]];
            }
            for (let k = 0; k < cardsNeeded; k++) runout.push(shuffled[k]);

            const heroEval = evaluateBest(heroCards, runout);
            const villEval = evaluateBest(vHand, runout);
            if (!heroEval || !villEval) continue;
            if (heroEval.score > villEval.score) wins++;
            else if (heroEval.score === villEval.score) ties++;
            sims++;
        }
        if (sims === 0) return 0.5;
        return (wins + ties * 0.5) / sims;
    }

    // Get villain's action description for timeline
    getVillainActionInfo() {
        if (this.villainAction === 'bet') {
            const pctOfPot = Math.round(this.villainBetSize / this.potSize * 100);
            let label;
            if (pctOfPot <= 40) label = '1/3 Pot';
            else if (pctOfPot <= 55) label = '1/2 Pot';
            else if (pctOfPot <= 72) label = '2/3 Pot';
            else if (pctOfPot <= 85) label = '3/4 Pot';
            else label = 'Pot';
            return { action: 'Bet', sizing: `${label} (${this.villainBetSize}BB)`, color: '#e74c3c' };
        } else if (this.villainAction === 'check') {
            return { action: 'Check', sizing: '', color: '#3498db' };
        }
        return null;
    }

    // Simulate villain's IP response after hero checks OOP
    simulateVillainIPResponse() {
        const villainEval = categorizeHand(this.villainCards, this.boardCards);
        const villainStr = villainEval.strength;
        const villainStyle = this.currentProfile.style;

        let betFreq;
        switch (villainStyle) {
            case 'LAG':  betFreq = 0.70; break;
            case 'TAG':  betFreq = 0.50; break;
            case 'REG':  betFreq = 0.55; break;
            case 'NIT':  betFreq = 0.35; break;
            case 'FISH': betFreq = 0.30; break;
            default:     betFreq = 0.45; break;
        }

        // IP player bets more after check (probing weakness)
        if (villainStr >= 0.7) betFreq += 0.25;
        else if (villainStr >= 0.4) betFreq += 0.15;
        else if (villainStr <= 0.15) betFreq += 0.20; // bluff more IP
        else betFreq -= 0.05;

        betFreq = Math.max(0.1, Math.min(0.9, betFreq));

        if (Math.random() < betFreq) {
            const sizingOptions = [0.33, 0.5, 0.66, 0.75, 1.0];
            const sizing = villainStr >= 0.7
                ? sizingOptions[2 + Math.floor(Math.random() * 3)]
                : sizingOptions[Math.floor(Math.random() * 3)];
            this.villainBetSize = Math.min(
                Math.round(this.potSize * sizing * 10) / 10,
                this.effectiveStack
            );
            this.villainAction = 'bet';
            this.facingBet = true;
            this._updateVillainRangeWeights('bet', sizing);
            return 'bet';
        } else {
            this.villainAction = 'check';
            this.villainBetSize = 0;
            this.facingBet = false;
            this._updateVillainRangeWeights('check', 0);
            return 'check';
        }
    }

    // Simulate villain's response when facing hero's bet/raise
    // Returns 'call' or 'fold'
    simulateVillainFacingBet(heroBetSize) {
        const villainEval = categorizeHand(this.villainCards, this.boardCards);
        const villainStr = villainEval.strength;
        const villainStyle = this.currentProfile.style;

        let callFreq;
        if (villainStr >= 0.7) callFreq = 0.92;
        else if (villainStr >= 0.5) callFreq = 0.72;
        else if (villainStr >= 0.35) callFreq = 0.48;
        else if (villainStr >= 0.2) callFreq = 0.28;
        else callFreq = 0.12;

        // Adjust by villain style
        switch (villainStyle) {
            case 'LAG': callFreq += 0.10; break;
            case 'NIT': callFreq -= 0.15; break;
            case 'FISH': callFreq += 0.20; break;
            case 'REG': callFreq += 0.05; break;
        }

        // Bigger bets get fewer calls
        const betPctOfPot = heroBetSize / this.potSize;
        if (betPctOfPot > 0.8) callFreq -= 0.08;
        if (betPctOfPot > 1.2) callFreq -= 0.08;

        callFreq = Math.max(0.05, Math.min(0.95, callFreq));

        return Math.random() < callFreq ? 'call' : 'fold';
    }

    // Get current game state
    getState() {
        const boardTexture = analyzeBoardTexture(this.boardCards);
        const handCategory = categorizeHand(this.heroCards, this.boardCards);
        const equity = this.villainRangeWeights && this.villainActionHistory.length > 0
            ? this._calcWeightedEquity()
            : calcEquity(this.heroCards, this.boardCards, this.villainRangeHands, 1500);

        if (this.effectiveStack < 0) this.effectiveStack = 0;
        const spr = this.potSize > 0 ? this.effectiveStack / this.potSize : 0;

        return {
            heroPosition: this.heroPosition,
            villainPosition: this.villainPosition,
            villainProfile: this.currentProfile,
            heroCards: this.heroCards,
            boardCards: this.boardCards,
            street: this.street,
            potSize: this.potSize,
            effectiveStack: this.effectiveStack,
            spr: spr,
            boardTexture: boardTexture,
            handCategory: handCategory,
            equity: equity,
            history: this.history,
            // Action context
            heroIsIP: this.heroIsIP,
            facingBet: this.facingBet,
            villainAction: this.villainAction,
            villainBetSize: this.villainBetSize,
            villainCards: this.villainCards,
            canUndo: this.canUndo(),
        };
    }

    // ============================================================
    // CFR+ Solver-based GTO Recommendation
    // Uses real counterfactual regret minimization instead of heuristics
    // ============================================================
    getCFRRecommendation() {
        const state = this.getState();
        const { equity, handCategory, boardTexture, spr } = state;

        // Need board cards for postflop solving
        if (!this.boardCards || this.boardCards.length < 3) return null;
        if (!this.villainRangeHands || this.villainRangeHands.length === 0) return null;

        // Cache check: same board + street + position → reuse previous solve
        const cacheKey = this.boardCards.map(c => c.id).sort().join(',') + '|' + this.street + '|' + (this.heroIsIP ? 'IP' : 'OOP');
        if (this._cfrCacheKey === cacheKey && this._cfrCachedResult) {
            return this._cfrCachedResult;
        }

        // Determine hero range — use preflop range if available
        let heroRangeHands = [];
        if (this.heroProfile && this.pm) {
            const heroPos = this.heroPosition;
            const heroProfileId = this.heroProfile?.id;
            let heroRangeStrings = [];
            if (typeof getVillainPostflopRange === 'function' && this.potType && this.potType !== 'srp') {
                heroRangeStrings = getVillainPostflopRange(this.pm, heroProfileId, heroPos, this.potType, !this.isVillainAggressor) || [];
            } else {
                heroRangeStrings = this.pm.getRange(heroProfileId, heroPos) || [];
            }
            heroRangeHands = heroRangeStrings.length > 0 ? this.pm.rangeToHands(heroRangeStrings) : [];
        }

        // If no hero range available, can't solve — fallback to heuristic
        if (heroRangeHands.length === 0) {
            return null;
        }

        // Dynamic parameter tuning based on range size
        // Smaller ranges = fewer buckets but more iterations → converges better
        const numHeroCombos = heroRangeHands.filter(h => !handConflictsWithBoard(h, this.boardCards)).length;
        const numVillainCombos = this.villainRangeHands.filter(h => !handConflictsWithBoard(h, this.boardCards)).length;
        const minCombos = Math.min(numHeroCombos, numVillainCombos);
        // JS solver params — optimized for best accuracy within browser constraints
        let numBuckets, iterations;
        if (minCombos < 50) {
            numBuckets = Math.min(20, Math.max(10, Math.floor(minCombos / 2)));
            iterations = 2500;
        } else if (minCombos < 200) {
            numBuckets = Math.min(40, Math.max(20, Math.floor(minCombos / 4)));
            iterations = 1500;
        } else {
            numBuckets = Math.min(50, Math.max(25, Math.floor(minCombos / 5)));
            iterations = 1000;
        }

        try {
            // Check if we have pre-cached equity buckets from solver-cache
            const cachedBuckets = (typeof solverCache !== 'undefined')
                ? solverCache.getCachedBuckets(this.boardCards, 50)
                : null;

            const solveOptions = {};
            let effectiveBuckets = numBuckets;
            let effectiveIterations = iterations;

            if (cachedBuckets) {
                // Pre-cached buckets → skip bucketing, boost precision
                solveOptions.precomputedHeroBuckets = this.heroIsIP ? cachedBuckets.hero : cachedBuckets.villain;
                solveOptions.precomputedVillainBuckets = this.heroIsIP ? cachedBuckets.villain : cachedBuckets.hero;
                effectiveBuckets = 50;
                effectiveIterations = 2500;
                console.log('[Practice] Using pre-cached buckets → boosted to 50 buckets, 2500 iterations');
            }

            const solver = new PostflopSolver({
                heroRange: heroRangeHands,
                villainRange: this.villainRangeHands,
                board: this.boardCards,
                pot: this.potSize,
                stack: this.effectiveStack,
                heroIsIP: this.heroIsIP,
                street: this.street,
                betSizes: [0.33, 0.66, 1.0],
                numBuckets: effectiveBuckets,
                iterations: effectiveIterations,
                simsPerHand: 150,
            });

            solver.solve(solveOptions);

            // Get strategy for hero's specific hand
            let strategy;
            if (this.facingBet) {
                const betPct = this.villainBetSize / this.potSize;
                strategy = solver.getStrategyFacingBet(this.heroCards, betPct);
            } else {
                strategy = solver.getStrategy(this.heroCards);
            }

            if (!strategy) return null;

            // Get range composition for reasoning
            const rangeComp = this.analyzeRangeComposition();

            // Convert CFR strategy to advice format
            const advice = [];
            const actionLabels = {
                check: { cn: '过牌', color: '#3498db' },
                bet33: { cn: '下注 1/3底池', color: '#e74c3c', sizing: '1/3底池' },
                bet66: { cn: '下注 2/3底池', color: '#e74c3c', sizing: '2/3底池' },
                bet100: { cn: '下注 满池', color: '#e74c3c', sizing: '满池' },
                fold: { cn: '弃牌', color: '#95a5a6' },
                call: { cn: '跟注', color: '#2ecc71' },
                raise: { cn: '加注', color: '#e74c3c', sizing: '2.5x' },
                allin: { cn: '全压', color: '#e74c3c', sizing: '全压' },
            };

            for (const [action, freq] of Object.entries(strategy)) {
                const pct = Math.round(freq * 100);
                if (pct < 1) continue;

                const label = actionLabels[action] || { cn: action, color: '#666' };
                const baseAction = action.startsWith('bet') ? 'bet' : action;

                advice.push({
                    action: baseAction,
                    actionCN: label.cn,
                    frequency: pct,
                    sizing: label.sizing || '-',
                    reasoning: this._buildCFRReasoning(action, pct, handCategory, equity, spr, boardTexture, rangeComp, this.facingBet, this.villainBetSize, this.potSize),
                    color: label.color,
                });
            }

            if (advice.length === 0) return null;

            // Normalize frequencies to sum to 100
            const total = advice.reduce((s, a) => s + a.frequency, 0);
            if (total > 0 && total !== 100) {
                advice.forEach(a => a.frequency = Math.round(a.frequency / total * 100));
                const roundedTotal = advice.reduce((s, a) => s + a.frequency, 0);
                if (roundedTotal !== 100 && advice.length > 0) {
                    const maxItem = advice.reduce((max, a) => a.frequency > max.frequency ? a : max, advice[0]);
                    maxItem.frequency += (100 - roundedTotal);
                }
            }

            const vStyle = this.currentProfile?.style || 'TAG';

            // Build narrative: board texture + hand + range context (no solver internals)
            const wetLabel = boardTexture ? (boardTexture.wetness === 'wet' ? '湿润' : boardTexture.wetness === 'dry' ? '干燥' : '中等') : '';
            const boardStr = this.boardCards.map(c => c.rank + c.suit).join(' ');
            const rcNarrative = rangeComp ? `对手范围: value ${rangeComp.valuePct || 0}% / draw ${rangeComp.drawPct || 0}% / air ${rangeComp.bluffPct || 0}%` : '';
            const sprLabel = spr < 2 ? '极浅筹码' : spr < 4 ? '浅筹码' : spr > 12 ? '深筹码' : '中等筹码';
            const posLabel = this.heroIsIP ? 'IP' : 'OOP';

            return {
                advice: advice.sort((a, b) => b.frequency - a.frequency),
                narrative: `${boardStr} ${wetLabel}牌面 | ${handCategory.categoryCN}(权益${(equity*100).toFixed(0)}%) ${posLabel} | ${rcNarrative} | SPR ${spr.toFixed(1)} ${sprLabel}`,
                mdf: { halfPot: 66.7, twoThirdsPot: 60.0, fullPot: 50.0, description: 'MDF：面对下注需要至少跟注该比例防止对手随意诈唬。' },
                potOdds: { halfPot: 25.0, twoThirdsPot: 28.6, fullPot: 33.3, description: '底池赔率：盈利跟注所需的最低胜率。' },
                equity, handCategory, boardTexture,
                inPosition: this.heroIsIP,
                facingBet: this.facingBet,
                spr: spr,
                villainStyle: vStyle,
                rangeComposition: rangeComp,
                solverUsed: true,
                solverIterations: effectiveIterations,
                solverBuckets: effectiveBuckets,
            };

            // Cache result for undo/redo consistency
            this._cfrCacheKey = cacheKey;
            this._cfrCachedResult = result;
            return result;
        } catch (e) {
            console.warn('CFR solver failed, falling back to heuristics:', e);
            return null;
        }
    }

    // C++ Solver API call (TexasSolver on Railway)
    // Returns PIO-level accurate strategy for hero's specific hand
    // Try Railway directly first (faster, no 10s Vercel timeout)
    // Falls back to Vercel proxy if direct fails (Zscaler etc)
    static SOLVER_API_URL = 'https://personalizedgtoteacher-production.up.railway.app';

    async getRemoteRecommendation() {
        try {
            const state = this.getState();
            if (!this.boardCards || this.boardCards.length < 3) return null;

            // Build range strings in TexasSolver format (comma-separated canonical hands)
            const heroRangeKeys = this.heroProfile && this.pm
                ? (this.pm.getRange(this.heroProfile.id, this.heroPosition) || [])
                : [];
            const villainRangeKeys = this.currentProfile && this.pm
                ? (this.pm.getRange(this.currentProfile.id, this.villainPosition) || [])
                : [];
            if (heroRangeKeys.length === 0 || villainRangeKeys.length === 0) return null;

            // Convert board to TexasSolver format: "Ts,Th,8d,7c"
            const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
            const boardStr = this.boardCards.map(c => c.rank + suitMap[c.suit]).join(',');
            const heroHandStr = this.heroCards.map(c => c.rank + suitMap[c.suit]);

            // Determine round: 1=flop, 2=turn, 3=river
            const round = this.boardCards.length === 3 ? 1 : this.boardCards.length === 4 ? 2 : 3;

            // Flop C++ tree is too large (millions of nodes across 3 streets)
            // Even with MC sampling, tree BUILDING takes minutes
            // Solution: use JS solver for flop, C++ for turn/river
            if (round === 1) {
                console.log('Flop: using enhanced JS solver (C++ tree too large)');
                return null;
            }
            // Turn/River: C++ solver via Railway Pro
            // Keep ranges small enough for Vercel proxy 10s timeout
            const maxRange = round === 2 ? 25 : 40;
            const ipRange = this.heroIsIP ? heroRangeKeys : villainRangeKeys;
            const oopRange = this.heroIsIP ? villainRangeKeys : heroRangeKeys;
            const trimmedIP = ipRange.length > maxRange ? ipRange.slice(0, maxRange) : ipRange;
            const trimmedOOP = oopRange.length > maxRange ? oopRange.slice(0, maxRange) : oopRange;

            // Ensure hero's actual hand is in the range
            const heroCanonical = handToCanonical(this.heroCards[0], this.heroCards[1]);
            if (this.heroIsIP && !trimmedIP.includes(heroCanonical)) trimmedIP.push(heroCanonical);
            else if (!this.heroIsIP && !trimmedOOP.includes(heroCanonical)) trimmedOOP.push(heroCanonical);

            const body = {
                range_ip: trimmedIP.join(','),
                range_oop: trimmedOOP.join(','),
                board: boardStr,
                round: round,
                oop_commit: this.potSize / 2,
                ip_commit: this.potSize / 2,
                stack: this.effectiveStack + this.potSize / 2,
                iterations: 50, // Fit within Vercel proxy 10s timeout (~3s solve + 4s overhead)
                accuracy: 0.5,
                threads: 2,
                dump_depth: 2,
            };

            // Try Railway directly (no 10s timeout), fallback to Vercel proxy
            let resp;
            try {
                resp = await fetch(PracticeSession.SOLVER_API_URL + '/api/solve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } catch(directErr) {
                // Direct failed (CORS/proxy) — try Vercel proxy
                console.log('Direct Railway failed, trying Vercel proxy');
                resp = await fetch('/api/solve-cpp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            }

            if (!resp || !resp.ok) return null;
            const data = await resp.json();
            if (data.error || !data.strategy) return null;

            // Navigate the strategy tree to find hero's decision node
            // Root = OOP's first action (CHECK/BET)
            // If hero is IP and NOT facing bet → hero's node is root.childrens["CHECK"]
            // If hero is IP and facing bet → hero decides at root (OOP bet, IP responds)
            // If hero is OOP → hero decides at root
            const heroIsIP = this.heroIsIP;
            let strategyNode = data.strategy?.strategy;

            if (heroIsIP && !this.facingBet) {
                // IP after OOP checks → find CHECK child
                strategyNode = data.strategy?.childrens?.['CHECK']?.strategy
                            || strategyNode;
            } else if (!heroIsIP && this.facingBet) {
                // OOP facing IP's bet → need to find the bet child
                // Find the closest bet size in children
                const children = data.strategy?.childrens || {};
                for (const [key, child] of Object.entries(children)) {
                    if (key.startsWith('BET')) {
                        strategyNode = child?.strategy || strategyNode;
                        break;
                    }
                }
            }
            // If hero is OOP not facing bet → root is correct (OOP acts first)
            // If hero is IP facing bet → root is OOP's bet action, hero responds
            //   → need the bet child node
            if (heroIsIP && this.facingBet) {
                const children = data.strategy?.childrens || {};
                for (const [key, child] of Object.entries(children)) {
                    if (key.startsWith('BET')) {
                        strategyNode = child?.strategy || strategyNode;
                        break;
                    }
                }
            }

            if (!strategyNode || !strategyNode.strategy) return null;

            const actions = strategyNode.actions || [];
            const handStrategies = strategyNode.strategy;

            // Find hero's specific hand combos
            const heroKey1 = heroHandStr[0] + heroHandStr[1];
            const heroKey2 = heroHandStr[1] + heroHandStr[0];
            const heroStrat = handStrategies[heroKey1] || handStrategies[heroKey2];
            if (!heroStrat) return null;

            // Convert to our format
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

            console.log(`C++ solver: ${Math.round(data.solve_time_ms)}ms, ${data.iterations} iters, hand: ${heroKey1}`);
            console.log('Strategy:', strategy);

            return { strategy, solveTimeMs: data.solve_time_ms, iterations: data.iterations };
        } catch (e) {
            console.warn('C++ solver unavailable:', e.message);
            return null;
        }
    }

    // Data-driven poker reasoning — answers: what do you have, why this action, key insight
    _buildCFRReasoning(action, freq, handCategory, equity, spr, boardTexture, rangeComp, facingBet, villainBetSize, potSize) {
        const parts = [];
        parts.push(this._describeHand(handCategory, equity, boardTexture));
        parts.push(this._explainAction(action, freq, handCategory, equity, spr, boardTexture, rangeComp, facingBet, villainBetSize, potSize));
        const insight = this._keyInsight(action, handCategory, rangeComp, spr, boardTexture);
        if (insight) parts.push(insight);
        return parts.join('');
    }

    // Part 1: What do you have on this board?
    _describeHand(handCategory, equity, boardTexture) {
        const catCN = handCategory.categoryCN;
        const eqPct = (equity * 100).toFixed(0);
        const cat = handCategory.category;
        const paired = boardTexture?.isPaired;
        const connected = boardTexture?.connectedness === 'connected';
        const mono = boardTexture?.isMonotone;

        let desc = `${catCN}(权益${eqPct}%)`;

        // Board-aware context (avoid generic statements)
        if (paired) {
            if (cat === 'nuts' || cat === 'strongMade' || str >= 0.7) {
                // Strong hand on paired board — you benefit from the pair
                desc += '——强牌在配对面';
            } else if (cat === 'air' || str < 0.15) {
                desc += '——公牌有对子，你没有connect';
            } else {
                // Medium/weak hand — the pair could mean opponent has trips
                desc += '——公牌有对子，对手可能有暗三';
            }
        } else if (mono && cat !== 'nuts' && !handCategory.blockerInfo?.blocksNutFlush) {
            desc += '——单色面你没有同花';
        } else if (connected && (cat === 'air' || cat === 'weakDraw')) {
            desc += '——连接面你没有顺子';
        } else if (cat === 'air') {
            desc += '——当前没有成牌';
        }
        return desc + '。';
    }

    // Part 2: Why this action? (data-driven, not template)
    _explainAction(action, freq, handCategory, equity, spr, boardTexture, rangeComp, facingBet, villainBetSize, potSize) {
        const str = handCategory.strength;
        const cat = handCategory.category;
        const isRiver = this.street === 'river';
        const isIP = this.heroIsIP;
        const beats = rangeComp?.beatsHeroPct || 0;
        const loses = rangeComp?.losesToHeroPct || 0;
        const heroTop = rangeComp?.heroPercentile || 50;
        const vAir = rangeComp?.bluffPct || 0;
        const vValue = rangeComp?.valuePct || 0;

        // Pot odds context
        let potOdds = 0;
        if (facingBet && villainBetSize > 0 && potSize > 0) {
            potOdds = Math.round(villainBetSize / (potSize + villainBetSize) * 100);
        }

        if (action === 'check') {
            if (isRiver && isIP) {
                if (loses > 60) return `对手范围${loses}%的combo不如你，但这些弱牌不会跟注你的下注——过牌摊牌是最优选择。`;
                if (beats > 40) return `对手范围${beats}%的combo强于你。下注会被更好的牌跟注，更差的弃牌，过牌摊牌锁定权益。`;
                return `下注后能获得跟注的手牌几乎都赢你，过牌摊牌更优。`;
            }
            if (isRiver && !isIP) {
                if (str >= 0.7) return `OOP强牌过牌——诱导IP下注，准备check-raise获取最大价值。`;
                if (str < 0.2) return `手牌无摊牌价值，放弃。`;
                return `有摊牌价值但不足以lead下注，过牌等待。`;
            }
            // Flop/Turn
            if (str >= 0.6 && isIP) return `IP强牌过牌控速——后续街还有下注机会，过牌保持范围平衡。`;
            if (str >= 0.6 && !isIP) return `OOP强牌过牌——保护过牌范围，后续可以check-raise。`;
            if (str >= 0.3) return `中等牌力过牌控池，避免膨胀底池后被迫弃牌。`;
            if (cat === 'strongDraw' || cat === 'weakDraw') return `听牌过牌看免费牌，保留改进机会。`;
            return `牌力不足以下注，过牌等待。`;
        }

        if (action === 'fold') {
            if (potOdds > 0) {
                let reason = `底池赔率需要${potOdds}%权益，你只有${(equity*100).toFixed(0)}%`;
                if (beats > 50) reason += `。对手下注范围中${beats}%的combo强于你`;
                return reason + '，弃牌止损。';
            }
            return `权益不足以继续，弃牌止损。`;
        }

        if (action === 'call') {
            if (potOdds > 0) {
                let reason = `底池赔率需要${potOdds}%权益`;
                if (equity * 100 > potOdds + 10) {
                    reason += `，你有${(equity*100).toFixed(0)}%权益(充足)`;
                } else if (equity * 100 > potOdds) {
                    reason += `，你有${(equity*100).toFixed(0)}%权益(刚好满足)`;
                }
                if (spr > 6 && (cat === 'strongDraw' || cat === 'weakDraw') && !isRiver) {
                    reason += '。深筹码听牌有隐含赔率';
                }
                return reason + '，跟注继续。';
            }
            return `权益足够跟注，但加注缺乏价值。`;
        }

        // bet/raise/allin — aggressive actions
        if (action === 'allin') {
            if (spr < 2) return `SPR仅${spr.toFixed(1)}，筹码浅已接近承诺——${str >= 0.5 ? '手牌够强，全压获取最大价值。' : '全压施加最大压力。'}`;
            return `全压——${str >= 0.6 ? '手牌强度支撑承诺全部筹码。' : '极化全压施压。'}`;
        }

        // bet (including bet33, bet66, bet100, bet_BET X)
        if (heroTop > 70) {
            return `你的牌在范围顶部(top ${100 - heroTop}%)。${vAir > 40 ? `对手范围空气${vAir}%，下注从弱牌中获取价值。` : `对手有足够跟注的中等牌(value ${vValue}%)。`}`;
        }
        if (cat === 'air' || str < 0.2) {
            return `作为诈唬下注——${vAir < 30 ? '平衡下注范围中需要一定诈唬频率。' : `对手范围弱牌多(air ${vAir}%)，下注拿走底池。`}`;
        }
        if (str >= 0.6) {
            return `${loses > 50 ? `你打对手${loses}%的范围，` : ''}下注从对手的中等牌和听牌中获取价值。`;
        }
        return `下注获取薄价值/保护权益。`;
    }

    // Part 3: One key insight (only when relevant)
    _keyInsight(action, handCategory, rangeComp, spr, boardTexture) {
        const blockers = handCategory.blockerInfo || {};
        const vStyle = this.currentProfile?.style;

        // Blocker effects
        if (blockers.blocksNutFlush && (action === 'bet' || action === 'raise' || action.startsWith('bet'))) {
            return `持有${blockers.flushSuit || ''}同花阻断牌，增加对手弃牌概率。`;
        }

        // Opponent type
        if (vStyle === 'NIT' && action === 'fold') return '对手NIT风格下注代表强牌，弃牌是正确的。';
        if (vStyle === 'FISH' && (action === 'bet' || action.startsWith('bet'))) return '对手FISH跟注站，加大下注尺度获取更多价值。';
        if (vStyle === 'LAG' && action === 'call') return '对手LAG诈唬频率高，宽跟注利用其过度激进。';

        // SPR
        if (spr < 1.5 && spr > 0) return `SPR ${spr.toFixed(1)}极低，已承诺底池。`;

        // Board texture
        if (boardTexture?.isPaired && action === 'check') return '公牌有对子，对手可能有trips，谨慎行事。';

        return '';
    }

    // ============================================================
    // GTO Recommendation — async worker-first, sync fallback
    // ============================================================
    getRecommendation() {
        // Priority 0: Precomputed lookup (PIO-level, zero latency)
        if (this._precomputedResult) {
            const result = this._precomputedResult;
            this._precomputedResult = null;
            return result;
        }

        // Priority 1: C++ TexasSolver result (PIO-level accuracy)
        if (this._remoteStrategy) {
            const formatted = this._formatRemoteStrategy(this._remoteStrategy);
            this._remoteStrategy = null;
            if (formatted) return formatted;
        }

        // Priority 2: JS Worker pre-solved result
        if (this._workerResult) {
            const result = this._workerResult;
            this._workerResult = null;
            return result;
        }

        // Priority 3: Sync JS CFR (blocks main thread)
        const cfrResult = this.getCFRRecommendation();
        if (cfrResult) return cfrResult;

        // Priority 4: Rule-based heuristic
        return this._getHeuristicRecommendation();
    }

    // Format C++ TexasSolver strategy into recommendation format
    _formatRemoteStrategy(strategy) {
        const state = this.getState();
        const { equity, handCategory, boardTexture, spr } = state;
        const rangeComp = this.analyzeRangeComposition();

        const advice = [];
        const actionMap = {
            'check': { cn: '过牌', color: '#3498db', sizing: '-', base: 'check' },
            'fold': { cn: '弃牌', color: '#95a5a6', sizing: '-', base: 'fold' },
            'call': { cn: '跟注', color: '#2ecc71', sizing: '-', base: 'call' },
        };

        for (const [key, freq] of Object.entries(strategy)) {
            const pct = Math.round(freq * 100);
            if (pct < 1) continue;

            let label;
            if (actionMap[key]) {
                label = actionMap[key];
            } else if (key.startsWith('bet_BET')) {
                const amount = parseFloat(key.replace('bet_BET ', ''));
                const potPct = Math.round(amount / this.potSize * 100);
                const sizeLabel = potPct <= 40 ? '1/3底池' : potPct <= 55 ? '1/2底池' : potPct <= 80 ? '2/3底池' : potPct <= 120 ? '满池' : `${potPct}%底池`;
                label = { cn: `下注 ${sizeLabel}`, color: '#e74c3c', sizing: sizeLabel, base: 'bet' };
            } else if (key.startsWith('raise_RAISE')) {
                const amount = parseFloat(key.replace('raise_RAISE ', ''));
                const potPct = Math.round(amount / this.potSize * 100);
                const sizeLabel = potPct >= 200 ? '全压' : `${amount.toFixed(0)}BB`;
                label = { cn: `加注 ${sizeLabel}`, color: '#e74c3c', sizing: sizeLabel, base: 'raise' };
            } else {
                label = { cn: key, color: '#666', sizing: '-', base: key };
            }

            // Merge into existing action with same display name (e.g., two BET sizes both "1/3底池")
            const existing = advice.find(a => a.actionCN === label.cn);
            if (existing) {
                existing.frequency += pct;
            } else {
                advice.push({
                    action: label.base,
                    actionCN: label.cn,
                    frequency: pct,
                    sizing: label.sizing,
                    reasoning: this._buildCFRReasoning(label.base, pct, handCategory, equity, spr, boardTexture, rangeComp, this.facingBet, this.villainBetSize, this.potSize),
                    color: label.color,
                });
            }
        }

        if (advice.length === 0) return null;

        // Normalize to 100%
        const total = advice.reduce((s, a) => s + a.frequency, 0);
        if (total > 0 && total !== 100) {
            advice.forEach(a => a.frequency = Math.round(a.frequency / total * 100));
            const rt = advice.reduce((s, a) => s + a.frequency, 0);
            if (rt !== 100) advice[0].frequency += (100 - rt);
        }

        const vStyle = this.currentProfile?.style || 'TAG';
        const wetLabel = boardTexture ? (boardTexture.wetness === 'wet' ? '湿润' : boardTexture.wetness === 'dry' ? '干燥' : '中等') : '';
        const boardStr = this.boardCards.map(c => c.rank + c.suit).join(' ');
        const rcNarr = rangeComp ? `对手范围: value ${rangeComp.valuePct || 0}% / draw ${rangeComp.drawPct || 0}% / air ${rangeComp.bluffPct || 0}%` : '';

        return {
            advice: advice.sort((a, b) => b.frequency - a.frequency),
            narrative: `${boardStr} ${wetLabel}牌面 | ${handCategory.categoryCN}(权益${(equity*100).toFixed(0)}%) ${this.heroIsIP ? 'IP' : 'OOP'} | ${rcNarr} | SPR ${spr.toFixed(1)}`,
            mdf: { halfPot: 66.7, twoThirdsPot: 60.0, fullPot: 50.0 },
            potOdds: { halfPot: 25.0, twoThirdsPot: 28.6, fullPot: 33.3 },
            equity, handCategory, boardTexture,
            inPosition: this.heroIsIP,
            facingBet: this.facingBet,
            spr, villainStyle: vStyle,
            rangeComposition: rangeComp,
            solverUsed: 'cpp',
        };
    }

    // Async version: waits for worker result, then falls back
    async getRecommendationAsync() {
        // Try to get pre-solved worker result
        if (typeof solverCache !== 'undefined') {
            const workerResult = await solverCache.getPreSolvedPostflop();
            if (workerResult && workerResult.strategy) {
                // Convert worker result to recommendation format
                const formatted = this._formatWorkerResult(workerResult);
                if (formatted) return formatted;
            }
        }

        // Fallback to sync
        return this.getRecommendation();
    }

    // Format worker solver result into recommendation format
    _formatWorkerResult(workerResult) {
        if (!workerResult || !workerResult.strategy) return null;

        const state = this.getState();
        const { equity, handCategory, boardTexture, spr } = state;
        const strategy = workerResult.strategy;

        const rangeComp = this.analyzeRangeComposition();

        const actionLabels = {
            check: { cn: '过牌', color: '#3498db' },
            bet33: { cn: '下注 1/3底池', color: '#e74c3c', sizing: '1/3底池' },
            bet66: { cn: '下注 2/3底池', color: '#e74c3c', sizing: '2/3底池' },
            bet100: { cn: '下注 满池', color: '#e74c3c', sizing: '满池' },
            fold: { cn: '弃牌', color: '#95a5a6' },
            call: { cn: '跟注', color: '#2ecc71' },
            raise: { cn: '加注', color: '#e74c3c', sizing: '2.5x' },
            allin: { cn: '全压', color: '#e74c3c', sizing: '全压' },
        };

        const advice = [];
        for (const [action, freq] of Object.entries(strategy)) {
            const pct = Math.round(freq * 100);
            if (pct < 1) continue;
            const label = actionLabels[action] || { cn: action, color: '#666' };
            const baseAction = action.startsWith('bet') ? 'bet' : action;
            advice.push({
                action: baseAction, actionCN: label.cn, frequency: pct,
                sizing: label.sizing || '-', color: label.color,
                reasoning: '',
            });
        }

        if (advice.length === 0) return null;

        // Normalize
        const total = advice.reduce((s, a) => s + a.frequency, 0);
        if (total > 0 && total !== 100) {
            advice.forEach(a => a.frequency = Math.round(a.frequency / total * 100));
            const rt = advice.reduce((s, a) => s + a.frequency, 0);
            if (rt !== 100) advice[0].frequency += (100 - rt);
        }
        advice.sort((a, b) => b.frequency - a.frequency);

        // Add reasoning only to best action
        advice[0].reasoning = this._buildCFRReasoning(
            Object.keys(strategy).reduce((best, k) => strategy[k] > (strategy[best] || 0) ? k : best, Object.keys(strategy)[0]),
            advice[0].frequency, handCategory, equity, spr, boardTexture, rangeComp, this.facingBet, this.villainBetSize, this.potSize
        );

        const vStyle = this.currentProfile?.style || 'TAG';
        const wetLabel = boardTexture ? (boardTexture.wetness === 'wet' ? '湿润' : boardTexture.wetness === 'dry' ? '干燥' : '中等') : '';
        const boardStr = this.boardCards.map(c => c.rank + c.suit).join(' ');
        const rcNarrative = rangeComp ? `对手范围: value ${rangeComp.valuePct || 0}% / draw ${rangeComp.drawPct || 0}% / air ${rangeComp.bluffPct || 0}%` : '';
        const posLabel = this.heroIsIP ? 'IP' : 'OOP';
        const sprLabel = spr < 2 ? '极浅筹码' : spr < 4 ? '浅筹码' : spr > 12 ? '深筹码' : '中等筹码';

        return {
            advice,
            narrative: `${boardStr} ${wetLabel}牌面 | ${handCategory.categoryCN}(权益${(equity*100).toFixed(0)}%) ${posLabel} | ${rcNarrative} | SPR ${spr.toFixed(1)} ${sprLabel}`,
            mdf: { halfPot: 66.7, twoThirdsPot: 60.0, fullPot: 50.0, description: 'MDF' },
            potOdds: { halfPot: 25.0, twoThirdsPot: 28.6, fullPot: 33.3, description: '底池赔率' },
            equity, handCategory, boardTexture,
            inPosition: this.heroIsIP, facingBet: this.facingBet,
            spr, villainStyle: vStyle,
            rangeComposition: rangeComp,
            solverUsed: true,
            workerSolved: true,
            solveTimeMs: workerResult.solveTimeMs,
        };
    }

    // ============================================================
    // Heuristic Recommendation (legacy) - rule-based fallback
    // ============================================================
    _getHeuristicRecommendation() {
        const state = this.getState();
        const { equity, handCategory, boardTexture, spr } = state;
        const inPosition = this.heroIsIP;
        const facingBet = this.facingBet;
        const street = this.street;
        const isRiver = street === 'river';
        const isFlop = street === 'flop';

        const advice = [];
        const cat = handCategory.category;
        const str = handCategory.strength;
        const blockerInfo = handCategory.blockerInfo || {};

        // --- Range composition analysis: check all preflop combos ---
        const rangeComp = this.analyzeRangeComposition();

        // Shared params for contextual reasoning generation
        const reasonParams = () => ({
            handCategory, equity, potOdds: this.facingBet ? this.villainBetSize / (this.potSize + this.villainBetSize) : 0,
            rangeComp, boardTexture, spr, inPosition, exploit, sizing: null
        });

        // --- Board texture modifiers ---
        const isWet = boardTexture && boardTexture.wetness === 'wet';
        const isDry = boardTexture && boardTexture.wetness === 'dry';
        const isMonotone = boardTexture && boardTexture.isMonotone;

        // Detect scare cards: board completes flush or straight draws
        // Flush completing: 3+ cards of one suit on board (turn/river)
        // isTwoTone (just 2 of a suit) does NOT complete a flush — need 3+ on board
        const isStraightCompleting = boardTexture && boardTexture.connectedness === 'connected' && !isFlop;
        const isFlushCompleting = boardTexture && boardTexture.isMonotone && !isFlop;
        const isScareCard = isStraightCompleting || isFlushCompleting;

        // --- Villain style + game-state-aware exploit adjustments ---
        const vStyle = this.currentProfile?.style || 'TAG';

        // Villain fold rate estimate (used across all SPR zones)
        const estFoldRate = vStyle === 'FISH' ? 0.20 : vStyle === 'NIT' ? 0.55 : vStyle === 'LAG' ? 0.30 : 0.38;

        // Base exploit config: these interact with game state below
        const exploit = {
            callAdj: 0, bluffAdj: 0, valueAdj: 0, foldAdj: 0,
            sizingMod: 1.0,    // multiplier: >1 = bigger sizing, <1 = smaller
            note: '',
            neverBluffRiverAir: false,
            checkraiseMore: false,
        };

        switch (vStyle) {
            case 'LAG':
                exploit.callAdj = 12; exploit.bluffAdj = -10; exploit.foldAdj = -10; exploit.valueAdj = 5;
                exploit.note = '对手松凶(LAG)诈唬频率高，应扩大跟注范围，减少弃牌。';
                // IP vs LAG: can float more (already reflected in callAdj)
                // OOP vs LAG: checkraise more with strong hands
                if (!inPosition && (cat === 'strongMade' || cat === 'nuts')) {
                    exploit.checkraiseMore = true;
                    exploit.note += ' OOP面对LAG强牌应增加过牌加注频率。';
                }
                break;
            case 'NIT':
                exploit.callAdj = -10; exploit.bluffAdj = 10; exploit.foldAdj = 12; exploit.valueAdj = -5;
                exploit.note = '对手紧凶(NIT)范围很强，面对下注应更多弃牌，但可以增加诈唬。';
                // On scare cards, NIT folds even more — boost bluff frequency
                if (isScareCard) {
                    exploit.bluffAdj = 25;
                    exploit.note += ` 恐吓牌(${isFlushCompleting ? '同花' : '顺子'}完成)，NIT弃牌率极高，大幅增加诈唬。`;
                }
                break;
            case 'FISH':
                exploit.callAdj = 5; exploit.bluffAdj = -20; exploit.foldAdj = -5; exploit.valueAdj = 18;
                exploit.sizingMod = 1.3; // use bigger sizing: they call anyway
                exploit.neverBluffRiverAir = true;
                exploit.note = '对手是鱼(FISH)跟注站，大尺度薄价值下注，河牌空气绝不诈唬。';
                break;
            case 'REG':
                exploit.callAdj = 2; exploit.bluffAdj = 2; exploit.foldAdj = 0; exploit.valueAdj = 0;
                exploit.note = '对手是职业玩家(REG)，保持接近GTO的平衡策略，微调即可。';
                break;
            default: // TAG
                exploit.note = '对手TAG风格，使用标准GTO策略。';
                break;
        }

        // --- Helper: compute recommended sizing string and numeric fraction ---
        function getSizing(handType, boardWetness, currentSpr, exploitSizingMod) {
            let frac, label;

            // Geometric betting: calculate ideal per-street sizing to jam by river
            // streets remaining: flop=3, turn=2, river=1
            const streetsLeft = isRiver ? 1 : (isFlop ? 3 : 2);
            const geoFrac = currentSpr > 0 ? Math.pow(currentSpr + 1, 1 / streetsLeft) - 1 : 0.5;

            switch (handType) {
                case 'nuts':
                    if (currentSpr <= 2) { frac = 99; label = '全压'; }
                    else if (currentSpr <= 4) { frac = Math.min(1.25, geoFrac * 1.1); label = `${(frac*100).toFixed(0)}%底池(超池价值)`; }
                    else { frac = Math.min(1.5, geoFrac * 1.15); label = `${(frac*100).toFixed(0)}%底池(超池价值)`; }
                    break;
                case 'polarized':
                    frac = boardWetness === 'wet' ? Math.min(0.80, geoFrac) : Math.min(0.70, geoFrac * 0.9);
                    label = `${Math.round(frac*100)}%底池`;
                    break;
                case 'merged':
                    frac = boardWetness === 'dry' ? 0.33 : Math.min(0.50, geoFrac * 0.65);
                    label = frac <= 0.35 ? '1/3底池' : `${Math.round(frac*100)}%底池`;
                    break;
                case 'bluff':
                    frac = boardWetness === 'wet' ? 0.66 : 0.50;
                    label = boardWetness === 'wet' ? '2/3底池' : '1/2底池';
                    break;
                case 'block':
                    frac = 0.25; label = '1/4底池';
                    break;
                default:
                    frac = 0.5; label = '1/2底池';
            }
            // Apply exploit sizing modifier (FISH = bigger)
            if (exploitSizingMod > 1 && handType !== 'block') {
                frac = Math.min(frac * exploitSizingMod, currentSpr);
                if (frac >= 1.0 && handType !== 'nuts') label = `${Math.round(frac*100)}%底池(对鱼加大)`;
                else if (exploitSizingMod > 1) label += '(加大尺度)';
            }
            // vs NIT bluffs: smaller sizing suffices
            if (vStyle === 'NIT' && (handType === 'bluff' || handType === 'block')) {
                frac = Math.min(frac, 0.40);
                label = `${Math.round(frac*100)}%底池(小注逼弃)`;
            }
            return { frac, label };
        }

        const wetness = boardTexture ? boardTexture.wetness : 'medium';

        // ========================================
        // HAND-SPECIFIC VARIABILITY FACTORS
        // Cards are objects: {id, rank, suit} where rank is '2'-'A', suit is '♠♥♦♣'
        // ========================================
        const _rv = r => RANK_VALUES[r] || 0;
        const _sv = s => s === '♠' ? 0 : s === '♥' ? 1 : s === '♦' ? 2 : 3;
        const heroRank1 = _rv(this.heroCards[0]?.rank);
        const heroRank2 = _rv(this.heroCards[1]?.rank);
        const heroSuit1 = _sv(this.heroCards[0]?.suit);
        const heroSuit2 = _sv(this.heroCards[1]?.suit);
        const isPair = heroRank1 === heroRank2;
        const isSuited = this.heroCards[0]?.suit === this.heroCards[1]?.suit;
        const highCard = Math.max(heroRank1, heroRank2);
        const lowCard = Math.min(heroRank1, heroRank2);
        const gap = highCard - lowCard;
        const isConnected = gap === 1 || (highCard === 14 && lowCard === 2); // A-2 wheel
        const isOneGap = gap === 2;
        const hasBroadway = highCard >= 10; // T+
        const hasAce = highCard === 14;

        // Board interaction: does hero connect with board?
        const boardRankVals = this.boardCards.map(c => _rv(c.rank));
        const boardSuitVals = this.boardCards.map(c => c.suit);
        const maxBoardRank = Math.max(...boardRankVals);
        const hasOvercards = heroRank1 > maxBoardRank && heroRank2 > maxBoardRank;
        const hasOneOvercard = (heroRank1 > maxBoardRank || heroRank2 > maxBoardRank) && !hasOvercards;
        const hasBDFD = isSuited ? boardSuitVals.filter(s => s === this.heroCards[0]?.suit).length === 1 : false;
        const hasBDSD = isConnected || isOneGap; // rough backdoor straight potential

        // Nut potential modifier: how likely this hand can improve to the nuts
        let nutPotential = 0;
        if (hasAce && isSuited && hasBDFD) nutPotential += 0.15;
        if (hasOvercards) nutPotential += 0.08;
        if (isConnected && !isRiver) nutPotential += 0.05;
        if (isPair && highCard >= 10) nutPotential += 0.10;
        if (cat === 'strongDraw') nutPotential += 0.12;

        // Hand uniqueness hash: creates small variance per specific hand combination
        // This ensures AKs plays differently from AKo, QJs from QJo, etc.
        const handHash = ((heroRank1 * 17 + heroRank2 * 13 + heroSuit1 * 7 + heroSuit2 * 3) % 19) / 19; // 0-1
        const handVariance = (handHash - 0.5) * 8; // -4 to +4 frequency points

        // ========================================
        // SPR-BASED COMMITMENT LOGIC
        // When SPR is very low, decisions simplify dramatically
        // ========================================
        if (spr < 1.5) {
            // COMMITTED ZONE: SPR < 1.5 — push/fold simplified
            // At this SPR, calling any bet essentially commits your stack
            // The only question is: go all-in or fold?
            const commitEquityNeeded = spr / (spr + 1); // break-even equity to commit

            if (!facingBet) {
                // Not facing bet with low SPR: jam or check
                if (equity > commitEquityNeeded + 0.05 || cat === 'nuts' || cat === 'strongMade' || str >= 0.60) {
                    const jamFreq = Math.min(95, Math.round(70 + (equity - commitEquityNeeded) * 150));
                    advice.push({
                        action: 'bet', actionCN: '全压',
                        frequency: Math.max(55, jamFreq),
                        sizing: '全压',
                        reasoning: this._generateContextualReasoning('value_bet', {...reasonParams(), sizing: '全压'}),
                        color: '#e74c3c'
                    });
                    advice.push({
                        action: 'check', actionCN: '过牌(设陷阱)',
                        frequency: 100 - Math.max(55, jamFreq),
                        sizing: '-',
                        reasoning: this._generateContextualReasoning('check_slowplay', reasonParams()),
                        color: '#3498db'
                    });
                } else if (!isRiver && (cat === 'strongDraw' || (cat === 'weakDraw' && equity > 0.25))) {
                    // Semi-bluff jam with draws at low SPR
                    const jamFreq = Math.round(40 + equity * 60);
                    advice.push({
                        action: 'bet', actionCN: '半诈唬全压',
                        frequency: Math.min(70, jamFreq),
                        sizing: '全压',
                        reasoning: this._generateContextualReasoning('semi_bluff_bet', reasonParams()),
                        color: '#e74c3c'
                    });
                    advice.push({
                        action: 'check', actionCN: '过牌',
                        frequency: 100 - Math.min(70, jamFreq),
                        sizing: '-',
                        reasoning: this._generateContextualReasoning('check_potcontrol', reasonParams()),
                        color: '#3498db'
                    });
                } else {
                    // Weak hand at low SPR: mostly check, occasional bluff jam
                    const bluffJamFreq = (!isRiver && estFoldRate > 0.35) ? 15 : 5;
                    advice.push({
                        action: 'check', actionCN: '过牌',
                        frequency: 100 - bluffJamFreq,
                        sizing: '-',
                        reasoning: this._generateContextualReasoning('give_up', reasonParams()),
                        color: '#95a5a6'
                    });
                    if (bluffJamFreq > 0) {
                        advice.push({
                            action: 'bet', actionCN: '诈唬全压',
                            frequency: bluffJamFreq,
                            sizing: '全压',
                            reasoning: this._generateContextualReasoning('bluff_bet', reasonParams()),
                            color: '#e74c3c'
                        });
                    }
                }
            } else {
                // Facing bet with low SPR: call (commit) or fold
                // You're already pot-committed if equity > break-even
                const betPct = this.villainBetSize / this.potSize;
                const potOdds = this.villainBetSize / (this.potSize + this.villainBetSize);
                // At low SPR, calling a bet means committing remaining stack
                // Need equity vs villain's range to justify
                const totalToCall = Math.min(this.effectiveStack, this.villainBetSize);
                const totalPot = this.potSize + this.villainBetSize + totalToCall;
                const commitOdds = totalToCall / totalPot;

                if (equity > commitOdds - 0.02) {
                    // Profitable commit — jam or call
                    const jamFreq = (equity > commitOdds + 0.15 && (cat !== 'air')) ? 40 : 0;
                    const callFreq = 100 - jamFreq;
                    if (jamFreq > 0) {
                        advice.push({
                            action: 'raise', actionCN: '全压',
                            frequency: jamFreq,
                            sizing: '全压',
                            reasoning: this._generateContextualReasoning('value_raise', reasonParams()),
                            color: '#e74c3c'
                        });
                    }
                    advice.push({
                        action: 'call', actionCN: '跟注(承诺底池)',
                        frequency: callFreq,
                        sizing: '-',
                        reasoning: `SPR仅${spr.toFixed(1)}，你已承诺底池。${this._describeVillainLine() || ''}。权益${(equity*100).toFixed(0)}%超过承诺所需${(commitOdds*100).toFixed(0)}%，跟注是自动的。`,
                        color: '#2ecc71'
                    });
                } else {
                    // Even at low SPR, if equity is terrible, folding can be correct
                    const foldFreq = Math.min(90, Math.round(60 + (commitOdds - equity) * 200));
                    advice.push({
                        action: 'fold', actionCN: '弃牌',
                        frequency: foldFreq,
                        sizing: '-',
                        reasoning: `SPR${spr.toFixed(1)}虽低，但权益仅${(equity*100).toFixed(0)}%远低于承诺所需${(commitOdds*100).toFixed(0)}%，沉没成本不应影响决策。`,
                        color: '#95a5a6'
                    });
                    advice.push({
                        action: 'call', actionCN: '跟注',
                        frequency: 100 - foldFreq,
                        sizing: '-',
                        reasoning: this._generateContextualReasoning('call_profitable', reasonParams()),
                        color: '#2ecc71'
                    });
                }
            }
        }
        // ========================================
        // SPR 1.5-3: Simplified stack-off decisions
        // ========================================
        else if (spr < 3 && facingBet) {
            const betPct = this.villainBetSize / this.potSize;
            const potOdds = this.villainBetSize / (this.potSize + this.villainBetSize);
            // Medium-low SPR: any bet + call basically commits us
            // Think in terms of "am I willing to stack off?"
            const stackOffEquity = spr / (2 * spr + 1); // simplified stack-off threshold

            if (equity > stackOffEquity + 0.10) {
                // Happy to stack off: raise (jam) for value
                const raiseFreq = Math.min(75, Math.round(40 + (equity - stackOffEquity) * 200 + handVariance));
                advice.push({
                    action: 'raise', actionCN: '加注/全压',
                    frequency: raiseFreq,
                    sizing: '全压',
                    reasoning: `SPR${spr.toFixed(1)}，${handCategory.categoryCN}权益${(equity*100).toFixed(0)}%适合承诺筹码。${this._describeVillainLine() || ''}。${this._interpretVillainLine() || ''}`,
                    color: '#e74c3c'
                });
                advice.push({
                    action: 'call', actionCN: '跟注',
                    frequency: 100 - raiseFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('call_profitable', reasonParams()),
                    color: '#2ecc71'
                });
            } else if (equity > potOdds) {
                // Marginal: call but don't raise
                const callFreq = smoothFreq(equity - potOdds, 55, 10, 35, 80) + Math.round(handVariance);
                advice.push({
                    action: 'call', actionCN: '跟注',
                    frequency: Math.max(30, Math.min(85, callFreq)),
                    sizing: '-',
                    reasoning: `SPR${spr.toFixed(1)}中低，${handCategory.categoryCN}权益${(equity*100).toFixed(0)}%。跟注但避免主动升级底池。${this._interpretVillainLine() || ''}`,
                    color: '#2ecc71'
                });
                advice.push({
                    action: 'fold', actionCN: '弃牌',
                    frequency: 100 - Math.max(30, Math.min(85, callFreq)),
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('fold_equity_deficit', reasonParams()),
                    color: '#95a5a6'
                });
            } else {
                // Below pot odds at low SPR: fold unless draw with implied odds
                const hasDraw = cat === 'strongDraw' || cat === 'weakDraw';
                const foldFreq = hasDraw && !isRiver ? 55 : 80;
                advice.push({
                    action: 'fold', actionCN: '弃牌',
                    frequency: foldFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('fold_equity_deficit', reasonParams()),
                    color: '#95a5a6'
                });
                advice.push({
                    action: 'call', actionCN: '跟注',
                    frequency: 100 - foldFreq,
                    sizing: '-',
                    reasoning: hasDraw ? this._generateContextualReasoning('call_implied', reasonParams()) : this._generateContextualReasoning('call_profitable', reasonParams()),
                    color: '#2ecc71'
                });
            }
        }
        else if (facingBet) {
            // ========================================
            // FACING A BET — equity-driven decisions (SPR > 3)
            // ========================================
            const betPct = this.villainBetSize / this.potSize;
            const potOdds = this.villainBetSize / (this.potSize + this.villainBetSize);
            const mdf = this.potSize / (this.potSize + this.villainBetSize);

            // Equity advantage over pot odds
            const equityEdge = equity - potOdds;

            // Implied odds: only apply to hands with draws or strong made hands that can stack villain
            // Air with no draw has ZERO implied odds — nothing to improve to
            const hasDraw = cat === 'strongDraw' || cat === 'weakDraw';
            const hasImpliedOdds = hasDraw || cat === 'nuts' || cat === 'strongMade' || str >= 0.65;
            const impliedOddsMod = isRiver ? 0 : (hasImpliedOdds ? (isFlop ? 0.08 : 0.04) : 0);

            // Board texture modifier: on dry boards, MADE HANDS realize equity better
            // But air hands don't benefit from dry boards
            const hasMadeHand = cat === 'mediumMade' || cat === 'weakMade' || cat === 'strongMade' || cat === 'nuts';
            const textureMod = hasMadeHand ? (isDry ? 0.03 : (isMonotone ? -0.05 : 0)) : 0;

            // Effective equity for calling decision
            const effectiveEquity = equity + impliedOddsMod + textureMod;

            // ---- RAISE threshold ----
            if (equity > 0.70 && (cat === 'nuts' || cat === 'strongMade' || str >= 0.80)) {
                // Value raise with the goods
                const raiseFreq = Math.min(85, 50 + Math.round((equity - 0.70) * 200));
                const callFreq = 100 - raiseFreq;
                const raiseSizing = spr > 3 ? '3x对手下注' : '全压';
                advice.push({
                    action: 'raise', actionCN: '加注',
                    frequency: raiseFreq,
                    sizing: raiseSizing,
                    reasoning: this._generateContextualReasoning('value_raise', reasonParams()),
                    color: '#e74c3c'
                });
                advice.push({
                    action: 'call', actionCN: '跟注',
                    frequency: callFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_slowplay', reasonParams()),
                    color: '#2ecc71'
                });
            }
            // Semi-bluff raise with strong draws (non-river)
            else if (!isRiver && cat === 'strongDraw' && equity > 0.40) {
                const raiseFreq = inPosition ? 35 : 25;
                advice.push({
                    action: 'raise', actionCN: '半诈唬加注',
                    frequency: raiseFreq,
                    sizing: '2.5-3x',
                    reasoning: this._generateContextualReasoning('semi_bluff_raise', reasonParams()),
                    color: '#e74c3c'
                });
                advice.push({
                    action: 'call', actionCN: '跟注',
                    frequency: 60 - raiseFreq + 40,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('call_implied', reasonParams()),
                    color: '#2ecc71'
                });
                advice.push({
                    action: 'fold', actionCN: '弃牌',
                    frequency: 100 - raiseFreq - (60 - raiseFreq + 40),
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('fold_equity_deficit', reasonParams()),
                    color: '#95a5a6'
                });
            }
            // ---- CALL vs FOLD threshold ----
            else if (effectiveEquity > potOdds) {
                // Profitable call — but weight by how far above pot odds
                // CRITICAL: equity is vs FULL range, but villain's betting range is VALUE-HEAVY
                // Use range composition to scale the discount more accurately
                let betRangeDiscount;
                // Range-composition-driven discount:
                // Villain's betting range is stronger than their full range
                const rangeValuePct = rangeComp ? rangeComp.valuePct / 100 : 0.35;
                const rangeBluffPct = rangeComp ? rangeComp.bluffPct / 100 : 0.25;
                const rangeDrawPct = rangeComp ? rangeComp.drawPct / 100 : 0.15;
                const rangeBeatsHeroPct = rangeComp ? rangeComp.beatsHeroPct / 100 : 0.30;

                // Estimate villain bet range average equity
                const vBetRangeEq = rangeValuePct * 0.85 + rangeDrawPct * 0.45 + rangeBluffPct * 0.15 +
                                    (1 - rangeValuePct - rangeDrawPct - rangeBluffPct) * 0.50;
                const streetPolarMul = isRiver ? 1.5 : (isFlop ? 0.6 : 1.0);
                const sizePolarMul = Math.max(0.5, Math.min(1.5, betPct));
                betRangeDiscount = Math.max(0, (vBetRangeEq - 0.48) * streetPolarMul * sizePolarMul);

                // Additional discount if villain range heavily beats hero
                if (rangeBeatsHeroPct > 0.40) {
                    betRangeDiscount += (rangeBeatsHeroPct - 0.40) * 0.15;
                }

                // Draws have minimal discount (implied odds compensate)
                if (hasDraw) betRangeDiscount = Math.min(betRangeDiscount, 0.06);
                const adjustedMargin = (effectiveEquity - betRangeDiscount) - potOdds;
                const margin = Math.max(0, adjustedMargin);
                let callFreq = smoothFreq(margin, 48, 12, 25, 85) + Math.round(handVariance);
                // Nut potential: hands that can improve are more valuable
                if (!isRiver && nutPotential > 0.05) callFreq += Math.round(nutPotential * 30);
                // Overcards add equity realization
                if (hasOvercards && !isRiver) callFreq += 5;
                // SPR interaction: deeper stacks favor draws and speculative hands
                if (spr > 10 && (cat === 'strongDraw' || cat === 'weakDraw')) callFreq += 6;

                // On monotone board, non-flush hands should be more cautious
                if (isMonotone && !cat.includes('Draw') && cat !== 'nuts' && str < 0.85) {
                    callFreq = Math.max(25, callFreq - 20);
                }

                // Strong draws facing small bets: always call
                if ((cat === 'strongDraw' || cat === 'weakDraw') && !isRiver && betPct < 0.5) {
                    callFreq = Math.max(callFreq, 70);
                }

                // River draws are air — reclassify
                if (isRiver && (cat === 'strongDraw' || cat === 'weakDraw')) {
                    callFreq = Math.min(callFreq, 15);
                }

                const foldFreq = Math.max(5, 100 - callFreq - 5);
                advice.push({
                    action: 'call', actionCN: '跟注',
                    frequency: callFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('call_profitable', reasonParams()),
                    color: '#2ecc71'
                });
                advice.push({
                    action: 'fold', actionCN: '弃牌',
                    frequency: foldFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('fold_equity_deficit', reasonParams()),
                    color: '#95a5a6'
                });
                // Small raise frequency for balance
                advice.push({
                    action: 'raise', actionCN: '加注',
                    frequency: 5,
                    sizing: '2.5x',
                    reasoning: this._generateContextualReasoning('bluff_raise', reasonParams()),
                    color: '#e74c3c'
                });
            }
            else {
                // Below pot odds — lean toward fold, but consider MDF
                let foldFreq, callFreq;
                const mdfGap = mdf - (1 - equity); // how much we need to defend

                if (cat === 'air' || (isRiver && (cat === 'strongDraw' || cat === 'weakDraw'))) {
                    // Pure air / busted draws — mostly fold, some bluff raises for balance
                    foldFreq = 80;
                    const bluffRaiseFreq = isRiver ? 12 : 15;
                    callFreq = 100 - foldFreq - bluffRaiseFreq;

                    advice.push({
                        action: 'fold', actionCN: '弃牌',
                        frequency: foldFreq,
                        sizing: '-',
                        reasoning: this._generateContextualReasoning('fold_equity_deficit', reasonParams()),
                        color: '#95a5a6'
                    });
                    advice.push({
                        action: 'raise', actionCN: '诈唬加注',
                        frequency: bluffRaiseFreq,
                        sizing: '2.5-3x',
                        reasoning: this._generateContextualReasoning('bluff_raise', reasonParams()),
                        color: '#e74c3c'
                    });
                    if (callFreq > 0) {
                        advice.push({
                            action: 'call', actionCN: 'Float',
                            frequency: callFreq,
                            sizing: '-',
                            reasoning: this._generateContextualReasoning('float', reasonParams()),
                            color: '#2ecc71'
                        });
                    }
                } else {
                    // Marginal made hand below pot odds — MDF defense
                    foldFreq = smoothFreq(potOdds - equity, 55, 8, 40, 78);
                    callFreq = 100 - foldFreq - 5;

                    advice.push({
                        action: 'fold', actionCN: '弃牌',
                        frequency: foldFreq,
                        sizing: '-',
                        reasoning: this._generateContextualReasoning('fold_mdf', reasonParams()),
                        color: '#95a5a6'
                    });
                    advice.push({
                        action: 'call', actionCN: '跟注',
                        frequency: callFreq,
                        sizing: '-',
                        reasoning: this._generateContextualReasoning('call_profitable', reasonParams()),
                        color: '#2ecc71'
                    });
                    advice.push({
                        action: 'raise', actionCN: '加注',
                        frequency: 5,
                        sizing: '2.5x',
                        reasoning: this._generateContextualReasoning('bluff_raise', reasonParams()),
                        color: '#e74c3c'
                    });
                }
            }

        } else if (spr < 3 && !facingBet) {
            // ========================================
            // NOT FACING BET, LOW SPR (< 3): simplified jam-or-check
            // ========================================
            const commitEquity = spr / (2 * spr + 1);

            if (equity > commitEquity + 0.10 || cat === 'nuts' || cat === 'strongMade') {
                // Value jam
                const jamFreq = Math.min(90, Math.round(65 + (equity - commitEquity) * 150 + handVariance));
                advice.push({
                    action: 'bet', actionCN: '全压价值',
                    frequency: Math.max(50, jamFreq),
                    sizing: '全压',
                    reasoning: `SPR${spr.toFixed(1)}低，${handCategory.categoryCN}权益${(equity*100).toFixed(0)}%。筹码浅应最大化价值，全压迫使对手在边缘情况做困难决定。`,
                    color: '#e74c3c'
                });
                advice.push({
                    action: 'check', actionCN: '过牌(设陷阱)',
                    frequency: 100 - Math.max(50, jamFreq),
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_slowplay', reasonParams()),
                    color: '#3498db'
                });
            } else if (!isRiver && (cat === 'strongDraw' || (cat === 'weakDraw' && equity > 0.20))) {
                // Semi-bluff jam
                const foldEquity = estFoldRate * this.potSize;
                const drawEV = equity * (this.potSize + 2 * this.effectiveStack);
                const jamFreq = Math.round(35 + Math.min(30, (foldEquity + drawEV) * 10) + handVariance);
                advice.push({
                    action: 'bet', actionCN: '半诈唬全压',
                    frequency: Math.max(25, Math.min(70, jamFreq)),
                    sizing: '全压',
                    reasoning: `SPR${spr.toFixed(1)}低，${handCategory.categoryCN}结合弃牌权益(约${(estFoldRate*100).toFixed(0)}%)和听牌权益，全压EV为正。`,
                    color: '#e74c3c'
                });
                advice.push({
                    action: 'check', actionCN: '过牌',
                    frequency: 100 - Math.max(25, Math.min(70, jamFreq)),
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_potcontrol', reasonParams()),
                    color: '#3498db'
                });
            } else if (cat === 'mediumMade' || cat === 'weakMade') {
                // Medium hands at low SPR: mostly check, but can jam for thin value
                const thinValueFreq = equity > 0.45 ? Math.round(30 + handVariance) : Math.round(15 + handVariance);
                advice.push({
                    action: 'check', actionCN: '过牌控池',
                    frequency: Math.max(40, 100 - Math.max(10, thinValueFreq)),
                    sizing: '-',
                    reasoning: `SPR${spr.toFixed(1)}低但${handCategory.categoryCN}不够强承诺全部筹码。过牌保持灵活性。`,
                    color: '#3498db'
                });
                advice.push({
                    action: 'bet', actionCN: equity > 0.45 ? '薄价值全压' : '阻断下注',
                    frequency: Math.max(10, thinValueFreq),
                    sizing: equity > 0.45 ? '全压' : `${Math.round(spr * 40)}%底池`,
                    reasoning: this._generateContextualReasoning(equity > 0.45 ? 'value_bet' : 'block_bet', reasonParams()),
                    color: '#e74c3c'
                });
            } else {
                // Air at low SPR: check-fold mostly, some bluff jams
                const bluffJamFreq = (!isRiver && estFoldRate > 0.35) ? Math.round(18 + handVariance) : Math.round(5 + handVariance);
                advice.push({
                    action: 'check', actionCN: '放弃/过牌',
                    frequency: Math.max(60, 100 - Math.max(0, bluffJamFreq)),
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('give_up', reasonParams()),
                    color: '#95a5a6'
                });
                if (Math.max(0, bluffJamFreq) > 0) {
                    advice.push({
                        action: 'bet', actionCN: '诈唬全压',
                        frequency: Math.max(0, bluffJamFreq),
                        sizing: '全压',
                        reasoning: `SPR${spr.toFixed(1)}低，小量筹码全压施压。${blockerInfo.blocksNutFlush ? '持有同花阻断牌增加弃牌率。' : ''}`,
                        color: '#e74c3c'
                    });
                }
            }
        } else {
            // ========================================
            // NOT FACING A BET — check or bet decision (SPR > 3)
            // equity-driven with board texture + sizing theory
            // ========================================

            // Estimate villain's continuing range equity threshold
            // When we bet, villain calls with ~MDF of their range (the top part)
            // Our value bets need equity > ~0.55 against that calling range
            const villainAirPct = (rangeComp?.bluffPct || 30) / 100;
            const valueThreshold = 0.60 - villainAirPct * 0.15; // 0.45 ~ 0.60
            // Dynamic bluff threshold based on villain fold tendency
            const bluffThreshold = estFoldRate > 0.30 ? 0.20 : 0.30; // bluff more vs folders

            // Street modifier for bluff frequency: fewer bluffs on later streets
            const bluffStreetMod = isRiver ? 0.5 : (isFlop ? 1.0 : 0.75);

            // OOP penalty: check more out of position
            const oopCheckBonus = inPosition ? 0 : 12;

            // Monotone board danger: hands without a flush (or flush draw) are vulnerable
            // Check if hero has a flush or flush draw on this board
            const heroHasFlush = eval_ => {
                const e = categorizeHand(this.heroCards, this.boardCards);
                return e.eval && e.eval.tier >= 5; // flush or better
            };
            const heroHasFlushDraw = hasFlushDraw(this.heroCards, this.boardCards);
            const monotoneDanger = isMonotone && !heroHasFlush() && !heroHasFlushDraw;

            if (cat === 'nuts' || str >= 0.85) {
                // --- NUTS: overbet when SPR allows ---
                const sz = getSizing('nuts', wetness, spr, exploit.sizingMod);
                const betFreq = Math.min(95, Math.max(70, 90 - oopCheckBonus + Math.round(handVariance)));
                advice.push({
                    action: 'bet', actionCN: '下注',
                    frequency: betFreq,
                    sizing: sz.label,
                    reasoning: this._generateContextualReasoning('value_bet', {...reasonParams(), sizing: sz.label}),
                    color: '#e74c3c'
                });
                advice.push({
                    action: 'check', actionCN: '过牌',
                    frequency: 100 - betFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_slowplay', reasonParams()),
                    color: '#3498db'
                });
            }
            else if (equity > valueThreshold && (cat === 'strongMade' || str >= 0.62 || (equity > 0.60 && (cat === 'mediumMade' || cat === 'weakMade')))) {
                // --- VALUE BET: equity-driven, merged range, medium sizing ---
                // Range-aware: adjust bet freq based on villain's range composition
                const sz = getSizing('merged', wetness, spr, exploit.sizingMod);
                const eqMargin = equity - valueThreshold;
                let betFreq = smoothFreq(eqMargin, inPosition ? 58 : 45, 10, 20, 82) + Math.round(handVariance);
                // Suited hands and hands with nut potential bet slightly more
                if (isSuited) betFreq += 3;
                if (nutPotential > 0.10) betFreq += 4;

                // If villain's range is weak on this board (lots of air), bet more for value
                if (rangeComp && rangeComp.bluffPct > 40) {
                    betFreq += 8; // villain has lots of air — more value bets
                }
                // If villain's range is strong on this board, check more (risk of getting raised)
                if (rangeComp && rangeComp.valuePct > 40) {
                    betFreq -= 10;
                }

                // Monotone board WITHOUT flush: check way more — any flush crushes us
                if (monotoneDanger) {
                    betFreq = Math.max(15, betFreq - 35);
                }

                // On dry boards, can bet thinner and smaller
                if (isDry) betFreq += 5;
                // On wet boards, polarize: strong hands bet bigger
                if (isWet && str >= 0.70 && !monotoneDanger) {
                    const polSz = getSizing('polarized', wetness, spr, exploit.sizingMod);
                    betFreq += 5;
                    advice.push({
                        action: 'bet', actionCN: '价值下注',
                        frequency: betFreq,
                        sizing: polSz.label,
                        reasoning: this._generateContextualReasoning('value_bet', {...reasonParams(), sizing: polSz.label}),
                        color: '#e74c3c'
                    });
                } else {
                    advice.push({
                        action: 'bet', actionCN: '价值下注',
                        frequency: betFreq,
                        sizing: monotoneDanger ? getSizing('block', wetness, spr, 1.0).label : sz.label,
                        reasoning: this._generateContextualReasoning('value_bet', {...reasonParams(), sizing: sz.label}),
                        color: '#e74c3c'
                    });
                }
                advice.push({
                    action: 'check', actionCN: '过牌',
                    frequency: 100 - betFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_potcontrol', reasonParams()),
                    color: '#3498db'
                });
            }
            else if ((cat === 'mediumMade' && equity <= 0.60) || (str >= 0.40 && str < 0.62 && equity <= 0.60)) {
                // --- POT CONTROL: check most, thin bet some (only when equity doesn't justify value betting) ---
                let checkFreq = 65 + oopCheckBonus - Math.round(handVariance);
                const sz = getSizing('block', wetness, spr, 1.0);

                if (isWet) {
                    // Wet board: need some protection
                    checkFreq -= 10;
                }

                checkFreq = Math.min(85, Math.max(45, checkFreq));
                advice.push({
                    action: 'check', actionCN: '过牌',
                    frequency: checkFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_potcontrol', reasonParams()),
                    color: '#3498db'
                });
                advice.push({
                    action: 'bet', actionCN: isWet ? '保护性下注' : '阻断下注',
                    frequency: 100 - checkFreq,
                    sizing: isWet ? getSizing('merged', wetness, spr, 1.0).label : sz.label,
                    reasoning: isWet ? this._generateContextualReasoning('protection_bet', reasonParams()) : this._generateContextualReasoning('block_bet', reasonParams()),
                    color: '#e74c3c'
                });
            }
            else if (!isRiver && (cat === 'strongDraw')) {
                // --- SEMI-BLUFF with strong draws (flop/turn only) ---
                const sz = getSizing('polarized', wetness, spr, exploit.sizingMod);
                let betFreq = inPosition ? 60 : 45;
                betFreq = Math.round(betFreq * bluffStreetMod);
                betFreq = Math.max(30, betFreq);

                advice.push({
                    action: 'bet', actionCN: '半诈唬下注',
                    frequency: betFreq,
                    sizing: sz.label,
                    reasoning: this._generateContextualReasoning('semi_bluff_bet', reasonParams()),
                    color: '#e74c3c'
                });
                advice.push({
                    action: 'check', actionCN: '过牌',
                    frequency: 100 - betFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_potcontrol', reasonParams()),
                    color: '#3498db'
                });
            }
            else if (!isRiver && cat === 'weakDraw') {
                // --- WEAK DRAW: mostly check, occasional small semi-bluff ---
                const sz = getSizing('block', wetness, spr, 1.0);
                let betFreq = Math.round(25 * bluffStreetMod);
                if (inPosition) betFreq += 8;

                advice.push({
                    action: 'check', actionCN: '过牌',
                    frequency: 100 - betFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_potcontrol', reasonParams()),
                    color: '#3498db'
                });
                advice.push({
                    action: 'bet', actionCN: '小注半诈唬',
                    frequency: betFreq,
                    sizing: sz.label,
                    reasoning: this._generateContextualReasoning('semi_bluff_bet', reasonParams()),
                    color: '#e74c3c'
                });
            }
            else if (cat === 'weakMade') {
                // --- WEAK MADE: mostly check, block bet sometimes ---
                const sz = getSizing('block', wetness, spr, 1.0);
                const checkFreq = 75 + oopCheckBonus;
                advice.push({
                    action: 'check', actionCN: '过牌',
                    frequency: Math.min(90, checkFreq),
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('check_potcontrol', reasonParams()),
                    color: '#3498db'
                });
                advice.push({
                    action: 'bet', actionCN: '阻断下注',
                    frequency: 100 - Math.min(90, checkFreq),
                    sizing: sz.label,
                    reasoning: this._generateContextualReasoning('block_bet', reasonParams()),
                    color: '#e74c3c'
                });
            }
            else {
                // --- AIR: bluff or give up ---
                // GTO bluff freq: value_bets / (value_bets + bluffs) ~ pot/(pot+bet)
                // Approximate: ~30% bluff on flop, ~20% on turn, ~10-15% on river
                let bluffFreq;
                const hasGoodBlockers = blockerInfo.blocksNutFlush || blockerInfo.blocksFlush;
                const blockerBonus = hasGoodBlockers ? 8 : 0;

                if (exploit.neverBluffRiverAir && isRiver) {
                    bluffFreq = 0;
                } else {
                    // Base bluff frequency by street and position, adjusted by villain fold rate
                    const baseBluff = isRiver ? 12 : (isFlop ? 28 : 20);
                    const posBonus = inPosition ? 10 : 0;
                    const foldBonus = Math.round((estFoldRate - 0.35) * 30); // +/- based on fold tendency
                    // Hand-specific: overcards and backdoor draws make better bluff candidates
                    const overcardBonus = hasOvercards ? 8 : (hasOneOvercard ? 4 : 0);
                    const bdBonus = (!isRiver && (hasBDFD || hasBDSD)) ? 5 : 0;
                    bluffFreq = Math.round((baseBluff + posBonus + blockerBonus + foldBonus + overcardBonus + bdBonus + handVariance) * bluffStreetMod);
                    bluffFreq = Math.max(0, Math.min(50, bluffFreq));
                }

                if (bluffFreq > 0) {
                    const sz = getSizing('bluff', wetness, spr, exploit.sizingMod);
                    advice.push({
                        action: 'bet', actionCN: isRiver ? '河牌诈唬' : '诈唬下注',
                        frequency: bluffFreq,
                        sizing: sz.label,
                        reasoning: this._generateContextualReasoning('bluff_bet', reasonParams()),
                        color: '#e74c3c'
                    });
                }
                advice.push({
                    action: 'check', actionCN: '放弃/过牌',
                    frequency: 100 - bluffFreq,
                    sizing: '-',
                    reasoning: this._generateContextualReasoning('give_up', reasonParams()),
                    color: '#95a5a6'
                });
            }
        }

        // ========================================
        // Apply exploit frequency adjustments (game-state-aware)
        // ========================================
        if (vStyle !== 'TAG') {
            // Scale call/fold adjustments by hand strength — strong hands benefit more from call adj
            // Air hands should NOT be called more just because villain is LAG — exploit means value calling, not station-ing
            const handStrengthScale = str >= 0.60 ? 1.0 : str >= 0.40 ? 0.7 : str >= 0.20 ? 0.4 : 0.15;

            for (const a of advice) {
                const act = a.action;
                const isBluff = cat === 'air' || cat === 'weakDraw' || cat === 'strongDraw' ||
                    (a.actionCN && (a.actionCN.includes('诈唬') || a.actionCN.includes('半诈唬')));

                if (act === 'call') {
                    // Scale call adjustment by hand strength
                    const scaledCallAdj = Math.round(exploit.callAdj * handStrengthScale);
                    a.frequency = Math.max(5, Math.min(95, a.frequency + scaledCallAdj));
                } else if (act === 'fold') {
                    // Fold adj inversely scaled — weak hands fold MORE, strong hands fold LESS
                    const scaledFoldAdj = Math.round(exploit.foldAdj * (1.1 - handStrengthScale * 0.5));
                    a.frequency = Math.max(5, Math.min(95, a.frequency + scaledFoldAdj));
                } else if (act === 'raise' || act === 'bet') {
                    if (isBluff) {
                        a.frequency = Math.max(5, Math.min(95, a.frequency + exploit.bluffAdj));
                    } else {
                        a.frequency = Math.max(5, Math.min(95, a.frequency + exploit.valueAdj));
                    }
                }
            }

            // OOP vs LAG: convert some calls to checkraises with strong hands
            if (exploit.checkraiseMore && facingBet) {
                const callEntry = advice.find(a => a.action === 'call');
                const raiseEntry = advice.find(a => a.action === 'raise');
                if (callEntry && raiseEntry) {
                    const shift = Math.min(15, callEntry.frequency - 20);
                    if (shift > 0) {
                        callEntry.frequency -= shift;
                        raiseEntry.frequency += shift;
                        raiseEntry.reasoning += ' 【OOP对LAG增加过牌加注频率】';
                    }
                }
            }

            // vs FISH river air: force 0 bluff
            if (exploit.neverBluffRiverAir && isRiver && (cat === 'air' || cat === 'weakDraw' || cat === 'strongDraw')) {
                for (const a of advice) {
                    if ((a.action === 'bet' || a.action === 'raise') &&
                        (a.actionCN.includes('诈唬') || cat === 'air')) {
                        a.frequency = 0;
                    }
                }
            }

            // Remove 0-frequency entries
            const filtered = advice.filter(a => a.frequency > 0);
            advice.length = 0;
            advice.push(...filtered);

            // exploit.note is now included via _generateContextualReasoning
        }

        // Always normalize frequencies to sum to 100
        if (advice.length > 0) {
            const total = advice.reduce((s, a) => s + a.frequency, 0);
            if (total > 0 && total !== 100) {
                advice.forEach(a => a.frequency = Math.round(a.frequency / total * 100));
            }
            const roundedTotal = advice.reduce((s, a) => s + a.frequency, 0);
            if (roundedTotal !== 100 && advice.length > 0) {
                const maxItem = advice.reduce((max, a) => a.frequency > max.frequency ? a : max, advice[0]);
                maxItem.frequency += (100 - roundedTotal);
            }
        }

        // Pot odds / MDF info
        const mdfInfo = {
            halfPot: 66.7, twoThirdsPot: 60.0, fullPot: 50.0,
            description: 'MDF：面对下注需要至少跟注该比例防止对手随意诈唬。'
        };
        const potOddsInfo = {
            halfPot: 25.0, twoThirdsPot: 28.6, fullPot: 33.3,
            description: '底池赔率：盈利跟注所需的最低胜率。'
        };

        return {
            advice: advice.sort((a, b) => b.frequency - a.frequency),
            narrative: this._buildNarrative(reasonParams()),
            mdf: mdfInfo, potOdds: potOddsInfo,
            equity, handCategory, boardTexture,
            inPosition, facingBet: this.facingBet,
            spr: state.spr, villainStyle: vStyle,
            rangeComposition: rangeComp
        };
    }

    // ============================================================
    // Villain Range Analysis — PioSolver-like breakdown
    // Categorizes villain's entire preflop range on the current board,
    // filters by their action (bet/check), shows value/bluff/draw splits
    // ============================================================
    analyzeVillainRange() {
        if (!this.villainRangeHands || this.villainRangeHands.length === 0) return null;
        if (!this.boardCards || this.boardCards.length < 3) return null;

        const usedCards = new Set([...this.heroCards, ...this.boardCards].map(c => c.id));
        const villainStyle = this.currentProfile?.style || 'TAG';
        const hasWeights = this.villainRangeWeights && this.villainRangeWeights.length === this.villainRangeHands.length;

        // Category buckets — use weighted combos for Bayesian narrowing
        const categories = {
            valueStrong: { label: '强价值牌', color: '#e74c3c', hands: [], weight: 0, desc: '坚果/强成牌' },
            valueMedium: { label: '中等价值', color: '#e67e22', hands: [], weight: 0, desc: '顶对好踢脚/超对/两对' },
            draw:        { label: '听牌', color: '#3498db', hands: [], weight: 0, desc: '同花听牌/顺子听牌' },
            weakMade:    { label: '弱成牌', color: '#f1c40f', hands: [], weight: 0, desc: '中底对/弱踢脚' },
            air:         { label: '空气牌', color: '#95a5a6', hands: [], weight: 0, desc: '高牌/完全空气' },
        };

        let totalWeight = 0;
        let totalRawCombos = 0;

        for (let i = 0; i < this.villainRangeHands.length; i++) {
            const hand = this.villainRangeHands[i];
            if (usedCards.has(hand[0].id) || usedCards.has(hand[1].id)) continue;

            const w = hasWeights ? this.villainRangeWeights[i] : 1.0;
            if (w < 0.001) continue; // Effectively removed from range

            const hc = categorizeHand(hand, this.boardCards);
            const cat = hc.category;
            const str = hc.strength;

            let bucket;
            if (cat === 'nuts' || str >= 0.85) bucket = 'valueStrong';
            else if (cat === 'strongMade' || str >= 0.65) bucket = 'valueMedium';
            else if (cat === 'strongDraw' || cat === 'weakDraw') bucket = 'draw';
            else if (cat === 'weakMade' || cat === 'mediumMade') bucket = str >= 0.4 ? 'valueMedium' : 'weakMade';
            else bucket = 'air';

            const r1 = hand[0].rank, r2 = hand[1].rank;
            const suited = hand[0].suit === hand[1].suit;
            const rv1 = RANK_VALUES[r1], rv2 = RANK_VALUES[r2];
            let handStr;
            if (rv1 === rv2) handStr = r1 + r2;
            else if (rv1 > rv2) handStr = r1 + r2 + (suited ? 's' : 'o');
            else handStr = r2 + r1 + (suited ? 's' : 'o');

            categories[bucket].hands.push({ handStr, categoryCN: hc.categoryCN, strength: str, weight: w });
            categories[bucket].weight += w;
            totalWeight += w;
            totalRawCombos++;
        }

        if (totalWeight === 0) return null;

        // Calculate weighted percentages
        const result = {};
        for (const [key, cat] of Object.entries(categories)) {
            const weightedPct = Math.round(cat.weight / totalWeight * 1000) / 10;
            // Sort hands by weight desc for display priority
            cat.hands.sort((a, b) => b.weight - a.weight);
            result[key] = {
                ...cat,
                combos: cat.hands.length,
                weightedCombos: Math.round(cat.weight * 10) / 10,
                pct: weightedPct,
                uniqueHands: [...new Set(cat.hands.map(h => h.handStr))],
            };
        }

        // Compute value vs bluff within the current (weighted) range
        const valueWeight = (result.valueStrong?.weight || 0) + (result.valueMedium?.weight || 0);
        const drawWeight = result.draw?.weight || 0;
        const bluffWeight = (result.weakMade?.weight || 0) + (result.air?.weight || 0);
        const valuePct = totalWeight > 0 ? Math.round(valueWeight / totalWeight * 100) : 0;
        const semiBluffPct = totalWeight > 0 ? Math.round(drawWeight / totalWeight * 100) : 0;
        const bluffPct = totalWeight > 0 ? Math.round(bluffWeight / totalWeight * 100) : 0;

        // Narrowing info — use weight-based metric for more meaningful narrowing display
        const originalCombos = this.villainRangeHands.filter(h => !usedCards.has(h[0].id) && !usedCards.has(h[1].id)).length;
        // Weight-based: totalWeight vs originalCombos (each started at 1.0)
        const effectiveNarrowPct = originalCombos > 0 ? Math.round(totalWeight / originalCombos * 100) : 100;
        const narrowingPct = effectiveNarrowPct;

        return {
            totalCombos: totalRawCombos,
            originalCombos,
            narrowingPct,
            totalWeight: Math.round(totalWeight * 10) / 10,
            categories: result,
            villainAction: this.villainAction,
            villainStyle,
            street: this.street,
            actionHistory: this.villainActionHistory,
            // Direct value/bluff split of the current weighted range
            valuePct,
            semiBluffPct,
            bluffPct,
            valueWeight: Math.round(valueWeight * 10) / 10,
            drawWeight: Math.round(drawWeight * 10) / 10,
            bluffWeight: Math.round(bluffWeight * 10) / 10,
        };
    }

    // ============================================================
    // Range Composition Analysis — checks every preflop combo
    // Evaluates hero's hand percentile within hero's range,
    // and villain's full range composition on current board.
    // Used by getRecommendation() for range-aware strategy.
    // ============================================================
    analyzeRangeComposition() {
        if (!this.boardCards || this.boardCards.length < 3) return null;
        const usedByBoard = new Set(this.boardCards.map(c => c.id));
        const heroIds = new Set(this.heroCards.map(c => c.id));

        // --- Hero range analysis: where does hero's hand rank? ---
        // Use pot-type-adjusted hero range (not full position range)
        const heroProfileId = this.heroProfile?.id;
        const heroPos = this.heroPosition;
        let heroRangeStrings = [];
        if (this.heroProfile) {
            if (typeof getVillainPostflopRange === 'function' && this.potType && this.potType !== 'srp') {
                // In 3bet/4bet pots, hero's range is narrowed
                heroRangeStrings = getVillainPostflopRange(this.pm, heroProfileId, heroPos, this.potType, !this.isVillainAggressor) || [];
            } else {
                heroRangeStrings = this.pm.getRange(heroProfileId, heroPos) || [];
            }
        }
        const heroRangeHands = heroRangeStrings.length > 0 ? this.pm.rangeToHands(heroRangeStrings) : [];

        // Check if hero's current hand is in hero's preflop range
        const heroHandKey = this._handToKey(this.heroCards);
        let heroInRange = false;
        let heroRangeStrengths = []; // {strength, category, key}
        let heroHandStrength = null;

        for (const hand of heroRangeHands) {
            // Skip hands that conflict with board
            if (usedByBoard.has(hand[0].id) || usedByBoard.has(hand[1].id)) continue;
            const key = this._handToKey(hand);
            const hc = categorizeHand(hand, this.boardCards);
            heroRangeStrengths.push({ key, strength: hc.strength, category: hc.category, categoryCN: hc.categoryCN });
            if (key === heroHandKey) {
                heroInRange = true;
                heroHandStrength = hc.strength;
            }
        }

        // If hero hand wasn't found by key match, evaluate it directly
        if (heroHandStrength === null) {
            const hc = categorizeHand(this.heroCards, this.boardCards);
            heroHandStrength = hc.strength;
        }

        // Sort to compute percentile
        heroRangeStrengths.sort((a, b) => a.strength - b.strength);
        let heroPercentile = 50; // default if no range
        if (heroRangeStrengths.length > 0) {
            const belowCount = heroRangeStrengths.filter(h => h.strength < heroHandStrength).length;
            heroPercentile = Math.round(belowCount / heroRangeStrengths.length * 100);
        }

        // --- Villain range analysis: every combo on this board ---
        // Use pot-type-adjusted villain range for accurate reporting
        const villainPos = this.villainPosition;
        const villainProfileId = this.currentProfile?.id;
        let villainRangeStrings;
        if (typeof getVillainPostflopRange === 'function' && this.potType && this.potType !== 'srp') {
            villainRangeStrings = getVillainPostflopRange(this.pm, villainProfileId, villainPos, this.potType, this.isVillainAggressor) || [];
        } else {
            villainRangeStrings = this.pm.getRange(villainProfileId, villainPos) || [];
        }

        // Categorize every villain combo
        const villainBuckets = {
            nuts: { count: 0, hands: [] },        // str >= 0.85
            strongMade: { count: 0, hands: [] },   // str >= 0.65
            mediumMade: { count: 0, hands: [] },   // str >= 0.45
            draw: { count: 0, hands: [] },          // draw categories
            weakMade: { count: 0, hands: [] },     // str >= 0.25
            air: { count: 0, hands: [] },           // str < 0.25
        };

        let totalVillainCombos = 0;
        let villainBeatsHero = 0;
        let villainLosesToHero = 0;
        let villainTiesHero = 0;

        // Use the already-expanded villain range hands (avoids re-expanding)
        const allVillainHands = this.villainRangeHands;

        for (const hand of allVillainHands) {
            if (usedByBoard.has(hand[0].id) || usedByBoard.has(hand[1].id)) continue;
            if (heroIds.has(hand[0].id) || heroIds.has(hand[1].id)) continue;

            const hc = categorizeHand(hand, this.boardCards);
            const s = hc.strength;
            const cat = hc.category;
            const key = this._handToKey(hand);
            totalVillainCombos++;

            // Bucket
            let bucket;
            if (s >= 0.85 || cat === 'nuts') bucket = 'nuts';
            else if (s >= 0.65 || cat === 'strongMade') bucket = 'strongMade';
            else if (cat === 'strongDraw' || cat === 'weakDraw') bucket = 'draw';
            else if (s >= 0.45 || cat === 'mediumMade') bucket = 'mediumMade';
            else if (s >= 0.25 || cat === 'weakMade') bucket = 'weakMade';
            else bucket = 'air';

            villainBuckets[bucket].count++;
            // Store unique hand names only
            if (!villainBuckets[bucket].hands.includes(key)) {
                villainBuckets[bucket].hands.push(key);
            }

            // Compare to hero
            if (s > heroHandStrength + 0.05) villainBeatsHero++;
            else if (s < heroHandStrength - 0.05) villainLosesToHero++;
            else villainTiesHero++;
        }

        // Compute percentages
        const vPct = {};
        for (const [k, v] of Object.entries(villainBuckets)) {
            vPct[k] = totalVillainCombos > 0 ? Math.round(v.count / totalVillainCombos * 1000) / 10 : 0;
        }

        // Value hands = nuts + strongMade
        const valueHands = villainBuckets.nuts.count + villainBuckets.strongMade.count;
        const valuePct = totalVillainCombos > 0 ? Math.round(valueHands / totalVillainCombos * 100) : 0;
        // Bluff/air hands
        const bluffHands = villainBuckets.air.count;
        const bluffPct = totalVillainCombos > 0 ? Math.round(bluffHands / totalVillainCombos * 100) : 0;
        // Draw hands
        const drawPct = totalVillainCombos > 0 ? Math.round(villainBuckets.draw.count / totalVillainCombos * 100) : 0;
        // Hands that beat hero
        const beatsHeroPct = totalVillainCombos > 0 ? Math.round(villainBeatsHero / totalVillainCombos * 100) : 0;

        return {
            // Hero range info
            heroInRange,
            heroPercentile,
            heroRangeSize: heroRangeStrings.length,
            heroRangeCombos: heroRangeStrengths.length,
            // Villain range composition
            villainRangeSize: villainRangeStrings.length,
            villainCombos: totalVillainCombos,
            villainBuckets,
            villainPct: vPct,
            valuePct,
            bluffPct,
            drawPct,
            // Hero vs villain range
            beatsHeroPct,
            losesToHeroPct: totalVillainCombos > 0 ? Math.round(villainLosesToHero / totalVillainCombos * 100) : 0,
            tiesPct: totalVillainCombos > 0 ? Math.round(villainTiesHero / totalVillainCombos * 100) : 0,
        };
    }

    // Helper: convert hand to canonical key like "AKs", "QQ", "T9o"
    _handToKey(hand) {
        const r1 = hand[0].rank, r2 = hand[1].rank;
        const rv1 = RANK_VALUES[r1], rv2 = RANK_VALUES[r2];
        const suited = hand[0].suit === hand[1].suit;
        if (rv1 === rv2) return r1 + r2;
        if (rv1 > rv2) return r1 + r2 + (suited ? 's' : 'o');
        return r2 + r1 + (suited ? 's' : 'o');
    }

    // Describe villain's action line in Chinese narrative
    _describeVillainLine() {
        if (!this.villainActionHistory || this.villainActionHistory.length === 0) return '';
        const vPos = this.villainPosition || '对手';
        const parts = [];
        for (const h of this.villainActionHistory) {
            const streetCN = h.street === 'flop' ? '翻牌' : h.street === 'turn' ? '转牌' : '河牌';
            if (h.action === 'bet') {
                const pct = Math.round(h.betPctOfPot * 100);
                let sizeLabel;
                if (pct <= 40) sizeLabel = '1/3底池';
                else if (pct <= 55) sizeLabel = '1/2底池';
                else if (pct <= 72) sizeLabel = '2/3底池';
                else if (pct <= 90) sizeLabel = '3/4底池';
                else sizeLabel = '满池';
                parts.push(`${streetCN}下注${sizeLabel}`);
            } else if (h.action === 'check') {
                parts.push(`${streetCN}过牌`);
            } else if (h.action === 'call') {
                parts.push(`${streetCN}跟注`);
            }
        }
        return `${vPos}${parts.join('，')}`;
    }

    // Interpret what a villain's line typically represents
    _interpretVillainLine() {
        const history = this.villainActionHistory || [];
        if (history.length === 0) return '';

        const lastAction = history[history.length - 1];
        const prevActions = history.slice(0, -1);
        const hasPreviousCheck = prevActions.some(h => h.action === 'check');
        const hasPreviousBet = prevActions.some(h => h.action === 'bet');
        const hasPreviousCall = prevActions.some(h => h.action === 'call');

        if (lastAction.action === 'bet') {
            const bigBet = lastAction.betPctOfPot > 0.7;
            if (hasPreviousCheck && !hasPreviousBet) {
                return bigBet ? '之前过牌后突然大注，通常代表慢打强牌或转化为价值的听牌'
                             : '之前过牌后小注，可能是薄价值或试探性下注';
            }
            if (hasPreviousBet) {
                return bigBet ? '持续施压大注，代表极化范围(坚果或诈唬)'
                             : '多条街持续下注，代表稳定的价值牌或执着的诈唬';
            }
            if (hasPreviousCall) {
                return bigBet ? '跟注后领先大注，通常代表加强的成手牌或转化为诈唬的听牌'
                             : '跟注后领先小注，可能是阻断下注或薄价值';
            }
            return bigBet ? '大注下注代表极化范围' : '中小注代表merged范围';
        }

        if (lastAction.action === 'check') {
            if (hasPreviousBet) {
                return '之前下注后过牌，通常代表放弃诈唬或控池';
            }
            return '过牌通常代表中等牌力或弱牌';
        }

        if (lastAction.action === 'call') {
            return '跟注代表有一定牌力但不够强到加注';
        }

        return '';
    }

    // Build shared context narrative (shown once, not per-action)
    _buildNarrative(params) {
        const { exploit } = params;
        const villainLine = this._describeVillainLine();
        const lineInterpretation = this._interpretVillainLine();
        const exploitDesc = exploit?.note || '';
        let narrative = '';
        if (exploitDesc) narrative += `${exploitDesc} `;
        if (villainLine) narrative += `${villainLine}。`;
        if (lineInterpretation) narrative += `${lineInterpretation}。`;
        return narrative;
    }

    // Generate context-aware reasoning for a specific action recommendation
    // Each action gets UNIQUE reasoning — no shared narrative prefix
    _generateContextualReasoning(actionType, params) {
        const { handCategory, equity, potOdds, rangeComp, boardTexture, spr, inPosition, exploit, sizing } = params;
        const catCN = handCategory.categoryCN;
        const str = handCategory.strength;
        const eqPct = (equity * 100).toFixed(0);

        // Range composition summary
        let rangeDesc = '';
        if (rangeComp && rangeComp.villainCombos > 0) {
            const vp = rangeComp.villainPct;
            const parts = [];
            if (vp.nuts > 0) parts.push(`坚果${vp.nuts}%`);
            if (vp.strongMade > 0) parts.push(`强牌${vp.strongMade}%`);
            if (vp.mediumMade > 0) parts.push(`中等${vp.mediumMade}%`);
            if (vp.draw > 0) parts.push(`听牌${vp.draw}%`);
            if (vp.weakMade > 0) parts.push(`弱牌${vp.weakMade}%`);
            if (vp.air > 0) parts.push(`空气${vp.air}%`);
            rangeDesc = `(${parts.join('/')})`;
        }

        const beatsDesc = rangeComp ? `对手范围${rangeComp.beatsHeroPct}%压制你` : '';
        const posTag = inPosition ? 'IP' : 'OOP';
        const sprTag = spr < 3 ? `短SPR${spr.toFixed(1)}` : spr < 8 ? `SPR${spr.toFixed(1)}` : `深SPR${spr.toFixed(1)}`;

        switch (actionType) {
            case 'value_raise':
                return `${catCN}权益${eqPct}%远超底池赔率，${sprTag}下raise最大化价值。${beatsDesc ? beatsDesc + '，但牌力足够stack off。' : ''}${rangeDesc}`;

            case 'semi_bluff_raise':
                return `${catCN}权益${eqPct}%，raise拿fold equity + 听牌改进空间。${posTag}有利。${rangeDesc}`;

            case 'call_profitable':
                return `${catCN}权益${eqPct}%${potOdds ? ` > 赔率${(potOdds*100).toFixed(0)}%` : ''}，call有正EV。${beatsDesc ? beatsDesc + '但' : ''}${posTag}实现equity。${rangeDesc}`;

            case 'call_implied':
                return `${catCN}当前赔率不够，但implied odds补偿。${posTag}后续街能从强牌中榨取更多value。`;

            case 'fold_equity_deficit':
                return `${catCN}权益${eqPct}%不够继续。${beatsDesc ? beatsDesc + '。' : ''}${rangeDesc}止损fold。`;

            case 'fold_mdf':
                return `MDF要求一定防守频率，但${catCN}太弱hold不住。${rangeDesc}放弃。`;

            case 'bluff_raise':
                return `低频bluff raise平衡范围${handCategory.blockerInfo?.blocksNutFlush ? '，持有nut flush blocker增加fold equity' : ''}。${rangeDesc}`;

            case 'value_bet':
                return `${catCN}权益${eqPct}%打对手的continue range有利。${posTag}，${sprTag}。${sizing ? sizing + '。' : ''}${rangeDesc}`;

            case 'check_slowplay':
                return `慢打平衡check range，引诱对手后续街加注或bluff。trap价值 > 直接bet。`;

            case 'check_potcontrol':
                return `${catCN}牌力${(str*100).toFixed(0)}不够bet for value，check控池避免被raise打走。${posTag}保持灵活。${rangeDesc}`;

            case 'protection_bet':
                return `湿润牌面${catCN}需要protection，不让对手免费realize听牌equity。${rangeDesc}`;

            case 'block_bet':
                return `小注block bet阻止对手大尺度bluff。${catCN}showdown value不错但不想面对大注。${posTag}。`;

            case 'semi_bluff_bet':
                return `${catCN}权益${eqPct}%，bet拿fold equity + draw outs。${posTag}。${rangeDesc}`;

            case 'bluff_bet':
                return `纯bluff${handCategory.blockerInfo?.blocksNutFlush ? '，nut flush blocker增加对手fold概率' : ''}。${posTag}，对手range空气多适合attack。${rangeDesc}`;

            case 'give_up':
                return `${catCN}没有改进空间${rangeDesc}，check放弃。bluff EV为负。`;

            case 'float':
                return `Float — ${posTag}跟一条街，计划后续街拿走底池。对手check概率高时可以steal。${rangeDesc}`;

            case 'catch_bluff':
                return `Bluff catcher — 极少数情况call抓诈，维持防守频率。${rangeDesc}`;

            default:
                return `${catCN}权益${eqPct}%。${posTag}。${rangeDesc}`;
        }
    }

    // Process player's action choice
    // actionLogSnapshot: pass current actionLog array so undo can restore it
    processAction(action, actionLogSnapshot) {
        // Save snapshot BEFORE making changes
        this._saveSnapshot(actionLogSnapshot);

        const rec = this.getRecommendation();
        const bestAction = rec.advice[0].action;

        // --- Frequency-weighted quality scoring ---
        // Normalize actions into 3 categories: passive (check/call), aggressive (bet/raise), fold
        function normalizeAction(act) {
            if (act === 'check' || act === 'call') return 'passive';
            if (act === 'fold') return 'fold';
            // All bet/raise actions (including CFR's bet33, bet66, bet100)
            if (act === 'bet' || act === 'raise' || act.startsWith('bet')) return 'aggressive';
            return act;
        }
        const normalizedPlayerAction = normalizeAction(action);

        // Find the frequency assigned to the player's chosen action
        let matchedFrequency = 0;
        for (const adv of rec.advice) {
            const normalizedAdvAction = normalizeAction(adv.action);
            if (normalizedAdvAction === normalizedPlayerAction) {
                matchedFrequency += adv.frequency;
            }
        }

        // Quality score: proportional to how much GTO recommends this action
        // Best action (highest frequency) gets 1.0
        // Other actions scale proportionally
        const bestFrequency = rec.advice[0].frequency;
        let qualityScore;
        if (matchedFrequency >= bestFrequency) {
            qualityScore = 1.0; // Player chose the top recommended action
        } else if (matchedFrequency > 0) {
            // Scale: 40% frequency -> ~0.7 score, 10% -> ~0.3, 5% -> ~0.2
            qualityScore = 0.2 + 0.8 * (matchedFrequency / bestFrequency);
            qualityScore = Math.round(qualityScore * 100) / 100;
        } else {
            qualityScore = 0.0; // Action not in recommendations at all
        }

        // Score: 0-100 integer based on quality
        const score = Math.round(qualityScore * 100);

        // Accumulate scores
        this.score.total++;
        if (!this.score.totalPoints) this.score.totalPoints = 0;
        this.score.totalPoints += score;

        const isCorrect = score >= 70;
        this.history.push({
            street: this.street,
            action: action,
            recommended: bestAction,
            score: score,
            qualityScore: qualityScore,
            matchedFrequency: matchedFrequency,
            equity: rec.equity,
            handCategory: rec.handCategory.categoryCN,
            isCorrect: isCorrect,
        });

        return {
            score,
            qualityScore,
            matchedFrequency,
            recommendation: rec,
            totalScore: this.score
        };
    }

    getScore() {
        return {
            ...this.score,
            correct: this.history.filter(h => h.isCorrect).length,
            avgScore: this.score.total > 0 && this.score.totalPoints ? Math.round(this.score.totalPoints / this.score.total) : 0,
        };
    }
    resetScore() { this.score = { correct: 0, total: 0, totalPoints: 0 }; }
}
