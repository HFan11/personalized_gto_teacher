// ============================================================
// Modern Roulette — Canvas wheel + ball physics
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
        this.outerRadius = 135 * scale;
        this.wheelRadius = 125 * scale;
        this.trackRadius = 115 * scale;
        this.pocketRadius = 98 * scale;
        this.hubRadius = 28 * scale;
        this.ballSize = 5 * scale;

        this.sequence = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
        this.reds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
        this.N = this.sequence.length;
        this.slotArc = (Math.PI * 2) / this.N;

        this.wheelAngle = Math.random() * Math.PI * 2;
        this.ballAngle = 0;
        this.ballR = 0;
        this.spinning = false;
        this.lastResult = null;

        this.draw();
    }

    draw() {
        const { ctx, cx, cy, wheelRadius, outerRadius, hubRadius, N, slotArc, sequence, reds } = this;
        ctx.clearRect(0, 0, this.size, this.size);

        // Outer wooden rim
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
        const rimGrad = ctx.createRadialGradient(cx, cy, outerRadius - 10, cx, cy, outerRadius);
        rimGrad.addColorStop(0, '#5a3e1b');
        rimGrad.addColorStop(1, '#3a2510');
        ctx.fillStyle = rimGrad;
        ctx.fill();

        // Ball track groove
        ctx.beginPath();
        ctx.arc(cx, cy, this.trackRadius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 6;
        ctx.stroke();

        // Wheel face (rotates)
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.wheelAngle);

        for (let i = 0; i < N; i++) {
            const a = i * slotArc - Math.PI / 2;
            const num = sequence[i];
            const isRed = reds.has(num);
            const isGreen = num === 0;

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, wheelRadius, a, a + slotArc);
            ctx.closePath();
            ctx.fillStyle = isGreen ? '#0a7c34' : isRed ? '#c0272d' : '#1c1c3a';
            ctx.fill();
            ctx.strokeStyle = '#2a1a08';
            ctx.lineWidth = 0.8;
            ctx.stroke();

            // Number
            ctx.save();
            ctx.rotate(a + slotArc / 2);
            ctx.translate(wheelRadius - 18, 0);
            ctx.rotate(Math.PI / 2);
            ctx.fillStyle = '#f0f0f0';
            ctx.font = `bold ${Math.round(9 * this.size / 300)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(num), 0, 0);
            ctx.restore();

            // Pocket divider tick
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * (wheelRadius - 2), Math.sin(a) * (wheelRadius - 2));
            ctx.lineTo(Math.cos(a) * wheelRadius, Math.sin(a) * wheelRadius);
            ctx.strokeStyle = '#bbb';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Hub
        const hubGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, hubRadius);
        hubGrad.addColorStop(0, '#3a4a5a');
        hubGrad.addColorStop(1, '#1a2332');
        ctx.beginPath();
        ctx.arc(0, 0, hubRadius, 0, Math.PI * 2);
        ctx.fillStyle = hubGrad;
        ctx.fill();
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Show last result in hub
        if (this.lastResult !== null) {
            const lr = this.lastResult;
            ctx.save();
            ctx.rotate(-this.wheelAngle); // counter-rotate so text stays upright
            ctx.fillStyle = lr === 0 ? '#0a7c34' : this.reds.has(lr) ? '#e74c3c' : '#e8ecf1';
            ctx.font = `bold ${Math.round(16 * this.size / 300)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(lr), 0, 0);
            ctx.restore();
        }

        ctx.restore();

        // Ball
        if (this.ballR > 0) {
            const bx = cx + Math.cos(this.ballAngle) * this.ballR;
            const by = cy + Math.sin(this.ballAngle) * this.ballR;

            ctx.beginPath();
            ctx.arc(bx, by, this.ballSize, 0, Math.PI * 2);
            const ballGrad = ctx.createRadialGradient(bx - 1, by - 1, 0, bx, by, this.ballSize);
            ballGrad.addColorStop(0, '#ffffff');
            ballGrad.addColorStop(0.6, '#d0d0d0');
            ballGrad.addColorStop(1, '#888');
            ctx.fillStyle = ballGrad;
            ctx.fill();
        }
    }

    spin(targetPocketIdx, callback) {
        if (this.spinning) return;
        this.spinning = true;
        this.lastResult = null;

        const duration = 5500;
        const startTime = performance.now();
        const startWheel = this.wheelAngle;
        const startBall = Math.random() * Math.PI * 2;

        // Wheel: slow clockwise rotation (1.5-2.5 turns)
        const wheelTurns = 1.5 + Math.random();
        const endWheel = startWheel + wheelTurns * Math.PI * 2;

        // Ball: fast counter-clockwise, then lands in target pocket
        // At rest, pocket i is at angle: wheelAngle + i*slotArc - PI/2 + slotArc/2
        // Ball must be at that same absolute angle
        const endPocketAngle = endWheel + targetPocketIdx * this.slotArc - Math.PI / 2 + this.slotArc / 2;
        const ballTurns = -(5 + Math.random() * 3); // counter-clockwise fast
        const endBall = endPocketAngle; // final position = in the pocket

        const animate = (now) => {
            const elapsed = now - startTime;
            let t = Math.min(elapsed / duration, 1);

            // Wheel: linear spin then decelerate
            const wheelEase = t < 0.3 ? t / 0.3 : 1 - Math.pow((t - 0.3) / 0.7, 0.5) * 0 + 1;
            const wEase = 1 - Math.pow(1 - t, 2.5);
            this.wheelAngle = startWheel + (endWheel - startWheel) * wEase;

            // Ball: fast orbit decelerating, then converge to pocket
            const ballEase = 1 - Math.pow(1 - t, 3.5);
            // During spin (t<0.65): ball orbits on outer track
            // During drop (0.65-0.85): ball spirals in
            // During settle (0.85-1): ball in pocket
            const orbitAngle = startBall + ballTurns * Math.PI * 2 * ballEase;
            const settleT = Math.max(0, (t - 0.6) / 0.4);
            // Blend from orbit to final pocket position
            this.ballAngle = orbitAngle + (endBall - orbitAngle) * Math.pow(settleT, 2);

            if (t < 0.6) {
                this.ballR = this.trackRadius;
            } else if (t < 0.85) {
                const dropT = (t - 0.6) / 0.25;
                const dropEase = dropT * dropT;
                this.ballR = this.trackRadius - (this.trackRadius - this.pocketRadius) * dropEase;
                // Bounces
                this.ballR += Math.sin(dropT * Math.PI * 4) * 5 * (1 - dropT);
            } else {
                this.ballR = this.pocketRadius;
            }

            this.draw();

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this.spinning = false;
                this.lastResult = this.sequence[targetPocketIdx];
                this.ballR = this.pocketRadius;
                this.draw();
                if (callback) callback(this.lastResult);
            }
        };

        requestAnimationFrame(animate);
    }
}
