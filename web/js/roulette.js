// ============================================================
// Modern Roulette — Canvas wheel + ball physics
// ============================================================

class RouletteWheel {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.size = 280;
        this.canvas.width = this.size;
        this.canvas.height = this.size;
        this.cx = this.size / 2;
        this.cy = this.size / 2;
        this.wheelRadius = 120;
        this.ballTrackRadius = 108;
        this.pocketRadius = 95;

        // European wheel sequence
        this.sequence = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
        this.reds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
        this.numSlots = this.sequence.length;
        this.slotAngle = (Math.PI * 2) / this.numSlots;

        this.wheelAngle = 0;      // current wheel rotation
        this.ballAngle = 0;       // ball position angle
        this.ballRadius = 0;      // ball distance from center
        this.spinning = false;
        this.resultCallback = null;

        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        const cx = this.cx, cy = this.cy;
        ctx.clearRect(0, 0, this.size, this.size);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.wheelAngle);

        // Outer rim
        ctx.beginPath();
        ctx.arc(0, 0, this.wheelRadius + 8, 0, Math.PI * 2);
        ctx.fillStyle = '#2c1810';
        ctx.fill();
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw pockets
        for (let i = 0; i < this.numSlots; i++) {
            const angle = i * this.slotAngle - Math.PI / 2;
            const num = this.sequence[i];
            const isRed = this.reds.has(num);
            const isGreen = num === 0;

            // Pocket wedge
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, this.wheelRadius, angle, angle + this.slotAngle);
            ctx.closePath();
            ctx.fillStyle = isGreen ? '#0d6b2e' : isRed ? '#b22222' : '#1a1a2e';
            ctx.fill();
            ctx.strokeStyle = '#3a2a0a';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            // Number text
            ctx.save();
            ctx.rotate(angle + this.slotAngle / 2);
            ctx.translate(this.wheelRadius - 22, 0);
            ctx.rotate(Math.PI / 2);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(num, 0, 0);
            ctx.restore();
        }

        // Center hub
        ctx.beginPath();
        ctx.arc(0, 0, 25, 0, Math.PI * 2);
        ctx.fillStyle = '#1a2332';
        ctx.fill();
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();

        // Ball track (outer ring)
        ctx.beginPath();
        ctx.arc(cx, cy, this.ballTrackRadius + 14, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(139,105,20,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Ball
        if (this.ballRadius > 0) {
            const bx = cx + Math.cos(this.ballAngle) * this.ballRadius;
            const by = cy + Math.sin(this.ballAngle) * this.ballRadius;
            ctx.beginPath();
            ctx.arc(bx, by, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#e8e8e8';
            ctx.fill();
            ctx.strokeStyle = '#999';
            ctx.lineWidth = 1;
            ctx.stroke();
            // Ball shine
            ctx.beginPath();
            ctx.arc(bx - 1.5, by - 1.5, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
        }
    }

    spin(targetPocketIdx, callback) {
        if (this.spinning) return;
        this.spinning = true;
        this.resultCallback = callback;

        const duration = 5000; // 5 seconds
        const startTime = performance.now();
        const startWheelAngle = this.wheelAngle;
        const startBallAngle = Math.random() * Math.PI * 2;

        // Wheel spins clockwise slowly (2 rotations)
        const wheelSpins = 2 + Math.random();
        // Ball spins counter-clockwise fast then decelerates (6-8 rotations)
        const ballSpins = -(6 + Math.random() * 3);

        // Final ball position: must land on targetPocketIdx
        const targetAngle = -targetPocketIdx * this.slotAngle - this.slotAngle / 2 + Math.PI / 2;
        const finalWheelAngle = startWheelAngle + wheelSpins * Math.PI * 2;
        // Ball relative to wheel at rest
        const finalBallAngle = finalWheelAngle + targetAngle;
        const totalBallRotation = ballSpins * Math.PI * 2;

        const animate = (now) => {
            const elapsed = now - startTime;
            let t = Math.min(elapsed / duration, 1);

            // Ease out cubic for deceleration
            const ease = 1 - Math.pow(1 - t, 3);

            // Wheel rotation
            this.wheelAngle = startWheelAngle + (finalWheelAngle - startWheelAngle) * ease;

            // Ball: starts on outer track, spirals inward
            const ballEase = 1 - Math.pow(1 - t, 4); // even more deceleration
            this.ballAngle = startBallAngle + totalBallRotation * ballEase + (finalBallAngle - startBallAngle - totalBallRotation) * ease;

            // Ball radius: starts outer, moves to pocket
            if (t < 0.6) {
                this.ballRadius = this.ballTrackRadius + 5; // on the track
            } else if (t < 0.8) {
                // Transition into the wheel
                const dropT = (t - 0.6) / 0.2;
                this.ballRadius = this.ballTrackRadius + 5 - dropT * (this.ballTrackRadius + 5 - this.pocketRadius);
                // Add bounce effect
                this.ballRadius += Math.sin(dropT * Math.PI * 3) * 6 * (1 - dropT);
            } else {
                this.ballRadius = this.pocketRadius;
            }

            this.draw();

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this.spinning = false;
                this.ballRadius = this.pocketRadius;
                this.draw();
                if (this.resultCallback) this.resultCallback(this.sequence[targetPocketIdx]);
            }
        };

        this.ballRadius = this.ballTrackRadius + 5;
        requestAnimationFrame(animate);
    }
}
