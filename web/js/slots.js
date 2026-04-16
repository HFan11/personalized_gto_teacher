// ============================================================
// Canvas Slot Machine — 3-reel vertical scroll
// ============================================================

class SlotMachine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.W = 320;
        this.H = 200;
        this.canvas.width = this.W;
        this.canvas.height = this.H;

        this.symbols = ['🍒', '🍋', '🍊', '🔔', '7️⃣', '💎'];
        this.weights = [25, 20, 18, 15, 12, 10];

        this.reelWidth = 80;
        this.symbolHeight = 60;
        this.gap = 16;
        this.reelX = [(this.W - 3 * this.reelWidth - 2 * this.gap) / 2,
                      (this.W - 3 * this.reelWidth - 2 * this.gap) / 2 + this.reelWidth + this.gap,
                      (this.W - 3 * this.reelWidth - 2 * this.gap) / 2 + 2 * (this.reelWidth + this.gap)];

        // Each reel: array of symbol indices, offset (for scrolling)
        this.reels = [
            { symbols: this._generateStrip(30), offset: 0, speed: 0, target: null, stopped: true },
            { symbols: this._generateStrip(35), offset: 0, speed: 0, target: null, stopped: true },
            { symbols: this._generateStrip(40), offset: 0, speed: 0, target: null, stopped: true },
        ];
        this.results = [0, 0, 0]; // final symbol index per reel
        this.spinning = false;
        this.onComplete = null;

        this.draw();
    }

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

    draw() {
        const { ctx, W, H, reelWidth, symbolHeight, reelX, symbols } = this;
        // Background
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, W, H);

        // Machine frame
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, W - 4, H - 4);

        for (let r = 0; r < 3; r++) {
            const reel = this.reels[r];
            const x = reelX[r];
            const viewY = 10;
            const viewH = H - 20;

            // Reel background
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(x, viewY, reelWidth, viewH);

            // Draw symbols
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, viewY, reelWidth, viewH);
            ctx.clip();

            const offsetY = reel.offset % symbolHeight;
            const startIdx = Math.floor(reel.offset / symbolHeight);

            for (let i = -1; i <= Math.ceil(viewH / symbolHeight) + 1; i++) {
                const symIdx = (startIdx + i) % reel.symbols.length;
                const si = symIdx < 0 ? reel.symbols.length + symIdx : symIdx;
                const symbol = symbols[reel.symbols[si]];
                const y = viewY + i * symbolHeight - offsetY + symbolHeight / 2;

                if (y > viewY - symbolHeight && y < viewY + viewH + symbolHeight) {
                    ctx.font = '36px serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#fff';
                    ctx.fillText(symbol, x + reelWidth / 2, y);
                }
            }

            ctx.restore();

            // Reel border
            ctx.strokeStyle = '#8b6914';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, viewY, reelWidth, viewH);

            // Top/bottom fade
            const fadeH = 25;
            const topGrad = ctx.createLinearGradient(0, viewY, 0, viewY + fadeH);
            topGrad.addColorStop(0, '#0d0d1a');
            topGrad.addColorStop(1, 'rgba(13,13,26,0)');
            ctx.fillStyle = topGrad;
            ctx.fillRect(x, viewY, reelWidth, fadeH);

            const botGrad = ctx.createLinearGradient(0, viewY + viewH - fadeH, 0, viewY + viewH);
            botGrad.addColorStop(0, 'rgba(13,13,26,0)');
            botGrad.addColorStop(1, '#0d0d1a');
            ctx.fillStyle = botGrad;
            ctx.fillRect(x, viewY + viewH - fadeH, reelWidth, fadeH);
        }

        // Center payline
        ctx.strokeStyle = 'rgba(251,191,36,0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(reelX[0] - 4, H / 2);
        ctx.lineTo(reelX[2] + reelWidth + 4, H / 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    spin(results, callback) {
        if (this.spinning) return;
        this.spinning = true;
        this.onComplete = callback;
        this.results = results; // [symIdx, symIdx, symIdx]

        // Set final symbol at known position in each reel strip
        for (let r = 0; r < 3; r++) {
            const reel = this.reels[r];
            // Place result at a far position
            const targetPos = reel.symbols.length - 5 - r * 3;
            reel.symbols[targetPos] = results[r];
            // Target offset: center this symbol in view
            reel.target = targetPos * this.symbolHeight - (this.H / 2 - this.symbolHeight / 2 - 10);
            reel.speed = 15 + r * 2; // initial speed (px per frame)
            reel.stopped = false;
        }

        const stopTimes = [1200, 1800, 2400]; // ms when each reel starts decelerating

        const startTime = performance.now();
        const animate = (now) => {
            const elapsed = now - startTime;
            let allStopped = true;

            for (let r = 0; r < 3; r++) {
                const reel = this.reels[r];
                if (reel.stopped) continue;
                allStopped = false;

                if (elapsed < stopTimes[r]) {
                    // Full speed
                    reel.offset += reel.speed;
                } else {
                    // Decelerate toward target
                    const remaining = reel.target - reel.offset;
                    if (Math.abs(remaining) < 1) {
                        reel.offset = reel.target;
                        reel.stopped = true;
                    } else {
                        reel.offset += remaining * 0.12;
                    }
                }
            }

            this.draw();

            if (!allStopped) {
                requestAnimationFrame(animate);
            } else {
                this.spinning = false;
                this.draw();
                if (this.onComplete) this.onComplete();
            }
        };

        requestAnimationFrame(animate);
    }
}
