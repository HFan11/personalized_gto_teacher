// ============================================================
// Casino FX — Shared visual effects for Roulette & Slots
// Audio (Web Audio API oscillators), Particles, Floating Text, Chase Lights
// ============================================================

// --- Casino Audio Engine (oscillator-based, no audio files) ---
class CasinoAudio {
    constructor() {
        this.ctx = null; // lazy-init AudioContext
        this._enabled = true;
    }

    _init() {
        if (this.ctx) return;
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch(e) { this._enabled = false; }
    }

    _isMuted() {
        if (!this._enabled) return true;
        try {
            const s = JSON.parse(localStorage.getItem('pokergto_settings') || '{}');
            return s.sound === false;
        } catch(e) { return false; }
    }

    // Short click/tick (ball passing pocket, reel stopping)
    tick(freq = 1800, duration = 0.04) {
        if (this._isMuted()) return;
        this._init(); if (!this.ctx) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.12, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + duration + 0.01);
    }

    // Continuous spin tone — returns a stop function
    spinLoop(baseFreq = 220) {
        if (this._isMuted()) return () => {};
        this._init(); if (!this.ctx) return () => {};
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = baseFreq;
        g.gain.value = 0.06;
        o.connect(g); g.connect(this.ctx.destination);
        o.start();
        let stopped = false;
        return (freqMult) => {
            if (stopped) return;
            if (freqMult !== undefined && freqMult > 0) {
                o.frequency.value = baseFreq * freqMult;
            } else {
                stopped = true;
                g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
                o.stop(this.ctx.currentTime + 0.35);
            }
        };
    }

    // Win jingle — ascending arpeggio (tier 1=small, 2=medium, 3=jackpot)
    winJingle(tier = 1) {
        if (this._isMuted()) return;
        this._init(); if (!this.ctx) return;
        const notes = tier >= 3
            ? [523, 659, 784, 1047, 1319, 1568]   // C5-G6 jackpot
            : tier >= 2
            ? [440, 554, 659, 880]                  // A4-A5 medium
            : [523, 659, 784];                       // C5-G5 small
        const dur = tier >= 3 ? 0.15 : 0.1;
        const vol = tier >= 3 ? 0.15 : 0.1;
        notes.forEach((freq, i) => {
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = tier >= 3 ? 'square' : 'sine';
            o.frequency.value = freq;
            const t = this.ctx.currentTime + i * dur;
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur * 2);
            o.connect(g); g.connect(this.ctx.destination);
            o.start(t); o.stop(t + dur * 2.5);
        });
    }

    // Loss thud — low frequency short pulse
    loseThud() {
        if (this._isMuted()) return;
        this._init(); if (!this.ctx) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 80;
        o.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.15);
        g.gain.setValueAtTime(0.15, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + 0.25);
    }
}

// --- Particle System (pool-based, lightweight) ---
class ParticleSystem {
    constructor(maxParticles = 200) {
        this.pool = [];
        for (let i = 0; i < maxParticles; i++) {
            this.pool.push({ alive: false, x:0, y:0, vx:0, vy:0, life:0, maxLife:1, size:3, color:'#fff', gravity:0, shape:'circle' });
        }
    }

    emit(x, y, count, opts = {}) {
        const colors = opts.colors || ['#fbbf24','#f59e0b','#fff','#ef4444'];
        const speed = opts.speed || 3;
        const life = opts.life || 1.0;
        const size = opts.size || 3;
        const gravity = opts.gravity ?? 80;
        const shape = opts.shape || 'circle';
        let emitted = 0;
        for (const p of this.pool) {
            if (p.alive || emitted >= count) continue;
            const angle = Math.random() * Math.PI * 2;
            const spd = speed * (0.3 + Math.random() * 0.7);
            p.x = x + (Math.random() - 0.5) * 4;
            p.y = y + (Math.random() - 0.5) * 4;
            p.vx = Math.cos(angle) * spd * 60;
            p.vy = Math.sin(angle) * spd * 60;
            p.life = life * (0.5 + Math.random() * 0.5);
            p.maxLife = p.life;
            p.size = size * (0.6 + Math.random() * 0.4);
            p.color = colors[Math.floor(Math.random() * colors.length)];
            p.gravity = gravity;
            p.shape = shape;
            p.alive = true;
            emitted++;
        }
    }

    update(dt) {
        for (const p of this.pool) {
            if (!p.alive) continue;
            p.life -= dt;
            if (p.life <= 0) { p.alive = false; continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += p.gravity * dt;
            p.vx *= 0.99;
        }
    }

    draw(ctx) {
        for (const p of this.pool) {
            if (!p.alive) continue;
            const alpha = Math.max(0, p.life / p.maxLife);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            if (p.shape === 'star') {
                this._drawStar(ctx, p.x, p.y, p.size * alpha);
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    _drawStar(ctx, x, y, r) {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const a = (i * 72 - 90) * Math.PI / 180;
            const method = i === 0 ? 'moveTo' : 'lineTo';
            ctx[method](x + Math.cos(a) * r, y + Math.sin(a) * r);
            const a2 = ((i * 72) + 36 - 90) * Math.PI / 180;
            ctx.lineTo(x + Math.cos(a2) * r * 0.4, y + Math.sin(a2) * r * 0.4);
        }
        ctx.closePath();
        ctx.fill();
    }

    hasAlive() {
        return this.pool.some(p => p.alive);
    }
}

// --- Floating Text ("+100" rising and fading) ---
class FloatingTextManager {
    constructor() { this.texts = []; }

    add(text, x, y, color = '#fbbf24', duration = 1.2, fontSize = 20) {
        this.texts.push({ text, x, y, startY: y, color, life: duration, maxLife: duration, fontSize });
    }

    update(dt) {
        for (let i = this.texts.length - 1; i >= 0; i--) {
            const t = this.texts[i];
            t.life -= dt;
            t.y -= 40 * dt; // float up
            if (t.life <= 0) this.texts.splice(i, 1);
        }
    }

    draw(ctx) {
        for (const t of this.texts) {
            const alpha = Math.max(0, t.life / t.maxLife);
            const scale = 0.8 + 0.4 * (1 - alpha); // start bigger, shrink
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = `bold ${Math.round(t.fontSize * scale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = t.color;
            ctx.shadowColor = t.color;
            ctx.shadowBlur = 8;
            ctx.fillText(t.text, t.x, t.y);
            ctx.shadowBlur = 0;
            ctx.restore();
        }
    }

    hasActive() { return this.texts.length > 0; }
}

// --- Chase Lights (animated dots around a rectangle) ---
function drawChaseLights(ctx, x, y, w, h, time, count = 16, color1 = '#fbbf24', color2 = '#ef4444', speed = 1) {
    const perimeter = 2 * (w + h);
    for (let i = 0; i < count; i++) {
        const phase = ((i / count) + time * speed) % 1;
        const dist = phase * perimeter;
        let px, py;
        if (dist < w) { px = x + dist; py = y; }
        else if (dist < w + h) { px = x + w; py = y + (dist - w); }
        else if (dist < 2 * w + h) { px = x + w - (dist - w - h); py = y + h; }
        else { px = x; py = y + h - (dist - 2 * w - h); }
        const isAlt = i % 2 === 0;
        const glow = 0.6 + 0.4 * Math.sin(time * 8 + i * 0.7);
        ctx.save();
        ctx.globalAlpha = glow;
        ctx.fillStyle = isAlt ? color1 : color2;
        ctx.shadowColor = isAlt ? color1 : color2;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// --- Global Instances ---
const casinoAudio = new CasinoAudio();
const casinoParticles = new ParticleSystem(200);
const casinoFloatingText = new FloatingTextManager();
