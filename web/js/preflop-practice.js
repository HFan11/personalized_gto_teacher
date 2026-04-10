// ============================================================
// Preflop Practice Module — GTO Preflop Decision Trainer
// Covers: RFI, vs Raise (call/3bet/fold), vs 3bet (call/4bet/fold),
//         vs 4bet (call/5bet-jam/fold)
// ============================================================

// GTO Preflop Ranges by Scenario
// Based on standard 6-max 100bb cash game GTO solutions
const GTO_PREFLOP = {
    // ========== RFI (Raise First In) ==========
    rfi: {
        UTG: ["AA","KK","QQ","JJ","TT","99","88","77","66","AKs","AQs","AJs","ATs","A5s","A4s","KQs","KJs","KTs","QJs","QTs","JTs","T9s","98s","87s","76s","AKo","AQo","AJo","KQo"],
        HJ:  ["AA","KK","QQ","JJ","TT","99","88","77","66","AKs","AQs","AJs","ATs","A9s","A5s","A4s","A3s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","54s","AKo","AQo","AJo","ATo","KQo","KJo"],
        CO:  ["AA","KK","QQ","JJ","TT","99","88","77","66","55","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo","ATo","A9o","KQo","KJo","KTo","QJo","QTo","JTo"],
        BTN: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","85s","76s","75s","74s","65s","64s","54s","53s","43s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","KQo","KJo","KTo","K9o","QJo","QTo","Q9o","JTo","J9o","T9o","T8o","98o","97o","87o","76o"],
        SB:  ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","QJs","QTs","Q9s","Q8s","Q7s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","KQo","KJo","KTo","K9o","QJo","QTo","JTo","J9o","T9o","98o"],
        // BB has no RFI in standard play (already posted)
    },

    // ========== Facing a Raise (3bet / Call / Fold) ==========
    // Key: hero_position, sub-key: vs_villain_position
    vs_raise: {
        HJ: {
            vs_UTG: {
                threebet: ["AA","KK","QQ","AKs","A5s","AKo"],
                call: ["JJ","TT","99","88","AQs","AJs","KQs","QJs","JTs","T9s","98s","87s","76s"]
            }
        },
        CO: {
            vs_UTG: {
                threebet: ["AA","KK","QQ","AKs","A5s","A4s","AKo"],
                call: ["JJ","TT","99","88","AQs","AJs","ATs","KQs","KJs","QJs","QTs","JTs","T9s","98s","87s","76s"]
            },
            vs_HJ: {
                threebet: ["AA","KK","QQ","JJ","AKs","AQs","A5s","A4s","76s","AKo"],
                call: ["TT","99","88","AJs","ATs","KQs","KJs","KTs","QJs","QTs","JTs","J9s","T9s","98s","87s","65s"]
            }
        },
        BTN: {
            vs_UTG: {
                threebet: ["AA","KK","QQ","AKs","A5s","A4s","AKo"],
                call: ["JJ","TT","99","88","77","AQs","AJs","ATs","A9s","KQs","KJs","KTs","QJs","QTs","JTs","T9s","98s","87s","76s","65s"]
            },
            vs_HJ: {
                threebet: ["AA","KK","QQ","JJ","AKs","AQs","A5s","A4s","76s","87s","AKo"],
                call: ["TT","99","88","77","66","AJs","ATs","A9s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","65s","54s"]
            },
            vs_CO: {
                threebet: ["AA","KK","QQ","JJ","TT","AKs","AQs","AJs","A5s","A4s","A3s","76s","87s","65s","AKo","AQo"],
                call: ["99","88","77","66","55","ATs","A9s","A8s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","J8s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","54s","43s"]
            }
        },
        SB: {
            // SB is 3bet or fold (no flatting in GTO)
            vs_UTG: {
                threebet: ["AA","KK","QQ","JJ","AKs","AQs","A5s","A4s","AKo"],
                call: [] // No flat from SB
            },
            vs_HJ: {
                threebet: ["AA","KK","QQ","JJ","TT","AKs","AQs","A5s","A4s","A3s","87s","76s","AKo"],
                call: []
            },
            vs_CO: {
                threebet: ["AA","KK","QQ","JJ","TT","99","AKs","AQs","AJs","A5s","A4s","A3s","A2s","KQs","87s","76s","65s","AKo","AQo"],
                call: []
            },
            vs_BTN: {
                threebet: ["AA","KK","QQ","JJ","TT","99","88","AKs","AQs","AJs","ATs","A9s","A5s","A4s","A3s","A2s","KQs","KJs","K9s","QJs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo"],
                call: []
            }
        },
        BB: {
            vs_UTG: {
                threebet: ["AA","KK","QQ","JJ","AKs","A5s","A4s","AKo"],
                call: ["TT","99","88","77","66","55","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s"]
            },
            vs_HJ: {
                threebet: ["AA","KK","QQ","JJ","TT","AKs","AQs","A5s","A4s","A3s","87s","AKo"],
                call: ["99","88","77","66","55","44","AJs","ATs","A9s","A8s","A7s","A6s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","QJs","QTs","Q9s","Q8s","Q7s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","76s","75s","65s","64s","54s","53s","43s","32s","AQo","AJo","ATo","KQo","KJo","QJo"]
            },
            vs_CO: {
                threebet: ["AA","KK","QQ","JJ","TT","99","AKs","AQs","AJs","A5s","A4s","A3s","A2s","KQs","87s","76s","65s","AKo","AQo"],
                call: ["88","77","66","55","44","33","ATs","A9s","A8s","A7s","A6s","KJs","KTs","K9s","K8s","K7s","K6s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","JTs","J9s","J8s","J7s","J6s","T9s","T8s","T7s","T6s","98s","97s","96s","95s","87s","86s","85s","76s","75s","74s","65s","64s","54s","53s","43s","32s","AJo","ATo","A9o","KQo","KJo","KTo","QJo","QTo","JTo","T9o"]
            },
            vs_BTN: {
                threebet: ["AA","KK","QQ","JJ","TT","99","88","AKs","AQs","AJs","ATs","A9s","A5s","A4s","A3s","A2s","KQs","KJs","K9s","QJs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo"],
                call: ["77","66","55","44","33","22","A8s","A7s","A6s","KTs","K8s","K7s","K6s","K5s","K4s","K3s","K2s","QTs","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s","J8s","J7s","J6s","J5s","J4s","T7s","T6s","96s","95s","86s","85s","84s","74s","73s","63s","62s","52s","42s","32s","ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o","KTo","K9o","K8o","K7o","QTo","Q9o","Q8o","JTo","J9o","J8o","T9o","T8o","98o","97o","87o","76o","65o","54o"]
            },
            vs_SB: {
                threebet: ["AA","KK","QQ","JJ","TT","99","88","77","AKs","AQs","AJs","ATs","A9s","A8s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo","ATo"],
                call: ["66","55","44","33","22","A7s","A6s","K8s","K7s","K6s","K5s","K4s","K3s","K2s","Q8s","Q7s","Q6s","Q5s","Q4s","J8s","J7s","J6s","J5s","T7s","T6s","96s","95s","85s","84s","74s","73s","63s","62s","52s","42s","32s","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o","KTo","K9o","K8o","K7o","K6o","QTo","Q9o","Q8o","Q7o","JTo","J9o","J8o","J7o","T9o","T8o","T7o","98o","97o","96o","87o","86o","76o","75o","65o","64o","54o","53o","43o"]
            }
        }
    },

    // ========== Facing a 3bet (after opening) ==========
    // Key: opener's position
    // AKo is universally a 4bet (not a call) in all positions — solver consensus
    vs_3bet: {
        UTG: {
            fourbet: ["AA","KK","QQ","AKs","AKo","A5s"],
            call: ["JJ","TT","99","AQs","AJs"]
        },
        HJ: {
            fourbet: ["AA","KK","QQ","AKs","AKo","A5s","A4s"],
            call: ["JJ","TT","99","AQs","AJs","ATs","KQs","KJs"]
        },
        CO: {
            fourbet: ["AA","KK","QQ","JJ","AKs","AKo","AQs","A5s","A4s","A3s"],
            call: ["TT","99","88","AJs","ATs","A9s","AQo","KQs","KJs","KTs","QJs","JTs","T9s","98s"]
        },
        BTN: {
            fourbet: ["AA","KK","QQ","JJ","TT","AKs","AKo","AQs","A5s","A4s","A3s","A2s"],
            call: ["99","88","77","AJs","ATs","A9s","AQo","KQs","KJs","KTs","K9s","QJs","QTs","JTs","J9s","T9s","98s","87s","76s"]
        },
        SB: {
            fourbet: ["AA","KK","QQ","JJ","AKs","AKo","AQs","A5s","A4s"],
            call: ["TT","99","AJs","ATs","AQo","KQs","KJs","QJs","JTs","T9s"]
        }
    },

    // ========== Facing a 4bet (after 3betting) ==========
    vs_4bet: {
        fivebet_jam: ["AA","KK","AKs"],
        call: ["QQ","JJ","AKo","AQs"],
    },

    // ========== Pot configurations ==========
    pot_configs: {
        srp: {
            label: '单次加注底池 (SRP)',
            labelShort: 'SRP',
            potSize: 6,        // 2.5bb open + 1 call
            effectiveStack: 97,
            spr: 16.2,
            description: '翻前一次加注被跟注'
        },
        threebet: {
            label: '3bet底池',
            labelShort: '3bet Pot',
            potSize: 22,       // ~9bb 3bet + call
            effectiveStack: 78,
            spr: 3.5,
            description: '翻前3bet被跟注，底池更大SPR更低'
        },
        fourbet: {
            label: '4bet底池',
            labelShort: '4bet Pot',
            potSize: 45,       // ~22bb 4bet + call
            effectiveStack: 55,
            spr: 1.2,
            description: '翻前4bet被跟注，几乎承诺全部筹码'
        }
    }
};

// Preflop action order: UTG acts first, BB acts last
// This is DIFFERENT from postflop order (SB first, BTN last)
const PREFLOP_ORDER = { UTG: 0, HJ: 1, CO: 2, BTN: 3, SB: 4, BB: 5 };

// ============================================================
// Preflop Practice Session
// ============================================================
class PreflopPracticeSession {
    constructor(profileManager) {
        this.pm = profileManager;
        this.score = { correct: 0, total: 0 };
        this.history = [];
        this.currentScenario = null;
    }

    // Generate a random preflop scenario
    generateScenario(heroProfileId, villainProfileId, heroPos, villainPos) {
        const positions = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

        // Pick positions if not specified
        if (!heroPos) heroPos = positions[Math.floor(Math.random() * positions.length)];
        if (!villainPos) {
            const others = positions.filter(p => p !== heroPos);
            villainPos = others[Math.floor(Math.random() * others.length)];
        }

        // Use PREFLOP action order (UTG=0 acts first, BB=5 acts last)
        const heroPre = PREFLOP_ORDER[heroPos];
        const villainPre = PREFLOP_ORDER[villainPos];
        // Postflop order for IP/OOP determination
        const heroOrd = POS_ORDER[heroPos];
        const villainOrd = POS_ORDER[villainPos];

        // Determine scenario type based on position order and legal actions
        // Key principle: 1v1 practice should mostly be facing opponent actions (vs_raise),
        // not just "folded to you" (RFI), because that's the most common and valuable scenario.
        let scenarioType;
        const rand = Math.random();

        // First: determine which scenarios are LEGAL for this position pair
        const canRFI = heroPos !== 'BB'; // BB can't open (already posted)
        const canFaceRaise = villainPre < heroPre; // villain opened before hero
        const canFace3bet = heroPre < villainPre && heroPos !== 'BB'; // hero opened, villain 3bet
        const canFace4bet = villainPre < heroPre; // villain opened, hero 3bet, villain 4bet

        // Build weighted scenario pool (favor vs_raise for 1v1 training)
        const scenarios = [];
        if (canFaceRaise) scenarios.push({ type: 'vs_raise', weight: 60 });
        if (canFace3bet)  scenarios.push({ type: 'vs_3bet',  weight: 35 });
        if (canFace4bet)  scenarios.push({ type: 'vs_4bet',  weight: 20 });
        if (canRFI)       scenarios.push({ type: 'rfi',      weight: 15 });

        // BB special: BB primarily faces raises, can also face 3bet (when BB 3bets and villain 4bets → vs_4bet)
        if (heroPos === 'BB' && scenarios.length === 0) {
            // BB must face a raise from someone
            scenarios.push({ type: 'vs_raise', weight: 100 });
        }

        // Fallback if no valid scenarios
        if (scenarios.length === 0) {
            scenarios.push({ type: 'rfi', weight: 100 });
        }

        // Weighted random selection
        const totalWeight = scenarios.reduce((s, sc) => s + sc.weight, 0);
        let pick = rand * totalWeight;
        scenarioType = scenarios[scenarios.length - 1].type;
        for (const sc of scenarios) {
            pick -= sc.weight;
            if (pick <= 0) { scenarioType = sc.type; break; }
        }

        // Deal hero a hand — for vs_3bet/vs_4bet, filter to plausible hands
        const deck = shuffleDeck(fullDeck());
        let heroCards, heroHandKey;

        if (scenarioType === 'vs_3bet' || scenarioType === 'vs_4bet') {
            // Hero must have opened (vs_3bet) or 3-bet (vs_4bet)
            // Only deal hands that would be in that range
            const plausibleHands = this._getPlausibleHands(scenarioType, heroPos, villainPos);
            if (plausibleHands.length > 0) {
                // Pick a random plausible hand and find matching cards in deck
                const targetKey = plausibleHands[Math.floor(Math.random() * plausibleHands.length)];
                heroCards = this._findCardsForHand(targetKey, deck);
                heroHandKey = targetKey;
            } else {
                heroCards = [deck.pop(), deck.pop()];
                heroHandKey = this._handToKey(heroCards);
            }
        } else {
            heroCards = [deck.pop(), deck.pop()];
            heroHandKey = this._handToKey(heroCards);
        }

        // Get correct action based on GTO ranges
        const correctActions = this._getCorrectAction(scenarioType, heroPos, villainPos, heroHandKey);

        // Build scenario description
        const scenarioDesc = this._buildDescription(scenarioType, heroPos, villainPos);

        this.currentScenario = {
            type: scenarioType,
            heroPos,
            villainPos,
            heroCards,
            heroHandKey,
            correctActions,
            description: scenarioDesc,
            heroIsIP: heroOrd > villainOrd, // Postflop IP/OOP
            // Available actions for this scenario
            availableActions: this._getAvailableActions(scenarioType),
        };

        return this.currentScenario;
    }

    _getCorrectAction(type, heroPos, villainPos, handKey) {
        // Try CFR solver first
        const cfrResult = this._getCFRAction(type, heroPos, villainPos, handKey);
        if (cfrResult) return cfrResult;

        // Fallback to static ranges
        return this._getStaticAction(type, heroPos, villainPos, handKey);
    }

    // CFR+ solver-based preflop action
    _getCFRAction(type, heroPos, villainPos, handKey) {
        try {
            // Ensure preflop solver is initialized
            if (!this._preflopSolver) {
                this._preflopSolver = PreflopSolver.getInstance();
                if (!this._preflopSolver.solved) {
                    console.time('Preflop CFR+ solve');
                    this._preflopSolver.solve({ iterations: 50 });
                    console.timeEnd('Preflop CFR+ solve');
                }
            }

            // Map scenario type to solver scenario
            let scenario;
            switch (type) {
                case 'rfi': scenario = 'rfi'; break;
                case 'vs_raise': scenario = 'vs_raise'; break;
                case 'vs_3bet': scenario = 'vs_3bet'; break;
                case 'vs_4bet': scenario = 'vs_4bet'; break;
                default: return null;
            }

            const strategy = this._preflopSolver.getStrategy(heroPos, handKey, scenario, villainPos);
            if (!strategy) return null;

            // Convert solver output to action format
            const actions = [];
            const actionLabels = {
                fold: { label: 'fold', cn: '弃牌' },
                raise: { label: 'raise', cn: '加注' },
                call: { label: 'call', cn: '跟注' },
                '3bet': { label: '3bet', cn: '3bet' },
                '4bet': { label: '4bet', cn: '4bet' },
                jam: { label: '5bet-jam', cn: '全压' },
            };

            for (const [action, freq] of Object.entries(strategy)) {
                const pct = Math.round(freq * 100);
                if (pct < 2) continue;

                const label = actionLabels[action] || { label: action, cn: action };
                actions.push({
                    action: label.label,
                    frequency: pct,
                    reasoning: this._buildPreflopReasoning(handKey, heroPos, villainPos, label.label, pct, scenario),
                });
            }

            if (actions.length === 0) return null;

            // Normalize
            const total = actions.reduce((s, a) => s + a.frequency, 0);
            if (total > 0 && total !== 100) {
                actions.forEach(a => a.frequency = Math.round(a.frequency / total * 100));
                const roundedTotal = actions.reduce((s, a) => s + a.frequency, 0);
                if (roundedTotal !== 100 && actions.length > 0) {
                    actions[0].frequency += (100 - roundedTotal);
                }
            }

            return actions.sort((a, b) => b.frequency - a.frequency);
        } catch (e) {
            console.warn('Preflop CFR solver failed:', e);
            return null;
        }
    }

    // Static range-based preflop action (legacy fallback)
    _getStaticAction(type, heroPos, villainPos, handKey) {
        switch (type) {
            case 'rfi': {
                const rfiRange = GTO_PREFLOP.rfi[heroPos] || [];
                if (rfiRange.includes(handKey)) {
                    return [{ action: 'raise', frequency: 100, reasoning: `${handKey}在${heroPos}的RFI范围内，应该加注开池。` }];
                }
                return [{ action: 'fold', frequency: 100, reasoning: `${handKey}不在${heroPos}的RFI范围内(${rfiRange.length}种)，应该弃牌。` }];
            }
            case 'vs_raise': {
                const ranges = GTO_PREFLOP.vs_raise[heroPos]?.['vs_' + villainPos];
                if (!ranges) {
                    return this._simplifiedVsRaise(heroPos, villainPos, handKey);
                }
                const in3bet = ranges.threebet.includes(handKey);
                const inCall = ranges.call.includes(handKey);
                if (in3bet && inCall) {
                    return [
                        { action: '3bet', frequency: 60, reasoning: `${handKey}可以3bet也可以跟注，偏向3bet获取主动权。` },
                        { action: 'call', frequency: 40, reasoning: `偶尔选择跟注以平衡范围。` }
                    ];
                }
                if (in3bet) return [{ action: '3bet', frequency: 100, reasoning: `${handKey}在${heroPos} vs ${villainPos}的3bet范围内。` }];
                if (inCall) return [{ action: 'call', frequency: 100, reasoning: `${handKey}在${heroPos} vs ${villainPos}的跟注范围内。` }];
                return [{ action: 'fold', frequency: 100, reasoning: `${handKey}不在${heroPos}对抗${villainPos}开池的防守范围内。` }];
            }
            case 'vs_3bet': {
                const ranges = GTO_PREFLOP.vs_3bet[heroPos];
                if (!ranges) {
                    return [{ action: 'fold', frequency: 70, reasoning: `面对3bet，大部分范围应弃牌。` },
                            { action: 'call', frequency: 30, reasoning: '部分手牌可以跟注。' }];
                }
                if (ranges.fourbet.includes(handKey)) return [{ action: '4bet', frequency: 100, reasoning: `${handKey}在4bet范围内。` }];
                if (ranges.call.includes(handKey)) return [{ action: 'call', frequency: 100, reasoning: `${handKey}在跟注范围内。` }];
                return [{ action: 'fold', frequency: 100, reasoning: `${handKey}不在防守范围内。` }];
            }
            case 'vs_4bet': {
                const ranges = GTO_PREFLOP.vs_4bet;
                if (ranges.fivebet_jam.includes(handKey)) return [{ action: '5bet-jam', frequency: 100, reasoning: `${handKey}面对4bet应全压。` }];
                if (ranges.call.includes(handKey)) return [{ action: 'call', frequency: 100, reasoning: `${handKey}面对4bet可以跟注。` }];
                return [{ action: 'fold', frequency: 100, reasoning: `${handKey}面对4bet应弃牌。` }];
            }
            default:
                return [{ action: 'fold', frequency: 100, reasoning: '未知场景。' }];
        }
    }

    _simplifiedVsRaise(heroPos, villainPos, handKey) {
        // Simplified logic when exact ranges not defined
        const premiumHands = ["AA","KK","QQ","JJ","AKs","AKo"];
        const strongHands = ["TT","99","AQs","AJs","KQs","AQo"];
        const playableHands = ["88","77","66","ATs","A9s","A5s","A4s","KJs","KTs","QJs","QTs","JTs","T9s","98s","87s","76s","65s","54s","KQo","AJo"];

        if (premiumHands.includes(handKey)) {
            return [{ action: '3bet', frequency: 100, reasoning: `${handKey}是高级手牌，在任何位置都应3bet。` }];
        }
        if (strongHands.includes(handKey)) {
            return [
                { action: '3bet', frequency: 40, reasoning: `${handKey}可混合3bet/跟注。` },
                { action: 'call', frequency: 60, reasoning: `跟注看翻牌也可行。` }
            ];
        }
        if (playableHands.includes(handKey)) {
            return [{ action: 'call', frequency: 100, reasoning: `${handKey}有足够的隐含赔率跟注。` }];
        }
        return [{ action: 'fold', frequency: 100, reasoning: `${handKey}不值得防守。` }];
    }

    // Build professional poker reasoning for preflop decisions
    _buildPreflopReasoning(handKey, heroPos, villainPos, action, freq, scenario) {
        const rv = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
        const r1 = rv[handKey[0]], r2 = rv[handKey[1] || handKey[0]];
        const isPair = handKey.length === 2;
        const isSuited = handKey.endsWith('s');
        const high = Math.max(r1, r2), low = Math.min(r1, r2);
        const gap = high - low;
        const hasAce = high === 14;
        const hasBroadway = high >= 10 && low >= 10;
        const isConnected = gap <= 1 || (high === 14 && low === 2);

        // Position analysis
        const heroOrd = POS_ORDER[heroPos] || 0;
        const villainOrd = POS_ORDER[villainPos] || 0;
        const heroIsIP = heroOrd > villainOrd;
        const posLabel = heroIsIP ? '有位置优势' : '无位置劣势';

        // Villain range width estimate (based on position)
        const rangeWidths = { UTG: 15, HJ: 18, CO: 25, BTN: 40, SB: 35, BB: 100 };
        const villainWidth = rangeWidths[villainPos] || 25;

        // Blocker analysis
        const blockers = [];
        if (hasAce) blockers.push('阻断AA/AK');
        if (high === 13) blockers.push('阻断KK/AK');
        if (high === 12) blockers.push('阻断QQ');
        const blockerText = blockers.length > 0 ? blockers.join('，') + '。' : '';

        // Hand strength tier
        let tierText;
        if (isPair && high >= 10) tierText = '超强对子';
        else if (isPair && high >= 7) tierText = '中等对子';
        else if (isPair) tierText = '小对子';
        else if (hasAce && isSuited && low >= 10) tierText = '同花高牌';
        else if (hasBroadway && isSuited) tierText = '同花百老汇';
        else if (hasAce && isSuited) tierText = '同花A';
        else if (hasBroadway) tierText = '百老汇牌';
        else if (isSuited && isConnected) tierText = '同花连牌';
        else if (isSuited) tierText = '同花牌';
        else tierText = '普通牌';

        // Build reasoning by scenario + action
        let reason = '';

        if (scenario === 'rfi') {
            if (action === 'raise') {
                reason = `${handKey}(${tierText})在${heroPos}开池加注(${freq}%)。`;
                if (isPair && high >= 10) reason += `大对子在任何位置都是强开池手牌。`;
                else if (isSuited && isConnected) reason += `同花连牌翻后可做性强，${heroPos}位置范围足够宽。`;
                else if (hasAce && isSuited) reason += `同花A有坚果同花潜力和阻断效应。${blockerText}`;
                else reason += `在${heroPos}范围内，翻后有足够的可玩性。`;
            } else {
                reason = `${handKey}(${tierText})在${heroPos}弃牌(${freq}%)。手牌不在${heroPos}的开池范围内，翻后可玩性不足。`;
            }
        } else if (scenario === 'vs_raise') {
            const villainRangeDesc = `${villainPos}开池范围约${villainWidth}%`;
            if (action === '3bet') {
                reason = `面对${villainPos}开池，${handKey}(${tierText})3-Bet(${freq}%)。${blockerText}`;
                if (heroIsIP) reason += `${posLabel}，3-Bet获取主动权并建立底池。`;
                else reason += `${posLabel}，但3-Bet可以夺回主动权。`;
                reason += `${villainRangeDesc}，你的${handKey}属于对抗范围顶部。`;
            } else if (action === 'call') {
                reason = `面对${villainPos}开池，${handKey}(${tierText})跟注(${freq}%)。`;
                if (heroIsIP) reason += `${posLabel}，跟注看翻牌实现隐含赔率。`;
                else reason += `手牌有足够权益跟注但不适合3-Bet(避免膨胀底池)。`;
                reason += `${villainRangeDesc}。`;
            } else {
                reason = `面对${villainPos}开池，${handKey}(${tierText})弃牌(${freq}%)。${villainRangeDesc}，${handKey}权益不足以防守。`;
            }
        } else if (scenario === 'vs_3bet') {
            if (action === '4bet') {
                reason = `面对3-Bet，${handKey}(${tierText})4-Bet(${freq}%)。${blockerText}`;
                reason += isPair && high >= 12 ? '顶级手牌直接4-Bet获取价值。' : '作为半诈唬4-Bet平衡范围。';
            } else if (action === 'call') {
                reason = `面对3-Bet，${handKey}(${tierText})跟注(${freq}%)。手牌够强但不适合4-Bet(避免面对5-Bet困境)。`;
                if (isSuited) reason += '同花属性提供额外翻后权益。';
            } else {
                reason = `面对3-Bet，${handKey}(${tierText})弃牌(${freq}%)。对手3-Bet范围很强(约8-12%)，${handKey}权益不足。`;
            }
        } else if (scenario === 'vs_4bet') {
            if (action === 'jam' || action === '5bet-jam') {
                reason = `面对4-Bet，${handKey}(${tierText})全压(${freq}%)。${blockerText}底池已很大，SPR极低，承诺筹码是最优选择。`;
            } else if (action === 'call') {
                reason = `面对4-Bet，${handKey}(${tierText})跟注(${freq}%)。手牌够强跟注但全压风险太高(对手4-Bet范围极强)。`;
            } else {
                reason = `面对4-Bet，${handKey}(${tierText})弃牌(${freq}%)。对手4-Bet范围极窄(约3-5%)，${handKey}权益严重不足。`;
            }
        }

        return reason;
    }

    _getAvailableActions(type) {
        switch (type) {
            case 'rfi': return ['raise', 'fold'];
            case 'vs_raise': return ['3bet', 'call', 'fold'];
            case 'vs_3bet': return ['4bet', 'call', 'fold'];
            case 'vs_4bet': return ['5bet-jam', 'call', 'fold'];
            default: return ['fold'];
        }
    }

    _buildDescription(type, heroPos, villainPos) {
        const ipLabel = POS_ORDER[heroPos] > POS_ORDER[villainPos] ? '(IP 有位置)' : '(OOP 无位置)';
        const typeLabels = {
            rfi: `你在${heroPos}，前面所有人弃牌，你应该？`,
            vs_raise: `${villainPos}加注开池(2.5BB)，你在${heroPos} ${ipLabel}，你应该？`,
            vs_3bet: `你在${heroPos}加注开池(2.5BB)，${villainPos} 3-Bet到8BB ${ipLabel}，你应该？`,
            vs_4bet: `${villainPos}加注开池，你3-Bet到8BB，${villainPos} 4-Bet到22BB ${ipLabel}，你应该？`,
        };
        return typeLabels[type] || '选择你的行动';
    }

    // Process player's answer
    processAnswer(action) {
        if (!this.currentScenario) return null;

        const scenario = this.currentScenario;
        const correct = scenario.correctActions;
        const bestAction = correct[0].action;

        // Normalize action matching
        function normalize(a) {
            if (a === 'raise' && scenario.type === 'rfi') return 'raise';
            if (a === '3bet') return '3bet';
            if (a === '4bet') return '4bet';
            if (a === '5bet-jam') return '5bet-jam';
            return a;
        }

        const normalizedPlayer = normalize(action);
        let matchedFreq = 0;
        for (const c of correct) {
            if (normalize(c.action) === normalizedPlayer) {
                matchedFreq += c.frequency;
            }
        }

        // Score: best action (highest freq) gets 100, others scale proportionally
        const bestFreq = correct[0].frequency;
        let score;
        if (matchedFreq >= bestFreq) {
            score = 100; // Chose the top recommended action → perfect score
        } else if (matchedFreq > 0) {
            // Scale relative to best: 40% freq vs 60% best → 0.2 + 0.8*(40/60) ≈ 73
            score = Math.round((0.2 + 0.8 * (matchedFreq / bestFreq)) * 100);
        } else {
            score = 0; // Action not in recommendations
        }

        this.score.total++;
        if (!this.score.totalPoints) this.score.totalPoints = 0;
        this.score.totalPoints += score;

        const qualityScore = score / 100;
        const result = {
            score,
            qualityScore,
            matchedFrequency: matchedFreq,
            correctActions: correct,
            bestAction,
            heroHandKey: scenario.heroHandKey,
            scenarioType: scenario.type,
        };

        this.history.push(result);
        return result;
    }

    // Get plausible hands for a scenario (hands that would actually be in this spot)
    _getPlausibleHands(scenarioType, heroPos, villainPos) {
        if (scenarioType === 'vs_3bet') {
            // Hero opened → only hands in hero's RFI range
            return GTO_PREFLOP.rfi[heroPos] || [];
        }
        if (scenarioType === 'vs_4bet') {
            // Hero 3-bet → only hands in hero's 3bet range
            const vsRaise = GTO_PREFLOP.vs_raise[heroPos];
            if (vsRaise) {
                const key = 'vs_' + villainPos;
                const data = vsRaise[key];
                if (data) return [...(data.threebet || []), ...(data.call || [])];
            }
            // Fallback: use a reasonable 3bet range
            return ['AA','KK','QQ','JJ','TT','AKs','AKo','AQs','AJs','KQs','A5s','A4s'];
        }
        return [];
    }

    // Find cards in deck that match a canonical hand key
    _findCardsForHand(handKey, deck) {
        const suits = ['♠', '♥', '♦', '♣'];
        const r1 = handKey[0];
        const r2 = handKey.length >= 2 ? handKey[1] : r1;
        const isPair = handKey.length === 2;
        const isSuited = handKey.endsWith('s');

        if (isPair) {
            // Find two cards of same rank
            const s1 = suits[Math.floor(Math.random() * 4)];
            let s2 = suits[Math.floor(Math.random() * 4)];
            while (s2 === s1) s2 = suits[Math.floor(Math.random() * 4)];
            return [makeCard(r1, s1), makeCard(r2, s2)];
        }
        if (isSuited) {
            const s = suits[Math.floor(Math.random() * 4)];
            return [makeCard(r1, s), makeCard(r2, s)];
        }
        // Offsuit
        const s1 = suits[Math.floor(Math.random() * 4)];
        let s2 = suits[Math.floor(Math.random() * 4)];
        while (s2 === s1) s2 = suits[Math.floor(Math.random() * 4)];
        return [makeCard(r1, s1), makeCard(r2, s2)];
    }

    _handToKey(hand) {
        const r1 = hand[0].rank, r2 = hand[1].rank;
        const rv1 = RANK_VALUES[r1], rv2 = RANK_VALUES[r2];
        const suited = hand[0].suit === hand[1].suit;
        if (rv1 === rv2) return r1 + r2;
        if (rv1 > rv2) return r1 + r2 + (suited ? 's' : 'o');
        return r2 + r1 + (suited ? 's' : 'o');
    }

    getScore() { return this.score; }
    resetScore() { this.score = { correct: 0, total: 0 }; this.history = []; }
}

// ============================================================
// Postflop Pot Configuration Helper
// Returns adjusted ranges for villain based on pot type and action tree
// ============================================================
function getVillainPostflopRange(pm, villainProfileId, villainPos, potType, isAggressor) {
    const profile = pm.getById(villainProfileId);
    if (!profile) return [];

    const baseRange = pm.getRange(villainProfileId, villainPos);

    switch (potType) {
        case 'srp':
            // SRP: villain has their full position range (as caller or opener)
            return baseRange;

        case 'threebet': {
            // 3bet pot: narrow to 3bet or calling-3bet range
            if (isAggressor) {
                // Villain was the 3bettor — use tight 3bet range
                // Approximate: top ~15-20% of their range
                const threebet3betRange = _approximate3betRange(baseRange, profile.style);
                return threebet3betRange;
            } else {
                // Villain called the 3bet — use call-vs-3bet range
                const callVs3betRange = _approximateCallVs3betRange(baseRange, profile.style);
                return callVs3betRange;
            }
        }

        case 'fourbet': {
            // 4bet pot: very narrow ranges
            if (isAggressor) {
                // Villain 4bet — very tight
                return _approximate4betRange(profile.style);
            } else {
                // Villain called the 4bet
                return _approximateCallVs4betRange(profile.style);
            }
        }

        default:
            return baseRange;
    }
}

function _approximate3betRange(baseRange, style) {
    // Approximate 3bet range based on style
    const tight3bet = ["AA","KK","QQ","JJ","AKs","AQs","A5s","A4s","AKo"];
    const standard3bet = ["AA","KK","QQ","JJ","TT","AKs","AQs","AJs","A5s","A4s","A3s","KQs","87s","76s","65s","AKo","AQo"];
    const wide3bet = ["AA","KK","QQ","JJ","TT","99","88","AKs","AQs","AJs","ATs","A9s","A5s","A4s","A3s","A2s","KQs","KJs","K9s","QJs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","54s","43s","AKo","AQo","AJo"];

    switch (style) {
        case 'NIT': return tight3bet.filter(h => baseRange.includes(h));
        case 'LAG': return wide3bet.filter(h => baseRange.includes(h));
        case 'FISH': return tight3bet.slice(0, 5); // Fish rarely 3bet
        default: return standard3bet.filter(h => baseRange.includes(h));
    }
}

function _approximateCallVs3betRange(baseRange, style) {
    const standardCall = ["JJ","TT","99","88","AQs","AJs","ATs","AKo","KQs","KJs","QJs","JTs","T9s","98s"];
    const wideCall = ["JJ","TT","99","88","77","66","AQs","AJs","ATs","A9s","AKo","AQo","KQs","KJs","KTs","QJs","QTs","JTs","J9s","T9s","98s","87s","76s"];
    const fishCall = [...standardCall, ...["77","66","55","44","33","22","A9s","A8s","A7s","A6s","A5s","KTs","K9s","QTs","Q9s","T8s","97s","87s","86s","76s","65s","54s","AJo","ATo","KQo","KJo","QJo","JTo"]];

    switch (style) {
        case 'NIT': return ["QQ","JJ","TT","AKo","AQs"];
        case 'FISH': return fishCall.filter(h => baseRange.includes(h));
        case 'LAG': return wideCall.filter(h => baseRange.includes(h));
        default: return standardCall.filter(h => baseRange.includes(h));
    }
}

function _approximate4betRange(style) {
    switch (style) {
        case 'NIT': return ["AA","KK"];
        case 'LAG': return ["AA","KK","QQ","JJ","AKs","AQs","A5s","A4s","AKo","KQs"];
        case 'FISH': return ["AA","KK","QQ","AKs"];
        default: return ["AA","KK","QQ","AKs","A5s","AKo"];
    }
}

function _approximateCallVs4betRange(style) {
    switch (style) {
        case 'NIT': return ["AA","KK","QQ","AKs"];
        case 'LAG': return ["QQ","JJ","TT","AKo","AQs","AJs","KQs"];
        case 'FISH': return ["QQ","JJ","TT","99","AKo","AQs","AQo","AJs","KQs"];
        default: return ["QQ","JJ","AKo","AQs"];
    }
}
