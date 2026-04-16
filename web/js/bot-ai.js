// ============================================================
// Bot AI — Fast decision engine for 6-max cash game bots
// Uses precomputed GTO data + style-based adjustments
// ============================================================

class BotAI {
    // Decide bot's action given game state
    // Returns: { action: 'fold'|'check'|'call'|'raise'|'bet'|'allin', amount?: number }
    static decide(game, seat) {
        const bot = game.seats[seat];
        const style = bot.style;
        const pos = game.getSeatPosition(seat);
        const street = game.street;
        const toCall = game.currentBet - game.bets[seat];
        const potSize = game.pot;
        const stack = bot.stack;
        const holeCards = bot.holeCards;
        const board = game.board;

        if (street === 'preflop') {
            return this._preflopDecision(holeCards, pos, style, toCall, game);
        } else {
            return this._postflopDecision(holeCards, board, pos, style, toCall, potSize, stack, game, seat);
        }
    }

    // ============================================================
    // PREFLOP — use hand ranking + position + style
    // ============================================================
    static _preflopDecision(holeCards, pos, style, toCall, game) {
        const handKey = this._handToKey(holeCards);
        const handRank = this._getHandRank(handKey);
        const bb = game.bb;

        // Position-based thresholds (tighter EP, wider LP)
        const posWidths = { UTG: 15, HJ: 20, CO: 28, BTN: 45, SB: 35, BB: 100 };
        let baseWidth = posWidths[pos] || 25;

        // Style adjustments
        const styleMult = { NIT: 0.6, TAG: 0.9, REG: 1.0, LAG: 1.4, FISH: 1.6 };
        const width = baseWidth * (styleMult[style] || 1.0);

        const isInRange = handRank <= width;
        const isPremium = handRank <= 5; // AA, KK, QQ, AKs, AKo
        const isStrong = handRank <= 15;

        // Facing a raise
        if (toCall > bb) {
            const facingRaiseBB = toCall / bb;
            if (facingRaiseBB >= 10) {
                // Facing 4bet+
                if (isPremium) return { action: 'allin', amount: game.seats[game.actingSeat].stack + game.bets[game.actingSeat] };
                if (isStrong && style === 'LAG') return { action: 'call', amount: toCall };
                return { action: 'fold' };
            }
            if (facingRaiseBB >= 3) {
                // Facing 3bet
                if (isPremium) {
                    const raise4bet = Math.min(game.currentBet * 2.5, game.seats[game.actingSeat].stack + game.bets[game.actingSeat]);
                    return { action: 'raise', amount: raise4bet };
                }
                if (isStrong) return { action: 'call', amount: toCall };
                if (handRank <= width * 0.5 && style !== 'NIT') return { action: 'call', amount: toCall };
                return { action: 'fold' };
            }
            // Facing open raise
            if (!isInRange) return { action: 'fold' };
            // 3bet with premium + some bluffs
            if (isPremium || (handRank <= 10 && Math.random() < 0.3)) {
                const raise3bet = Math.min(game.currentBet * 3, game.seats[game.actingSeat].stack + game.bets[game.actingSeat]);
                return { action: 'raise', amount: raise3bet };
            }
            return { action: 'call', amount: toCall };
        }

        // No raise facing (limped to us or BB option)
        if (pos === 'BB' && toCall <= 0) {
            // BB check option
            if (isStrong) {
                const raiseAmt = Math.min(3 * bb, game.seats[game.actingSeat].stack);
                return { action: 'raise', amount: raiseAmt + game.bets[game.actingSeat] };
            }
            return { action: 'check' };
        }

        if (!isInRange) return { action: 'fold' };

        // Open raise
        const openSize = pos === 'SB' ? 3 * bb : 2.5 * bb;
        return { action: 'raise', amount: openSize };
    }

    // ============================================================
    // POSTFLOP — hand strength + board texture + style
    // ============================================================
    static _postflopDecision(holeCards, board, pos, style, toCall, potSize, stack, game, seat) {
        const eval_ = categorizeHand(holeCards, board);
        const strength = eval_ ? eval_.strength : 0;
        const category = eval_ ? eval_.category : 'unknown';
        const spr = potSize > 0 ? stack / potSize : 99;

        // Style aggression factor
        const aggression = { NIT: 0.3, TAG: 0.6, REG: 0.65, LAG: 0.85, FISH: 0.5 };
        const agg = aggression[style] || 0.6;

        // Bet/raise probability based on hand strength + aggression
        const betProb = Math.min(1.0, strength * agg * 1.5);
        const bluffProb = style === 'LAG' ? 0.25 : style === 'FISH' ? 0.15 : style === 'NIT' ? 0.05 : 0.12;

        // Facing a bet
        if (toCall > 0) {
            const potOdds = toCall / (potSize + toCall);

            // Strong hands — raise or call
            if (strength >= 0.8) {
                // Slow play sometimes (strong on safe board)
                if (Math.random() < 0.3 && category !== 'draw') {
                    return { action: 'call', amount: toCall };
                }
                // Raise for value
                const raiseAmt = Math.min(game.currentBet * 2.5, stack + game.bets[seat]);
                if (raiseAmt > game.currentBet && stack > toCall * 2) {
                    return { action: 'raise', amount: raiseAmt };
                }
                return { action: 'call', amount: toCall };
            }

            // Medium hands — call if odds are right
            if (strength >= 0.4) {
                if (strength > potOdds + 0.05) return { action: 'call', amount: toCall };
                // NIT folds medium hands more
                if (style === 'NIT' && strength < 0.55) return { action: 'fold' };
                if (Math.random() < 0.5) return { action: 'call', amount: toCall };
                return { action: 'fold' };
            }

            // Weak hands / draws
            if (strength >= 0.2 && strength > potOdds) {
                // Drawing hand — call with odds
                if (style === 'FISH' || Math.random() < 0.4) return { action: 'call', amount: toCall };
            }

            // Bluff raise occasionally
            if (Math.random() < bluffProb * 0.3 && stack > toCall * 3) {
                const raiseAmt = Math.min(game.currentBet * 2.5, stack + game.bets[seat]);
                return { action: 'raise', amount: raiseAmt };
            }

            return { action: 'fold' };
        }

        // Not facing bet (can check or bet)
        if (strength >= 0.7) {
            // Value bet
            if (Math.random() < betProb) {
                const sizePct = strength >= 0.85 ? 0.66 : 0.33;
                const betAmt = Math.round(potSize * sizePct * 10) / 10;
                if (betAmt >= game.bb && betAmt <= stack) {
                    return { action: 'bet', amount: betAmt };
                }
            }
            return { action: 'check' }; // slowplay
        }

        if (strength >= 0.4) {
            // Medium — mostly check, sometimes bet for thin value
            if (Math.random() < agg * 0.4) {
                const betAmt = Math.round(potSize * 0.33 * 10) / 10;
                if (betAmt >= game.bb && betAmt <= stack) {
                    return { action: 'bet', amount: betAmt };
                }
            }
            return { action: 'check' };
        }

        // Weak — bluff sometimes
        if (Math.random() < bluffProb) {
            const betAmt = Math.round(potSize * 0.5 * 10) / 10;
            if (betAmt >= game.bb && betAmt <= stack) {
                return { action: 'bet', amount: betAmt };
            }
        }
        return { action: 'check' };
    }

    // ============================================================
    // Hand ranking (1=best, 169=worst)
    // ============================================================
    static _handToKey(cards) {
        const rv = { A:14,K:13,Q:12,J:11,T:10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2 };
        const r0 = rv[cards[0].rank], r1 = rv[cards[1].rank];
        const suited = cards[0].suit === cards[1].suit;
        const hi = Math.max(r0, r1), lo = Math.min(r0, r1);
        const ranks = 'AKQJT98765432';
        const h = ranks[14 - hi], l = ranks[14 - lo];
        if (hi === lo) return h + l;
        return h + l + (suited ? 's' : 'o');
    }

    static _getHandRank(handKey) {
        // Simplified hand ranking: 1-169 based on equity vs random
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
