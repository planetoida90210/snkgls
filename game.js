(function () {
    'use strict';

    // ════════════════════════════════════════
    // CONSTANTS
    // ════════════════════════════════════════
    const LETTERS = ['G', 'O', 'O', 'D', ' ', 'L', 'O', 'O', 'K', 'I', 'N', 'G', ' '];
    const FOOD_COLORS = ['#B6D1C1', '#FC5100', '#024F12', '#FFB4ED'];
    const BG1 = '#F8F7F2';
    const BG2 = '#EFEEE8';
    const START_SPEED = 155;   // ms per tick
    const SPEED_STEP = 2;      // ms faster per food
    const MIN_SPEED = 72;      // fastest tick
    const GAP = 2;             // px between segments
    const SEG_R = 4;           // segment corner radius
    const FOOD_R = 5;          // food corner radius
    const SWIPE_MIN = 20;      // min px for swipe
    const INIT_LEN = 3;        // starting snake length

    // ════════════════════════════════════════
    // STATE
    // ════════════════════════════════════════
    let canvas, ctx, dpr;
    let W, H;                  // logical screen size
    let cellSize, cols, rows;
    let ox, oy;                // grid offset (px)
    let snake, dir, nextDir;
    let food, foodCI;          // food color index
    let score, speed;
    let state;                 // 'start' | 'play' | 'die' | 'over'
    let lastTick;
    let particles;
    let tx0, ty0;              // touch start
    let dieAnim;               // { idx, timer }
    let bgBuf;                 // pre-rendered background

    // DOM refs
    let $ss, $os, $hud, $fs, $wb, $df;

    // ════════════════════════════════════════
    // BOOT
    // ════════════════════════════════════════
    function boot() {
        canvas = document.getElementById('gc');
        ctx = canvas.getContext('2d', { alpha: false });
        dpr = Math.min(window.devicePixelRatio || 1, 3);

        $ss  = document.getElementById('ss');
        $os  = document.getElementById('os');
        $hud = document.getElementById('hud');
        $fs  = document.getElementById('fs');
        $wb  = document.getElementById('wb');
        $df  = document.getElementById('df');

        measure();
        bakeBg();
        bindInput();

        particles = [];
        state = 'start';
        show($ss); hide($os); hide($hud);

        requestAnimationFrame(loop);
    }

    // ════════════════════════════════════════
    // SIZING
    // ════════════════════════════════════════
    function measure() {
        W = window.innerWidth;
        H = window.innerHeight;

        // Read CSS safe-area values
        const cs = getComputedStyle(document.documentElement);
        const safeT = parseInt(cs.getPropertyValue('--sat')) || 0;
        const safeB = parseInt(cs.getPropertyValue('--sab')) || 0;

        // Grid columns: aim for ~24px cells
        let targetCols = Math.round(W / 24);
        targetCols = Math.max(12, Math.min(20, targetCols));
        cellSize = Math.floor(W / targetCols);
        cols = Math.floor(W / cellSize);

        // Rows: subtract safe areas, leave room for HUD
        const hudH = safeT + 36;                       // HUD area
        const availH = H - hudH - safeB;
        rows = Math.floor(availH / cellSize);

        ox = Math.round((W - cols * cellSize) / 2);
        oy = hudH + Math.round((availH - rows * cellSize) / 2);

        // Size canvas
        canvas.style.width  = W + 'px';
        canvas.style.height = H + 'px';
        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function bakeBg() {
        bgBuf = document.createElement('canvas');
        bgBuf.width  = Math.round(W * dpr);
        bgBuf.height = Math.round(H * dpr);
        const bc = bgBuf.getContext('2d');
        bc.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Full background
        bc.fillStyle = BG1;
        bc.fillRect(0, 0, W, H);

        // Checkerboard
        bc.fillStyle = BG2;
        for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
                if ((x + y) & 1) {
                    bc.fillRect(ox + x * cellSize, oy + y * cellSize, cellSize, cellSize);
                }
            }
        }

        // Border
        bc.strokeStyle = 'rgba(0,0,0,.06)';
        bc.lineWidth = 1;
        bc.strokeRect(ox + .5, oy + .5, cols * cellSize - 1, rows * cellSize - 1);
    }

    // ════════════════════════════════════════
    // INPUT
    // ════════════════════════════════════════
    function bindInput() {
        const po = { passive: false };
        // Touch on DOCUMENT (not canvas) so overlays don't block input
        document.addEventListener('touchstart', tsStart, po);
        document.addEventListener('touchmove',  tsMove, po);
        document.addEventListener('touchend',   tsEnd, po);
        // Keyboard (for testing on desktop)
        document.addEventListener('keydown', onKey);
    }

    function tsStart(e) {
        e.preventDefault();
        tx0 = e.touches[0].clientX;
        ty0 = e.touches[0].clientY;
    }

    function tsMove(e) {
        e.preventDefault();
        if (state !== 'play') return;
        const t = e.touches[0];
        attemptSwipe(t.clientX - tx0, t.clientY - ty0);
        tx0 = t.clientX;
        ty0 = t.clientY;
    }

    function tsEnd(e) {
        e.preventDefault();
        if (state === 'start' || state === 'over') { go(); return; }
        if (state === 'play') {
            const t = e.changedTouches[0];
            attemptSwipe(t.clientX - tx0, t.clientY - ty0);
        }
    }

    function attemptSwipe(dx, dy) {
        if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 0 && dir.x !== -1) nextDir = { x:  1, y: 0 };
            if (dx < 0 && dir.x !==  1) nextDir = { x: -1, y: 0 };
        } else {
            if (dy > 0 && dir.y !== -1) nextDir = { x: 0, y:  1 };
            if (dy < 0 && dir.y !==  1) nextDir = { x: 0, y: -1 };
        }
    }

    function onKey(e) {
        const dirMap = {
            ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0],
            w:[0,-1], s:[0,1], a:[-1,0], d:[1,0]
        };
        if (state === 'start' || state === 'over') {
            go();
            // Also apply direction if an arrow/WASD key was pressed
            var m = dirMap[e.key];
            if (m) { dir.x = m[0]; dir.y = m[1]; nextDir.x = m[0]; nextDir.y = m[1]; }
            return;
        }
        if (state !== 'play') return;
        var m = dirMap[e.key]; if (!m) return;
        if (m[0] && m[0] === -dir.x) return;
        if (m[1] && m[1] === -dir.y) return;
        nextDir = { x: m[0], y: m[1] };
    }

    // ════════════════════════════════════════
    // GAME FLOW
    // ════════════════════════════════════════
    function go() {
        measure();
        bakeBg();
        reset();
        state = 'play';
        hide($ss); hide($os); show($hud);
        lastTick = performance.now();
    }

    function reset() {
        const sx = Math.floor(cols / 2);
        const sy = Math.floor(rows / 2);
        snake = [];
        for (let i = 0; i < INIT_LEN; i++) snake.push({ x: sx - i, y: sy });
        dir     = { x: 1, y: 0 };
        nextDir = { x: 1, y: 0 };
        score   = 0;
        speed   = START_SPEED;
        particles = [];
        foodCI  = 0;
        dieAnim = null;
        updHud();
        spawnFood();
    }

    function die() {
        state = 'die';
        vib([30, 40, 30, 40, 60]);
        flash();
        dieAnim = { idx: 0, t: performance.now() };
    }

    function showOver() {
        state = 'over';
        hide($hud);
        animNum($fs, score, 500);

        // Build "words" string
        const n = snake.length;
        const full = Math.floor(n / LETTERS.length);
        const rem  = n % LETTERS.length;
        let txt = '';
        if (full > 0) {
            txt = 'GOOD LOOKING';
            if (full > 1) txt += ' \u00d7 ' + full;
        }
        if (rem > 0) {
            var partial = LETTERS.slice(0, rem).filter(function(c){ return c !== ' '; }).join('');
            if (partial) {
                if (full > 0) txt += ' + ';
                txt += partial;
            }
        }
        $wb.textContent = txt;

        // Force reflow so CSS animations re-trigger
        $os.classList.add('hidden');
        void $os.offsetWidth;
        $os.classList.remove('hidden');
    }

    // ════════════════════════════════════════
    // GAME LOGIC
    // ════════════════════════════════════════
    function tick() {
        dir.x = nextDir.x;
        dir.y = nextDir.y;

        const h  = snake[0];
        const nx = h.x + dir.x;
        const ny = h.y + dir.y;

        // Wall collision
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) { die(); return; }

        // Self collision
        for (let i = 0; i < snake.length; i++) {
            if (snake[i].x === nx && snake[i].y === ny) { die(); return; }
        }

        snake.unshift({ x: nx, y: ny });

        // Eat?
        if (nx === food.x && ny === food.y) {
            score++;
            speed = Math.max(MIN_SPEED, speed - SPEED_STEP);
            updHud();
            burst(
                ox + food.x * cellSize + cellSize / 2,
                oy + food.y * cellSize + cellSize / 2,
                FOOD_COLORS[foodCI], 14
            );
            vib(12);
            foodCI = (foodCI + 1) % FOOD_COLORS.length;
            spawnFood();
        } else {
            snake.pop();
        }
    }

    function spawnFood() {
        let fx, fy, ok;
        do {
            fx = (Math.random() * cols) | 0;
            fy = (Math.random() * rows) | 0;
            ok = true;
            for (let i = 0; i < snake.length; i++) {
                if (snake[i].x === fx && snake[i].y === fy) { ok = false; break; }
            }
        } while (!ok);
        food = { x: fx, y: fy };
    }

    function tickDie(now) {
        if (!dieAnim) return;
        if (now - dieAnim.t < 35) return;
        dieAnim.t = now;
        if (dieAnim.idx < snake.length) {
            const s = snake[dieAnim.idx];
            burst(
                ox + s.x * cellSize + cellSize / 2,
                oy + s.y * cellSize + cellSize / 2,
                FOOD_COLORS[dieAnim.idx % FOOD_COLORS.length], 8
            );
            dieAnim.idx++;
        } else if (particles.length === 0) {
            showOver();
        }
    }

    // ════════════════════════════════════════
    // PARTICLES
    // ════════════════════════════════════════
    function burst(px, py, color, n) {
        for (let i = 0; i < n; i++) {
            const a  = (Math.PI * 2 / n) * i + Math.random() * .5;
            const sp = 1.5 + Math.random() * 4.5;
            particles.push({
                x: px, y: py,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                s: 2 + Math.random() * 4,
                c: color,
                l: 1,
                d: .016 + Math.random() * .024
            });
        }
    }

    function tickParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy;
            p.vx *= .955; p.vy *= .955;
            p.l -= p.d;
            if (p.l <= 0) particles.splice(i, 1);
        }
    }

    // ════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════
    function render(now) {
        // Pre-rendered background (1:1 pixel copy)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(bgBuf, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (state === 'play' || state === 'die') {
            if (state !== 'die') drawFood(now);
            drawSnake();
        }
        drawParticles();
    }

    // ── food ──
    function drawFood(now) {
        const pulse = Math.sin(now / 200) * .07 + 1;
        const s  = (cellSize - GAP) * pulse;
        const px = ox + food.x * cellSize + (cellSize - s) / 2;
        const py = oy + food.y * cellSize + (cellSize - s) / 2;

        // Glow (cheap simulated glow)
        const gs = s + 8;
        ctx.globalAlpha = .18;
        ctx.fillStyle = FOOD_COLORS[foodCI];
        rrect(px - 4, py - 4, gs, gs, FOOD_R + 3);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Solid food
        ctx.fillStyle = FOOD_COLORS[foodCI];
        rrect(px, py, s, s, FOOD_R);
        ctx.fill();
    }

    // ── snake ──
    function segAngle(i) {
        // Direction this segment faces (toward head)
        var dx, dy;
        if (i === 0) { dx = dir.x; dy = dir.y; }
        else { dx = snake[i - 1].x - snake[i].x; dy = snake[i - 1].y - snake[i].y; }
        if (dy === 1) return Math.PI / 2;    // down
        if (dy === -1) return -Math.PI / 2;  // up
        return 0;                             // left or right: keep upright
    }

    function drawSnake() {
        const dead = dieAnim ? dieAnim.idx : 0;

        // Draw tail → head so head is on top
        for (let i = snake.length - 1; i >= 0; i--) {
            if (i < dead) continue;

            const seg = snake[i];
            const fromTail = snake.length - 1 - i;
            const letter = LETTERS[fromTail % LETTERS.length];
            const isHead = (i === 0) && !dieAnim;
            const isSpace = letter === ' ';

            const px = ox + seg.x * cellSize + GAP / 2;
            const py = oy + seg.y * cellSize + GAP / 2;
            const s  = cellSize - GAP;

            // Black body
            ctx.fillStyle = '#000';
            rrect(px, py, s, s, SEG_R);
            ctx.fill();

            // Head subtle highlight
            if (isHead) {
                ctx.strokeStyle = 'rgba(255,255,255,.22)';
                ctx.lineWidth = 1.5;
                rrect(px, py, s, s, SEG_R);
                ctx.stroke();
            }

            // Letter (skip spaces - they act as visual separator)
            if (!isSpace) {
                const angle = segAngle(i);
                const cx = px + s / 2;
                const cy = py + s / 2 + 1;
                ctx.save();
                ctx.translate(cx, cy);
                if (angle !== 0) ctx.rotate(angle);
                ctx.fillStyle = '#FFF';
                ctx.font = '700 ' + Math.round(s * .52) + 'px "Space Grotesk",system-ui,sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(letter, 0, 0);
                ctx.restore();
            }
        }
    }

    // ── particles ──
    function drawParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            ctx.globalAlpha = Math.max(0, p.l);
            ctx.fillStyle = p.c;
            const hs = p.s / 2;
            ctx.fillRect(p.x - hs, p.y - hs, p.s, p.s);
        }
        ctx.globalAlpha = 1;
    }

    // ════════════════════════════════════════
    // HELPERS
    // ════════════════════════════════════════
    function rrect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} }

    function show(el) { el.classList.remove('hidden'); }
    function hide(el) { el.classList.add('hidden'); }

    function updHud() { $hud.textContent = score; }

    function flash() {
        $df.classList.add('active');
        setTimeout(function () { $df.classList.remove('active'); }, 150);
    }

    function animNum(el, target, dur) {
        var t0 = performance.now();
        (function f(now) {
            var p = Math.min((now - t0) / dur, 1);
            var e = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(target * e);
            if (p < 1) requestAnimationFrame(f);
        })(t0);
    }

    // ════════════════════════════════════════
    // GAME LOOP
    // ════════════════════════════════════════
    function loop() {
        var now = performance.now();

        if (state === 'play' && now - lastTick >= speed) {
            tick();
            lastTick = now;
        }
        if (state === 'die') tickDie(now);

        tickParticles();
        render(now);

        requestAnimationFrame(loop);
    }

    // ════════════════════════════════════════
    // VISIBILITY (pause when tab hidden)
    // ════════════════════════════════════════
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && state === 'play') lastTick = performance.now();
    });

    // ════════════════════════════════════════
    // START
    // ════════════════════════════════════════
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(boot);
    } else {
        document.addEventListener('DOMContentLoaded', boot);
    }
})();
