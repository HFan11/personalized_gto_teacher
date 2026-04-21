// ============================================================
// poker-table-dom.js — DOM + CSS based poker table renderer
//
// Public API (drop-in replacement for the retired Canvas class):
//   const t = new PokerTableDom(el, { seats: 6, mode: 'game' });
//   t.setState(state);
//   t.playAction(seatIdx, action, amount);
//   t.dealBoard(cards);                    // cards: ['As', 'Kh', ...]
//   t.showWinner(seatIdx, amount);
//   t.foldSeat(seatIdx);
//   t.clearEffects();
//   t.onSeatClick = (seatIdx) => {};
//   t.destroy();
//
// Uses CSS variables + media queries for responsiveness (no JS
// resize math). Uses CSS transitions/keyframes for animations.
// ============================================================

class PokerTableDom {
    constructor(el, opts = {}) {
        if (typeof el === 'string') el = document.getElementById(el);
        this.el = el;
        this.seatCount = opts.seats || 6;
        this.mode = opts.mode || 'game';
        this.interactive = !!opts.interactive;
        this.onSeatClick = null;

        this.state = this._blankState();
        this._build();
    }

    _blankState() {
        const seats = Array.from({ length: this.seatCount }, () => ({
            name: '', stack: 0, holeCards: null, isMe: false,
            position: '', folded: false, allIn: false, isGhost: false,
            isEmpty: true,
        }));
        return {
            seats, board: [], pot: 0,
            bets: new Array(this.seatCount).fill(0),
            folded: new Array(this.seatCount).fill(false),
            allIn: new Array(this.seatCount).fill(false),
            actingSeat: -1, dealerSeat: -1, heroSeat: 0,
            street: 'waiting',
        };
    }

    _build() {
        // Host becomes a wrap containing two siblings: the table itself
        // and the hero-hand strip below it. The consumer already gave
        // us a container div — we put both elements inside it.
        this.hostEl = this.el;
        this.hostEl.classList.add('poker-table-wrap');
        this.hostEl.innerHTML = '';

        // Table
        const table = document.createElement('div');
        table.classList.add('poker-table');
        table.dataset.seats = this.seatCount;
        table.dataset.mode = this.mode;
        this.tableEl = table;
        // Rewire this.el -> the table itself for backward compatibility
        // with existing animation code that queries via this.el.
        this.el = table;

        const felt = document.createElement('div');
        felt.className = 'felt-bg';
        const studs = document.createElement('div');
        studs.className = 'rail-studs';
        table.appendChild(felt);
        table.appendChild(studs);

        // Center: pot + board
        const center = document.createElement('div');
        center.className = 'table-center';
        center.innerHTML = `
            <div class="pot-display"></div>
            <div class="board-cards"></div>
        `;
        table.appendChild(center);
        this.potEl = center.querySelector('.pot-display');
        this.boardEl = center.querySelector('.board-cards');

        // Dealer button (position updated on setState)
        this.dealerBtn = document.createElement('div');
        this.dealerBtn.className = 'dealer-btn hidden';
        this.dealerBtn.textContent = 'D';
        table.appendChild(this.dealerBtn);

        // Seats
        this.seatEls = [];
        for (let i = 0; i < this.seatCount; i++) {
            const seat = document.createElement('div');
            seat.className = 'seat';
            seat.dataset.vp = i;
            seat.innerHTML = `
                <div class="hole-cards"></div>
                <div class="avatar"></div>
                <div class="player-info">
                    <span class="name"></span>
                    <span class="stack"></span>
                </div>
                <div class="position-pill"></div>
                <div class="bet-chip"></div>
            `;
            if (this.interactive) {
                seat.addEventListener('click', () => {
                    if (this.onSeatClick) this.onSeatClick(i);
                });
                seat.style.cursor = 'pointer';
            }
            table.appendChild(seat);
            this.seatEls.push(seat);
        }

        this.hostEl.appendChild(table);

        // Hero-hand strip below the table — big cards + stack. Shown
        // only when hero has hole cards; empty state hidden via CSS.
        const heroHand = document.createElement('div');
        heroHand.className = 'poker-hero-hand is-empty';
        heroHand.innerHTML = `
            <div class="hero-cards"></div>
            <div class="hero-stack-line">
                <span class="hero-name"></span>
                <span class="hero-stack"></span>
                <span class="hero-pos-pill"></span>
            </div>
        `;
        this.heroHandEl = heroHand;
        this.heroCardsEl = heroHand.querySelector('.hero-cards');
        this.heroNameEl = heroHand.querySelector('.hero-name');
        this.heroStackEl = heroHand.querySelector('.hero-stack');
        this.heroPosEl = heroHand.querySelector('.hero-pos-pill');
        this.hostEl.appendChild(heroHand);
    }

    // =========== Public: state sync ===========
    setState(newState) {
        const s = this.state;
        const prevBets = s.bets ? s.bets.slice() : null;
        const prevStreet = s.street;
        const prevFolded = s.folded ? s.folded.slice() : null;
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

        // Detect bet transitions for subtle fly animations.
        //   Bet went up for seat i  -> chip flies from seat to bet slot
        //   All bets cleared on new street -> chips fly from bet slots to pot
        if (prevBets) {
            const allPrevHad = prevBets.some(b => b > 0);
            const allNowZero = s.bets.every(b => !b || b === 0);
            if (allPrevHad && allNowZero && prevStreet !== s.street) {
                // Street transition — collect bets into pot visually
                for (let i = 0; i < this.seatCount; i++) {
                    if (prevBets[i] > 0 && (prevFolded ? !prevFolded[i] : true)) {
                        this._animateChipToPot(i);
                    }
                }
            } else {
                for (let i = 0; i < this.seatCount; i++) {
                    if ((s.bets[i] || 0) > (prevBets[i] || 0)) {
                        this._animateChipFly(i);
                    }
                }
            }
        }

        this._render();
    }

    _normalizeSeats(arr) {
        const out = [];
        for (let i = 0; i < this.seatCount; i++) {
            const src = arr[i] || {};
            out.push({
                name: src.name || '',
                stack: src.stack != null ? src.stack : 0,
                holeCards: src.holeCards || null,
                isMe: !!src.isMe,
                position: src.position || '',
                folded: !!src.folded,
                allIn: !!src.allIn,
                isGhost: !!src.isGhost,
                isEmpty: src.isEmpty || (!src.name && !src.stack),
            });
        }
        return out;
    }

    _render() {
        const s = this.state;
        // Expose street on the table element so CSS can branch on it
        // (e.g. bot hole cards grow + rise above avatar at showdown).
        if (this.tableEl) this.tableEl.dataset.street = s.street || 'waiting';

        // Pot
        this._renderPot(s.pot);

        // Board
        this._renderBoard();

        // Seats
        for (let i = 0; i < this.seatCount; i++) {
            this._renderSeat(i);
        }

        // Dealer button
        this._renderDealer();

        // Hero hand strip (outside the table — big cards + stack)
        this._renderHeroHand();
    }

    // ============================================================
    // Hero hand strip (below the table, not inside it)
    // ============================================================
    _renderHeroHand() {
        if (!this.heroHandEl) return;
        const heroIdx = this.state.seats.findIndex(s => s.isMe);
        const hero = heroIdx >= 0 ? this.state.seats[heroIdx] : null;
        if (!hero || !hero.name) {
            this.heroHandEl.classList.add('is-empty');
            return;
        }
        this.heroHandEl.classList.remove('is-empty');

        // Name / stack / position line
        this.heroNameEl.textContent = hero.name || 'Hero';
        this.heroStackEl.textContent = `${(hero.stack || 0).toFixed(1)} BB`;
        this.heroPosEl.textContent = hero.position || '';
        this.heroPosEl.style.display = hero.position ? '' : 'none';

        // Cards — show hero's actual hole cards face-up, or empty if not dealt
        const cards = hero.holeCards || [];
        const currentKey = Array.from(this.heroCardsEl.children)
            .map(c => c.dataset.card || 'fd').join(',');
        const desiredKey = cards.length === 2 && cards[0] && cards[1]
            ? cards.join(',')
            : '';
        if (!desiredKey) {
            this.heroCardsEl.innerHTML = '';
            return;
        }
        if (currentKey === desiredKey && this.heroCardsEl.children.length === 2) return;

        // Deal / reveal animation: add dealing-in the first time cards appear
        const wasEmpty = this.heroCardsEl.children.length === 0;
        this.heroCardsEl.innerHTML = '';
        for (let k = 0; k < 2; k++) {
            const cel = this._makeCardEl(cards[k], false);
            if (wasEmpty) {
                cel.classList.add('dealing-in');
                cel.style.animationDelay = (k * 0.06) + 's';
            }
            this.heroCardsEl.appendChild(cel);
        }
    }

    // Render the pot as a row of chip stacks (100 / 25 / 5 / 1 denominations)
    // plus a small "X BB" label underneath. Caps each column at 6 chips so the
    // stack stays proportional for huge pots.
    _renderPot(pot) {
        if (!this.potEl) return;
        this.potEl.innerHTML = '';
        if (!pot || pot <= 0.01) {
            this.potEl.classList.remove('has-pot');
            return;
        }
        this.potEl.classList.add('has-pot');

        // Break pot into denominations
        const denoms = [
            { value: 100, cls: 'chip-100', max: 5 },
            { value: 25,  cls: 'chip-25',  max: 5 },
            { value: 5,   cls: 'chip-5',   max: 6 },
            { value: 1,   cls: 'chip-1',   max: 6 },
        ];
        let remaining = pot;
        const columns = [];
        for (const d of denoms) {
            const count = Math.floor((remaining + 0.001) / d.value);
            if (count > 0) columns.push({ cls: d.cls, count: Math.min(count, d.max) });
            remaining -= count * d.value;
        }
        // If nothing made it through (very small pot < 1), force one white chip
        if (columns.length === 0) columns.push({ cls: 'chip-1', count: 1 });

        const stackRow = document.createElement('div');
        stackRow.className = 'pot-stack-row';
        for (const col of columns) {
            const stack = document.createElement('div');
            stack.className = 'pot-chip-stack';
            for (let i = 0; i < col.count; i++) {
                const chip = document.createElement('div');
                chip.className = 'pot-chip ' + col.cls;
                stack.appendChild(chip);
            }
            stackRow.appendChild(stack);
        }
        this.potEl.appendChild(stackRow);

        const label = document.createElement('div');
        label.className = 'pot-amount';
        label.textContent = pot.toFixed(1) + ' BB';
        this.potEl.appendChild(label);
    }

    _renderBoard() {
        const desiredCount = this.state.board.length;
        const existing = this.boardEl.children;
        // Add missing cards
        while (existing.length < desiredCount) {
            const idx = existing.length;
            const el = this._makeCardEl(this.state.board[idx]);
            el.classList.add('dealing-in');
            // Stagger initial deal by css animation-delay
            el.style.animationDelay = (idx * 0.12) + 's';
            this.boardEl.appendChild(el);
        }
        // Remove extras (new street / new hand)
        while (existing.length > desiredCount) {
            this.boardEl.removeChild(existing[existing.length - 1]);
        }
        // Update any cards that changed (unusual, but safe)
        for (let i = 0; i < desiredCount; i++) {
            const el = existing[i];
            const card = this.state.board[i];
            if (el.dataset.card !== card) {
                const fresh = this._makeCardEl(card);
                fresh.classList.add('dealing-in');
                this.boardEl.replaceChild(fresh, el);
            }
        }
    }

    _renderSeat(i) {
        const seat = this.state.seats[i];
        const el = this.seatEls[i];
        if (!el || !seat) return;

        const isActing = i === this.state.actingSeat && this.state.street !== 'waiting';

        el.classList.toggle('is-hero', !!seat.isMe);
        el.classList.toggle('is-folded', !!this.state.folded[i]);
        el.classList.toggle('is-acting', isActing);
        el.classList.toggle('is-allin', !!this.state.allIn[i] && !this.state.folded[i]);
        el.classList.toggle('is-ghost', !!seat.isGhost);
        el.classList.toggle('is-empty', !!seat.isEmpty);

        // Avatar letter
        const initial = (seat.name || '?')[0] ? (seat.name || '?')[0].toUpperCase() : '';
        el.querySelector('.avatar').textContent = initial;

        // Name + stack
        const nameEl = el.querySelector('.name');
        const stackEl = el.querySelector('.stack');
        nameEl.textContent = seat.isEmpty ? '空位' : (seat.name || 'Bot');
        stackEl.textContent = `${(seat.stack || 0).toFixed(1)}BB`;

        // Position pill
        el.querySelector('.position-pill').textContent = seat.position || '';

        // Hole cards
        this._renderHoleCards(el, seat, i);

        // Bet chip
        const chipEl = el.querySelector('.bet-chip');
        const bet = this.state.bets[i] || 0;
        if (bet > 0) {
            const newText = bet.toFixed(1);
            if (chipEl.textContent !== newText) {
                chipEl.textContent = newText;
                chipEl.classList.remove('is-new');
                // Force reflow to restart animation
                void chipEl.offsetWidth;
                chipEl.classList.add('is-new');
            }
        } else {
            chipEl.textContent = '';
        }
    }

    _renderHoleCards(seatEl, seat, i) {
        const hcEl = seatEl.querySelector('.hole-cards');
        const street = this.state.street;
        if (street === 'waiting' || seat.isGhost || this.state.folded[i]) {
            hcEl.innerHTML = '';
            return;
        }
        const cards = seat.holeCards || [];
        // If hole cards haven't changed and we have 2, skip rebuild
        const currentKey = Array.from(hcEl.children).map(c => c.dataset.card || 'fd').join(',');
        const desiredKey = (seat.isMe || (cards.length === 2 && street === 'showdown'))
            ? cards.map(c => c || 'fd').join(',')
            : 'fd,fd';
        if (currentKey === desiredKey && hcEl.children.length === 2) return;

        // Detect whether this is a fresh deal (was empty) or a reveal
        // (was facedown, now showing faces). Fresh deal gets the deck→seat
        // fly; reveal gets a flip animation only.
        const wasEmpty = hcEl.children.length === 0;
        const isHero = !!seat.isMe;

        const revealing = isHero || (cards.length === 2 && street === 'showdown' && cards[0] && cards[1]);
        hcEl.innerHTML = '';
        for (let k = 0; k < 2; k++) {
            const card = revealing ? cards[k] : null;
            // facedown when the seat is NOT revealing (non-hero outside showdown)
            const cel = this._makeCardEl(card, !revealing);
            // Opponent seats keep the "small peek" style even at showdown —
            // it visually matches the pre-showdown peek position.
            if (!isHero) cel.classList.add('small');
            if (wasEmpty) {
                cel.classList.add('dealing-in');
                cel.style.animationDelay = (i * 0.08 + k * 0.05) + 's';
            } else if (street === 'showdown' && !isHero) {
                cel.classList.add('flipping-in');
                cel.style.animationDelay = (k * 0.12) + 's';
            }
            hcEl.appendChild(cel);
        }
        if (wasEmpty && isHero && typeof casinoAudio !== 'undefined') {
            // subtle card sound for hero deal
            setTimeout(() => this._sound('card'), i * 80);
        }
    }

    _renderDealer() {
        const d = this.state.dealerSeat;
        if (d < 0 || d >= this.seatCount) {
            this.dealerBtn.classList.add('hidden');
            return;
        }
        this.dealerBtn.classList.remove('hidden');
        // Position: between seat and centre (35% toward centre)
        const seatEl = this.seatEls[d];
        // Compute seat relative position in percent via its offsetLeft/Top
        const parentW = this.el.clientWidth;
        const parentH = this.el.clientHeight;
        const seatX = seatEl.offsetLeft + seatEl.offsetWidth / 2;
        const seatY = seatEl.offsetTop + seatEl.offsetHeight / 2;
        const cx = parentW / 2;
        const cy = parentH / 2;
        const bx = seatX + (cx - seatX) * 0.42;
        const by = seatY + (cy - seatY) * 0.42;
        this.dealerBtn.style.left = (bx - 10) + 'px';
        this.dealerBtn.style.top = (by - 10) + 'px';
    }

    // =========== Cards ===========
    _makeCardEl(card, facedown = false) {
        const el = document.createElement('div');
        el.className = 'card';
        if (facedown || !card) {
            el.classList.add('facedown');
            el.dataset.card = 'fd';
            return el;
        }
        const rank = card[0];
        const suit = card[1];
        const suitMap = { s: '♠', h: '♥', d: '♦', c: '♣' };
        const suitChar = suitMap[suit] || suit;
        const rankText = rank === 'T' ? '10' : rank;
        const red = (suit === 'h' || suit === 'd');
        el.classList.add(red ? 'red' : 'black');
        el.dataset.rank = rankText;
        el.dataset.suit = suitChar;
        el.dataset.card = card;
        // Corner suit + centre suit as children (so ::before handles rank)
        el.innerHTML = `
            <span class="suit-corner">${suitChar}</span>
            <span class="suit-center">${suitChar}</span>
        `;
        return el;
    }

    // =========== Public: action animations ===========
    playAction(seatIdx, action, amount) {
        const seatEl = this.seatEls[seatIdx];
        if (!seatEl) return;
        // Toast with colour hint by action
        const map = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', bet: '下注', allin: 'ALL-IN' };
        const label = map[action] || action;
        const amt = (amount && amount > 0) ? ` ${(+amount).toFixed(1)}` : '';
        const toast = document.createElement('div');
        toast.className = 'action-toast toast-' + (action || 'x');
        toast.textContent = label + amt;
        seatEl.appendChild(toast);
        setTimeout(() => toast.remove(), 1800);

        if (action === 'fold') {
            seatEl.classList.add('is-folding');
            setTimeout(() => seatEl.classList.remove('is-folding'), 400);
            this._sound('fold');
        } else if (action === 'check') {
            this._sound('check');
        } else if (action === 'call' || action === 'bet' || action === 'raise' || action === 'allin') {
            this._sound('chip');
            // Flying chip already handled via setState bet diff; if setState
            // hasn't been called yet, trigger here too for reliability.
            if (amount > 0) this._animateChipFly(seatIdx);
        }
    }

    _sound(kind) {
        if (typeof casinoAudio === 'undefined') return;
        try {
            if (kind === 'chip') casinoAudio.tick(900, 0.05);
            else if (kind === 'card') casinoAudio.tick(1400, 0.04);
            else if (kind === 'fold') casinoAudio.tick(300, 0.08);
            else if (kind === 'check') casinoAudio.tick(700, 0.05);
            else if (kind === 'win') casinoAudio.winJingle(2);
        } catch (e) { /* ignore */ }
    }

    // Fly a single chip sprite from a seat toward its bet slot. In teach
    // mode the bet slot is right next to the avatar (small travel), so we
    // fly a SECOND chip toward the pot as well — that's the WePoker feel
    // the user wants.
    _animateChipFly(seatIdx) {
        const seatEl = this.seatEls[seatIdx];
        if (!seatEl) return;
        const betChipEl = seatEl.querySelector('.bet-chip');
        if (!betChipEl) return;
        const parentRect = this.el.getBoundingClientRect();
        const avRect = seatEl.querySelector('.avatar').getBoundingClientRect();
        const betRect = betChipEl.getBoundingClientRect();
        const fromX = avRect.left - parentRect.left + avRect.width / 2;
        const fromY = avRect.top - parentRect.top + avRect.height / 2;
        // Primary destination: the bet-slot (or an inferred slot between
        // the seat and centre if the bet chip element has no size yet).
        let toX, toY;
        if (betRect.width > 0) {
            toX = betRect.left - parentRect.left + betRect.width / 2;
            toY = betRect.top - parentRect.top + betRect.height / 2;
        } else {
            const cx = parentRect.width / 2, cy = parentRect.height / 2;
            toX = fromX + (cx - fromX) * 0.5;
            toY = fromY + (cy - fromY) * 0.5;
        }
        this._spawnFlyingChip(fromX, fromY, toX, toY, 520);
        // In teach mode the bet slot is beside the avatar, so also fly a
        // delayed chip from the avatar toward the pot for clarity.
        if (this.mode === 'teach') {
            const potRect = this.potEl.getBoundingClientRect();
            const potX = potRect.left - parentRect.left + potRect.width / 2;
            const potY = potRect.top - parentRect.top + potRect.height / 2;
            setTimeout(() => {
                this._spawnFlyingChip(fromX, fromY, potX, potY, 620);
            }, 120);
        }
        this._sound('chip');
    }

    // Fly a chip from each live seat's bet slot toward the pot (street end)
    _animateChipToPot(seatIdx) {
        const seatEl = this.seatEls[seatIdx];
        if (!seatEl) return;
        const parentRect = this.el.getBoundingClientRect();
        const betEl = seatEl.querySelector('.bet-chip');
        const potRect = this.potEl.getBoundingClientRect();
        const br = betEl ? betEl.getBoundingClientRect() : seatEl.querySelector('.avatar').getBoundingClientRect();
        const fromX = br.left - parentRect.left + br.width / 2;
        const fromY = br.top - parentRect.top + br.height / 2;
        const toX = potRect.left - parentRect.left + potRect.width / 2;
        const toY = potRect.top - parentRect.top + potRect.height / 2;
        this._spawnFlyingChip(fromX, fromY, toX, toY, 580);
    }

    // Fly pot chips outward to the winner seat (pot collect by winner)
    _animatePotToWinner(seatEl) {
        const parentRect = this.el.getBoundingClientRect();
        const potRect = this.potEl.getBoundingClientRect();
        const sr = seatEl.getBoundingClientRect();
        const fromX = potRect.left - parentRect.left + potRect.width / 2;
        const fromY = potRect.top - parentRect.top + potRect.height / 2;
        const toX = sr.left - parentRect.left + sr.width / 2;
        const toY = sr.top - parentRect.top + sr.height / 2;
        for (let k = 0; k < 6; k++) {
            setTimeout(() => {
                const jitterX = (Math.random() - 0.5) * 16;
                const jitterY = (Math.random() - 0.5) * 16;
                this._spawnFlyingChip(fromX + jitterX, fromY + jitterY, toX, toY, 700);
            }, k * 50);
        }
    }

    _spawnFlyingChip(fromX, fromY, toX, toY, dur) {
        const chip = document.createElement('div');
        chip.className = 'flying-chip';
        chip.style.left = fromX + 'px';
        chip.style.top = fromY + 'px';
        chip.style.setProperty('--dx', (toX - fromX) + 'px');
        chip.style.setProperty('--dy', (toY - fromY) + 'px');
        chip.style.setProperty('--fly-dur', dur + 'ms');
        this.el.appendChild(chip);
        setTimeout(() => chip.remove(), dur + 80);
    }

    dealBoard(cards) {
        // board state already updated by setState; this just forces the
        // dealing-in animation by clearing + re-rendering
        const s = this.state;
        s.board = cards.slice();
        // Remove existing cards that shouldn't be there (new hand)
        const existing = this.boardEl.children.length;
        if (cards.length < existing) {
            this.boardEl.innerHTML = '';
        }
        this._renderBoard();
    }

    showWinner(seatIdx, amount) {
        const seatEl = this.seatEls[seatIdx];
        if (!seatEl) return;
        seatEl.classList.add('is-winner');
        setTimeout(() => seatEl.classList.remove('is-winner'), 2200);

        // Winning amount floating text
        if (amount > 0) {
            const win = document.createElement('div');
            win.className = 'win-amount';
            win.textContent = `+${amount.toFixed(1)}`;
            seatEl.appendChild(win);
            setTimeout(() => win.remove(), 2200);
        }

        // Pot chips fly toward the winner, then a burst of confetti
        this._animatePotToWinner(seatEl);
        setTimeout(() => this._emitConfetti(seatEl), 350);
        this._sound('win');
    }

    _emitConfetti(targetSeatEl) {
        const parentRect = this.el.getBoundingClientRect();
        const targetRect = targetSeatEl.getBoundingClientRect();
        const cx = parentRect.width / 2;
        const cy = parentRect.height / 2;
        const tx = targetRect.left + targetRect.width / 2 - parentRect.left;
        const ty = targetRect.top + targetRect.height / 2 - parentRect.top;
        const dx = tx - cx;
        const dy = ty - cy;

        const count = 14;
        for (let i = 0; i < count; i++) {
            const dot = document.createElement('div');
            dot.className = 'confetti-dot';
            dot.style.left = cx + 'px';
            dot.style.top = cy + 'px';
            // Randomize the endpoint near the winner with some scatter
            const scatterX = (Math.random() - 0.5) * 60;
            const scatterY = (Math.random() - 0.5) * 60;
            dot.style.setProperty('--dx', (dx + scatterX) + 'px');
            dot.style.setProperty('--dy', (dy + scatterY) + 'px');
            dot.style.animationDelay = (i * 0.03) + 's';
            // Vary colour between gold and soft yellow
            if (i % 3 === 0) dot.style.background = '#fde68a';
            this.el.appendChild(dot);
            setTimeout(() => dot.remove(), 1300);
        }
    }

    foldSeat(seatIdx) {
        const seatEl = this.seatEls[seatIdx];
        if (seatEl) seatEl.classList.add('is-folding');
        setTimeout(() => seatEl && seatEl.classList.remove('is-folding'), 400);
    }

    clearEffects() {
        // Remove floating toasts, confetti, win amounts
        this.el.querySelectorAll('.action-toast, .confetti-dot, .win-amount').forEach(e => e.remove());
        this.seatEls.forEach(el => {
            el.classList.remove('is-winner', 'is-folding');
        });
    }

    // =========== Compat (no-ops used by legacy code) ===========
    resize() { /* CSS handles resize — no-op */ }

    // Old canvas used a rAF loop keyed off _needsRedraw. With DOM we just
    // re-render immediately. Provide a setter so legacy callers that poked
    // state fields directly and then set _needsRedraw = true still work.
    set _needsRedraw(v) {
        if (v) this._render();
    }
    get _needsRedraw() { return false; }

    destroy() {
        if (this.hostEl) {
            this.hostEl.innerHTML = '';
            this.hostEl.classList.remove('poker-table-wrap');
        } else if (this.el) {
            this.el.innerHTML = '';
            this.el.classList.remove('poker-table');
        }
        this.seatEls = [];
    }
}

if (typeof window !== 'undefined') window.PokerTableDom = PokerTableDom;
