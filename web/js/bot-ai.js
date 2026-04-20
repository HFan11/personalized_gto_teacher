// ============================================================
// Bot AI — Decision engine for 6-max cash game bots
// Style-based play: NIT, TAG, LAG, FISH, REG
// Preflop uses the CFR+ PreflopSolver (same engine that powers the
// preflop practice module) and then applies a per-style tilt layer on
// top of the GTO frequencies so each bot still has a distinct
// personality. Postflop still uses heuristic for speed.
// ============================================================

class BotAI {
    // Async so it can await the preflop solver's solve() on first use
    // of a session. Subsequent calls just hit the cached strategy table.
    static async decide(game, seat) {
        const bot = game.seats[seat];
        const style = bot.style;
        const pos = game.getSeatPosition(seat);
        const street = game.street;
        const toCall = Math.max(0, game.currentBet - game.bets[seat]);
        const potSize = game.pot;
        const stack = bot.stack;
        const holeCards = bot.holeCards;
        const board = game.board;
        const bb = game.bb;

        // Count players still in hand (not folded)
        const playersInHand = game.seats.filter((s, i) => !game.folded[i] && !s.isSittingOut && s.isActive).length;
        // Was this bot the preflop raiser?
        const isPFR = game.handHistory.some(h => h.seat === seat && (h.action === 'raise' || h.action === 'allin') && h.street === 'preflop');

        if (street === 'preflop') {
            // Try the GTO solver first. If it can't resolve this spot
            // (unusual multi-way / limped pot / solver not loaded) fall
            // back to the heuristic so the hand never stalls.
            try {
                const solved = await this._solverPreflop(holeCards, pos, style, toCall, bb, stack, seat, game, playersInHand);
                if (solved) return solved;
            } catch (e) {
                console.warn('[BotAI] solver preflop failed, using heuristic:', e.message);
            }
            return this._preflopDecision(holeCards, pos, style, toCall, bb, stack, seat, game, playersInHand);
        } else {
            // Postflop: try precomputed GTO lookup on the flop; fall
            // through to heuristic for turn/river and uncovered flops.
            try {
                const solved = await this._solverPostflop(holeCards, board, pos, style, toCall, potSize, stack, seat, game, playersInHand, isPFR);
                if (solved) return solved;
            } catch (e) {
                console.warn('[BotAI] solver postflop failed, using heuristic:', e.message);
            }
            return this._postflopDecision(holeCards, board, pos, style, toCall, potSize, stack, seat, game, playersInHand, isPFR);
        }
    }

    // ============================================================
    // SOLVER-BACKED POSTFLOP (flop only, via PrecomputedLookup)
    // ============================================================
    //
    // Our precomputed flop library (235 boards, ~293 hands each) is
    // fuzzy-matched by rank/suit pattern, so ~80% of flops hit a
    // solved strategy for free. The strategy is for a generic "SRP
    // IP vs OOP" setup — ideal for the cash-game common case where
    // the bot got here after raise-call preflop.
    //
    // Strategy shape:
    //   { check: 0.5, "bet_BET 3.0": 0.4, "bet_BET 10.0": 0.1 }
    // or { fold: 0.4, call: 0.5, "raise_RAISE 12.0": 0.1 }
    //
    // We collapse the sized-bet keys into generic "bet" / "raise"
    // totals, apply the same style-tilt layer as preflop, sample an
    // action, then pick a concrete sizing based on the hand's
    // strength (value hands bet bigger, bluffs smaller).
    static async _solverPostflop(holeCards, board, pos, style, toCall, potSize, stack, seat, game, playersInHand, isPFR) {
        if (typeof precomputedLookup === 'undefined') return null;
        if (board.length !== 3) return null;                       // flop only for now
        if (playersInHand > 2) return null;                        // precomputed is HU
        if (stack <= 0 || potSize < game.bb) return null;          // degenerate

        const isIP = pos === 'BTN' || pos === 'CO';
        const facingBet = toCall > 0;
        const result = await precomputedLookup.getStrategy(board, holeCards, isIP, facingBet);
        if (!result || !result.strategy) return null;

        // Collapse sized-bet/raise keys into plain "bet"/"raise"
        const raw = result.strategy;
        const collapsed = { check: 0, fold: 0, call: 0, bet: 0, raise: 0 };
        for (const [k, v] of Object.entries(raw)) {
            if (k === 'check') collapsed.check += v;
            else if (k === 'fold') collapsed.fold += v;
            else if (k === 'call') collapsed.call += v;
            else if (k.startsWith('bet_')) collapsed.bet += v;
            else if (k.startsWith('raise_')) collapsed.raise += v;
        }
        // Drop zero-freq actions before tilt so we don't divide by zero
        const cleaned = {};
        for (const [k, v] of Object.entries(collapsed)) if (v > 0.001) cleaned[k] = v;
        if (Object.keys(cleaned).length === 0) return null;

        // Apply the same per-style tilt, but only the relevant keys
        const tilts = {
            NIT:  { fold: 1.4,  call: 0.8, check: 1.1, bet: 0.7, raise: 0.6 },
            TAG:  { fold: 1.1,  call: 0.95, check: 1.0, bet: 0.95, raise: 0.9 },
            REG:  { fold: 1.0,  call: 1.0,  check: 1.0, bet: 1.0,  raise: 1.0 },
            LAG:  { fold: 0.7,  call: 1.0,  check: 0.85, bet: 1.3, raise: 1.35 },
            FISH: { fold: 0.55, call: 1.5,  check: 1.0, bet: 0.9, raise: 0.7 },
        };
        const t = tilts[style] || tilts.REG;
        const tilted = {};
        let total = 0;
        for (const [k, v] of Object.entries(cleaned)) {
            const m = t[k] != null ? t[k] : 1.0;
            tilted[k] = Math.max(0, v * m);
            total += tilted[k];
        }
        if (total <= 0) return null;
        for (const k in tilted) tilted[k] /= total;

        const picked = this._sampleStrategy(tilted);
        return this._translatePostflopAction(picked, holeCards, board, toCall, potSize, stack, seat, game);
    }

    static _translatePostflopAction(action, holeCards, board, toCall, potSize, stack, seat, game) {
        const myBet = game.bets[seat] || 0;
        const maxBet = stack + myBet;
        switch (action) {
            case 'check':
                return { action: 'check' };
            case 'fold':
                // Never fold when you can check for free
                return toCall <= 0 ? { action: 'check' } : { action: 'fold' };
            case 'call':
                return toCall <= 0 ? { action: 'check' } : { action: 'call', amount: toCall };
            case 'bet': {
                // Pick sizing by hand strength: value hands bet ~66% pot,
                // medium hands ~33-50%, bluffs mixed.
                const evalH = (typeof categorizeHand === 'function') ? categorizeHand(holeCards, board) : null;
                const str = evalH ? evalH.strength : 0.4;
                let pct;
                if (str >= 0.85) pct = 0.66;
                else if (str >= 0.6) pct = 0.5;
                else if (str >= 0.35) pct = 0.33;
                else pct = Math.random() < 0.5 ? 0.66 : 0.33;
                const size = Math.max(game.bb, Math.round(potSize * pct * 10) / 10);
                if (size >= maxBet - 0.5) return { action: 'allin', amount: maxBet };
                return { action: 'bet', amount: Math.min(size, maxBet) };
            }
            case 'raise': {
                // Raise-to = currentBet * 2.5 with pot-size guardrail
                const raiseTo = Math.round(game.currentBet * 2.5 * 10) / 10;
                if (raiseTo >= maxBet - 0.5) return { action: 'allin', amount: maxBet };
                return { action: 'raise', amount: Math.min(raiseTo, maxBet) };
            }
            default:
                return null;
        }
    }

    // ============================================================
    // SOLVER-BACKED PREFLOP
    // ============================================================
    //
    // Maps the live cash-game state to one of the four canonical
    // preflop scenarios the solver knows about:
    //   - 'rfi'       : folded to us, first raise of the hand
    //   - 'vs_raise'  : one prior raise to call / fold / 3-bet
    //   - 'vs_3bet'   : two prior raises (original opener facing 3b)
    //   - 'vs_4bet'   : three prior raises
    // Multi-way / squeeze / limped pots fall through to the heuristic.
    //
    // After we have a {fold, call, raise/3bet/4bet/jam} mixed strategy,
    // we apply a per-style tilt multiplier and then sample an action
    // proportional to the resulting weights. Sizing of the raise still
    // uses the standard cash-game defaults (2.5x open, 3x 3-bet, 2.5x
    // 4-bet) because the solver only outputs the frequency mix, not a
    // bet size.
    static async _solverPreflop(holeCards, pos, style, toCall, bb, stack, seat, game, playersInHand) {
        if (typeof PreflopSolver === 'undefined') return null;
        const solver = PreflopSolver.getInstance();
        if (!solver.solved) {
            // Solve once — takes ~0.8s on first call. Cached from then on.
            try { solver.solve({ iterations: 500 }); }
            catch (e) { return null; }
        }

        // Work out the scenario by scanning THIS street's preflop history.
        const history = game.handHistory.filter(h => h.street === 'preflop');
        const raiseActions = history.filter(h => h.action === 'raise' || h.action === 'allin');
        let scenario, villainPos;
        if (raiseActions.length === 0) {
            scenario = 'rfi';
            villainPos = null;
        } else if (raiseActions.length === 1) {
            scenario = 'vs_raise';
            villainPos = game.getSeatPosition(raiseActions[0].seat);
        } else if (raiseActions.length === 2) {
            // We're the opener facing a 3-bet
            const lastRaiser = raiseActions[raiseActions.length - 1];
            if (lastRaiser.seat === seat) return null;   // shouldn't happen (we're acting)
            scenario = 'vs_3bet';
            villainPos = game.getSeatPosition(lastRaiser.seat);
        } else if (raiseActions.length === 3) {
            scenario = 'vs_4bet';
            villainPos = game.getSeatPosition(raiseActions[raiseActions.length - 1].seat);
        } else {
            return null;   // 5-bet+ spots: heuristic handles jam/fold
        }

        // Don't ask the solver for spots it wasn't trained on
        if (scenario === 'rfi' && pos === 'BB') return null;   // BB doesn't open when folded to

        // Multi-way detection: only treat as "tight multi-way" when there
        // are 1+ prior CALLERS (not just folded players behind). The 2-player
        // solver output is a reasonable approximation for the 6-max
        // "facing one raise" spot since nobody has called yet.
        const priorCallers = history.filter(h =>
            h.action === 'call' && h.seat !== seat
        ).length;
        if (priorCallers >= 1 && scenario !== 'rfi') return null;   // multi-way — heuristic

        const handKey = this._handToKey(holeCards);
        const strat = solver.getStrategy(pos, handKey, scenario, villainPos);
        if (!strat) return null;

        // Apply style tilt: each style biases the GTO frequencies a bit
        // (tight players fold more, loose more raise/call) so bots retain
        // their personality even when they play close to GTO.
        const tilted = this._tiltStrategy(strat, style);

        // Sample an action from the mixed strategy
        const picked = this._sampleStrategy(tilted);
        return this._translateSolverAction(picked, scenario, toCall, bb, stack, seat, game);
    }

    static _tiltStrategy(strat, style) {
        // Multiplier per action per style. Numbers are mild (±0.3) so bots
        // still track GTO — they just lean tight / loose / aggressive.
        const tilts = {
            NIT:  { fold: 1.35, call: 0.80, raise: 0.70, '3bet': 0.70, '4bet': 0.60, jam: 0.70 },
            TAG:  { fold: 1.10, call: 0.95, raise: 1.00, '3bet': 1.00, '4bet': 0.90, jam: 0.90 },
            REG:  { fold: 1.00, call: 1.00, raise: 1.00, '3bet': 1.00, '4bet': 1.00, jam: 1.00 },
            LAG:  { fold: 0.70, call: 1.10, raise: 1.30, '3bet': 1.40, '4bet': 1.30, jam: 1.20 },
            FISH: { fold: 0.55, call: 1.55, raise: 0.85, '3bet': 0.70, '4bet': 0.60, jam: 0.70 },
        };
        const t = tilts[style] || tilts.REG;
        const out = {};
        let total = 0;
        for (const [act, freq] of Object.entries(strat)) {
            const m = t[act] != null ? t[act] : 1.0;
            out[act] = Math.max(0, freq * m);
            total += out[act];
        }
        if (total > 0) { for (const k in out) out[k] /= total; }
        return out;
    }

    static _sampleStrategy(strat) {
        const r = Math.random();
        let acc = 0;
        for (const [act, freq] of Object.entries(strat)) {
            acc += freq;
            if (r <= acc) return act;
        }
        // Fall back to the highest-frequency action (rounding guard)
        let best = null, bestFreq = -1;
        for (const [act, freq] of Object.entries(strat)) {
            if (freq > bestFreq) { bestFreq = freq; best = act; }
        }
        return best || 'fold';
    }

    static _translateSolverAction(action, scenario, toCall, bb, stack, seat, game) {
        const myBet = game.bets[seat] || 0;
        const maxBet = stack + myBet;
        switch (action) {
            case 'fold':
                // If we're already checked-down with no bet to call, check instead
                return toCall <= 0 ? { action: 'check' } : { action: 'fold' };
            case 'call':
                return toCall <= 0 ? { action: 'check' } : { action: 'call', amount: toCall };
            case 'raise': {
                // RFI default open size — slightly larger from SB (per GTO)
                const pos = game.getSeatPosition(seat);
                const size = pos === 'SB' ? 3 * bb : 2.5 * bb;
                return this._raise(Math.min(size, maxBet), game);
            }
            case '3bet': {
                const size = Math.round(game.currentBet * 3 * 10) / 10;
                return this._raise(Math.min(size, maxBet), game);
            }
            case '4bet': {
                const size = Math.round(game.currentBet * 2.3 * 10) / 10;
                return this._raise(Math.min(size, maxBet), game);
            }
            case 'jam':
                return { action: 'allin', amount: maxBet };
            default:
                return null;
        }
    }

    // ============================================================
    // PREFLOP
    // ============================================================
    static _preflopDecision(holeCards, pos, style, toCall, bb, stack, seat, game, playersInHand) {
        const handKey = this._handToKey(holeCards);
        const handRank = this._getHandRank(handKey);

        // Position-based open range width (% of 169 hands)
        const posWidths = { UTG: 14, HJ: 19, CO: 27, BTN: 42, SB: 32, BB: 100 };
        let baseWidth = posWidths[pos] || 25;

        // Style multiplier
        const styleMult = { NIT: 0.6, TAG: 0.85, REG: 1.0, LAG: 1.35, FISH: 1.5 };
        const width = baseWidth * (styleMult[style] || 1.0);

        const isInRange = handRank <= width;
        const isPremium = handRank <= 5;  // AA, KK, QQ, JJ, AKs
        const isStrong = handRank <= 12;  // 99+, AQs+, AKo, KQs
        const isMedium = handRank <= 30;

        // ---- Facing raise ----
        if (toCall > bb) {
            const raiseBB = toCall / bb;

            // Facing 4bet+ (>= 10BB)
            if (raiseBB >= 10) {
                if (handRank <= 3) return this._raise(stack + game.bets[seat], game); // AA/KK/QQ jam
                if (isPremium && style !== 'NIT') return { action: 'call', amount: toCall };
                return { action: 'fold' };
            }

            // Facing 3bet (>= 6BB)
            if (raiseBB >= 5) {
                if (isPremium) return this._raise(Math.min(game.currentBet * 2.5, stack + game.bets[seat]), game);
                if (isStrong) return { action: 'call', amount: toCall };
                if (style === 'LAG' && isMedium && Math.random() < 0.2) return { action: 'call', amount: toCall };
                return { action: 'fold' };
            }

            // Facing open raise
            // Tighten up in multiway (more callers = need stronger hand)
            const mwTighten = playersInHand > 3 ? 0.8 : 1.0;
            const defenseWidth = width * 1.2 * mwTighten;

            if (handRank > defenseWidth) return { action: 'fold' };

            // 3bet range
            if (isPremium || (isStrong && Math.random() < (style === 'LAG' ? 0.4 : 0.2))) {
                const size3bet = pos === 'BB' || pos === 'SB'
                    ? Math.round(game.currentBet * 3.5 * 10) / 10  // OOP 3bet bigger
                    : Math.round(game.currentBet * 3 * 10) / 10;
                return this._raise(Math.min(size3bet, stack + game.bets[seat]), game);
            }

            // SB should rarely flat (3bet or fold in GTO)
            if (pos === 'SB' && style !== 'FISH') {
                if (handRank <= defenseWidth * 0.6) {
                    return this._raise(Math.min(game.currentBet * 3.5, stack + game.bets[seat]), game);
                }
                return { action: 'fold' };
            }

            // FISH limps and calls too wide
            if (style === 'FISH' && handRank <= 80) return { action: 'call', amount: toCall };

            return { action: 'call', amount: toCall };
        }

        // ---- BB check option ----
        if (pos === 'BB' && toCall <= 0) {
            if (isStrong && Math.random() < 0.6) {
                return this._raise(Math.min(3.5 * bb, stack + game.bets[seat]), game);
            }
            return { action: 'check' };
        }

        // ---- Open action (no raise yet) ----
        if (!isInRange) {
            // FISH limps with bad hands sometimes
            if (style === 'FISH' && handRank <= 80 && Math.random() < 0.3) {
                return { action: 'call', amount: bb }; // limp
            }
            return { action: 'fold' };
        }

        // Open raise
        const openSize = pos === 'SB' ? 3 * bb : 2.5 * bb;
        return this._raise(openSize, game);
    }

    // ============================================================
    // POSTFLOP
    // ============================================================
    static _postflopDecision(holeCards, board, pos, style, toCall, potSize, stack, seat, game, playersInHand, isPFR) {
        const eval_ = categorizeHand(holeCards, board);
        const strength = eval_ ? eval_.strength : 0;
        const category = eval_ ? eval_.category : 'unknown';
        const spr = potSize > 0 ? stack / potSize : 99;
        const isIP = pos === 'BTN' || pos === 'CO';
        const isMultiway = playersInHand > 2;

        // Style params
        const styleParams = {
            NIT:  { agg: 0.3, bluff: 0.04, cbet: 0.35, callWidth: 0.35 },
            TAG:  { agg: 0.6, bluff: 0.10, cbet: 0.65, callWidth: 0.42 },
            REG:  { agg: 0.65, bluff: 0.12, cbet: 0.60, callWidth: 0.45 },
            LAG:  { agg: 0.80, bluff: 0.22, cbet: 0.75, callWidth: 0.50 },
            FISH: { agg: 0.35, bluff: 0.08, cbet: 0.40, callWidth: 0.60 }, // FISH calls wide
        };
        const sp = styleParams[style] || styleParams.REG;

        // Tighten in multiway pots
        const mwAdj = isMultiway ? 0.8 : 1.0;

        // ---- Facing a bet ----
        if (toCall > 0) {
            const potOdds = toCall / (potSize + toCall);

            // Nuts / very strong (strength >= 0.82) — raise for value
            if (strength >= 0.82) {
                if (Math.random() < 0.35) return { action: 'call', amount: toCall }; // slowplay mix
                const raiseAmt = this._calcRaise(game.currentBet, potSize, stack, seat, game, spr);
                if (raiseAmt > game.currentBet) return this._raise(raiseAmt, game);
                return { action: 'call', amount: toCall };
            }

            // Strong (0.6-0.82) — call, occasionally raise
            if (strength >= 0.6) {
                if (strength > potOdds + 0.1 * mwAdj) return { action: 'call', amount: toCall };
                if (Math.random() < sp.agg * 0.3 && !isMultiway) {
                    const raiseAmt = this._calcRaise(game.currentBet, potSize, stack, seat, game, spr);
                    return this._raise(raiseAmt, game);
                }
                return { action: 'call', amount: toCall };
            }

            // Medium (0.35-0.6) — call if getting right price
            if (strength >= 0.35) {
                const threshold = potOdds + (isMultiway ? 0.08 : 0.03);
                if (strength > threshold) return { action: 'call', amount: toCall };
                if (style === 'FISH' && strength > potOdds - 0.05) return { action: 'call', amount: toCall };
                if (style === 'NIT') return { action: 'fold' };
                return Math.random() < sp.callWidth ? { action: 'call', amount: toCall } : { action: 'fold' };
            }

            // Draws (0.15-0.35) — call if implied odds justify
            if (strength >= 0.15) {
                const impliedOdds = spr > 3 ? 0.08 : 0; // deep stacks = more implied odds
                if (strength > potOdds - impliedOdds) {
                    if (style === 'FISH' || Math.random() < 0.4) return { action: 'call', amount: toCall };
                }
                // Semi-bluff raise with draws
                if (!isMultiway && Math.random() < sp.bluff * 0.5 && stack > toCall * 3) {
                    const raiseAmt = this._calcRaise(game.currentBet, potSize, stack, seat, game, spr);
                    return this._raise(raiseAmt, game);
                }
                return { action: 'fold' };
            }

            // Trash — fold (FISH still calls sometimes)
            if (style === 'FISH' && Math.random() < 0.15) return { action: 'call', amount: toCall };
            return { action: 'fold' };
        }

        // ---- Not facing bet (check or bet) ----

        // C-bet logic: preflop raiser should bet more often
        const cbetBonus = isPFR ? sp.cbet : 0;

        // Value bet (strong hands)
        if (strength >= 0.7) {
            const betChance = Math.min(1.0, sp.agg + cbetBonus * 0.3);
            if (Math.random() < betChance) {
                const sizing = this._chooseSizing(strength, spr, potSize, stack, game);
                if (sizing >= game.bb) return { action: 'bet', amount: sizing };
            }
            return { action: 'check' };
        }

        // Medium hands — thin value / protection
        if (strength >= 0.4) {
            const betChance = isMultiway ? sp.agg * 0.15 : sp.agg * 0.35 + cbetBonus * 0.2;
            if (Math.random() < betChance) {
                const sizing = Math.round(potSize * 0.33 * 10) / 10;
                if (sizing >= game.bb && sizing <= stack) return { action: 'bet', amount: sizing };
            }
            return { action: 'check' };
        }

        // Weak / air — bluff
        const bluffChance = isMultiway ? sp.bluff * 0.3 : sp.bluff + cbetBonus * 0.25;
        if (Math.random() < bluffChance) {
            const sizing = this._chooseSizing(0.2, spr, potSize, stack, game);
            if (sizing >= game.bb && sizing <= stack) return { action: 'bet', amount: sizing };
        }
        return { action: 'check' };
    }

    // ============================================================
    // Helpers
    // ============================================================
    static _raise(amount, game) {
        const rounded = Math.round(amount * 10) / 10;
        if (rounded >= game.seats[game.actingSeat].stack + game.bets[game.actingSeat]) {
            return { action: 'allin', amount: rounded };
        }
        return { action: 'raise', amount: rounded };
    }

    static _calcRaise(currentBet, potSize, stack, seat, game, spr) {
        // Low SPR → jam more; high SPR → standard raise
        if (spr < 2) return stack + game.bets[seat]; // jam
        if (spr < 4) return Math.min(currentBet * 2.5, stack + game.bets[seat]);
        return Math.min(currentBet * 2.5 + potSize * 0.3, stack + game.bets[seat]);
    }

    static _chooseSizing(strength, spr, potSize, stack, game) {
        // Strong: bet big; medium: bet small; bluff: mixed
        let pct;
        if (strength >= 0.85) pct = spr < 3 ? 1.0 : 0.66;
        else if (strength >= 0.7) pct = 0.5;
        else if (strength >= 0.4) pct = 0.33;
        else pct = Math.random() < 0.5 ? 0.66 : 0.33; // bluffs mix sizes
        return Math.round(Math.min(potSize * pct, stack) * 10) / 10;
    }

    static _handToKey(cards) {
        const rv = {A:14,K:13,Q:12,J:11,T:10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};
        const r0 = rv[cards[0].rank], r1 = rv[cards[1].rank];
        const suited = cards[0].suit === cards[1].suit;
        const hi = Math.max(r0, r1), lo = Math.min(r0, r1);
        const ranks = 'AKQJT98765432';
        if (hi === lo) return ranks[14-hi] + ranks[14-lo];
        return ranks[14-hi] + ranks[14-lo] + (suited ? 's' : 'o');
    }

    static _getHandRank(handKey) {
        const top = ['AA','KK','QQ','JJ','AKs','TT','AKo','AQs','AJs','KQs',
            '99','ATs','AQo','KJs','KTs','QJs','88','AJo','A9s','QTs',
            'KQo','A8s','JTs','77','A5s','A7s','KJo','A4s','A6s','A3s',
            'QJo','66','K9s','A2s','T9s','KTo','Q9s','J9s','55','JTo',
            'A9o','QTo','K8s','A8o','98s','K7s','44','T8s','Q8s','87s',
            'A5o','K6s','33','A7o','J8s','97s','K5s','76s','Q9o','22',
            'A4o','T9o','K4s','J9o','65s','A6o','K3s','Q7s','A3o','86s',
            'K2s','54s','T7s','Q6s','A2o','98o','Q5s','75s','96s','J7s',
            'K9o','64s','Q4s','87o','T8o','53s','43s','Q3s','K8o','J8o',
            'Q2s','85s','97o','76o','J6s','T6s','K7o','74s','65o','J5s',
            '95s','86o','54o','63s','K6o','T9o','J4s','52s','T7o','Q8o',
            'K5o','42s','J3s','84s','96o','Q7o','75o','J2s','93s','T5s',
            'K4o','64o','53o','73s','Q6o','K3o','T4s','92s','43o','Q5o',
            'K2o','82s','T3s','62s','83o','94o','Q4o','T2s','72s','85o',
            'Q3o','74o','32s','J7o','T6o','Q2o','63o','95o','J6o','52o',
            '42o','J5o','84o','93o','J4o','73o','32o','J3o','92o','62o',
            'T5o','82o','J2o','T4o','72o','T3o','T2o'];
        const idx = top.indexOf(handKey);
        return idx >= 0 ? idx + 1 : 100;
    }
}
