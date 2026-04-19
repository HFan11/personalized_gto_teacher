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
        if (newState.dealerSeat !== undefined) s.dealerSeat = newState.dealerSeat;
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
        // Phase 2 — for now just re-request render
        this._needsRedraw = true;
    }
    dealBoard(cards) { this._needsRedraw = true; }
    showWinner(seat, amount) { this._needsRedraw = true; }
    foldSeat(seat) { this._needsRedraw = true; }

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
        const h = Math.round(w / 1.5); // 1.5:1 aspect ratio
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
        this.ctx.scale(this.dpr, this.dpr);
        this.W = w;
        this.H = h;
        // Ellipse parameters
        this.cx = w / 2;
        this.cy = h / 2;
        this.rx = w * 0.38;
        this.ry = h * 0.34;
        // Rebuild caches
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
        const w = 64;  // base size — drawImage scales
        const h = 88;
        const cache = [];
        const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
        const suits = ['c', 'd', 'h', 's'];
        for (const suit of suits) {
            for (const rank of ranks) {
                cache.push(this._renderCardFace(rank, suit, w, h));
            }
        }
        cache.push(this._renderCardBack(w, h));  // index 52 = back
        this.cardCache = cache;
        this._cardIdx = (rank, suit) => {
            const ri = ranks.indexOf(rank);
            const si = suits.indexOf(suit);
            if (ri < 0 || si < 0) return 52;
            return si * 13 + ri;
        };
    }

    _renderCardFace(rank, suit, w, h) {
        const c = document.createElement('canvas');
        c.width = Math.round(w * this.dpr);
        c.height = Math.round(h * this.dpr);
        const cx = c.getContext('2d');
        cx.scale(this.dpr, this.dpr);
        // White background with subtle vertical gradient
        const g = cx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#e8e8ea');
        cx.fillStyle = g;
        this._roundRect(cx, 0.5, 0.5, w - 1, h - 1, 6);
        cx.fill();
        // Outer stroke
        cx.strokeStyle = '#0a0a0a';
        cx.lineWidth = 0.8;
        this._roundRect(cx, 0.5, 0.5, w - 1, h - 1, 6);
        cx.stroke();

        const red = (suit === 'h' || suit === 'd');
        cx.fillStyle = red ? '#d01a2e' : '#0a0a0a';

        // Top-left index
        cx.textAlign = 'left';
        cx.textBaseline = 'top';
        cx.font = `bold 16px -apple-system, "Helvetica Neue", sans-serif`;
        cx.fillText(rank === 'T' ? '10' : rank, 4, 3);
        cx.font = '12px sans-serif';
        cx.fillText(this._suitChar(suit), 5, 20);

        // Bottom-right index (rotated 180°)
        cx.save();
        cx.translate(w - 4, h - 3);
        cx.rotate(Math.PI);
        cx.font = `bold 16px -apple-system, "Helvetica Neue", sans-serif`;
        cx.fillText(rank === 'T' ? '10' : rank, 0, 0);
        cx.font = '12px sans-serif';
        cx.fillText(this._suitChar(suit), 1, 17);
        cx.restore();

        // Center suit (large)
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.font = 'bold 34px sans-serif';
        cx.fillText(this._suitChar(suit), w / 2, h / 2 + 2);

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
        // Seat 0 (hero) at 270° (bottom center). Others clockwise.
        // For 6 seats: 270, 330, 30, 90, 150, 210 (in ccw? check)
        // Actually use: 90 = bottom in standard canvas (y grows down).
        // Map seat i to angle: hero at 90° (bottom), go counter-clockwise
        const n = this.seatCount;
        const baseAngleDeg = 90;  // bottom center
        const step = 360 / n;
        const angle = (baseAngleDeg - i * step) * Math.PI / 180;
        const x = this.cx + Math.cos(angle) * this.rx;
        const y = this.cy + Math.sin(angle) * this.ry;
        return { x, y, angle };
    }

    // ============ Render loop ============

    _startRenderLoop() {
        const tick = (now) => {
            const dt = Math.min((now - this._lastFrame) / 1000, 0.05);
            this._lastFrame = now;
            // Advance tweens
            for (let i = this.activeTweens.length - 1; i >= 0; i--) {
                const tw = this.activeTweens[i];
                const t = Math.min(1, (now - tw.start) / tw.duration);
                tw.update(tw.easing ? tw.easing(t) : t);
                if (t >= 1) {
                    if (tw.done) tw.done();
                    this.activeTweens.splice(i, 1);
                }
                this._needsRedraw = true;
            }
            // Acting pulse animation
            if (this.state.actingSeat >= 0) this._needsRedraw = true;
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
        // Seats
        this._drawSeats();
        // Hole cards (hero's own cards shown face-up)
        this._drawHoleCards();
    }

    _drawDealerButton() {
        const s = this.state;
        if (s.dealerSeat < 0 || s.dealerSeat >= this.seatCount) return;
        const seat = this._seatPos(s.dealerSeat);
        // Offset the button toward center of table
        const dx = (this.cx - seat.x) * 0.22;
        const dy = (this.cy - seat.y) * 0.22;
        const bx = seat.x + dx;
        const by = seat.y + dy;
        const ctx = this.ctx;
        // Disc
        const g = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 11);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#d0d0d0');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Label
        ctx.fillStyle = '#1a1a1a';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('D', bx, by + 1);
    }

    _drawBoard() {
        const s = this.state;
        if (!s.board || s.board.length === 0) return;
        const cw = 36, ch = 50, gap = 5;
        const totalW = 5 * cw + 4 * gap;
        const startX = this.cx - totalW / 2;
        const y = this.cy - ch / 2 - 8;
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
        // Pot text above the board
        const label = `底池 ${s.pot.toFixed(1)} BB`;
        ctx.save();
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const metrics = ctx.measureText(label);
        const padX = 10, padY = 4;
        const boxW = metrics.width + padX * 2;
        const boxH = 20;
        const boxX = this.cx - boxW / 2;
        const boxY = this.cy - 45;
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
        for (let i = 0; i < this.seatCount; i++) {
            const bet = s.bets[i] || 0;
            if (bet <= 0) continue;
            const seat = this._seatPos(i);
            // Position bet slot halfway between seat and center
            const bx = seat.x + (this.cx - seat.x) * 0.35;
            const by = seat.y + (this.cy - seat.y) * 0.35;
            this._drawChipStack(bx, by, bet);
        }
    }

    _drawChipStack(x, y, amount) {
        if (!this.chipCache) return;
        const ctx = this.ctx;
        // Pick up to 3 chips of decreasing denomination
        const denoms = [100, 25, 5, 1];
        let remaining = amount;
        const chips = [];
        for (const d of denoms) {
            const n = Math.floor(remaining / d);
            if (n > 0) {
                chips.push({ d, n: Math.min(n, 3) });
                remaining -= n * d;
            }
        }
        // Draw stacked with slight y offset
        let stackY = y;
        let total = 0;
        for (const item of chips) {
            for (let k = 0; k < item.n; k++) {
                const denomIdx = [1, 5, 25, 100].indexOf(item.d);
                if (denomIdx < 0) continue;
                ctx.drawImage(this.chipCache[denomIdx], x - 14, stackY - 14, 28, 28);
                stackY -= 2.5;
                total++;
                if (total >= 5) break;
            }
            if (total >= 5) break;
        }
        // Amount text
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(amount.toFixed(1), x, y + 8);
    }

    _drawSeats() {
        const s = this.state;
        const now = performance.now();
        for (let i = 0; i < this.seatCount; i++) {
            const seat = s.seats[i] || {};
            const pos = this._seatPos(i);
            const isActing = i === s.actingSeat && s.street !== 'waiting';
            const isFolded = s.folded[i];
            this._drawSeat(seat, pos, isActing, isFolded, now);
        }
    }

    _drawSeat(seat, pos, isActing, isFolded, now) {
        const ctx = this.ctx;
        const { x, y } = pos;
        const plateW = 88, plateH = 44;
        const plateX = x - plateW / 2;
        const plateY = y - plateH / 2;

        ctx.save();
        if (isFolded) ctx.globalAlpha = 0.4;

        // Acting pulse ring
        if (isActing) {
            const pulse = 0.6 + 0.4 * Math.sin(now / 200);
            ctx.strokeStyle = `rgba(251, 191, 36, ${pulse})`;
            ctx.lineWidth = 2;
            this._roundRect(ctx, plateX - 3, plateY - 3, plateW + 6, plateH + 6, 10);
            ctx.stroke();
        }

        // Plate bg
        ctx.fillStyle = seat.isMe ? 'rgba(30, 58, 138, 0.75)' : 'rgba(0, 0, 0, 0.55)';
        this._roundRect(ctx, plateX, plateY, plateW, plateH, 8);
        ctx.fill();
        ctx.strokeStyle = seat.isMe ? 'rgba(99, 162, 255, 0.8)' : 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, plateX, plateY, plateW, plateH, 8);
        ctx.stroke();

        // Avatar circle (left side)
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

        // Initial letter
        const initial = (seat.name || '?')[0].toUpperCase();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(initial, avX, avY + 1);

        // Name + stack on right (full width — position pill is OUTSIDE plate)
        const textX = avX + avR + 8;
        const textW = plateW - (avR * 2 + 4 + 8);
        ctx.textAlign = 'left';
        ctx.fillStyle = seat.isEmpty ? 'rgba(99,162,255,0.9)' : '#f3f4f6';
        ctx.font = 'bold 11px sans-serif';
        ctx.textBaseline = 'top';
        const fullName = seat.isEmpty ? '空位' : (seat.name || 'Bot');
        const nameText = this._fitText(ctx, fullName, textW);
        ctx.fillText(nameText, textX, plateY + 5);
        // Stack
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(`${(seat.stack || 0).toFixed(1)}BB`, textX, plateY + 21);

        // All-in tag
        if (seat.allIn && !isFolded) {
            ctx.fillStyle = '#a855f7';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText('ALL-IN', textX, plateY + 35);
        }

        // Position pill — placed on the felt-facing edge of the plate
        // (below for top seats, above for bottom seats, inside for side seats).
        if (seat.position) {
            ctx.font = 'bold 9px sans-serif';
            const pw = ctx.measureText(seat.position).width + 8;
            const ph = 13;
            // Decide side based on seat location: above-center -> pill below plate
            const aboveCenter = pos.y < this.cy - 4;
            const pillY = aboveCenter ? (plateY + plateH + 2) : (plateY - ph - 2);
            const pillX = plateX + plateW / 2 - pw / 2;
            const posColors = {BTN:'#f59e0b',SB:'#a855f7',BB:'#ef4444',UTG:'#3b82f6',HJ:'#22c55e',CO:'#06b6d4'};
            ctx.fillStyle = posColors[seat.position] || 'rgba(251, 191, 36, 0.85)';
            this._roundRect(ctx, pillX, pillY, pw, ph, 6);
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
        const cw = 26, ch = 36;
        for (let i = 0; i < this.seatCount; i++) {
            const seat = s.seats[i];
            if (!seat || s.folded[i]) continue;
            const pos = this._seatPos(i);
            // Position cards ALONG THE VECTOR from seat toward table center,
            // so cards always sit on the felt (not outside the table).
            const dx = this.cx - pos.x;
            const dy = this.cy - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            // Push cards further away from the seat plate (~52px instead of 34)
            // to avoid overlapping the plate, especially for side seats.
            const offset = 52;
            const centerX = pos.x + (dx / dist) * offset;
            const centerY = pos.y + (dy / dist) * offset - ch / 2;

            const faceDown = !seat.isMe && !(seat.holeCards && seat.holeCards.length === 2 && s.street === 'showdown');
            const cards = seat.holeCards && seat.holeCards.length === 2 ? seat.holeCards : [null, null];

            if (seat.isMe || !faceDown) {
                // Show faces (hero, or showdown reveal)
                this._drawCardAt(cards[0], centerX - cw - 2, centerY, cw, ch, cards[0] == null);
                this._drawCardAt(cards[1], centerX + 2, centerY, cw, ch, cards[1] == null);
            } else {
                // Face-down
                this._drawCardAt(null, centerX - cw - 2, centerY, cw, ch, true);
                this._drawCardAt(null, centerX + 2, centerY, cw, ch, true);
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
