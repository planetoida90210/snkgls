(function () {
    'use strict';

    // ════════════════════════════════════════
    // CONSTANTS
    // ════════════════════════════════════════
    const LETTERS = ['G', 'O', 'O', 'D', ' ', 'L', 'O', 'O', 'K', 'I', 'N', 'G', ' '];
    const FOOD_COLORS = ['#B6D1C1', '#FC5100', '#024F12', '#FFB4ED'];
    const BG = '#F8F7F2';
    const START_SPEED = 155;   // ms per tick
    const SPEED_STEP = 2;      // ms faster per food
    const MIN_SPEED = 72;      // fastest tick
    const GAP = 2;             // visual gap reference
    const SWIPE_MIN = 20;      // min px for swipe
    const INIT_LEN = 3;        // starting snake length
    const BOSS_BONUS = 5;      // bonus points for boss
    const BOSS_EVERY = 13;     // boss spawns every N foods
    const TAPER_SEGS = 3;      // tail taper segment count

    // ════════════════════════════════════════
    // STATE
    // ════════════════════════════════════════
    let canvas, ctx, dpr;
    let W, H;                  // logical screen size
    let cellSize, cols, rows;
    let ox, oy;                // grid offset (px)
    let bodyR;                 // snake body radius
    let snake, dir, nextDir;
    let prevSnake;             // previous positions for interpolation
    let food, foodCI;          // food & color index
    let boss;                  // null or {x, y}
    let score, speed;
    let state;                 // 'start' | 'play' | 'die' | 'over'
    let lastTick;
    let particles;
    let floatingTexts;         // floating +1/+5 popups
    let tx0, ty0;              // touch start
    let dieAnim;               // { idx, timer }
    let bgBuf;                 // pre-rendered background
    let hiScore;               // high score (localStorage)
    let shakeAmount;           // screen shake intensity

    // DOM refs
    let $ss, $os, $hud, $fs, $wb, $df, $hi;
    let bossImg;               // preloaded boss PNG

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
        $hi  = document.getElementById('hi');

        bossImg = new Image();
        bossImg.src = 'favicon_gls.png';

        // Load high score
        try { hiScore = parseInt(localStorage.getItem('gls_hi')) || 0; } catch (_) { hiScore = 0; }

        measure();
        bakeBg();
        bindInput();

        particles = [];
        floatingTexts = [];
        shakeAmount = 0;
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

        const cs = getComputedStyle(document.documentElement);
        const safeT = parseInt(cs.getPropertyValue('--sat')) || 0;
        const safeB = parseInt(cs.getPropertyValue('--sab')) || 0;

        let targetCols = Math.round(W / 24);
        targetCols = Math.max(12, Math.min(20, targetCols));
        cellSize = Math.floor(W / targetCols);
        cols = Math.floor(W / cellSize);

        const hudH = safeT + 36;
        const availH = H - hudH - safeB;
        rows = Math.floor(availH / cellSize);

        ox = Math.round((W - cols * cellSize) / 2);
        oy = hudH + Math.round((availH - rows * cellSize) / 2);

        bodyR = cellSize * 0.44;

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

        // Solid background
        bc.fillStyle = BG;
        bc.fillRect(0, 0, W, H);

        // Subtle dot grid at intersections
        bc.fillStyle = 'rgba(0,0,0,.045)';
        for (let x = 0; x <= cols; x++) {
            for (let y = 0; y <= rows; y++) {
                bc.beginPath();
                bc.arc(ox + x * cellSize, oy + y * cellSize, 1.2, 0, Math.PI * 2);
                bc.fill();
            }
        }

        // Subtle vignette for depth
        var gcx = ox + cols * cellSize / 2;
        var gcy = oy + rows * cellSize / 2;
        var gr  = Math.max(cols * cellSize, rows * cellSize) * 0.75;
        var grad = bc.createRadialGradient(gcx, gcy, 0, gcx, gcy, gr);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.028)');
        bc.fillStyle = grad;
        bc.fillRect(ox, oy, cols * cellSize, rows * cellSize);

        // Subtle border
        bc.strokeStyle = 'rgba(0,0,0,.06)';
        bc.lineWidth = 1;
        bc.strokeRect(ox + .5, oy + .5, cols * cellSize - 1, rows * cellSize - 1);
    }

    // ════════════════════════════════════════
    // INPUT
    // ════════════════════════════════════════
    function bindInput() {
        const po = { passive: false };
        document.addEventListener('touchstart', tsStart, po);
        document.addEventListener('touchmove',  tsMove, po);
        document.addEventListener('touchend',   tsEnd, po);
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
        prevSnake = snake.map(function (s) { return { x: s.x, y: s.y }; });
        dir     = { x: 1, y: 0 };
        nextDir = { x: 1, y: 0 };
        score   = 0;
        speed   = START_SPEED;
        particles = [];
        floatingTexts = [];
        shakeAmount = 0;
        foodCI  = 0;
        boss    = null;
        dieAnim = null;
        updHud();
        spawnFood();
    }

    function die() {
        state = 'die';
        vib([30, 40, 30, 40, 60]);
        flash();
        shakeAmount = 14;
        dieAnim = { idx: 0, t: performance.now() };

        // Update high score
        if (score > hiScore) {
            hiScore = score;
            try { localStorage.setItem('gls_hi', hiScore); } catch (_) {}
        }
    }

    function showOver() {
        state = 'over';
        hide($hud);
        animNum($fs, score, 500);

        // High score display
        if ($hi) {
            if (score >= hiScore && score > 0) {
                $hi.textContent = 'NOWY REKORD!';
                $hi.className = 'os-hi new';
            } else {
                $hi.textContent = 'REKORD: ' + hiScore;
                $hi.className = 'os-hi';
            }
        }

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
        prevSnake = snake.map(function (s) { return { x: s.x, y: s.y }; });

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

        // Eat boss?
        if (boss && nx === boss.x && ny === boss.y) {
            score += BOSS_BONUS;
            speed = Math.max(MIN_SPEED, speed - SPEED_STEP * 3);
            updHud();
            var bpx = ox + boss.x * cellSize + cellSize / 2;
            var bpy = oy + boss.y * cellSize + cellSize / 2;
            burst(bpx, bpy, '#FC5100', 30);
            burst(bpx, bpy, '#FFB4ED', 20);
            addFloating(bpx, bpy - cellSize, '+' + BOSS_BONUS, '#FC5100');
            vib([40, 30, 40, 30, 80]);
            boss = null;
            spawnFood();
        }
        // Eat normal food?
        else if (nx === food.x && ny === food.y) {
            score++;
            speed = Math.max(MIN_SPEED, speed - SPEED_STEP);
            updHud();
            var fpx = ox + food.x * cellSize + cellSize / 2;
            var fpy = oy + food.y * cellSize + cellSize / 2;
            burst(fpx, fpy, FOOD_COLORS[foodCI], 14);
            addFloating(fpx, fpy - cellSize, '+1', FOOD_COLORS[foodCI]);
            vib(12);
            foodCI = (foodCI + 1) % FOOD_COLORS.length;

            if (score > 0 && score % BOSS_EVERY === 0) {
                spawnBoss();
            }
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

    function spawnBoss() {
        var bx, by, ok;
        do {
            bx = (Math.random() * cols) | 0;
            by = (Math.random() * rows) | 0;
            ok = true;
            for (var i = 0; i < snake.length; i++) {
                if (snake[i].x === bx && snake[i].y === by) { ok = false; break; }
            }
            if (food && food.x === bx && food.y === by) ok = false;
        } while (!ok);
        boss = { x: bx, y: by };
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
    // FLOATING TEXTS
    // ════════════════════════════════════════
    function addFloating(x, y, text, color) {
        floatingTexts.push({
            x: x, y: y,
            text: text,
            color: color,
            life: 1,
            vy: -1.5
        });
    }

    function tickFloating() {
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            var ft = floatingTexts[i];
            ft.y += ft.vy;
            ft.vy *= 0.97;
            ft.life -= 0.02;
            if (ft.life <= 0) floatingTexts.splice(i, 1);
        }
    }

    function drawFloating() {
        var fsize = Math.round(cellSize * 0.65);
        ctx.font = '700 ' + fsize + 'px "Space Grotesk",system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < floatingTexts.length; i++) {
            var ft = floatingTexts[i];
            ctx.globalAlpha = Math.max(0, Math.min(1, ft.life * 1.5));
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, ft.x, ft.y);
        }
        ctx.globalAlpha = 1;
    }

    // ════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════
    function render(now, progress) {
        // Screen shake offset
        var sx = 0, sy = 0;
        if (shakeAmount > 0.3) {
            sx = (Math.random() - 0.5) * shakeAmount;
            sy = (Math.random() - 0.5) * shakeAmount;
            shakeAmount *= 0.88;
            if (shakeAmount < 0.3) shakeAmount = 0;
        }

        // Pre-rendered background
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(bgBuf, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, sx, sy);

        if (state === 'play' || state === 'die') {
            if (state !== 'die') {
                drawFood(now);
                if (boss) drawBoss(now);
            }
            drawSnake(state === 'play' ? progress : 1);
        }
        drawParticles();
        drawFloating();
    }

    // ── food (circle) ──
    function drawFood(now) {
        var pulse = Math.sin(now / 200) * .07 + 1;
        var r  = (cellSize - GAP) * pulse / 2;
        var cx = ox + food.x * cellSize + cellSize / 2;
        var cy = oy + food.y * cellSize + cellSize / 2;

        // Glow
        ctx.globalAlpha = .15;
        ctx.fillStyle = FOOD_COLORS[foodCI];
        ctx.beginPath();
        ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Solid food
        ctx.fillStyle = FOOD_COLORS[foodCI];
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // ── boss ──
    function drawBoss(now) {
        if (!bossImg.complete) return;
        var pulse = Math.sin(now / 120) * .08 + 1;
        var spin  = now / 2000;
        var size  = cellSize * 1.35 * pulse;
        var cx = ox + boss.x * cellSize + cellSize / 2;
        var cy = oy + boss.y * cellSize + cellSize / 2;

        // Glow
        ctx.globalAlpha = .18 + Math.sin(now / 200) * .08;
        ctx.fillStyle = '#FC5100';
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2 + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Rotating PNG
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);
        ctx.drawImage(bossImg, -size / 2, -size / 2, size, size);
        ctx.restore();
    }

    // ── snake (continuous smooth body with interpolation) ──
    function segR(idx, total) {
        var fromTail = total - 1 - idx;
        if (total > 5 && fromTail < TAPER_SEGS) {
            var t = fromTail / TAPER_SEGS;
            return bodyR * (0.4 + 0.6 * t);
        }
        return bodyR;
    }

    function drawSnake(progress) {
        var dead = dieAnim ? dieAnim.idx : 0;

        // Calculate interpolated pixel positions
        var pts = [];
        for (var i = 0; i < snake.length; i++) {
            if (i < dead) continue;

            var lx, ly;
            if (prevSnake && i < prevSnake.length) {
                lx = prevSnake[i].x + (snake[i].x - prevSnake[i].x) * progress;
                ly = prevSnake[i].y + (snake[i].y - prevSnake[i].y) * progress;
            } else {
                lx = snake[i].x;
                ly = snake[i].y;
            }

            pts.push({
                idx: i,
                px: ox + lx * cellSize + cellSize / 2,
                py: oy + ly * cellSize + cellSize / 2
            });
        }

        if (pts.length === 0) return;

        // ─── Draw connections between adjacent segments ───
        ctx.fillStyle = '#000';
        for (var j = 0; j < pts.length - 1; j++) {
            var a = pts[j], b = pts[j + 1];
            var dx = b.px - a.px;
            var dy = b.py - a.py;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.5) continue;

            var rA = segR(j, pts.length);
            var rB = segR(j + 1, pts.length);
            var nxA = (-dy / dist) * rA;
            var nyA = (dx / dist) * rA;
            var nxB = (-dy / dist) * rB;
            var nyB = (dx / dist) * rB;

            ctx.beginPath();
            ctx.moveTo(a.px + nxA, a.py + nyA);
            ctx.lineTo(b.px + nxB, b.py + nyB);
            ctx.lineTo(b.px - nxB, b.py - nyB);
            ctx.lineTo(a.px - nxA, a.py - nyA);
            ctx.closePath();
            ctx.fill();
        }

        // ─── Draw circles at each segment (back to front, head on top) ───
        for (var k = pts.length - 1; k >= 0; k--) {
            var r = segR(k, pts.length);

            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(pts[k].px, pts[k].py, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // ─── Head highlight ───
        if (pts.length > 0 && pts[0].idx === 0 && !dieAnim) {
            ctx.strokeStyle = 'rgba(255,255,255,.22)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pts[0].px, pts[0].py, segR(0, pts.length), 0, Math.PI * 2);
            ctx.stroke();
        }

        // ─── Letters ───
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var m = 0; m < pts.length; m++) {
            var letter = LETTERS[pts[m].idx % LETTERS.length];
            if (letter === ' ') continue;

            var sr = segR(m, pts.length);
            if (sr < bodyR * 0.6) continue; // too small for letter

            var fsize = Math.round(sr * 1.1);
            ctx.font = '700 ' + fsize + 'px "Space Grotesk",system-ui,sans-serif';
            ctx.fillStyle = '#FFF';
            ctx.fillText(letter, pts[m].px, pts[m].py + 1);
        }
    }

    // ── particles (circles instead of squares) ──
    function drawParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            ctx.globalAlpha = Math.max(0, p.l);
            ctx.fillStyle = p.c;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.s / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // ════════════════════════════════════════
    // HELPERS
    // ════════════════════════════════════════
    function smoothstep(t) {
        return t * t * (3 - 2 * t);
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

        // Interpolation progress with easing
        var progress = 0;
        if (state === 'play' && speed > 0) {
            progress = Math.min((now - lastTick) / speed, 1);
            progress = smoothstep(progress);
        }

        tickParticles();
        tickFloating();
        render(now, progress);

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
