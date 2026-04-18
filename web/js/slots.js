// ============================================================
// Canvas Slot Machine — 3-reel vertical scroll (Premium Casino Edition)
// Depends on casino-fx.js globals: casinoAudio, casinoParticles,
//   casinoFloatingText, drawChaseLights
// ============================================================

class SlotMachine {
    constructor(canvas) {
        // Accept either a canvas element or an ID string
        this.canvas = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
        this.ctx = this.canvas.getContext('2d');

        // --- Responsive sizing ---
        this.W = Math.min(420, window.innerWidth - 40);
        this.H = Math.round(this.W * (280 / 420)); // proportional
        this.canvas.width = this.W;
        this.canvas.height = this.H;

        // --- Layout constants ---
        this.reelWidth = 105;
        this.symbolHeight = 78;
        this.gap = 16;
        this.headerH = 24;              // LED header zone
        this.frameInset = 14;           // total frame thickness
        this.chromeBand = 6;

        const reelAreaW = 3 * this.reelWidth + 2 * this.gap;
        const reelStartX = (this.W - reelAreaW) / 2;
        this.reelX = [
            reelStartX,
            reelStartX + this.reelWidth + this.gap,
            reelStartX + 2 * (this.reelWidth + this.gap)
        ];
        this.reelViewY = this.frameInset + this.headerH;
        this.reelViewH = this.H - this.reelViewY - this.frameInset;

        // --- Symbols & weights ---
        this.symbols = ['\u{1F352}', '\u{1F34B}', '\u{1F34A}', '\u{1F514}', '7\uFE0F\u20E3', '\u{1F48E}'];
        this.weights = [25, 20, 18, 15, 12, 10];

        // --- Reel state ---
        this.reels = [
            { symbols: this._generateStrip(30), offset: 0, speed: 0, target: null, stopped: true },
            { symbols: this._generateStrip(35), offset: 0, speed: 0, target: null, stopped: true },
            { symbols: this._generateStrip(40), offset: 0, speed: 0, target: null, stopped: true },
        ];
        this.results = [0, 0, 0];
        this.spinning = false;
        this.onComplete = null;

        // --- Animation state ---
        this._time = 0;
        this._lastFrame = performance.now();
        this._spinStopFn = null;     // spin audio stop handle
        this._headerFlashOn = false;
        this._headerFlashTimer = 0;
        this._celebrationState = null; // { tier, startTime, flash, particlesDone }

        // --- Chase lights state ---
        this._chaseLightsMode = 'idle'; // 'idle' | 'spin' | 'win'
        this._winStrobeEnd = 0;

        // --- Start ambient idle loop ---
        this._idleRAF = null;
        this._startIdleLoop();
    }

    // -------------------------------------------------------
    // Strip generation
    // -------------------------------------------------------
    _generateStrip(len) {
        const strip = [];
        for (let i = 0; i < len; i++) strip.push(this._pickWeighted());
        return strip;
    }

    _pickWeighted() {
        const total = this.weights.reduce((s, w) => s + w, 0);
        let r = Math.random() * total;
        for (let i = 0; i < this.symbols.length; i++) {
            r -= this.weights[i];
            if (r <= 0) return i;
        }
        return 0;
    }

    // -------------------------------------------------------
    // Main draw
    // -------------------------------------------------------
    draw() {
        const { ctx, W, H } = this;
        const now = performance.now();
        const dt = Math.min((now - this._lastFrame) / 1000, 0.05);
        this._lastFrame = now;
        this._time += dt;

        // --- Background ---
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, W, H);

        // --- Chase lights (behind frame) ---
        this._drawChaseLightsLayer(dt);

        // --- Chrome machine frame ---
        this._drawFrame();

        // --- LED header ---
        this._drawHeader(dt);

        // --- Reels ---
        this._drawReels(dt);

        // --- Reel separators ---
        this._drawReelSeparators();

        // --- Payline ---
        this._drawPayline();

        // --- Corner rivets ---
        this._drawRivets();

        // --- Celebration overlay ---
        if (this._celebrationState) {
            this._drawCelebration(dt);
        }

        // --- Particles & floating text (from casino-fx.js) ---
        if (typeof casinoParticles !== 'undefined') {
            casinoParticles.update(dt);
            casinoParticles.draw(ctx);
        }
        if (typeof casinoFloatingText !== 'undefined') {
            casinoFloatingText.update(dt);
            casinoFloatingText.draw(ctx);
        }
    }

    // -------------------------------------------------------
    // Chrome frame — multi-layer border
    // -------------------------------------------------------
    _drawFrame() {
        const { ctx, W, H, chromeBand } = this;

        // Outer dark border
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, W - 2, H - 2);

        // Chrome metallic gradient band
        const bandX = 3;
        const bandY = 3;
        const bandW = W - 6;
        const bandH = H - 6;

        // Top edge
        const topGrad = ctx.createLinearGradient(0, bandY, 0, bandY + chromeBand);
        topGrad.addColorStop(0, '#e8e8e8');
        topGrad.addColorStop(0.3, '#f5f5f5');
        topGrad.addColorStop(0.6, '#cccccc');
        topGrad.addColorStop(1, '#999999');
        ctx.fillStyle = topGrad;
        ctx.fillRect(bandX, bandY, bandW, chromeBand);

        // Bottom edge
        const botGrad = ctx.createLinearGradient(0, bandY + bandH - chromeBand, 0, bandY + bandH);
        botGrad.addColorStop(0, '#999999');
        botGrad.addColorStop(0.4, '#cccccc');
        botGrad.addColorStop(0.7, '#f5f5f5');
        botGrad.addColorStop(1, '#e8e8e8');
        ctx.fillStyle = botGrad;
        ctx.fillRect(bandX, bandY + bandH - chromeBand, bandW, chromeBand);

        // Left edge
        const leftGrad = ctx.createLinearGradient(bandX, 0, bandX + chromeBand, 0);
        leftGrad.addColorStop(0, '#e8e8e8');
        leftGrad.addColorStop(0.3, '#f5f5f5');
        leftGrad.addColorStop(0.6, '#cccccc');
        leftGrad.addColorStop(1, '#999999');
        ctx.fillStyle = leftGrad;
        ctx.fillRect(bandX, bandY + chromeBand, chromeBand, bandH - 2 * chromeBand);

        // Right edge
        const rightGrad = ctx.createLinearGradient(bandX + bandW - chromeBand, 0, bandX + bandW, 0);
        rightGrad.addColorStop(0, '#999999');
        rightGrad.addColorStop(0.4, '#cccccc');
        rightGrad.addColorStop(0.7, '#f5f5f5');
        rightGrad.addColorStop(1, '#e8e8e8');
        ctx.fillStyle = rightGrad;
        ctx.fillRect(bandX + bandW - chromeBand, bandY + chromeBand, chromeBand, bandH - 2 * chromeBand);

        // Inner neon gold glow
        ctx.save();
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
        ctx.lineWidth = 1.5;
        const innerX = bandX + chromeBand;
        const innerY = bandY + chromeBand;
        const innerW = bandW - 2 * chromeBand;
        const innerH = bandH - 2 * chromeBand;
        ctx.strokeRect(innerX, innerY, innerW, innerH);
        ctx.restore();
    }

    // -------------------------------------------------------
    // Corner rivets
    // -------------------------------------------------------
    _drawRivets() {
        const { ctx, W, H } = this;
        const r = 4;
        const offset = 8;
        const positions = [
            [offset, offset],
            [W - offset, offset],
            [offset, H - offset],
            [W - offset, H - offset]
        ];
        for (const [cx, cy] of positions) {
            // Metallic circle
            const grad = ctx.createRadialGradient(cx - 1, cy - 1, 0, cx, cy, r);
            grad.addColorStop(0, '#f0f0f0');
            grad.addColorStop(0.5, '#c0c0c0');
            grad.addColorStop(1, '#666666');
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
    }

    // -------------------------------------------------------
    // LED "LUCKY 777" header
    // -------------------------------------------------------
    _drawHeader(dt) {
        const { ctx, W, frameInset, headerH } = this;
        const centerY = frameInset + headerH / 2 + 2;

        // Flash logic during spin
        if (this.spinning) {
            this._headerFlashTimer += dt;
            if (this._headerFlashTimer >= 0.2) {
                this._headerFlashTimer = 0;
                this._headerFlashOn = !this._headerFlashOn;
            }
        } else {
            this._headerFlashOn = false;
            this._headerFlashTimer = 0;
        }

        const color = (this.spinning && this._headerFlashOn) ? '#ef4444' : '#fbbf24';

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText('LUCKY  777', W / 2, centerY);
        // Double-draw for stronger glow
        ctx.fillText('LUCKY  777', W / 2, centerY);
        ctx.restore();
    }

    // -------------------------------------------------------
    // Chase lights layer
    // -------------------------------------------------------
    _drawChaseLightsLayer(_dt) {
        if (typeof drawChaseLights === 'undefined') return;
        const { ctx, W, H, _time } = this;
        let speed, c1, c2;
        if (this._chaseLightsMode === 'win' && this._time < this._winStrobeEnd) {
            speed = 4;
            c1 = '#ffffff';
            c2 = '#fbbf24';
        } else if (this.spinning) {
            speed = 2;
            c1 = '#fbbf24';
            c2 = '#ef4444';
            this._chaseLightsMode = 'spin';
        } else {
            speed = 0.5;
            c1 = '#f5f0e0';
            c2 = '#d4c9a8';
            this._chaseLightsMode = 'idle';
        }
        drawChaseLights(ctx, 0, 0, W, H, _time, 18, c1, c2, speed);
    }

    // -------------------------------------------------------
    // Reels with reel background gradient + motion blur
    // -------------------------------------------------------
    _drawReels(_dt) {
        const { ctx, reelWidth, symbolHeight, reelX, symbols, reelViewY, reelViewH } = this;

        for (let r = 0; r < 3; r++) {
            const reel = this.reels[r];
            const x = reelX[r];

            // Reel background — subtle vertical gradient (darker at edges)
            const bgGrad = ctx.createLinearGradient(x, 0, x + reelWidth, 0);
            bgGrad.addColorStop(0, '#141428');
            bgGrad.addColorStop(0.15, '#1c1c36');
            bgGrad.addColorStop(0.5, '#20203e');
            bgGrad.addColorStop(0.85, '#1c1c36');
            bgGrad.addColorStop(1, '#141428');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, reelViewY, reelWidth, reelViewH);

            // Clip to reel area
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, reelViewY, reelWidth, reelViewH);
            ctx.clip();

            const isMoving = !reel.stopped && reel.speed > 0;
            const motionBlurThreshold = 6;
            const useMotionBlur = isMoving && Math.abs(reel.speed) > motionBlurThreshold;

            if (useMotionBlur) {
                // Motion blur: 3 offset copies at low alpha
                const blurOffsets = [-symbolHeight * 0.18, 0, symbolHeight * 0.18];
                const baseAlpha = 0.12;
                for (const bOff of blurOffsets) {
                    ctx.globalAlpha = baseAlpha;
                    this._drawReelSymbols(ctx, reel, x, reelViewY, reelViewH, bOff);
                }
                ctx.globalAlpha = 1;
            } else {
                // Sharp draw (or decelerating: blend from blur to sharp)
                this._drawReelSymbols(ctx, reel, x, reelViewY, reelViewH, 0);
            }

            ctx.restore();

            // Top/bottom fade overlays
            const fadeH = 30;
            const topGrad = ctx.createLinearGradient(0, reelViewY, 0, reelViewY + fadeH);
            topGrad.addColorStop(0, '#0d0d1a');
            topGrad.addColorStop(1, 'rgba(13,13,26,0)');
            ctx.fillStyle = topGrad;
            ctx.fillRect(x, reelViewY, reelWidth, fadeH);

            const botGrad = ctx.createLinearGradient(0, reelViewY + reelViewH - fadeH, 0, reelViewY + reelViewH);
            botGrad.addColorStop(0, 'rgba(13,13,26,0)');
            botGrad.addColorStop(1, '#0d0d1a');
            ctx.fillStyle = botGrad;
            ctx.fillRect(x, reelViewY + reelViewH - fadeH, reelWidth, fadeH);
        }
    }

    _drawReelSymbols(ctx, reel, x, viewY, viewH, extraOffset) {
        const { reelWidth, symbolHeight } = this;
        const offsetY = reel.offset % symbolHeight;
        const startIdx = Math.floor(reel.offset / symbolHeight);

        for (let i = -1; i <= Math.ceil(viewH / symbolHeight) + 1; i++) {
            const symIdx = (startIdx + i) % reel.symbols.length;
            const si = symIdx < 0 ? reel.symbols.length + symIdx : symIdx;
            const symbolId = reel.symbols[si];
            const y = viewY + i * symbolHeight - offsetY + symbolHeight / 2 + extraOffset;

            if (y > viewY - symbolHeight && y < viewY + viewH + symbolHeight) {
                SlotMachine.drawCasinoSymbol(ctx, symbolId, x + reelWidth / 2, y, Math.min(reelWidth, symbolHeight) * 0.45);
            }
        }
    }

    // Vegas-style symbol renderer: gradients, outlines, and glow.
    // symbolId: 0=cherry, 1=lemon, 2=orange, 3=bell, 4=seven, 5=diamond
    static drawCasinoSymbol(ctx, id, cx, cy, r) {
        ctx.save();
        switch (id) {
            case 0: SlotMachine._drawCherry(ctx, cx, cy, r); break;
            case 1: SlotMachine._drawLemon(ctx, cx, cy, r); break;
            case 2: SlotMachine._drawOrange(ctx, cx, cy, r); break;
            case 3: SlotMachine._drawBell(ctx, cx, cy, r); break;
            case 4: SlotMachine._drawSeven(ctx, cx, cy, r); break;
            case 5: SlotMachine._drawDiamond(ctx, cx, cy, r); break;
        }
        ctx.restore();
    }

    static _drawCherry(ctx, cx, cy, r) {
        // Stem + two red cherries, with a highlight dot
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.strokeStyle = '#2d6b28';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.7);
        ctx.quadraticCurveTo(cx - r * 0.1, cy - r * 1.1, cx - r * 0.45, cy - r * 0.1);
        ctx.moveTo(cx, cy - r * 0.7);
        ctx.quadraticCurveTo(cx + r * 0.1, cy - r * 1.1, cx + r * 0.45, cy - r * 0.1);
        ctx.stroke();
        // Leaf
        ctx.fillStyle = '#4caf50';
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.12, cy - r * 0.8, r * 0.22, r * 0.1, -0.4, 0, Math.PI * 2);
        ctx.fill();
        // Left cherry
        const g1 = ctx.createRadialGradient(cx - r * 0.55, cy, r * 0.05, cx - r * 0.45, cy + r * 0.1, r * 0.55);
        g1.addColorStop(0, '#ff6b7a'); g1.addColorStop(0.6, '#c41e2a'); g1.addColorStop(1, '#6a0d14');
        ctx.fillStyle = g1;
        ctx.beginPath(); ctx.arc(cx - r * 0.45, cy + r * 0.1, r * 0.45, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(cx - r * 0.6, cy - r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();
        // Right cherry
        const g2 = ctx.createRadialGradient(cx + r * 0.35, cy, r * 0.05, cx + r * 0.45, cy + r * 0.1, r * 0.55);
        g2.addColorStop(0, '#ff6b7a'); g2.addColorStop(0.6, '#c41e2a'); g2.addColorStop(1, '#6a0d14');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(cx + r * 0.45, cy + r * 0.1, r * 0.45, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(cx + r * 0.3, cy - r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();
    }

    static _drawLemon(ctx, cx, cy, r) {
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r * 0.95);
        g.addColorStop(0, '#fffbd5'); g.addColorStop(0.4, '#f7d940'); g.addColorStop(1, '#b58700');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.85, r * 0.65, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#8a6200'; ctx.lineWidth = r * 0.05;
        ctx.stroke();
        // Tips (little bumps)
        ctx.fillStyle = '#d9a900';
        ctx.beginPath(); ctx.arc(cx - r * 0.85, cy, r * 0.1, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.85, cy, r * 0.1, 0, Math.PI * 2); ctx.fill();
        // Shine
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath(); ctx.ellipse(cx - r * 0.25, cy - r * 0.25, r * 0.25, r * 0.1, -0.5, 0, Math.PI * 2); ctx.fill();
    }

    static _drawOrange(ctx, cx, cy, r) {
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r * 0.95);
        g.addColorStop(0, '#ffd08a'); g.addColorStop(0.4, '#ff8c1a'); g.addColorStop(1, '#a04500');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7c3000'; ctx.lineWidth = r * 0.05;
        ctx.stroke();
        // Top leaf
        ctx.fillStyle = '#2d6b28';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.1, cy - r * 0.8, r * 0.22, r * 0.08, -0.6, 0, Math.PI * 2);
        ctx.ellipse(cx + r * 0.1, cy - r * 0.8, r * 0.22, r * 0.08, 0.6, 0, Math.PI * 2);
        ctx.fill();
        // Shine
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.ellipse(cx - r * 0.25, cy - r * 0.3, r * 0.22, r * 0.1, -0.5, 0, Math.PI * 2); ctx.fill();
    }

    static _drawBell(ctx, cx, cy, r) {
        // Main bell body with gold gradient
        const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        g.addColorStop(0, '#fff0a8'); g.addColorStop(0.4, '#fbbf24'); g.addColorStop(0.8, '#b8860b'); g.addColorStop(1, '#5a3d00');
        ctx.fillStyle = g;
        ctx.strokeStyle = '#4a2d00'; ctx.lineWidth = r * 0.06;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.8);
        ctx.bezierCurveTo(cx + r * 0.6, cy - r * 0.7, cx + r * 0.75, cy + r * 0.15, cx + r * 0.8, cy + r * 0.45);
        ctx.lineTo(cx - r * 0.8, cy + r * 0.45);
        ctx.bezierCurveTo(cx - r * 0.75, cy + r * 0.15, cx - r * 0.6, cy - r * 0.7, cx, cy - r * 0.8);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        // Bottom rim
        ctx.fillStyle = '#8b6914';
        ctx.fillRect(cx - r * 0.88, cy + r * 0.42, r * 1.76, r * 0.12);
        // Clapper
        ctx.fillStyle = '#4a2d00';
        ctx.beginPath(); ctx.arc(cx, cy + r * 0.65, r * 0.13, 0, Math.PI * 2); ctx.fill();
        // Highlight
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.ellipse(cx - r * 0.3, cy - r * 0.3, r * 0.15, r * 0.35, -0.3, 0, Math.PI * 2); ctx.fill();
        // Top knob
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy - r * 0.83, r * 0.08, 0, Math.PI * 2); ctx.fill();
    }

    static _drawSeven(ctx, cx, cy, r) {
        // Neon-red 7 with gold outline + glow
        ctx.save();
        ctx.shadowColor = '#ff2040'; ctx.shadowBlur = r * 0.35;
        ctx.font = `900 ${Math.round(r * 1.8)}px Impact, "Arial Black", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Gold outline (thick)
        ctx.lineWidth = r * 0.2;
        ctx.strokeStyle = '#fbbf24';
        ctx.strokeText('7', cx, cy + r * 0.05);
        // Red fill
        const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
        g.addColorStop(0, '#ff5c6e'); g.addColorStop(0.5, '#e11d2e'); g.addColorStop(1, '#7a0d18');
        ctx.fillStyle = g;
        ctx.fillText('7', cx, cy + r * 0.05);
        // Inner highlight
        ctx.shadowBlur = 0;
        ctx.lineWidth = r * 0.05;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.strokeText('7', cx - r * 0.02, cy + r * 0.03);
        ctx.restore();
    }

    static _drawDiamond(ctx, cx, cy, r) {
        // Classic gem shape with faceted gradient
        const topY = cy - r * 0.75;
        const bottomY = cy + r * 0.9;
        const leftX = cx - r * 0.8;
        const rightX = cx + r * 0.8;
        const midY = cy - r * 0.2;
        // Main faceted body
        const g = ctx.createLinearGradient(leftX, topY, rightX, bottomY);
        g.addColorStop(0, '#d8f4ff'); g.addColorStop(0.3, '#6fc8ff'); g.addColorStop(0.7, '#2a7fc0'); g.addColorStop(1, '#0b3058');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(rightX, midY);
        ctx.lineTo(cx, bottomY);
        ctx.lineTo(leftX, midY);
        ctx.closePath();
        ctx.fill();
        // Top facet highlight
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(rightX, midY);
        ctx.lineTo(cx, midY + r * 0.1);
        ctx.closePath();
        ctx.fill();
        // Faint inner lines
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = r * 0.04;
        ctx.beginPath();
        ctx.moveTo(leftX, midY); ctx.lineTo(rightX, midY);
        ctx.moveTo(cx, topY); ctx.lineTo(cx, bottomY);
        ctx.stroke();
        // Outer edge
        ctx.strokeStyle = '#07243d'; ctx.lineWidth = r * 0.05;
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(rightX, midY);
        ctx.lineTo(cx, bottomY);
        ctx.lineTo(leftX, midY);
        ctx.closePath();
        ctx.stroke();
        // Sparkle
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx - r * 0.35, topY + r * 0.3, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
    }

    // -------------------------------------------------------
    // Reel separators (chrome dividers)
    // -------------------------------------------------------
    _drawReelSeparators() {
        const { ctx, reelX, reelWidth, reelViewY, reelViewH, gap } = this;
        for (let r = 0; r < 2; r++) {
            const sepX = reelX[r] + reelWidth + gap / 2;
            // Bright line
            ctx.strokeStyle = '#c0c0c0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sepX, reelViewY + 2);
            ctx.lineTo(sepX, reelViewY + reelViewH - 2);
            ctx.stroke();
            // Dark line (shadow)
            ctx.strokeStyle = '#333333';
            ctx.beginPath();
            ctx.moveTo(sepX + 1, reelViewY + 2);
            ctx.lineTo(sepX + 1, reelViewY + reelViewH - 2);
            ctx.stroke();
        }
    }

    // -------------------------------------------------------
    // Payline — gold with glow + arrow markers
    // -------------------------------------------------------
    _drawPayline() {
        const { ctx, reelX, reelWidth, reelViewY, reelViewH } = this;
        const payY = reelViewY + reelViewH / 2;
        const leftX = reelX[0] - 6;
        const rightX = reelX[2] + reelWidth + 6;

        ctx.save();
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 4;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(leftX, payY);
        ctx.lineTo(rightX, payY);
        ctx.stroke();

        // Arrow markers at edges
        const arrowSize = 5;
        ctx.fillStyle = '#fbbf24';
        // Left arrow
        ctx.beginPath();
        ctx.moveTo(leftX, payY);
        ctx.lineTo(leftX + arrowSize, payY - arrowSize);
        ctx.lineTo(leftX + arrowSize, payY + arrowSize);
        ctx.closePath();
        ctx.fill();
        // Right arrow
        ctx.beginPath();
        ctx.moveTo(rightX, payY);
        ctx.lineTo(rightX - arrowSize, payY - arrowSize);
        ctx.lineTo(rightX - arrowSize, payY + arrowSize);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    // -------------------------------------------------------
    // Spin — animate reels to given results
    // -------------------------------------------------------
    spin(results, callback) {
        if (this.spinning) return;
        this.spinning = true;
        this.onComplete = callback;
        this.results = results;
        this._celebrationState = null;

        // Sound: start spin loop
        if (typeof casinoAudio !== 'undefined') {
            this._spinStopFn = casinoAudio.spinLoop();
        }

        // Set final symbol at known position in each reel strip
        for (let r = 0; r < 3; r++) {
            const reel = this.reels[r];
            const targetPos = reel.symbols.length - 5 - r * 3;
            reel.symbols[targetPos] = results[r];
            reel.target = targetPos * this.symbolHeight - (this.reelViewY + this.reelViewH / 2 - this.symbolHeight / 2 - this.reelViewY);
            reel.speed = 18 + r * 3;
            reel.stopped = false;
        }

        const stopTimes = [1200, 1800, 2400];
        const maxDuration = 5000; // safety: force stop after 5s
        const startTime = performance.now();
        let lastFrame = startTime;

        // Stop idle loop — spin drives its own animation
        this._stopIdleLoop();

        const finishSpin = () => {
            // Stop spin audio
            if (this._spinStopFn) {
                this._spinStopFn(); // call with no args to stop
                this._spinStopFn = null;
            }
            this.spinning = false;
            this.draw();
            this._startIdleLoop();
            if (this.onComplete) this.onComplete();
        };

        const animate = (now) => {
            const elapsed = now - startTime;
            const dt = Math.min(now - lastFrame, 100); // cap dt to avoid jumps
            lastFrame = now;

            // Safety: force-snap all reels after maxDuration
            if (elapsed > maxDuration) {
                for (let r = 0; r < 3; r++) {
                    this.reels[r].offset = this.reels[r].target;
                    this.reels[r].stopped = true;
                    this.reels[r].speed = 0;
                }
                this.draw();
                finishSpin();
                return;
            }

            let allStopped = true;

            for (let r = 0; r < 3; r++) {
                const reel = this.reels[r];
                if (reel.stopped) continue;
                allStopped = false;

                if (elapsed < stopTimes[r]) {
                    // Full speed (time-based: speed pixels per 16ms frame)
                    reel.offset += reel.speed * (dt / 16);
                    // Modulate spin audio pitch
                    if (this._spinStopFn) {
                        this._spinStopFn(1.0 + Math.sin(elapsed * 0.003) * 0.1);
                    }
                } else {
                    // Time-based deceleration: ease toward target
                    const decelElapsed = elapsed - stopTimes[r];
                    const decelDuration = 600; // ms to fully settle
                    const t = Math.min(1, decelElapsed / decelDuration);
                    const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out

                    if (!reel._decelStart) {
                        reel._decelStart = reel.offset; // capture start of deceleration
                    }

                    reel.offset = reel._decelStart + (reel.target - reel._decelStart) * eased;
                    reel.speed = Math.abs(reel.target - reel.offset) * 0.1;

                    if (t >= 1) {
                        reel.offset = reel.target;
                        reel.stopped = true;
                        reel.speed = 0;
                        reel._decelStart = null;
                        // Sound: tick on each reel stop
                        if (typeof casinoAudio !== 'undefined') {
                            casinoAudio.tick();
                        }
                    }
                }
            }

            this.draw();

            if (!allStopped) {
                requestAnimationFrame(animate);
            } else {
                finishSpin();
            }
        };

        requestAnimationFrame(animate);

        // Safety: force-complete if rAF doesn't fire (background tab / extension control)
        setTimeout(() => {
            if (this.spinning) {
                for (let r = 0; r < 3; r++) {
                    this.reels[r].offset = this.reels[r].target;
                    this.reels[r].stopped = true;
                    this.reels[r].speed = 0;
                    this.reels[r]._decelStart = null;
                }
                this.draw();
                finishSpin();
            }
        }, maxDuration + 500);
    }

    // -------------------------------------------------------
    // Celebrate — tiered win effects
    // -------------------------------------------------------
    celebrate(tier) {
        const { W, reelViewY, reelViewH } = this;
        const centerX = W / 2;
        const centerY = reelViewY + reelViewH / 2;

        this._celebrationState = {
            tier: tier,
            startTime: this._time,
            flashAlpha: tier >= 3 ? 0.4 : tier >= 2 ? 0.25 : 0.15,
            holdDuration: tier >= 3 ? 1.0 : 0.2,
        };

        // Chase lights: win strobe
        this._chaseLightsMode = 'win';
        this._winStrobeEnd = this._time + (tier >= 3 ? 2.0 : tier >= 2 ? 1.0 : 0.5);

        // Sound
        if (typeof casinoAudio !== 'undefined') {
            casinoAudio.winJingle(tier);
        }

        // Tier 2+: particles
        if (tier >= 2 && typeof casinoParticles !== 'undefined') {
            const count = tier >= 3 ? 60 : 20;
            casinoParticles.emit(centerX, centerY, count, {
                colors: ['#fbbf24', '#f59e0b', '#fff', '#ef4444', '#a855f7'],
                speed: tier >= 3 ? 5 : 3,
                life: tier >= 3 ? 1.5 : 1.0,
                size: tier >= 3 ? 4 : 3,
                shape: tier >= 3 ? 'star' : 'circle',
            });
        }

        // Tier 2+: floating text
        if (tier >= 2 && typeof casinoFloatingText !== 'undefined') {
            if (tier >= 3) {
                casinoFloatingText.add('JACKPOT!', centerX, centerY - 20, '#fbbf24', 2.0, 28);
            } else {
                // Caller can customize this, but default to generic
                casinoFloatingText.add('BIG WIN!', centerX, centerY - 20, '#fbbf24', 1.5, 22);
            }
        }
    }

    _drawCelebration(dt) {
        const state = this._celebrationState;
        if (!state) return;
        const { ctx, W, H } = this;
        const elapsed = this._time - state.startTime;

        if (elapsed > state.holdDuration + 0.5) {
            this._celebrationState = null;
            return;
        }

        // White flash overlay, fading out
        let alpha;
        if (elapsed < 0.05) {
            alpha = state.flashAlpha; // instant peak
        } else if (elapsed < state.holdDuration) {
            alpha = state.flashAlpha * (1 - elapsed / state.holdDuration);
        } else {
            alpha = 0;
        }

        if (alpha > 0) {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }
    }

    // -------------------------------------------------------
    // Idle animation loop (ambient chase lights + glow)
    // -------------------------------------------------------
    _startIdleLoop() {
        if (this._idleRAF) return;
        const tick = () => {
            if (this.spinning) { this._idleRAF = null; return; }
            this.draw();
            this._idleRAF = requestAnimationFrame(tick);
        };
        this._idleRAF = requestAnimationFrame(tick);
    }

    _stopIdleLoop() {
        if (this._idleRAF) {
            cancelAnimationFrame(this._idleRAF);
            this._idleRAF = null;
        }
    }
}
