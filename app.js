/* ============================================================
   Air Notes — motion engine
   One rAF loop drives: sky interpolation (OKLab), starfield,
   parallax. IntersectionObserver drives reveals, phone states,
   counters. One easing family. Everything slow.
   ============================================================ */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  /* ---------- colour: sRGB <-> OKLab (banding-free lerps) ---------- */
  const s2l = c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
  const l2s = c => { c = c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055; return Math.round(Math.max(0, Math.min(1, c)) * 255); };
  const hex2lab = hex => {
    const n = parseInt(hex.slice(1), 16);
    const r = s2l(n >> 16 & 255), g = s2l(n >> 8 & 255), b = s2l(n & 255);
    const L = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const M = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const S = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * L + .793617785 * M - .0040720468 * S,
            1.9779984951 * L - 2.428592205 * M + .4505937099 * S,
            .0259040371 * L + .7827717662 * M - .808675766 * S];
  };
  const lab2rgb = ([l, a, bb]) => {
    const L = (l + .3963377774 * a + .2158037573 * bb) ** 3;
    const M = (l - .1055613458 * a - .0638541728 * bb) ** 3;
    const S = (l - .0894841775 * a - 1.291485548 * bb) ** 3;
    return `rgb(${l2s(4.0767416621 * L - 3.3077115913 * M + .2309699292 * S)},${l2s(-1.2684380046 * L + 2.6097574011 * M - .3413193965 * S)},${l2s(-.0041960863 * L - .7034186147 * M + 1.707614701 * S)})`;
  };
  const mixLab = (A, B, t) => lab2rgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);

  const NIGHT_DEEP = hex2lab('#0A1220'), NIGHT = hex2lab('#0F2438'),
        DAWN = hex2lab('#2E4A63'), PAPER = hex2lab('#F5F1E6');

  /* ---------- starfield ---------- */
  const canvas = $('#stars'), ctx = canvas.getContext('2d');
  let stars = [], W = 0, H = 0, dpr = 1;
  function seedStars() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(230, Math.round(W * H / 6500));
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() < .82 ? .7 + Math.random() * .5 : 1.1 + Math.random() * .8,
      depth: Math.random() < .5 ? 1 : Math.random() < .8 ? 2 : 3,   // parallax layers
      speed: .0035 + Math.random() * .008,                          // slow drift
      a: .25 + Math.random() * .6,
      tw: .5 + Math.random() * 1.2, ph: Math.random() * Math.PI * 2
    }));
  }
  seedStars();
  addEventListener('resize', seedStars);

  /* ---------- pointer parallax (throttled + eased) ---------- */
  let tx = 0, ty = 0, px = 0, py = 0;
  if (!reduced && matchMedia('(pointer:fine)').matches) {
    addEventListener('pointermove', e => {
      tx = (e.clientX / innerWidth - .5) * 2;
      ty = (e.clientY / innerHeight - .5) * 2;
    }, { passive: true });
  }

  /* ---------- sky engine ---------- */
  const sky = $('#sky'), aurora = $('#aurora'), grain = $('#grain');
  const heroEl = $('#hero'), act2 = $('#act2'), ctaEl = $('#cta');
  let anchors = {};
  function measure() {
    const y = el => el.getBoundingClientRect().top + scrollY;
    anchors = {
      dawnStart: y(act2) - innerHeight * .95,   // sky starts warming as act2 approaches
      dayFull:   y(act2) + innerHeight * .08,   // fully paper
      duskStart: y(ctaEl) - innerHeight * .75,  // paper starts cooling
      duskFull:  y(ctaEl) + innerHeight * .05
    };
  }
  measure();
  addEventListener('resize', () => { measure(); });

  const clamp01 = v => Math.max(0, Math.min(1, v));
  let starAlpha = 1, skyState = { color: 'rgb(10,18,32)', day: false };

  function skyAt(sy) {
    const a = anchors;
    if (sy < a.dawnStart) {                       // deep night, slight lift with scroll
      const t = clamp01(sy / Math.max(1, a.dawnStart));
      return { c: mixLab(NIGHT_DEEP, NIGHT, t * .6), stars: 1, aur: 1, grain: .03, day: false };
    }
    if (sy < a.dayFull) {                          // dawn: night -> dawn -> paper
      const t = clamp01((sy - a.dawnStart) / (a.dayFull - a.dawnStart));
      const c = t < .45 ? mixLab(NIGHT, DAWN, t / .45) : mixLab(DAWN, PAPER, (t - .45) / .55);
      return { c, stars: 1 - clamp01(t * 1.6), aur: 1 - t, grain: .03 - t * .01, day: t > .6 };
    }
    if (sy < a.duskStart) {                        // full day
      return { c: 'rgb(245,241,230)', stars: 0, aur: 0, grain: .02, day: true };
    }
    // dusk: paper -> night, stars gently returning
    const t = clamp01((sy - a.duskStart) / Math.max(1, a.duskFull - a.duskStart));
    const c = t < .5 ? mixLab(PAPER, DAWN, t / .5) : mixLab(DAWN, NIGHT, (t - .5) / .5);
    return { c, stars: clamp01((t - .35) * .9), aur: t * .35, grain: .02 + t * .01, day: t < .4 };
  }

  /* ---------- master rAF loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last); last = now;

    // eased pointer
    px += (tx - px) * .06; py += (ty - py) * .06;

    // sky
    const s = skyAt(scrollY);
    if (s.c !== skyState.color) { sky.style.backgroundColor = s.c; skyState.color = s.c; }
    if (s.day !== skyState.day) { document.body.classList.toggle('is-day', s.day); skyState.day = s.day; }
    aurora.style.opacity = s.aur.toFixed(3);
    grain.style.opacity = s.grain.toFixed(3);
    starAlpha = s.stars;

    // aurora + parallax depths (max 12px)
    if (!reduced) {
      aurora.style.setProperty('--px1', (px * 6) + 'px');  aurora.style.setProperty('--py1', (py * 4) + 'px');
      aurora.style.setProperty('--px2', (px * 9) + 'px');  aurora.style.setProperty('--py2', (py * 6) + 'px');
      aurora.style.setProperty('--px3', (px * 12) + 'px'); aurora.style.setProperty('--py3', (py * 8) + 'px');
    }

    // stars
    ctx.clearRect(0, 0, W, H);
    if (starAlpha > .01) {
      const t = now / 1000;
      for (const st of stars) {
        if (!reduced) {
          st.x += st.speed * st.depth * dt * .06;
          if (st.x > W + 4) st.x = -4;
        }
        const tw = reduced ? 1 : (.65 + .35 * Math.sin(t * st.tw + st.ph));
        ctx.globalAlpha = st.a * tw * starAlpha;
        ctx.fillStyle = '#EAF0F6';
        const ox = reduced ? 0 : px * 4 * st.depth, oy = reduced ? 0 : py * 3 * st.depth;
        ctx.beginPath();
        ctx.arc(st.x + ox, st.y + oy, st.r, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- hero H1 word reveal ---------- */
  const h1 = $('#h1');
  h1.innerHTML = h1.textContent.trim().split(/\s+/)
    .map(w => `<span class="word">${w}</span>`).join(' ');
  $$('.word', h1).forEach((w, i) => setTimeout(() => w.classList.add('in'), 250 + i * 80));

  /* ---------- reveals ---------- */
  const ro = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); }
  }), { threshold: .25 });
  $$('.reveal').forEach(el => ro.observe(el));

  /* ---------- sticky phone state swap ---------- */
  const screens = $$('#stickyScreen .pscreen');
  const setPhone = state => screens.forEach(sc =>
    sc.classList.toggle('active', sc.dataset.state === state));
  const po = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) setPhone(e.target.dataset.phone);
  }), { threshold: .5 });
  $$('.benefit[data-phone]').forEach(el => po.observe(el));

  /* ---------- counters ---------- */
  const co = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    co.unobserve(e.target);
    const el = e.target, end = +el.dataset.count;
    if (reduced || end === 0) { el.textContent = end; return; }
    const t0 = performance.now(), D = 900;
    (function tick(n) {
      const p = Math.min(1, (n - t0) / D), ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(end * ease);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }), { threshold: .6 });
  $$('[data-count]').forEach(el => co.observe(el));

  /* ---------- magnetic buttons ---------- */
  if (!reduced && matchMedia('(pointer:fine)').matches) {
    $$('.magnetic').forEach(btn => {
      btn.addEventListener('pointermove', e => {
        const r = btn.getBoundingClientRect();
        const mx = ((e.clientX - r.left) / r.width - .5) * 8;   // max 4px
        const my = ((e.clientY - r.top) / r.height - .5) * 8;
        btn.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
      });
      btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
    });
  }

  /* ---------- email form ---------- */
  const form = $('#ctaForm'), input = $('#email'), btn = $('#ctaBtn');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim());
    input.classList.toggle('invalid', !ok);
    if (!ok) { input.focus(); return; }
    btn.querySelector('.btn-label').textContent = "You're on the list ✓";
    btn.classList.add('swept');
    btn.disabled = true;
    input.disabled = true;
    setTimeout(() => btn.classList.remove('swept'), 1000);
  });

  /* re-measure anchors once fonts/layout settle */
  addEventListener('load', measure);
  document.fonts?.ready.then(measure);
})();
