// ============================================================
// Premium Roulette Wheel — Chrome rim, glow trail, particles
// ============================================================

class RouletteWheel {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.size = Math.min(300, window.innerWidth - 40);
        this.canvas.width = this.size;
        this.canvas.height = this.size;
        this.cx = this.size / 2;
        this.cy = this.size / 2;

        const scale = this.size / 300;
        this.scale = scale;
        this.outerRadius = 140 * scale;
        this.rimInner = 130 * scale;
        this.wheelRadius = 125 * scale;
        this.trackRadius = 115 * scale;
        this.pocketRadius = 98 * scale;
        this.hubRadius = 28 * scale;
        this.ballSize = 5 * scale;

        // European single-zero layout
        this.sequence = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
        this.reds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
        this.N = this.sequence.length;
        this.slotArc = (Math.PI * 2) / this.N;

        this.wheelAngle = Math.random() * Math.PI * 2;
        this.ballAngle = 0;
        this.ballR = 0;
        this.spinning = false;
        this.lastResult = null;

        // Ball glow trail — ring buffer of last 10 positions
        this.trailBuffer = new Array(10);
        for (let i = 0; i < 10; i++) this.trailBuffer[i] = { x: 0, y: 0, active: false };
        this.trailIdx = 0;

        // Specular highlight angle (rotates during spin)
        this.specularAngle = 0;

        // Idle animation state
        this._idleRaf = null;
        this._lastIdleTime = 0;
        this._idleSparkleTimer = 0;

        // Spin loop sound handle
        this._spinLoopStop = null;
        this._lastTickAngle = 0;

        // Draw initial frame then start idle loop
        this.draw();
        this._startIdleLoop();
    }

    // ----------------------------------------------------------
    // Idle animation — subtle sparkles at ~30fps when not spinning
    // ----------------------------------------------------------
    _startIdleLoop() {
        if (this._idleRaf) return;
        this._lastIdleTime = performance.now();
        const loop = (now) => {
            if (this.spinning) {
                this._idleRaf = requestAnimationFrame(loop);
                return;
            }
            const dt = Math.min((now - this._lastIdleTime) / 1000, 0.05);
            this._lastIdleTime = now;

            this._idleSparkleTimer -= dt;
            if (this._idleSparkleTimer <= 0) {
                this._idleSparkleTimer = 0.25 + Math.random() * 0.4;
                // Emit a faint sparkle near the rim
                if (typeof casinoParticles !== 'undefined') {
                    const a = Math.random() * Math.PI * 2;
                    const r = this.outerRadius - 4 + Math.random() * 6;
                    casinoParticles.emit(
                        this.cx + Math.cos(a) * r,
                        this.cy + Math.sin(a) * r,
                        1,
                        { colors: ['#d0d0dd','#8a8a95','#c9a84c'], speed: 0.4, life: 0.6, size: 1.5, gravity: 0, shape: 'star' }
                    );
                }
            }

            // Update particles and floating text
            if (typeof casinoParticles !== 'undefined') casinoParticles.update(dt);
            if (typeof casinoFloatingText !== 'undefined') casinoFloatingText.update(dt);

            this.draw();
            this._idleRaf = requestAnimationFrame(loop);
        };
        this._idleRaf = requestAnimationFrame(loop);
    }

    // ----------------------------------------------------------
    // Main render
    // ----------------------------------------------------------
    draw() {
        const { ctx, cx, cy, size, wheelRadius, outerRadius, rimInner, hubRadius, N, slotArc, sequence, reds, scale } = this;
        ctx.clearRect(0, 0, size, size);

        // === Chrome metallic rim ===
        this._drawChromeRim(ctx, cx, cy, rimInner, outerRadius);

        // === Ball track groove ===
        ctx.beginPath();
        ctx.arc(cx, cy, this.trackRadius + 3 * scale, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 5 * scale;
        ctx.stroke();

        // Inner track subtle shadow
        ctx.beginPath();
        ctx.arc(cx, cy, this.trackRadius - 1 * scale, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();

        // === Wheel face (rotates) ===
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.wheelAngle);

        for (let i = 0; i < N; i++) {
            const a = i * slotArc - Math.PI / 2;
            const num = sequence[i];
            const isRed = reds.has(num);
            const isGreen = num === 0;

            // Pocket fill with radial gradient
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, wheelRadius, a, a + slotArc);
            ctx.closePath();

            if (isGreen) {
                const g = ctx.createRadialGradient(0, 0, wheelRadius * 0.2, 0, 0, wheelRadius);
                g.addColorStop(0, '#00994d');
                g.addColorStop(0.5, '#007a33');
                g.addColorStop(1, '#005522');
                ctx.fillStyle = g;
            } else if (isRed) {
                const g = ctx.createRadialGradient(0, 0, wheelRadius * 0.2, 0, 0, wheelRadius);
                g.addColorStop(0, '#e8333f');
                g.addColorStop(0.5, '#c41e2a');
                g.addColorStop(1, '#8a1018');
                ctx.fillStyle = g;
            } else {
                const g = ctx.createRadialGradient(0, 0, wheelRadius * 0.2, 0, 0, wheelRadius);
                g.addColorStop(0, '#1e1e2e');
                g.addColorStop(0.5, '#111118');
                g.addColorStop(1, '#0a0a12');
                ctx.fillStyle = g;
            }
            ctx.fill();

            // Gold pocket divider
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * (hubRadius + 2 * scale), Math.sin(a) * (hubRadius + 2 * scale));
            ctx.lineTo(Math.cos(a) * wheelRadius, Math.sin(a) * wheelRadius);
            ctx.strokeStyle = '#c9a84c';
            ctx.lineWidth = 1.2 * scale;
            ctx.stroke();

            // Number text with shadow for depth
            ctx.save();
            ctx.rotate(a + slotArc / 2);
            ctx.translate(wheelRadius - 18 * scale, 0);
            ctx.rotate(Math.PI / 2);
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            ctx.shadowBlur = 3 * scale;
            ctx.shadowOffsetY = 1 * scale;
            ctx.fillStyle = '#f0f0f0';
            ctx.font = `bold ${Math.round(9 * scale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(num), 0, 0);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.restore();
        }

        // Gold outer ring (pocket edge)
        ctx.beginPath();
        ctx.arc(0, 0, wheelRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#c9a84c';
        ctx.lineWidth = 1.5 * scale;
        ctx.stroke();

        // === Hub ===
        const hubGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, hubRadius);
        hubGrad.addColorStop(0, '#556677');
        hubGrad.addColorStop(0.5, '#3a4a5a');
        hubGrad.addColorStop(1, '#1a2332');
        ctx.beginPath();
        ctx.arc(0, 0, hubRadius, 0, Math.PI * 2);
        ctx.fillStyle = hubGrad;
        ctx.fill();

        // Hub gold border
        ctx.strokeStyle = '#c9a84c';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();

        // Hub highlight dot
        ctx.beginPath();
        ctx.arc(-4 * scale, -4 * scale, hubRadius * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();

        // Last result displayed in hub
        if (this.lastResult !== null) {
            const lr = this.lastResult;
            ctx.save();
            ctx.rotate(-this.wheelAngle); // counter-rotate for upright text
            ctx.shadowColor = lr === 0 ? '#00ff66' : this.reds.has(lr) ? '#ff4444' : '#aaaaff';
            ctx.shadowBlur = 10 * scale;
            ctx.fillStyle = lr === 0 ? '#00cc55' : this.reds.has(lr) ? '#ff5555' : '#e8ecf1';
            ctx.font = `bold ${Math.round(16 * scale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(lr), 0, 0);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        ctx.restore(); // end wheel rotation

        // === Ball trail + ball ===
        if (this.ballR > 0) {
            this._drawBallTrail(ctx, cx, cy);
            this._drawBall(ctx, cx, cy);
        }

        // === Overlay particles and floating text ===
        if (typeof casinoParticles !== 'undefined') casinoParticles.draw(ctx);
        if (typeof casinoFloatingText !== 'undefined') casinoFloatingText.draw(ctx);
    }

    // ----------------------------------------------------------
    // Chrome metallic rim with multi-stop gradient + specular
    // ----------------------------------------------------------
    _drawChromeRim(ctx, cx, cy, inner, outer) {
        // Outer chrome ring
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
        ctx.closePath();

        const rimGrad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
        rimGrad.addColorStop(0, '#3a3a42');
        rimGrad.addColorStop(0.2, '#8a8a95');
        rimGrad.addColorStop(0.45, '#d0d0dd');
        rimGrad.addColorStop(0.7, '#8a8a95');
        rimGrad.addColorStop(1, '#2a2a30');
        ctx.fillStyle = rimGrad;
        ctx.fill();

        // Rim edge shadows for depth
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1.5 * this.scale;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, inner, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1 * this.scale;
        ctx.stroke();

        // Rotating specular highlight arc during spin
        if (this.spinning) {
            ctx.beginPath();
            const mid = (inner + outer) / 2;
            const specLen = 0.5; // radians
            ctx.arc(cx, cy, mid, this.specularAngle - specLen / 2, this.specularAngle + specLen / 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = (outer - inner) * 0.6;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.lineCap = 'butt';
        } else {
            // Static subtle highlight at top
            ctx.beginPath();
            const mid = (inner + outer) / 2;
            ctx.arc(cx, cy, mid, -Math.PI * 0.6, -Math.PI * 0.4);
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = (outer - inner) * 0.5;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.lineCap = 'butt';
        }
        ctx.restore();
    }

    // ----------------------------------------------------------
    // Ball glow trail — fading circles from ring buffer
    // ----------------------------------------------------------
    _drawBallTrail(ctx, cx, cy) {
        if (!this.spinning) return;
        ctx.save();
        for (let k = 0; k < 10; k++) {
            // Read from oldest to newest
            const idx = (this.trailIdx + k) % 10;
            const pt = this.trailBuffer[idx];
            if (!pt.active) continue;
            const age = (10 - k) / 10; // 0=newest, 1=oldest
            const alpha = (1 - age) * 0.35;
            if (alpha <= 0) continue;
            const r = this.ballSize * (0.4 + (1 - age) * 0.6);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
            ctx.fill();
        }
        ctx.restore();
    }

    // ----------------------------------------------------------
    // Ball with glow
    // ----------------------------------------------------------
    _drawBall(ctx, cx, cy) {
        const bx = cx + Math.cos(this.ballAngle) * this.ballR;
        const by = cy + Math.sin(this.ballAngle) * this.ballR;

        ctx.save();
        // Outer glow
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 8 * this.scale;

        ctx.beginPath();
        ctx.arc(bx, by, this.ballSize, 0, Math.PI * 2);
        const ballGrad = ctx.createRadialGradient(
            bx - 1 * this.scale, by - 1 * this.scale, 0,
            bx, by, this.ballSize
        );
        ballGrad.addColorStop(0, '#ffffff');
        ballGrad.addColorStop(0.4, '#e8e8ee');
        ballGrad.addColorStop(0.75, '#b0b0bb');
        ballGrad.addColorStop(1, '#777788');
        ctx.fillStyle = ballGrad;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.restore();
    }

    // ----------------------------------------------------------
    // Record ball position into trail ring buffer
    // ----------------------------------------------------------
    _recordTrailPos(bx, by) {
        this.trailBuffer[this.trailIdx] = { x: bx, y: by, active: true };
        this.trailIdx = (this.trailIdx + 1) % 10;
    }

    // ----------------------------------------------------------
    // Spin animation
    // ----------------------------------------------------------
    spin(targetPocketIdx, callback) {
        if (this.spinning) return;
        this.spinning = true;
        this.lastResult = null;

        // Clear trail buffer
        for (let i = 0; i < 10; i++) this.trailBuffer[i].active = false;
        this.trailIdx = 0;

        // Sound: start spin loop
        let stopSpin = null;
        if (typeof casinoAudio !== 'undefined') {
            stopSpin = casinoAudio.spinLoop();
        }
        this._lastTickAngle = 0;

        const duration = 5000;
        const startTime = performance.now();
        const startWheel = this.wheelAngle;

        // Wheel: slow clockwise (2-3 turns)
        const wheelTurns = 2 + Math.random();
        const endWheel = startWheel + wheelTurns * Math.PI * 2;

        // Final ball absolute angle = where the pocket will be when wheel stops
        const endPocketAngle = endWheel + targetPocketIdx * this.slotArc - Math.PI / 2 + this.slotArc / 2;

        // Ball: counter-clockwise fast, total rotation = endPocketAngle + extra full turns
        const ballExtraTurns = 4 + Math.random() * 2;
        const startBallAngle = endPocketAngle + ballExtraTurns * Math.PI * 2;

        let prevTime = startTime;

        const animate = (now) => {
            const elapsed = now - startTime;
            const dt = Math.min((now - prevTime) / 1000, 0.05);
            prevTime = now;
            let t = Math.min(elapsed / duration, 1);

            // Wheel: smooth deceleration
            const wEase = 1 - Math.pow(1 - t, 2.5);
            this.wheelAngle = startWheel + (endWheel - startWheel) * wEase;

            // Ball: strong ease-out deceleration
            const bEase = 1 - Math.pow(1 - t, 3);
            this.ballAngle = startBallAngle + (endPocketAngle - startBallAngle) * bEase;

            // Ball radius: on track -> drop in -> settle
            if (t < 0.55) {
                this.ballR = this.trackRadius;
            } else if (t < 0.8) {
                const dropT = (t - 0.55) / 0.25;
                this.ballR = this.trackRadius - (this.trackRadius - this.pocketRadius) * (dropT * dropT);
                this.ballR += Math.sin(dropT * Math.PI * 3) * 4 * (1 - dropT);
            } else {
                this.ballR = this.pocketRadius;
            }

            // Specular highlight rotation
            this.specularAngle = this.wheelAngle * 0.7 + elapsed * 0.002;

            // Sound: modulate spin pitch + tick on pocket crossings
            if (stopSpin) {
                const speed = 1 - Math.pow(t, 2);
                stopSpin(0.5 + speed * 1.5);
            }
            if (typeof casinoAudio !== 'undefined') {
                const pocketsCrossed = Math.abs(this.ballAngle - startBallAngle) / this.slotArc;
                if (Math.floor(pocketsCrossed) > this._lastTickAngle && t < 0.85) {
                    this._lastTickAngle = Math.floor(pocketsCrossed);
                    // Tick frequency decreases as ball slows
                    const freq = 1200 + 800 * (1 - t);
                    if (this._lastTickAngle % 2 === 0) {
                        casinoAudio.tick(freq, 0.03);
                    }
                }
            }

            // Record trail position
            const bx = this.cx + Math.cos(this.ballAngle) * this.ballR;
            const by = this.cy + Math.sin(this.ballAngle) * this.ballR;
            this._recordTrailPos(bx, by);

            // Rim sparkle particles during spin (1-2 per frame)
            if (typeof casinoParticles !== 'undefined' && t < 0.9) {
                const sparkleCount = Math.random() < 0.5 ? 1 : 2;
                for (let s = 0; s < sparkleCount; s++) {
                    const a = Math.random() * Math.PI * 2;
                    const r = this.outerRadius - 2 + Math.random() * 4;
                    casinoParticles.emit(
                        this.cx + Math.cos(a) * r,
                        this.cy + Math.sin(a) * r,
                        1,
                        { colors: ['#d0d0dd','#ffffff','#c9a84c'], speed: 0.6, life: 0.4, size: 1.5, gravity: 0, shape: 'star' }
                    );
                }
            }

            // Update particles and floating text
            if (typeof casinoParticles !== 'undefined') casinoParticles.update(dt);
            if (typeof casinoFloatingText !== 'undefined') casinoFloatingText.update(dt);

            this.draw();

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                // Stop spin sound
                if (stopSpin) stopSpin();

                this.spinning = false;
                this.lastResult = this.sequence[targetPocketIdx];
                this.ballR = this.pocketRadius;

                // Win particle burst (40 particles)
                if (typeof casinoParticles !== 'undefined') {
                    const resultNum = this.lastResult;
                    const burstColors = resultNum === 0
                        ? ['#00ff66','#00cc55','#ffffff','#c9a84c']
                        : this.reds.has(resultNum)
                        ? ['#ff4444','#ff6666','#fbbf24','#ffffff']
                        : ['#8888ff','#aaaaff','#fbbf24','#ffffff'];
                    casinoParticles.emit(
                        this.cx + Math.cos(this.ballAngle) * this.ballR,
                        this.cy + Math.sin(this.ballAngle) * this.ballR,
                        40,
                        { colors: burstColors, speed: 2.5, life: 1.0, size: 3, gravity: 60, shape: 'star' }
                    );
                }

                // Clear trail
                for (let i = 0; i < 10; i++) this.trailBuffer[i].active = false;

                this.draw();
                if (callback) callback(this.lastResult);
            }
        };

        requestAnimationFrame(animate);

        // Safety: force-complete if rAF doesn't fire (background tab)
        setTimeout(() => {
            if (this.spinning) {
                this.spinning = false;
                this.wheelAngle = startWheel + targetWheelAngle;
                this.ballAngle = startBall + targetBallAngle;
                this.ballRadius = this.pocketR;
                this.lastResult = this.sequence[targetPocketIdx];
                this.draw();
                if (stopSpin) stopSpin();
                if (callback) callback(this.lastResult);
            }
        }, duration + 500);
    }
}
