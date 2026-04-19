// ============================================================
// 6-Max Cash Game Engine
// Full game state management for player vs 5 bots
// ============================================================

const BOT_NAMES = [
    'Alex 🎩', 'Luna 🌙', 'Rocky 🪨', 'Blaze 🔥', 'Sage 🦉',
    'Viper 🐍', 'Frost ❄️', 'Phoenix 🔆', 'Shadow 🌑', 'Storm ⚡',
    'Titan 💪', 'Ghost 👻', 'Hawk 🦅', 'Rex 🦖', 'Wolf 🐺',
];
const BOT_STYLES = ['NIT', 'TAG', 'LAG', 'FISH', 'REG'];

class CashGameEngine {
    constructor(config = {}) {
        this.numSeats = 6;
        this.bb = config.bb || 1;
        this.sb = config.sb || 0.5;
        this.heroSeat = config.heroSeat || 0; // 0-5
        this.startingStack = config.buyIn || 100; // in BB

        // Seats: { name, stack, style, isHero, isActive, holeCards, isSittingOut }
        this.seats = [];
        this.dealerSeat = 0;
        this.handNumber = 0;

        // Per-hand state
        this.deck = [];
        this.board = [];
        this.pot = 0;
        this.sidePots = [];
        this.street = 'preflop'; // preflop, flop, turn, river, showdown
        this.currentBet = 0; // current bet to match
        this.minRaise = 0;
        this.actingSeat = -1;
        this.lastAggressor = -1;
        this.actionClosed = false;
        this.bets = []; // per-seat bets this street
        this.folded = [];
        this.allIn = [];
        this.handHistory = []; // action log for current hand

        // Session stats
        this.stats = {
            handsPlayed: 0,
            heroProfit: 0, // cumulative BB won/lost
            vpipCount: 0, // hands hero voluntarily put money in
            pfRaiseCount: 0,
        };

        this._usedBotNames = new Set();
        this._initSeats(config);
    }

    _initSeats(config) {
        this.seats = [];
        for (let i = 0; i < this.numSeats; i++) {
            if (i === this.heroSeat) {
                this.seats.push({
                    name: 'Hero',
                    stack: this.startingStack,
                    style: 'HERO',
                    isHero: true,
                    isActive: true,
                    holeCards: null,
                    isSittingOut: false,
                });
            } else {
                this.seats.push(this._createBot());
            }
        }
    }

    _createBot() {
        let name;
        do { name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]; }
        while (this._usedBotNames.has(name));
        this._usedBotNames.add(name);

        const style = BOT_STYLES[Math.floor(Math.random() * BOT_STYLES.length)];
        const stack = this.startingStack * (0.8 + Math.random() * 0.8); // 80-160BB
        return {
            name,
            stack: Math.round(stack * 10) / 10,
            style,
            isHero: false,
            isActive: true,
            holeCards: null,
            isSittingOut: false,
        };
    }

    _replaceBot(seat) {
        const old = this.seats[seat];
        if (old && old.name) this._usedBotNames.delete(old.name);
        this.seats[seat] = this._createBot();
    }

    // Get position name for a seat relative to dealer
    getSeatPosition(seat) {
        const positions = this.numSeats === 6
            ? ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']
            : ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'];
        const offset = (seat - this.dealerSeat + this.numSeats) % this.numSeats;
        return positions[offset] || `Seat${seat}`;
    }

    // Active players (not folded, not sitting out, has stack)
    _activePlayers() {
        return this.seats.map((s, i) => i).filter(i =>
            this.seats[i].isActive && !this.seats[i].isSittingOut && !this.folded[i]
        );
    }

    _playersInHand() {
        return this._activePlayers().filter(i => !this.folded[i]);
    }

    _nextSeat(from) {
        for (let i = 1; i <= this.numSeats; i++) {
            const s = (from + i) % this.numSeats;
            if (this.seats[s].isActive && !this.seats[s].isSittingOut && !this.folded[s] && !this.allIn[s]) return s;
        }
        return -1;
    }

    // ============================================================
    // Start a new hand
    // ============================================================
    startHand() {
        // Rotate dealer
        if (this.handNumber > 0) {
            do { this.dealerSeat = (this.dealerSeat + 1) % this.numSeats; }
            while (this.seats[this.dealerSeat].isSittingOut);
        }
        this.handNumber++;

        // Replace busted bots
        for (let i = 0; i < this.numSeats; i++) {
            if (!this.seats[i].isHero && this.seats[i].stack <= 0) {
                this._replaceBot(i);
            }
        }

        // Reset hand state
        this.deck = shuffleDeck(fullDeck());
        this.board = [];
        this.pot = 0;
        this.street = 'preflop';
        this.currentBet = this.bb;
        this.minRaise = this.bb;
        this.lastAggressor = -1;
        this.bets = new Array(this.numSeats).fill(0);
        this.folded = new Array(this.numSeats).fill(false);
        this.allIn = new Array(this.numSeats).fill(false);
        this.handHistory = [];

        // Mark sitting-out seats
        for (let i = 0; i < this.numSeats; i++) {
            this.seats[i].holeCards = null;
            this.seats[i].isSittingOut = this.seats[i].stack <= 0;
        }

        // Post blinds
        const sbSeat = this._nextSeat(this.dealerSeat);
        const bbSeat = this._nextSeat(sbSeat);
        this._postBlind(sbSeat, this.sb);
        this._postBlind(bbSeat, this.bb);

        // Deal hole cards
        for (let i = 0; i < this.numSeats; i++) {
            if (!this.seats[i].isSittingOut) {
                this.seats[i].holeCards = [this.deck.pop(), this.deck.pop()];
            }
        }

        // Set first to act (UTG preflop)
        this.actingSeat = this._nextSeat(bbSeat);
        this.actionClosed = false;

        return this.getState();
    }

    _postBlind(seat, amount) {
        const actual = Math.min(amount, this.seats[seat].stack);
        this.seats[seat].stack -= actual;
        this.bets[seat] = actual;
        this.pot += actual;
        if (this.seats[seat].stack <= 0) this.allIn[seat] = true;
        this.handHistory.push({
            seat, action: amount === this.sb ? 'post_sb' : 'post_bb',
            amount: actual, street: 'preflop',
        });
    }

    // ============================================================
    // Process an action (for hero or bot)
    // Returns: { nextActor, state } or { showdown: true } or { nextStreet: true }
    // ============================================================
    processAction(seat, action, amount = 0) {
        if (seat !== this.actingSeat) return null;

        const player = this.seats[seat];
        const toCall = this.currentBet - this.bets[seat];

        switch (action) {
            case 'fold':
                this.folded[seat] = true;
                this.handHistory.push({ seat, action: 'fold', street: this.street });
                break;

            case 'check':
                this.handHistory.push({ seat, action: 'check', street: this.street });
                break;

            case 'call': {
                const callAmt = Math.min(toCall, player.stack);
                player.stack -= callAmt;
                this.bets[seat] += callAmt;
                this.pot += callAmt;
                if (player.stack <= 0) this.allIn[seat] = true;
                this.handHistory.push({ seat, action: 'call', amount: callAmt, street: this.street });
                break;
            }

            case 'raise':
            case 'bet': {
                const totalBet = Math.min(amount, player.stack + this.bets[seat]);
                const raiseBy = totalBet - this.bets[seat];
                const additional = totalBet - this.bets[seat];
                player.stack -= additional;
                this.pot += additional;
                this.minRaise = totalBet - this.currentBet;
                this.currentBet = totalBet;
                this.bets[seat] = totalBet;
                this.lastAggressor = seat;
                if (player.stack <= 0) this.allIn[seat] = true;
                this.handHistory.push({
                    seat, action: this.currentBet > 0 ? 'raise' : 'bet',
                    amount: totalBet, street: this.street,
                });
                break;
            }

            case 'allin': {
                const allInAmt = player.stack + this.bets[seat];
                const add = player.stack;
                if (allInAmt > this.currentBet) {
                    this.minRaise = allInAmt - this.currentBet;
                    this.currentBet = allInAmt;
                    this.lastAggressor = seat;
                }
                player.stack = 0;
                this.pot += add;
                this.bets[seat] = allInAmt;
                this.allIn[seat] = true;
                this.handHistory.push({ seat, action: 'allin', amount: allInAmt, street: this.street });
                break;
            }
        }

        // Find next actor
        return this._advanceAction();
    }

    _advanceAction() {
        const inHand = this._playersInHand();
        const notAllIn = inHand.filter(i => !this.allIn[i]);

        // Only one player left → wins pot
        if (inHand.length <= 1) {
            return this._awardPot(inHand[0]);
        }

        // All-in runout only when no more meaningful action is possible:
        //   - Zero players can still act (everyone all-in)
        //   - Exactly one player can still act, AND they've already matched the current bet
        //     (so they have no pending decision — they just wait for cards)
        // Previously we ran out as soon as notAllIn.length <= 1, which wrongly auto-folded
        // the villain's decision when the hero went all-in first.
        if (notAllIn.length === 0) {
            return this._runItOut();
        }
        if (notAllIn.length === 1 && this.bets[notAllIn[0]] >= this.currentBet) {
            return this._runItOut();
        }

        // Find next player who needs to act
        let next = this._nextSeat(this.actingSeat);
        // Round complete when we get back to last aggressor or everyone has acted
        if (next === this.lastAggressor || next === -1) {
            return this._nextStreet();
        }

        // Check if everyone has matched the current bet
        const allMatched = notAllIn.every(i => this.bets[i] === this.currentBet);
        if (allMatched && this.lastAggressor === -1 && next === this._firstToAct()) {
            // Preflop BB option: give BB a chance only if BB hasn't just acted.
            // Previously checked only `actionClosed` flag, which wasn't set when
            // the BB option condition fired AFTER BB already checked — causing
            // an infinite loop back to BB. Fix: detect "BB just acted" by
            // comparing actingSeat (the player who just acted) to bbSeat.
            if (this.street === 'preflop' && !this.actionClosed) {
                const bbSeat = this._nextSeat(this._nextSeat(this.dealerSeat));
                this.actionClosed = true;
                // If BB is NOT the one who just acted, give them the option.
                // Otherwise fall through to _nextStreet.
                if (bbSeat !== this.actingSeat && !this.folded[bbSeat] && !this.allIn[bbSeat]) {
                    this.actingSeat = bbSeat;
                    return { nextActor: bbSeat, state: this.getState() };
                }
            }
            return this._nextStreet();
        }

        this.actingSeat = next;
        return { nextActor: next, state: this.getState() };
    }

    _firstToAct() {
        if (this.street === 'preflop') {
            const bbSeat = this._nextSeat(this._nextSeat(this.dealerSeat));
            return this._nextSeat(bbSeat);
        }
        // Postflop: first active player after dealer
        return this._nextSeat(this.dealerSeat);
    }

    _nextStreet() {
        // Collect bets into pot
        this.bets.fill(0);
        this.currentBet = 0;
        this.minRaise = this.bb;
        this.lastAggressor = -1;
        this.actionClosed = false;

        if (this.street === 'preflop') {
            this.street = 'flop';
            this.deck.pop(); // burn
            this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        } else if (this.street === 'flop') {
            this.street = 'turn';
            this.deck.pop();
            this.board.push(this.deck.pop());
        } else if (this.street === 'turn') {
            this.street = 'river';
            this.deck.pop();
            this.board.push(this.deck.pop());
        } else {
            return this._showdown();
        }

        // First to act postflop
        this.actingSeat = this._nextSeat(this.dealerSeat);
        if (this.actingSeat === -1) return this._showdown();

        return { nextStreet: this.street, state: this.getState() };
    }

    _runItOut() {
        // Deal remaining community cards
        while (this.board.length < 5) {
            this.deck.pop(); // burn
            this.board.push(this.deck.pop());
        }
        this.street = 'showdown';
        return this._showdown();
    }

    _showdown() {
        this.street = 'showdown';
        const inHand = this._playersInHand();

        // Evaluate all hands
        const results = [];
        for (const seat of inHand) {
            const eval_ = evaluateBest(this.seats[seat].holeCards, this.board);
            results.push({ seat, eval: eval_, score: eval_ ? eval_.score : 0 });
        }
        results.sort((a, b) => b.score - a.score);

        // Check for chop (multiple winners with same score)
        const bestScore = results[0].score;
        const winners = results.filter(r => r.score === bestScore).map(r => r.seat);

        return this._awardPot(winners, results);
    }

    _awardPot(winners, results = null) {
        // winners is an array (chop pot if >1)
        if (!Array.isArray(winners)) winners = [winners];

        const potTotal = this.pot;
        const share = Math.round(potTotal / winners.length * 10) / 10;

        // Award each winner their share
        for (const w of winners) {
            this.seats[w].stack += share;
        }

        // Calculate each player's total investment this hand
        const invested = new Array(this.numSeats).fill(0);
        for (const h of this.handHistory) {
            if (h.amount) invested[h.seat] += h.amount;
        }

        const heroInvested = invested[this.heroSeat];
        const isHeroWinner = winners.includes(this.heroSeat);

        if (isHeroWinner) {
            this.stats.heroProfit += share - heroInvested; // net = share won - amount put in
        } else {
            this.stats.heroProfit -= heroInvested;
        }
        this.stats.handsPlayed++;

        const mainWinner = winners[0];
        const isChop = winners.length > 1;

        return {
            showdown: true,
            winner: mainWinner,
            winners,
            isChop,
            winnerName: isChop ? `${winners.length}人平分` : this.seats[mainWinner].name,
            winAmount: isChop ? (share - invested[mainWinner]) : (potTotal - invested[mainWinner]),
            potTotal,
            share,
            results,
            heroProfit: this.stats.heroProfit,
            heroInvested,
            isHeroWinner,
            state: this.getState(),
        };
    }

    // ============================================================
    // Get available actions for current actor
    // ============================================================
    getAvailableActions(seat) {
        if (seat === undefined) seat = this.actingSeat;
        const player = this.seats[seat];
        const toCall = this.currentBet - this.bets[seat];
        const actions = [];

        if (toCall <= 0) {
            actions.push({ action: 'check' });
            // Can bet
            for (const pct of [0.33, 0.5, 0.66, 1.0]) {
                const betAmt = Math.round(this.pot * pct * 10) / 10;
                if (betAmt >= this.bb && betAmt <= player.stack) {
                    actions.push({ action: 'bet', amount: betAmt, label: `Bet ${Math.round(pct * 100)}%` });
                }
            }
        } else {
            actions.push({ action: 'fold' });
            if (toCall <= player.stack) {
                actions.push({ action: 'call', amount: toCall });
            }
            // Can raise
            const minRaiseTotal = this.currentBet + Math.max(this.minRaise, this.bb);
            if (minRaiseTotal - this.bets[seat] < player.stack) {
                for (const mult of [2.5, 3.0]) {
                    const raiseAmt = Math.round(this.currentBet * mult * 10) / 10;
                    if (raiseAmt <= player.stack + this.bets[seat] && raiseAmt > this.currentBet) {
                        actions.push({ action: 'raise', amount: raiseAmt, label: `Raise ${mult}x` });
                    }
                }
            }
        }

        // Always can go all-in
        if (player.stack > 0) {
            actions.push({ action: 'allin', amount: player.stack + this.bets[seat], label: 'All-In' });
        }

        return actions;
    }

    // ============================================================
    // State snapshot for UI
    // ============================================================
    getState() {
        return {
            seats: this.seats.map((s, i) => ({
                ...s,
                position: this.getSeatPosition(i),
                bet: this.bets[i],
                folded: this.folded[i],
                allIn: this.allIn[i],
                isActing: i === this.actingSeat,
                holeCards: s.isHero ? s.holeCards : (this.street === 'showdown' && !this.folded[i] ? s.holeCards : null),
            })),
            board: this.board,
            pot: this.pot,
            street: this.street,
            dealerSeat: this.dealerSeat,
            heroSeat: this.heroSeat,
            actingSeat: this.actingSeat,
            currentBet: this.currentBet,
            handNumber: this.handNumber,
            stats: { ...this.stats },
        };
    }
}
