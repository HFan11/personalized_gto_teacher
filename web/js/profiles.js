// ============================================================
// Player Profiles - Preflop Habits by Position
// ============================================================

// Range format: array of hand strings like "AA", "AKs", "AKo"
// Each profile defines RFI (raise first in) range per position
// BB uses 'defend' range (call + 3bet vs raise) instead of RFI

const DEFAULT_PROFILES = [
    {
        id: 'gto-balanced',
        name: 'GTO平衡型',
        avatar: '🤖',
        description: '接近GTO的平衡打法，各位置范围合理，很难被剥削',
        style: 'TAG',
        vpip: 23,
        pfr: 19,
        color: '#3498db',
        ranges: {
            UTG: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","AKs","AQs","AJs","ATs","A5s","A4s","KQs","KJs","KTs","QJs","QTs","JTs","T9s","98s","87s","76s","AKo","AQo","AJo","KQo"],
            },
            HJ: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","AKs","AQs","AJs","ATs","A9s","A5s","A4s","A3s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","54s","AKo","AQo","AJo","ATo","KQo","KJo"],
            },
            CO: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo","ATo","A9o","KQo","KJo","KTo","QJo","QTo","JTo"],
            },
            BTN: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","85s","76s","75s","74s","65s","64s","54s","53s","43s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","KQo","KJo","KTo","K9o","QJo","QTo","Q9o","JTo","J9o","T9o","T8o","98o","97o","87o","76o"],
            },
            SB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","QJs","QTs","Q9s","Q8s","Q7s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A5o","KQo","KJo","KTo","K9o","QJo","QTo","JTo","J9o","T9o","98o"],
            },
            BB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s","JTs","J9s","J8s","J7s","J6s","J5s","J4s","T9s","T8s","T7s","T6s","98s","97s","96s","95s","87s","86s","85s","76s","75s","74s","65s","64s","63s","54s","53s","43s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o","KQo","KJo","KTo","K9o","K8o","K7o","QJo","QTo","Q9o","Q8o","JTo","J9o","J8o","T9o","T8o","98o","97o","87o","76o","65o","54o"],
            }
        }
    },
    {
        id: 'tight-nit',
        name: '紧凶岩石',
        avatar: '🪨',
        description: '非常紧的玩家，只玩优质起手牌，很少诈唬，加注代表强牌',
        style: 'NIT',
        vpip: 12,
        pfr: 10,
        color: '#95a5a6',
        ranges: {
            UTG: {
                rfi: ["AA","KK","QQ","JJ","TT","AKs","AQs","AKo"],
            },
            HJ: {
                rfi: ["AA","KK","QQ","JJ","TT","99","AKs","AQs","AJs","KQs","AKo","AQo"],
            },
            CO: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","AKs","AQs","AJs","ATs","KQs","KJs","QJs","AKo","AQo","AJo","KQo"],
            },
            BTN: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","AKs","AQs","AJs","ATs","A9s","KQs","KJs","KTs","QJs","QTs","JTs","T9s","AKo","AQo","AJo","ATo","KQo","KJo","QJo"],
            },
            SB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","AKs","AQs","AJs","ATs","KQs","KJs","QJs","JTs","AKo","AQo","AJo","KQo"],
            },
            BB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","AKs","AQs","AJs","ATs","A9s","A8s","A5s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","98s","87s","76s","65s","AKo","AQo","AJo","ATo","KQo","KJo"],
            }
        }
    },
    {
        id: 'loose-aggressive',
        name: '松凶疯子',
        avatar: '🔥',
        description: '极其松凶的玩家，范围很宽，频繁加注和3-bet，喜欢施加压力',
        style: 'LAG',
        vpip: 35,
        pfr: 28,
        color: '#e74c3c',
        ranges: {
            UTG: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","AKs","AQs","AJs","ATs","A9s","A8s","A5s","A4s","A3s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","54s","AKo","AQo","AJo","ATo","KQo","KJo","QJo"],
            },
            HJ: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo","ATo","A9o","KQo","KJo","KTo","QJo","QTo","JTo"],
            },
            CO: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","QJs","QTs","Q9s","Q8s","Q7s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","85s","76s","75s","74s","65s","64s","54s","53s","43s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","KQo","KJo","KTo","K9o","QJo","QTo","Q9o","JTo","J9o","T9o","98o","87o"],
            },
            BTN: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","JTs","J9s","J8s","J7s","J6s","T9s","T8s","T7s","T6s","98s","97s","96s","95s","87s","86s","85s","76s","75s","74s","65s","64s","63s","54s","53s","43s","42s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o","KQo","KJo","KTo","K9o","K8o","QJo","QTo","Q9o","Q8o","JTo","J9o","J8o","T9o","T8o","98o","97o","87o","86o","76o","65o"],
            },
            SB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","85s","76s","75s","74s","65s","64s","54s","53s","43s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","KQo","KJo","KTo","K9o","K8o","QJo","QTo","Q9o","JTo","J9o","T9o","98o","87o"],
            },
            BB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s","JTs","J9s","J8s","J7s","J6s","J5s","J4s","J3s","J2s","T9s","T8s","T7s","T6s","T5s","98s","97s","96s","95s","87s","86s","85s","84s","76s","75s","74s","65s","64s","63s","54s","53s","52s","43s","42s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o","KQo","KJo","KTo","K9o","K8o","K7o","K6o","QJo","QTo","Q9o","Q8o","Q7o","JTo","J9o","J8o","J7o","T9o","T8o","T7o","98o","97o","96o","87o","86o","76o","75o","65o","64o","54o","53o","43o"],
            }
        }
    },
    {
        id: 'calling-station',
        name: '跟注站',
        avatar: '📞',
        description: '被动的鱼玩家，喜欢跟注很少加注，几乎不弃牌，总想看到摊牌',
        style: 'FISH',
        vpip: 45,
        pfr: 8,
        color: '#f39c12',
        ranges: {
            UTG: {
                rfi: ["AA","KK","QQ","JJ","TT","AKs","AKo"],
                limp: ["99","88","77","66","55","44","33","22","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","KQo","KJo","KTo","K9o","QJo","QTo","Q9o","JTo","J9o","T9o","98o","87o","76o"],
            },
            HJ: {
                rfi: ["AA","KK","QQ","JJ","TT","99","AKs","AQs","AKo"],
                limp: ["88","77","66","55","44","33","22","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AQo","AJo","ATo","A9o","A8o","A7o","KQo","KJo","KTo","K9o","QJo","QTo","JTo","J9o","T9o","98o","87o","76o"],
            },
            CO: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","AKs","AQs","AJs","KQs","AKo","AQo"],
                limp: ["77","66","55","44","33","22","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KJs","KTs","K9s","K8s","K7s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AJo","ATo","A9o","A8o","A7o","KQo","KJo","KTo","K9o","QJo","QTo","Q9o","JTo","J9o","T9o","98o","87o","76o"],
            },
            BTN: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","AKs","AQs","AJs","ATs","KQs","KJs","QJs","AKo","AQo","AJo","KQo"],
                limp: ["66","55","44","33","22","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KTs","K9s","K8s","K7s","K6s","QTs","Q9s","Q8s","Q7s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","76s","75s","65s","64s","54s","53s","43s","ATo","A9o","A8o","A7o","A6o","A5o","KJo","KTo","K9o","QJo","QTo","Q9o","JTo","J9o","T9o","98o","97o","87o","76o","65o","54o"],
            },
            SB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","AKs","AQs","AKo","AQo"],
                limp: ["88","77","66","55","44","33","22","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","98s","87s","76s","65s","54s","AJo","ATo","A9o","KQo","KJo","KTo","QJo","JTo"],
            },
            BB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s","JTs","J9s","J8s","J7s","J6s","J5s","J4s","J3s","J2s","T9s","T8s","T7s","T6s","T5s","T4s","98s","97s","96s","95s","94s","87s","86s","85s","84s","76s","75s","74s","73s","65s","64s","63s","62s","54s","53s","52s","43s","42s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o","KQo","KJo","KTo","K9o","K8o","K7o","K6o","K5o","K4o","QJo","QTo","Q9o","Q8o","Q7o","Q6o","Q5o","JTo","J9o","J8o","J7o","J6o","T9o","T8o","T7o","T6o","98o","97o","96o","87o","86o","85o","76o","75o","65o","64o","54o","53o","43o"],
            }
        }
    },
    {
        id: 'shark-pro',
        name: '职业鲨鱼',
        avatar: '🦈',
        description: '高水平职业玩家，范围精确，根据对手调整策略，善于读牌和诈唬',
        style: 'REG',
        vpip: 25,
        pfr: 21,
        color: '#2c3e50',
        ranges: {
            UTG: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","AKs","AQs","AJs","ATs","A5s","A4s","KQs","KJs","KTs","QJs","QTs","JTs","T9s","98s","87s","76s","65s","AKo","AQo","AJo","KQo"],
            },
            HJ: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","AKs","AQs","AJs","ATs","A9s","A8s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","T8s","98s","97s","87s","86s","76s","75s","65s","54s","AKo","AQo","AJo","ATo","KQo","KJo"],
            },
            CO: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","T7s","98s","97s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo","ATo","A9o","KQo","KJo","KTo","QJo","QTo","JTo"],
            },
            BTN: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","JTs","J9s","J8s","J7s","J6s","T9s","T8s","T7s","98s","97s","96s","87s","86s","85s","76s","75s","74s","65s","64s","54s","53s","43s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","KQo","KJo","KTo","K9o","K8o","QJo","QTo","Q9o","JTo","J9o","T9o","T8o","98o","97o","87o","76o"],
            },
            SB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","QJs","QTs","Q9s","Q8s","Q7s","JTs","J9s","J8s","J7s","T9s","T8s","T7s","98s","97s","96s","87s","86s","76s","75s","65s","64s","54s","53s","43s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A5o","KQo","KJo","KTo","K9o","QJo","QTo","JTo","J9o","T9o","98o"],
            },
            BB: {
                rfi: ["AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s","JTs","J9s","J8s","J7s","J6s","J5s","T9s","T8s","T7s","T6s","98s","97s","96s","95s","87s","86s","85s","76s","75s","74s","65s","64s","63s","54s","53s","43s","32s","AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o","KQo","KJo","KTo","K9o","K8o","K7o","QJo","QTo","Q9o","Q8o","JTo","J9o","J8o","T9o","T8o","98o","97o","87o","76o","65o","54o"],
            }
        }
    }
];

// ============================================================
// Profile Manager
// ============================================================

class ProfileManager {
    constructor() {
        this.profiles = [];
        this.loadProfiles();
    }

    loadProfiles() {
        const saved = localStorage.getItem('poker_profiles');
        if (saved) {
            try {
                this.profiles = JSON.parse(saved);
                // Migrate: fill empty BB ranges from defaults
                for (const p of this.profiles) {
                    const def = DEFAULT_PROFILES.find(d => d.id === p.id);
                    if (def && p.ranges?.BB && (!p.ranges.BB.rfi || p.ranges.BB.rfi.length === 0)) {
                        if (def.ranges?.BB?.rfi?.length > 0) {
                            p.ranges.BB.rfi = [...def.ranges.BB.rfi];
                        }
                    }
                    // Migrate: add limp ranges from defaults if missing
                    if (def && p.ranges) {
                        for (const pos of ['UTG','HJ','CO','BTN','SB','BB']) {
                            if (p.ranges[pos] && !p.ranges[pos].limp && def.ranges?.[pos]?.limp) {
                                p.ranges[pos].limp = [...def.ranges[pos].limp];
                            }
                        }
                    }
                }
                this.saveProfiles();
            } catch (e) {
                this.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
            }
        } else {
            this.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
        }
    }

    saveProfiles() {
        localStorage.setItem('poker_profiles', JSON.stringify(this.profiles));
    }

    getAll() {
        return this.profiles;
    }

    getById(id) {
        return this.profiles.find(p => p.id === id);
    }

    add(profile) {
        if (!profile.id) profile.id = 'custom-' + Date.now();
        this.profiles.push(profile);
        this.saveProfiles();
    }

    update(id, updates) {
        const idx = this.profiles.findIndex(p => p.id === id);
        if (idx >= 0) {
            this.profiles[idx] = { ...this.profiles[idx], ...updates };
            this.saveProfiles();
        }
    }

    remove(id) {
        this.profiles = this.profiles.filter(p => p.id !== id);
        this.saveProfiles();
    }

    duplicate(id) {
        const p = this.getById(id);
        if (p) {
            const copy = JSON.parse(JSON.stringify(p));
            copy.id = 'custom-' + Date.now();
            copy.name = copy.name + ' (副本)';
            this.profiles.push(copy);
            this.saveProfiles();
            return copy;
        }
        return null;
    }

    resetToDefaults() {
        this.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
        this.saveProfiles();
    }

    // Get the preflop raise range for a specific profile and position
    getRange(profileId, position) {
        const p = this.getById(profileId);
        if (!p || !p.ranges[position]) return [];
        return p.ranges[position].rfi || [];
    }

    // Get the preflop limp range for a specific profile and position
    getLimpRange(profileId, position) {
        const p = this.getById(profileId);
        if (!p || !p.ranges[position]) return [];
        return p.ranges[position].limp || [];
    }

    // Convert range strings to actual card pairs for equity calculation
    rangeToHands(rangeStrings) {
        const hands = [];
        const allRanks = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

        for (const str of rangeStrings) {
            if (str.length === 2) {
                // Pair: "AA"
                const rank = str[0];
                const suits = ['♠','♥','♦','♣'];
                for (let i = 0; i < 4; i++) {
                    for (let j = i + 1; j < 4; j++) {
                        hands.push([makeCard(rank, suits[i]), makeCard(rank, suits[j])]);
                    }
                }
            } else if (str.length === 3 && str[2] === 's') {
                // Suited: "AKs"
                const r1 = str[0], r2 = str[1];
                for (const s of ['♠','♥','♦','♣']) {
                    hands.push([makeCard(r1, s), makeCard(r2, s)]);
                }
            } else if (str.length === 3 && str[2] === 'o') {
                // Offsuit: "AKo"
                const r1 = str[0], r2 = str[1];
                for (const s1 of ['♠','♥','♦','♣']) {
                    for (const s2 of ['♠','♥','♦','♣']) {
                        if (s1 !== s2) {
                            hands.push([makeCard(r1, s1), makeCard(r2, s2)]);
                        }
                    }
                }
            }
        }
        return hands;
    }
}

// Matrix helper: get all 169 hand categories (13x13 grid)
function getHandMatrix() {
    const ranks = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
    const matrix = [];
    for (let i = 0; i < 13; i++) {
        const row = [];
        for (let j = 0; j < 13; j++) {
            if (i === j) {
                row.push(ranks[i] + ranks[j]); // pair
            } else if (i < j) {
                row.push(ranks[i] + ranks[j] + 's'); // suited (above diagonal)
            } else {
                row.push(ranks[j] + ranks[i] + 'o'); // offsuit (below diagonal)
            }
        }
        matrix.push(row);
    }
    return matrix;
}

// Get combo count for a hand string
function getComboCount(handStr) {
    if (handStr.length === 2) return 6; // pair
    if (handStr.endsWith('s')) return 4; // suited
    if (handStr.endsWith('o')) return 12; // offsuit
    return 0;
}
