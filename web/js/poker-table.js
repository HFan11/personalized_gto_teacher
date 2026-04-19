// ============================================================
// PokerTableCanvas — unified Canvas renderer for all poker tables
//
// Public API:
//   const t = new PokerTableCanvas(canvasEl, { seats: 6, mode: 'game' });
//   t.setState({seats, board, pot, bets, folded, allIn, actingSeat, dealerSeat, heroSeat, street});
//   t.resize(w, h);                        // rebuild caches
//   t.playAction(seat, action, amount);   // toast + chip fly (Phase 2)
//   t.dealBoard(cards);                    // flip-in animation (Phase 2)
//   t.showWinner(seat, amount);            // chip fly + particles (Phase 2)
//   t.foldSeat(seat);                      // fold animation (Phase 2)
//   t.onSeatClick = (seatIdx) => {};       // PVP sit-down hook (Phase 3)
//
// Depends on casino-fx.js for ParticleSystem / FloatingTextManager / CasinoAudio.
// ============================================================

class PokerTableCanvas {
    constructor(canvasEl, opts = {}) {
        if (typeof canvasEl === 'string') canvasEl = document.getElementById(canvasEl);
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.seatCount = opts.seats || 6;
        this.mode = opts.mode || 'game';           // 'game' | 'teach'
        this.interactive = !!opts.interactive;

        // State (default empty)
        this.state = this._blankState();

        // DPR + sizing
        this.dpr = window.devicePixelRatio || 1;
        this.W = 0; this.H = 0;

        // Caches (built on first resize)
        this.cardCache = null;        // array[53] — 52 faces + back
        this.chipCache = null;        // array[4] — 1/5/25/100 BB chips
        this.feltCache = null;        // offscreen felt background
        this.railCache = null;        // offscreen rail ring
        this.avatarCache = {};        // seatId -> cached circle

        // Animation / tween state (Phase 2+)
        this.activeTweens = [];
        this._rafId = null;
        this._lastFrame = performance.now();
        this._needsRedraw = true;
        this._idleSinceTs = performance.now();

        // Seat click support
        if (this.interactive) {
            this.onSeatClick = null;
            this.canvas.addEventListener('click', (e) => this._handleClick(e));
            this.canvas.style.cursor = 'default';
        }

        // Resize observer
        this._resizeRO = new ResizeObserver(() => this._onResizeDebounced());
        this._resizeRO.observe(this.canvas.parentElement || this.canvas);
        this._resizeDebounceTimer = null;

        // Initial sizing
        this._doResize();
        this._startRenderLoop();
    }

    _blankState() {
        const blankSeats = Array.from({ length: this.seatCount }, (_, i) => ({
            name: '',
            stack: 0,
            folded: false,
            allIn: false,
            holeCards: null,
            isMe: false,
            avatar: null,
            position: '',
            seatIdx: i,
            isEmpty: true,
        }));
        return {
            seats: blankSeats,
            board: [],
            pot: 0,
            bets: new Array(this.seatCount).fill(0),
            folded: new Array(this.seatCount).fill(false),
            allIn: new Array(this.seatCount).fill(false),
            actingSeat: -1,
            dealerSeat: 0,
            heroSeat: 0,
            street: 'waiting',
        };
    }

    // ============ Public API ============

    setState(newState) {
        // Merge, accepting partial updates
        const s = this.state;
        if (newState.seats) s.seats = this._normalizeSeats(newState.seats);
        if (newState.board !== undefined) s.board = newState.board || [];
        if (newState.pot !== undefined) s.pot = newState.pot || 0;
        if (newState.bets) s.bets = newState.bets.slice();
        if (newState.folded) s.folded = newState.folded.slice();
        if (newState.allIn) s.allIn = newState.allIn.slice();
        if (newState.actingSeat !== undefined) s.actingSeat = newState.actingSeat;
        if (newState.dealerSeat !== undefined) {
            // Slide the dealer button when it changes (game mode only)
            const prev = s.dealerSeat;
            const next = newState.dealerSeat;
            if (this.mode === 'game' && prev >= 0 && next >= 0 && prev !== next
                && prev < this.seatCount && next < this.seatCount) {
                this._dealerSlide = { from: prev, to: next, start: performance.now(), dur: 800 };
                this._addTween({
                    start: performance.now(),
                    duration: 800,
                    easing: (t) => 1 - (1 - t) * (1 - t),
                    update: () => { this._needsRedraw = true; },
                });
            }
            s.dealerSeat = next;
        }
        if (newState.heroSeat !== undefined) s.heroSeat = newState.heroSeat;
        if (newState.street) s.street = newState.street;
        this._needsRedraw = true;
    }

    _normalizeSeats(arr) {
        const out = [];
        for (let i = 0; i < this.seatCount; i++) {
            const src = arr[i] || {};
            out.push({
                name: src.name || '',
                stack: src.stack != null ? src.stack : 0,
                folded: !!src.folded,
                allIn: !!src.allIn,
                holeCards: src.holeCards || null,
                isMe: !!src.isMe,
                avatar: src.avatar || null,
                position: src.position || '',
                seatIdx: i,
                isEmpty: src.isEmpty || (!src.name && !src.stack),
                isBot: !!src.isBot,
                isGhost: !!src.isGhost,
            });
        }
        return out;
    }

    resize(w, h) {
        if (w) this.canvas.style.width = w + 'px';
        if (h) this.canvas.style.height = h + 'px';
        this._doResize();
    }

    playAction(seat, action, amount) {
        const seatPos = this._seatPos(seat);
        // Floating text toast with the action label. Offset in the OUTWARD
        // direction (away from felt centre) so it doesn't overlap the
        // position pill (which sits on the inward edge of the plate).
        if (typeof casinoFloatingText !== 'undefined') {
            const map = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', bet: '下注', allin: 'ALL-IN' };
            const label = map[action] || action;
            const amt = (amount && amount > 0) ? ` ${(+amount).toFixed(1)}` : '';
            const outDx = seatPos.x - this.cx;
            const outDy = seatPos.y - this.cy;
            const dist = Math.sqrt(outDx * outDx + outDy * outDy) || 1;
            const tx = seatPos.x + (outDx / dist) * 42;
            const ty = seatPos.y + (outDy / dist) * 42;
            casinoFloatingText.add(label + amt, tx, ty, '#fbbf24', 1.6, 16);
        }
        if (amount > 0 && (action === 'bet' || action === 'raise' || action === 'call' || action === 'allin')) {
            this._tweenChipsFrom(seat, amount);
            if (typeof casinoAudio !== 'undefined') casinoAudio.tick(1200, 0.05);
        }
        if (action === 'fold') {
            this.foldSeat(seat);
            if (typeof casinoAudio !== 'undefined') casinoAudio.tick(400, 0.07);
        }
        this._needsRedraw = true;
    }

    dealBoard(cards) {
        // Staggered flip-in of new cards — slower + more spaced so the
        // animation reads as "dealing cards" rather than a flash.
        const s = this.state;
        const prev = s.board.length;
        const newCards = cards.slice(prev);
        if (newCards.length === 0) return;
        s.board = cards.slice();
        const startAt = performance.now();
        newCards.forEach((c, i) => {
            this._addTween({
                start: startAt + i * 150,
                duration: 600,
                easing: (t) => 1 - (1 - t) * (1 - t),
                update: () => { this._needsRedraw = true; },
            });
        });
        if (typeof casinoAudio !== 'undefined') casinoAudio.tick(900, 0.05);
        this._needsRedraw = true;
    }

    showWinner(seat, amount) {
        const seatPos = this._seatPos(seat);
        // Floating "+amount" — long enough to read comfortably.
        if (typeof casinoFloatingText !== 'undefined' && amount > 0) {
            casinoFloatingText.add(`+${(+amount).toFixed(1)}`, seatPos.x, seatPos.y - 40, '#34d399', 2.4, 24);
        }
        // Gold particle burst from pot center — linger 1.5s (was 1.0s) so
        // the celebration is noticeable.
        if (typeof casinoParticles !== 'undefined') {
            casinoParticles.emit(this.cx, this.cy, 48, {
                colors: ['#fbbf24', '#fde68a', '#f59e0b', '#ffffff'],
                speed: 3.5, life: 1.5, gravity: 0, shape: 'star', size: 3,
            });
        }
        if (typeof casinoAudio !== 'undefined') casinoAudio.winJingle(2);
        this._needsRedraw = true;
    }

    foldSeat(seat) {
        // Simple fold cue — state.folded drives visual dim already.
        // Optional: shake / slide cards off. For Phase 2 just mark redraw.
        this._needsRedraw = true;
    }

    // Clears transient FX (floating-text toasts, particle bursts, tweens).
    // Call this at the start of a new hand so stale "弃牌" / "加注" toasts
    // from the previous hand don't bleed into the new hand's render.
    clearEffects() {
        this.activeTweens.length = 0;
        if (typeof casinoFloatingText !== 'undefined' && casinoFloatingText.texts) {
            casinoFloatingText.texts.length = 0;
        }
        if (typeof casinoParticles !== 'undefined' && casinoParticles.pool) {
            for (const p of casinoParticles.pool) p.alive = false;
        }
        this._needsRedraw = true;
    }

    _tweenChipsFrom(seat, amount) {
        // Chip-fly particles from seat toward bet slot — slightly longer-lived
        // so the motion is visible (was 0.5s).
        if (typeof casinoParticles === 'undefined') return;
        const seatPos = this._seatPos(seat);
        casinoParticles.emit(seatPos.x, seatPos.y, 8, {
            colors: ['#fbbf24', '#fde68a'],
            speed: 1.8, life: 0.9, gravity: 0, size: 3,
        });
    }

    _addTween(t) {
        // Stores a tween with absolute start time; render loop processes.
        this.activeTweens.push(t);
        this._needsRedraw = true;
    }

    destroy() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        if (this._resizeRO) this._resizeRO.disconnect();
        this.canvas = null;
        this.ctx = null;
    }

    // ============ Sizing ============

    _onResizeDebounced() {
        clearTimeout(this._resizeDebounceTimer);
        this._resizeDebounceTimer = setTimeout(() => this._doResize(), 100);
    }

    _doResize() {
        const parent = this.canvas.parentElement;
        const w = Math.max(280, Math.min(560, parent?.clientWidth || 480));
        // Mode-aware aspect:
        //   game (6-max): flatter landscape 1:0.80 — seats spread across
        //     the long axis, board + pot sit in the middle horizontally.
        //   teach (2-seat 1v1): taller 1:0.95 — hero and villain sit at
        //     poles (top/bottom), needs vertical room to separate them and
        //     leave clean space between for cards, chip stacks, pot text.
        const isTeach = this.mode === 'teach';
        // Adaptive aspect — keep canvas short enough that header + canvas
        // + action bar all fit on typical viewports without scrolling.
        //   narrow viewports (phones, w<440): taller aspect (1.05) so 6
        //     seats + cards fit vertically at the smaller width
        //   desktop: shorter landscape aspect. Teach mode goes shorter
        //     still because there are only 2 seats to fit.
        const aspect = w < 440
            ? (isTeach ? 1.00 : 1.05)
            : (isTeach ? 0.80 : 0.85);
        const h = Math.round(w * aspect);
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        this.ctx.scale(this.dpr, this.dpr);
        this.W = w;
        this.H = h;
        // Scale factor for fixed-pixel UI (avatar/plate/cards/chips) so
        // sizes shrink proportionally on narrow canvases.
        this.S = Math.max(0.72, Math.min(1, w / 540));
        this.cx = w / 2;
        this.cy = h * 0.48;
        this.rx = w * 0.46;
        this.ry = h * 0.45;
        // Seats pulled a bit toward centre (smaller seatRy) so hero cards
        // below the plate + pill still fit within canvas height.
        this.seatRx = isTeach ? w * 0.28 : w * 0.32;
        this.seatRy = isTeach ? h * 0.30 : h * 0.24;
        this._buildCaches();
        this._needsRedraw = true;
    }

    _buildCaches() {
        this._buildFeltCache();
        this._buildRailCache();
        if (!this.cardCache) this._buildCardCache();
        if (!this.chipCache) this._buildChipCache();
    }

    // ============ Felt background cache ============

    _buildFeltCache() {
        const c = document.createElement('canvas');
        c.width = Math.round(this.W * this.dpr);
        c.height = Math.round(this.H * this.dpr);
        const cx = c.getContext('2d');
        cx.scale(this.dpr, this.dpr);

        // Dark base
        cx.fillStyle = '#050a08';
        cx.fillRect(0, 0, this.W, this.H);

        // Felt oval with radial gradient
        const g = cx.createRadialGradient(this.cx, this.cy, this.rx * 0.2, this.cx, this.cy, this.rx);
        g.addColorStop(0, '#1d7a3c');
        g.addColorStop(0.6, '#11582a');
        g.addColorStop(1, '#0a3d1c');
        cx.fillStyle = g;
        cx.beginPath();
        cx.ellipse(this.cx, this.cy, this.rx + 6, this.ry + 6, 0, 0, Math.PI * 2);
        cx.fill();

        // Cloth specks (noise texture)
        cx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let i = 0; i < 400; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * (this.rx * 0.95);
            const x = this.cx + Math.cos(a) * r;
            const y = this.cy + Math.sin(a) * (r * (this.ry / this.rx));
            const s = Math.random() * 0.8 + 0.3;
            cx.fillRect(x, y, s, s);
        }

        // Inner rim highlight
        cx.strokeStyle = 'rgba(255,255,255,0.08)';
        cx.lineWidth = 1;
        cx.beginPath();
        cx.ellipse(this.cx, this.cy, this.rx, this.ry, 0, 0, Math.PI * 2);
        cx.stroke();

        this.feltCache = c;
    }

    _buildRailCache() {
        const c = document.createElement('canvas');
        c.width = Math.round(this.W * this.dpr);
        c.height = Math.round(this.H * this.dpr);
        const cx = c.getContext('2d');
        cx.scale(this.dpr, this.dpr);

        // Wood rail ring
        cx.save();
        cx.lineWidth = 10;
        const railGrad = cx.createLinearGradient(0, this.cy - this.ry, 0, this.cy + this.ry);
        railGrad.addColorStop(0, '#8b6914');
        railGrad.addColorStop(0.5, '#6b4f1d');
        railGrad.addColorStop(1, '#3a2a0a');
        cx.strokeStyle = railGrad;
        cx.beginPath();
        cx.ellipse(this.cx, this.cy, this.rx + 11, this.ry + 11, 0, 0, Math.PI * 2);
        cx.stroke();

        // Inner bevel highlight
        cx.lineWidth = 1.5;
        cx.strokeStyle = 'rgba(255, 220, 150, 0.35)';
        cx.beginPath();
        cx.ellipse(this.cx, this.cy, this.rx + 5, this.ry + 5, 0, 0, Math.PI * 2);
        cx.stroke();

        // Outer shadow
        cx.lineWidth = 1;
        cx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        cx.beginPath();
        cx.ellipse(this.cx, this.cy, this.rx + 17, this.ry + 17, 0, 0, Math.PI * 2);
        cx.stroke();

        // 4 gold studs
        const studAngles = [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4];
        for (const a of studAngles) {
            const sx = this.cx + Math.cos(a) * (this.rx + 11);
            const sy = this.cy + Math.sin(a) * (this.ry + 11);
            const g = cx.createRadialGradient(sx - 1, sy - 1, 0, sx, sy, 4);
            g.addColorStop(0, '#fde68a');
            g.addColorStop(0.6, '#fbbf24');
            g.addColorStop(1, '#8b6914');
            cx.fillStyle = g;
            cx.beginPath();
            cx.arc(sx, sy, 4, 0, Math.PI * 2);
            cx.fill();
        }
        cx.restore();

        this.railCache = c;
    }

    // ============ Card face/back cache ============

    _buildCardCache() {
        // Render at 1.5x the largest real draw size for crisp scaling. This
        // is before DPR — the inner context already multiplies by DPR.
        const w = 96;
        const h = 132;
        const cache = [];
        const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
        const suits = ['c', 'd', 'h', 's'];
        for (const suit of suits) {
            for (const rank of ranks) {
                cache.push(this._renderCardFace(rank, suit, w, h));
            }
        }
        cache.push(this._renderCardBack(w, h));
        this.cardCache = cache;
        this._cardIdx = (rank, suit) => {
            const ri = ranks.indexOf(rank);
            const si = suits.indexOf(suit);
            if (ri < 0 || si < 0) return 52;
            return si * 13 + ri;
        };
    }

    // WePoker-style card face — big bold rank in two corners, huge
    // centre suit symbol. Clean white background. Red / near-black
    // for the two colour families.
    _renderCardFace(rank, suit, w, h) {
        const c = document.createElement('canvas');
        c.width = Math.round(w * this.dpr);
        c.height = Math.round(h * this.dpr);
        const cx = c.getContext('2d');
        cx.scale(this.dpr, this.dpr);
        // Soft white gradient background
        const g = cx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#e6e6e9');
        cx.fillStyle = g;
        this._roundRect(cx, 0.5, 0.5, w - 1, h - 1, 8);
        cx.fill();
        // Thin dark border
        cx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        cx.lineWidth = 1;
        this._roundRect(cx, 0.5, 0.5, w - 1, h - 1, 8);
        cx.stroke();

        const red = (suit === 'h' || suit === 'd');
        const inkColor = red ? '#d91e3a' : '#111111';
        cx.fillStyle = inkColor;

        const rankText = rank === 'T' ? '10' : rank;
        const suitChar = this._suitChar(suit);

        // Top-left: large rank + suit below
        cx.textAlign = 'left';
        cx.textBaseline = 'top';
        cx.font = `900 ${Math.round(w * 0.32)}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
        cx.fillText(rankText, 5, 3);
        cx.font = `${Math.round(w * 0.22)}px "Apple Color Emoji", sans-serif`;
        cx.fillText(suitChar, 5, Math.round(h * 0.27));

        // Bottom-right (rotated 180°)
        cx.save();
        cx.translate(w - 5, h - 3);
        cx.rotate(Math.PI);
        cx.font = `900 ${Math.round(w * 0.32)}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
        cx.fillText(rankText, 0, 0);
        cx.font = `${Math.round(w * 0.22)}px "Apple Color Emoji", sans-serif`;
        cx.fillText(suitChar, 1, Math.round(h * 0.20));
        cx.restore();

        // HUGE centre suit symbol
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.font = `bold ${Math.round(w * 0.55)}px "Apple Color Emoji", sans-serif`;
        cx.fillText(suitChar, w / 2, h / 2 + 3);

        return c;
    }

    _renderCardBack(w, h) {
        const c = document.createElement('canvas');
        c.width = Math.round(w * this.dpr);
        c.height = Math.round(h * this.dpr);
        const cx = c.getContext('2d');
        cx.scale(this.dpr, this.dpr);
        // Blue gradient
        const g = cx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#1e3a8a');
        g.addColorStop(1, '#3b82f6');
        cx.fillStyle = g;
        this._roundRect(cx, 0.5, 0.5, w - 1, h - 1, 6);
        cx.fill();
        cx.strokeStyle = '#0a0a0a';
        cx.lineWidth = 0.8;
        this._roundRect(cx, 0.5, 0.5, w - 1, h - 1, 6);
        cx.stroke();
        // Pattern: diagonal crosshatch
        cx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        cx.lineWidth = 0.6;
        for (let i = -h; i < w; i += 4) {
            cx.beginPath();
            cx.moveTo(i, 0); cx.lineTo(i + h, h);
            cx.stroke();
            cx.beginPath();
            cx.moveTo(i + h, 0); cx.lineTo(i, h);
            cx.stroke();
        }
        // Inner frame
        cx.strokeStyle = 'rgba(255, 220, 150, 0.6)';
        cx.lineWidth = 1;
        this._roundRect(cx, 4, 4, w - 8, h - 8, 4);
        cx.stroke();
        // Center diamond
        cx.save();
        cx.translate(w / 2, h / 2);
        cx.fillStyle = '#fbbf24';
        cx.strokeStyle = '#8b6914';
        cx.lineWidth = 0.8;
        cx.beginPath();
        cx.moveTo(0, -12); cx.lineTo(10, 0); cx.lineTo(0, 12); cx.lineTo(-10, 0);
        cx.closePath();
        cx.fill(); cx.stroke();
        cx.restore();
        return c;
    }

    _suitChar(s) {
        return { c: '♣', d: '♦', h: '♥', s: '♠' }[s] || s;
    }

    // ============ Chip cache ============

    _buildChipCache() {
        const denoms = [
            { value: 1,   fill: '#e5e7eb', stripe: '#111', label: '1' },
            { value: 5,   fill: '#dc2626', stripe: '#fff', label: '5' },
            { value: 25,  fill: '#15803d', stripe: '#fff', label: '25' },
            { value: 100, fill: '#1e3a8a', stripe: '#fbbf24', label: '100' },
        ];
        const cache = [];
        for (const d of denoms) {
            cache.push(this._renderChip(d));
        }
        this.chipCache = cache;
        this.chipDenoms = denoms;
    }

    _renderChip(d) {
        const size = 28;
        const c = document.createElement('canvas');
        c.width = Math.round(size * this.dpr);
        c.height = Math.round(size * this.dpr);
        const cx = c.getContext('2d');
        cx.scale(this.dpr, this.dpr);
        const r = size / 2;
        // Shadow
        cx.shadowColor = 'rgba(0,0,0,0.4)'; cx.shadowBlur = 3; cx.shadowOffsetY = 2;
        // Outer fill
        const g = cx.createRadialGradient(r - 3, r - 3, 1, r, r, r);
        g.addColorStop(0, this._lighten(d.fill, 0.15));
        g.addColorStop(1, this._darken(d.fill, 0.2));
        cx.fillStyle = g;
        cx.beginPath();
        cx.arc(r, r, r - 1, 0, Math.PI * 2);
        cx.fill();
        cx.shadowBlur = 0; cx.shadowOffsetY = 0;
        // Rim stripes (4 triangular wedges)
        cx.fillStyle = d.stripe;
        for (let i = 0; i < 8; i++) {
            if (i % 2 !== 0) continue;
            const a = (i / 8) * Math.PI * 2;
            cx.save();
            cx.translate(r, r);
            cx.rotate(a);
            cx.fillRect(-1.5, -r + 1, 3, 5);
            cx.restore();
        }
        // Inner circle
        cx.fillStyle = this._lighten(d.fill, 0.1);
        cx.beginPath();
        cx.arc(r, r, r - 7, 0, Math.PI * 2);
        cx.fill();
        cx.strokeStyle = 'rgba(0,0,0,0.25)';
        cx.lineWidth = 0.8;
        cx.stroke();
        // Label
        cx.fillStyle = d.stripe === '#fff' ? '#fff' : '#111';
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.font = 'bold 9px sans-serif';
        cx.fillText(d.label, r, r);
        return c;
    }

    _lighten(hex, amt) {
        const { r, g, b } = this._hexToRgb(hex);
        return `rgb(${Math.min(255, r + 255 * amt)|0},${Math.min(255, g + 255 * amt)|0},${Math.min(255, b + 255 * amt)|0})`;
    }
    _darken(hex, amt) {
        const { r, g, b } = this._hexToRgb(hex);
        return `rgb(${Math.max(0, r - 255 * amt)|0},${Math.max(0, g - 255 * amt)|0},${Math.max(0, b - 255 * amt)|0})`;
    }
    _hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
    }

    // Progressively truncate text until it fits in maxWidth. Returns the truncated string.
    _fitText(ctx, text, maxWidth) {
        if (!text) return '';
        if (ctx.measureText(text).width <= maxWidth) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
            t = t.slice(0, -1);
        }
        return t + '…';
    }

    _roundRect(cx, x, y, w, h, r) {
        cx.beginPath();
        cx.moveTo(x + r, y);
        cx.lineTo(x + w - r, y); cx.quadraticCurveTo(x + w, y, x + w, y + r);
        cx.lineTo(x + w, y + h - r); cx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        cx.lineTo(x + r, y + h); cx.quadraticCurveTo(x, y + h, x, y + h - r);
        cx.lineTo(x, y + r); cx.quadraticCurveTo(x, y, x + r, y);
        cx.closePath();
    }

    // ============ Seat positioning ============

    _seatPos(i) {
        // Seat 0 (hero) at 90° (bottom center, since canvas Y grows down).
        // Remaining seats spread CLOCKWISE around the ellipse (viewer's
        // perspective: next seat is to hero's right-side first, wrapping to
        // upper-left). Canvas Y is flipped vs math, so ADDING to the angle
        // gives visual clockwise motion.
        // Uses seatRx/seatRy (smaller than the felt rx/ry) so plates stay
        // inside the green felt, not hanging off the rail.
        const n = this.seatCount;
        const baseAngleDeg = 90;
        const step = 360 / n;
        const angle = (baseAngleDeg + i * step) * Math.PI / 180;
        const x = this.cx + Math.cos(angle) * this.seatRx;
        const y = this.cy + Math.sin(angle) * this.seatRy;
        return { x, y, angle };
    }

    // ============ Render loop ============

    _startRenderLoop() {
        const tick = (now) => {
            this._lastFrame = now;
            // Advance tweens (tw.start is absolute timestamp)
            for (let i = this.activeTweens.length - 1; i >= 0; i--) {
                const tw = this.activeTweens[i];
                if (now < tw.start) continue; // not started yet
                const t = Math.min(1, (now - tw.start) / tw.duration);
                tw.update(tw.easing ? tw.easing(t) : t);
                if (t >= 1) {
                    if (tw.done) tw.done();
                    this.activeTweens.splice(i, 1);
                }
                this._needsRedraw = true;
            }
            // Update casino-fx modules (particles + floating text)
            const dt = 1 / 60;
            if (typeof casinoParticles !== 'undefined' && casinoParticles.hasAlive && casinoParticles.hasAlive()) {
                casinoParticles.update(dt);
                this._needsRedraw = true;
            }
            if (typeof casinoFloatingText !== 'undefined' && casinoFloatingText.hasActive && casinoFloatingText.hasActive()) {
                casinoFloatingText.update(dt);
                this._needsRedraw = true;
            }
            // Acting pulse animation keeps rendering
            if (this.state.actingSeat >= 0 && this.state.street !== 'waiting') this._needsRedraw = true;
            // Ambient felt sparkle — emit a few particles every 4-8s near a
            // random non-folded seat (game mode only, not during showdown).
            if (this.mode === 'game' && this.state.street && this.state.street !== 'waiting'
                && typeof casinoParticles !== 'undefined') {
                if (!this._nextSparkleAt) this._nextSparkleAt = now + 4000 + Math.random() * 4000;
                if (now >= this._nextSparkleAt) {
                    const candidates = [];
                    for (let i = 0; i < this.seatCount; i++) {
                        if (!this.state.folded[i]) candidates.push(i);
                    }
                    if (candidates.length) {
                        const i = candidates[Math.floor(Math.random() * candidates.length)];
                        const p = this._seatPos(i);
                        casinoParticles.emit(p.x + (this.cx - p.x) * 0.3, p.y + (this.cy - p.y) * 0.3, 4, {
                            colors: ['#fbbf24', '#fde68a', '#ffffff'],
                            speed: 1.2, life: 0.8, gravity: -20, size: 2, shape: 'star',
                        });
                        this._needsRedraw = true;
                    }
                    this._nextSparkleAt = now + 4000 + Math.random() * 4000;
                }
            }
            // Draw if needed
            if (this._needsRedraw) {
                this._draw();
                this._needsRedraw = false;
                this._idleSinceTs = now;
            }
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    // ============ Main draw ============

    _draw() {
        const { ctx, W, H } = this;
        ctx.clearRect(0, 0, W, H);
        // Felt
        if (this.feltCache) ctx.drawImage(this.feltCache, 0, 0, W, H);
        // Rail
        if (this.railCache) ctx.drawImage(this.railCache, 0, 0, W, H);
        // Dealer button
        this._drawDealerButton();
        // Community board
        this._drawBoard();
        // Pot display
        this._drawPot();
        // Bets (current street bets per seat — between seat and pot)
        this._drawBets();
        // ALL hole cards draw BEFORE the seat plates, so the plates render
        // on top and the cards appear tucked behind the name plate from the
        // felt side. Hero's cards are larger and more prominent.
        this._drawHoleCards();
        // Seats (plates on top — cards peek out from behind them)
        this._drawSeats();
        // Particles + floating text (casino-fx overlays)
        if (typeof casinoParticles !== 'undefined' && casinoParticles.draw) {
            casinoParticles.draw(this.ctx);
        }
        if (typeof casinoFloatingText !== 'undefined' && casinoFloatingText.draw) {
            casinoFloatingText.draw(this.ctx);
        }
    }

    _drawDealerButton() {
        const s = this.state;
        if (s.dealerSeat < 0 || s.dealerSeat >= this.seatCount) return;

        // Interpolate position if a slide is in progress.
        let seat;
        const slide = this._dealerSlide;
        if (slide) {
            const t = Math.min(1, (performance.now() - slide.start) / slide.dur);
            if (t >= 1) {
                seat = this._seatPos(slide.to);
                this._dealerSlide = null;  // clear slide
            } else {
                const eased = 1 - (1 - t) * (1 - t);
                const a = this._seatPos(slide.from);
                const b = this._seatPos(slide.to);
                seat = { x: a.x + (b.x - a.x) * eased, y: a.y + (b.y - a.y) * eased };
            }
        } else {
            seat = this._seatPos(s.dealerSeat);
        }

        // Offset the button toward center of table — enough to clear
        // the (now wider) plate's bounding box so the D never overlaps
        // the seat name.
        const dx = (this.cx - seat.x) * 0.42;
        const dy = (this.cy - seat.y) * 0.42;
        const bx = seat.x + dx;
        const by = seat.y + dy;
        const ctx = this.ctx;
        const btnR = 9;  // smaller disc
        // Disc
        const g = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, btnR);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#d0d0d0');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, btnR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Label
        ctx.fillStyle = '#1a1a1a';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('D', bx, by + 1);
    }

    _drawBoard() {
        const s = this.state;
        if (!s.board || s.board.length === 0) return;
        const S = this.S || 1;
        const cw = 40 * S, ch = 56 * S, gap = 5 * S;
        const totalW = 5 * cw + 4 * gap;
        const startX = this.cx - totalW / 2;
        const y = this.cy - ch / 2 - 8 * S;
        for (let i = 0; i < 5; i++) {
            const cx = startX + i * (cw + gap);
            if (i < s.board.length) {
                this._drawCardAt(s.board[i], cx, y, cw, ch, false);
            } else {
                // Empty slot — faint outline
                this.ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                this.ctx.lineWidth = 1;
                this._roundRect(this.ctx, cx, y, cw, ch, 5);
                this.ctx.stroke();
            }
        }
    }

    // Draw a card with a tilt (rotation around its own centre). Used for
    // WePoker-style fan of cards held by each player.
    _drawCardTilted(card, x, y, w, h, tiltDeg, faceDown) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(tiltDeg * Math.PI / 180);
        ctx.translate(-(x + w / 2), -(y + h / 2));
        this._drawCardAt(card, x, y, w, h, faceDown);
        ctx.restore();
    }

    _drawCardAt(card, x, y, w, h, faceDown) {
        const ctx = this.ctx;
        if (!this.cardCache) return;
        if (faceDown || !card) {
            ctx.drawImage(this.cardCache[52], x, y, w, h);
        } else {
            const rank = card[0];
            const suit = card[1];
            const idx = this._cardIdx(rank, suit);
            ctx.drawImage(this.cardCache[idx], x, y, w, h);
        }
    }

    _drawPot() {
        const s = this.state;
        if (s.pot <= 0) return;
        const ctx = this.ctx;
        const label = `底池 ${s.pot.toFixed(1)} BB`;
        ctx.save();
        // Bigger, more prominent label in game mode (WePoker style).
        const fontSize = this.mode === 'game' ? 15 : 13;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const metrics = ctx.measureText(label);
        const padX = 12, padY = 5;
        const boxW = metrics.width + padX * 2;
        const boxH = fontSize + padY * 2;
        const boxX = this.cx - boxW / 2;
        // Above the board (which sits at cy ± ~44). Offset scales with
        // mode so teach-mode (taller canvas) places it clearly in the
        // empty middle above the board.
        const offsetAbove = this.mode === 'teach' ? 80 : 70;
        const boxY = this.cy - offsetAbove;
        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        this._roundRect(ctx, boxX, boxY, boxW, boxH, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
        ctx.lineWidth = 0.8;
        this._roundRect(ctx, boxX, boxY, boxW, boxH, 10);
        ctx.stroke();
        // Text
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(label, this.cx, boxY + boxH / 2);
        ctx.restore();
    }

    _drawBets() {
        const s = this.state;
        // Game mode: chip sits close to each seat (35% toward centre) so
        // it reads as "that player's bet" and never lands on the board
        // cards in the middle.
        // Teach mode: chip at 45% — clearly between the seat and the pot
        // text, on the seat's side of the pot (so villain's bet sits
        // ABOVE the pot label, hero's bet below).
        const frac = this.mode === 'game' ? 0.35 : 0.45;
        for (let i = 0; i < this.seatCount; i++) {
            const bet = s.bets[i] || 0;
            if (bet <= 0) continue;
            const seat = this._seatPos(i);
            const bx = seat.x + (this.cx - seat.x) * frac;
            const by = seat.y + (this.cy - seat.y) * frac;
            this._drawChipStack(bx, by, bet);
        }
    }

    _drawChipStack(x, y, amount) {
        if (!this.chipCache) return;
        const ctx = this.ctx;
        const S = this.S || 1;
        // Compact chip visual: small 20x20 disc on the left, amount label
        // INLINE to the right in a colored pill. Scales with S on mobile.
        const chipR = 10 * S;
        const chipDenom = amount >= 100 ? 3
                        : amount >= 25  ? 2
                        : amount >= 5   ? 1
                        : 0;
        ctx.drawImage(this.chipCache[chipDenom], x - chipR - 12 * S, y - chipR, chipR * 2, chipR * 2);
        const labelText = amount.toFixed(1);
        const labelColor = amount >= 6 ? '#ff6b6b'
                         : amount >= 2 ? '#fb923c'
                         : '#fde68a';
        ctx.save();
        const labelFont = Math.max(10, Math.round(11 * S));
        ctx.font = `bold ${labelFont}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const textW = ctx.measureText(labelText).width;
        const pillW = textW + 10 * S;
        const pillH = 16 * S;
        const pillX = x + 2 * S;
        const pillY = y - pillH / 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
        this._roundRect(ctx, pillX, pillY, pillW, pillH, 5 * S);
        ctx.fill();
        ctx.fillStyle = labelColor;
        ctx.fillText(labelText, pillX + 5 * S, pillY + pillH / 2 + 1);
        ctx.restore();
    }

    _drawSeats() {
        const s = this.state;
        const now = performance.now();
        for (let i = 0; i < this.seatCount; i++) {
            const seat = s.seats[i] || {};
            const pos = this._seatPos(i);
            if (seat.isGhost) {
                this._drawGhostSeat(pos, seat);
                continue;
            }
            const isActing = i === s.actingSeat && s.street !== 'waiting';
            const isFolded = s.folded[i];
            this._drawSeat(seat, pos, isActing, isFolded, now);
        }
    }

    // Draw a "ghost" placeholder at a seat position — just a small dimmed
    // dot on the felt, marking that a seat exists here in the action order
    // without occupying visual space like a real plate. Used in teaching
    // mode where only hero + villain are shown as full seats.
    _drawGhostSeat(pos, seat) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = 0.35;
        // Small dimmed circle
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    _drawSeat(seat, pos, isActing, isFolded, now) {
        if (this.mode === 'game') {
            this._drawSeatGame(seat, pos, isActing, isFolded, now);
        } else {
            this._drawSeatTeach(seat, pos, isActing, isFolded, now);
        }
    }

    // WePoker-style seat: circular avatar on top, compact name/stack plate
    // below, position pill as a separate small pill beneath the plate.
    // Acting ring wraps the AVATAR (not the plate) for a cleaner look.
    _drawSeatGame(seat, pos, isActing, isFolded, now) {
        const ctx = this.ctx;
        const { x, y } = pos;
        const S = this.S;
        const avR = 18 * S;
        const avY = y - 20 * S;
        const plateW = 76 * S, plateH = 30 * S;
        const plateX = x - plateW / 2;
        const plateY = y + 2 * S;
        const pillY = plateY + plateH + 4 * S;

        ctx.save();
        if (isFolded) ctx.globalAlpha = 0.38;

        // Acting pulse ring around the AVATAR
        if (isActing) {
            const pulse = 0.55 + 0.45 * Math.sin(now / 200);
            ctx.strokeStyle = `rgba(251, 191, 36, ${pulse})`;
            ctx.lineWidth = Math.max(2, 3 * S);
            ctx.beginPath();
            ctx.arc(x, avY, avR + 3 * S, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Avatar circle
        const hue = (seat.seatIdx * 60) % 360;
        const ag = ctx.createRadialGradient(x - 4, avY - 4, 1, x, avY, avR);
        ag.addColorStop(0, `hsl(${hue}, 70%, 60%)`);
        ag.addColorStop(1, `hsl(${hue}, 70%, 28%)`);
        ctx.fillStyle = ag;
        ctx.beginPath();
        ctx.arc(x, avY, avR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Initial letter inside avatar
        const initial = (seat.name || '?')[0].toUpperCase();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(15 * S)}px sans-serif`;
        ctx.fillText(initial, x, avY + 1);

        // Name plate (rounded rect)
        ctx.fillStyle = seat.isMe ? 'rgba(30, 58, 138, 0.88)' : 'rgba(0, 0, 0, 0.70)';
        this._roundRect(ctx, plateX, plateY, plateW, plateH, 6 * S);
        ctx.fill();
        ctx.strokeStyle = seat.isMe ? 'rgba(99, 162, 255, 0.85)' : 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, plateX, plateY, plateW, plateH, 6 * S);
        ctx.stroke();

        // Name (top line) — scaled font so it fits the plate width
        const fullName = seat.isEmpty ? '空位' : (seat.name || 'Bot');
        const nameFont = Math.max(9, Math.round(10 * S));
        ctx.font = `bold ${nameFont}px sans-serif`;
        const nameText = this._fitText(ctx, fullName, plateW - 8);
        ctx.fillStyle = seat.isEmpty ? 'rgba(99,162,255,0.9)' : '#f3f4f6';
        ctx.textBaseline = 'top';
        ctx.fillText(nameText, x, plateY + 3 * S);

        // Stack (bottom line, gold)
        ctx.fillStyle = '#fbbf24';
        ctx.font = `bold ${Math.max(11, Math.round(13 * S))}px sans-serif`;
        ctx.fillText(`${(seat.stack || 0).toFixed(1)}BB`, x, plateY + 15 * S);

        // All-in tag
        if (seat.allIn && !isFolded) {
            ctx.fillStyle = '#a855f7';
            ctx.font = `bold ${Math.round(9 * S)}px sans-serif`;
            ctx.fillText('ALL-IN', x, plateY + plateH + 2 * S);
        }

        // Position pill
        if (seat.position) {
            const pillFont = Math.max(8, Math.round(9 * S));
            ctx.font = `bold ${pillFont}px sans-serif`;
            const pw = ctx.measureText(seat.position).width + 10 * S;
            const ph = 13 * S;
            const pillX = x - pw / 2;
            const posColors = {BTN:'#f59e0b',SB:'#a855f7',BB:'#ef4444',UTG:'#3b82f6',HJ:'#22c55e',CO:'#06b6d4'};
            ctx.fillStyle = posColors[seat.position] || 'rgba(251, 191, 36, 0.85)';
            this._roundRect(ctx, pillX, pillY, pw, ph, 5 * S);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${pillFont}px sans-serif`;
            ctx.fillText(seat.position, x, pillY + ph / 2 + 0.5);
        }

        ctx.restore();
    }

    // Teach-mode seat: compact horizontal plate for 1v1 coaching context.
    // Cleaner / data-forward feel (GTO-Wizard-ish).
    _drawSeatTeach(seat, pos, isActing, isFolded, now) {
        const ctx = this.ctx;
        const { x, y } = pos;
        const plateW = 104, plateH = 46;
        const plateX = x - plateW / 2;
        const plateY = y - plateH / 2;

        ctx.save();
        if (isFolded) ctx.globalAlpha = 0.4;

        if (isActing) {
            const pulse = 0.6 + 0.4 * Math.sin(now / 200);
            ctx.strokeStyle = `rgba(251, 191, 36, ${pulse})`;
            ctx.lineWidth = 2;
            this._roundRect(ctx, plateX - 3, plateY - 3, plateW + 6, plateH + 6, 10);
            ctx.stroke();
        }

        ctx.fillStyle = seat.isMe ? 'rgba(30, 58, 138, 0.75)' : 'rgba(0, 0, 0, 0.55)';
        this._roundRect(ctx, plateX, plateY, plateW, plateH, 8);
        ctx.fill();
        ctx.strokeStyle = seat.isMe ? 'rgba(99, 162, 255, 0.8)' : 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, plateX, plateY, plateW, plateH, 8);
        ctx.stroke();

        const avR = 16;
        const avX = plateX + avR + 4;
        const avY = plateY + plateH / 2;
        const hue = (seat.seatIdx * 60) % 360;
        const g = ctx.createRadialGradient(avX - 3, avY - 3, 1, avX, avY, avR);
        g.addColorStop(0, `hsl(${hue}, 65%, 55%)`);
        g.addColorStop(1, `hsl(${hue}, 70%, 28%)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(avX, avY, avR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        const initial = (seat.name || '?')[0].toUpperCase();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(initial, avX, avY + 1);

        const textX = avX + avR + 8;
        const pillReserve = seat.position ? 22 : 4;
        const textW = plateW - (avR * 2 + 4 + 8) - pillReserve;
        ctx.textAlign = 'left';
        ctx.fillStyle = seat.isEmpty ? 'rgba(99,162,255,0.9)' : '#f3f4f6';
        ctx.font = 'bold 11px sans-serif';
        ctx.textBaseline = 'top';
        const fullName = seat.isEmpty ? '空位' : (seat.name || 'Bot');
        const nameText = this._fitText(ctx, fullName, textW);
        ctx.fillText(nameText, textX, plateY + 6);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(`${(seat.stack || 0).toFixed(1)}BB`, textX, plateY + 24);

        if (seat.allIn && !isFolded) {
            ctx.fillStyle = '#a855f7';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText('ALL-IN', textX, plateY + 35);
        }

        if (seat.position) {
            ctx.font = 'bold 9px sans-serif';
            const pw = ctx.measureText(seat.position).width + 6;
            const ph = 12;
            const pillX = plateX + plateW - pw - 3;
            const pillY = plateY + 2;
            const posColors = {BTN:'#f59e0b',SB:'#a855f7',BB:'#ef4444',UTG:'#3b82f6',HJ:'#22c55e',CO:'#06b6d4'};
            ctx.fillStyle = posColors[seat.position] || 'rgba(251, 191, 36, 0.85)';
            this._roundRect(ctx, pillX, pillY, pw, ph, 4);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText(seat.position, pillX + pw / 2, pillY + ph / 2 + 0.5);
        }

        ctx.restore();
    }

    _drawHoleCards() {
        const s = this.state;
        if (s.street === 'waiting') return;
        const S = this.S || 1;
        for (let i = 0; i < this.seatCount; i++) {
            const seat = s.seats[i];
            if (!seat || s.folded[i] || seat.isGhost) continue;
            const pos = this._seatPos(i);
            const cards = seat.holeCards && seat.holeCards.length === 2 ? seat.holeCards : [null, null];
            const faceDown = !seat.isMe && !(seat.holeCards && seat.holeCards.length === 2 && s.street === 'showdown');
            const c0 = seat.isMe || !faceDown ? cards[0] : null;
            const c1 = seat.isMe || !faceDown ? cards[1] : null;

            if (this.mode === 'game' && seat.isMe) {
                // Hero (WePoker): prominent readable cards below the seat
                // stack — bigger so rank/suit are obvious at a glance.
                const cw = 52 * S, ch = 72 * S, gap = 4 * S;
                const cardTop = pos.y + 52 * S;
                const lx = pos.x - cw - gap / 2;
                const rx = pos.x + gap / 2;
                this._drawCardTilted(c0, lx, cardTop, cw, ch, -6, c0 == null);
                this._drawCardTilted(c1, rx, cardTop, cw, ch, +6, c1 == null);
            } else if (this.mode === 'game') {
                // Bot (WePoker): small cards peek from behind the avatar.
                const cw = 28 * S, ch = 40 * S;
                const avY = pos.y - 20 * S;
                const cardCY = avY - 24 * S;
                this._drawCardTilted(c0, pos.x - 11 * S - cw / 2, cardCY - ch / 2, cw, ch, -14, c0 == null);
                this._drawCardTilted(c1, pos.x + 11 * S - cw / 2, cardCY - ch / 2, cw, ch, +14, c1 == null);
            } else if (seat.isMe) {
                // Hero (teach): clean readable cards below plate, no tilt.
                const cw = 48 * S, ch = 66 * S, gap = 4 * S;
                const cardTop = pos.y + 46 / 2 + 6;
                this._drawCardAt(cards[0], pos.x - cw - gap / 2, cardTop, cw, ch, cards[0] == null);
                this._drawCardAt(cards[1], pos.x + gap / 2, cardTop, cw, ch, cards[1] == null);
            } else {
                // Bot (teach): outward adaptive offset (GTO-Wizard-ish).
                const cw = 32 * S, ch = 44 * S, gap = 4;
                const plateW = 104, plateH = 46;
                const outDx = pos.x - this.cx;
                const outDy = pos.y - this.cy;
                const dist = Math.sqrt(outDx * outDx + outDy * outDy) || 1;
                const nx = outDx / dist, ny = outDy / dist;
                const pad = 6;
                const needX = plateW / 2 + cw + gap / 2 + pad;
                const needY = plateH / 2 + ch / 2 + pad;
                const offsetX = Math.abs(nx) > 0.05 ? needX / Math.abs(nx) : Infinity;
                const offsetY = Math.abs(ny) > 0.05 ? needY / Math.abs(ny) : Infinity;
                const offset = Math.min(offsetX, offsetY);
                const cardCenterX = pos.x + nx * offset;
                const cardCenterY = pos.y + ny * offset;
                const cardTop = cardCenterY - ch / 2;
                this._drawCardAt(c0, cardCenterX - cw - gap / 2, cardTop, cw, ch, c0 == null);
                this._drawCardAt(c1, cardCenterX + gap / 2, cardTop, cw, ch, c1 == null);
            }
        }
    }

    // ============ Click detection ============

    _handleClick(e) {
        if (!this.onSeatClick) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Find closest seat within radius
        for (let i = 0; i < this.seatCount; i++) {
            const pos = this._seatPos(i);
            const dx = x - pos.x, dy = y - pos.y;
            if (dx * dx + dy * dy < 48 * 48) {
                this.onSeatClick(i);
                return;
            }
        }
    }
}

// Expose globally
if (typeof window !== 'undefined') window.PokerTableCanvas = PokerTableCanvas;
