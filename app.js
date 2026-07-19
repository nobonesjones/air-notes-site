/* ============================================================
   Air Note — motion engine
   One rAF loop drives: sky interpolation (OKLab), context flow,
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

  /* ---------- context convergence field ---------- */
  const canvas = $('#contextFlow'), ctx = canvas.getContext('2d');
  let paths = [], packets = [], W = 0, H = 0, dpr = 1;
  let focus = { x: 0, y: 0 };

  const fract = n => n - Math.floor(n);
  const seeded = n => fract(Math.sin(n * 91.731) * 43758.5453);
  const cubicPoint = (p0, p1, p2, p3, t) => {
    const m = 1 - t, m2 = m * m, t2 = t * t;
    return {
      x: m2 * m * p0.x + 3 * m2 * t * p1.x + 3 * m * t2 * p2.x + t2 * t * p3.x,
      y: m2 * m * p0.y + 3 * m2 * t * p1.y + 3 * m * t2 * p2.y + t2 * t * p3.y
    };
  };
  const pointOnPath = (path, t) => {
    if (t < .68) return cubicPoint(...path.incoming, t / .68);
    return cubicPoint(...path.outgoing, (t - .68) / .32);
  };

  function seedFlow() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lineCount = W < 640 ? 28 : 52;
    // Converge at the exact visual midpoint between the subtitle and the CTA
    // button. Measured via offsetTop (not getBoundingClientRect) because the
    // .reveal entrance animation translates these elements 26px at load time —
    // rect-based measurement froze that stale position into the canvas and the
    // line ended up visibly closer to the button. offsetTop ignores transforms,
    // so it always reports the settled layout position.
    const docTop = el => { let y = 0; for (; el; el = el.offsetParent) y += el.offsetTop; return y; };
    let focusY = H * (W < 640 ? .56 : .52);
    {
      const subEl = document.querySelector('.hero .sub');
      const ctaEl = document.querySelector('.hero .cta-row');
      if (subEl && ctaEl) {
        // The subtitle's box bottom includes half a line-height of empty
        // leading; the button pill is a hard edge. Trim the leading so the two
        // gaps are equal to the eye, not just to the boxes.
        const cs = getComputedStyle(subEl);
        const halfLeading = Math.max(0, (parseFloat(cs.lineHeight) - parseFloat(cs.fontSize)) / 2) || 0;
        const subVisualBottom = docTop(subEl) + subEl.offsetHeight - halfLeading;
        const ctaTop = docTop(ctaEl);
        focusY = (subVisualBottom + ctaTop) / 2;
      }
    }
    focus = { x: W * .5, y: focusY };
    canvas.dataset.focusY = String(Math.round(focusY));
    paths = Array.from({ length: lineCount }, (_, i) => {
      const n = i / (lineCount - 1);
      const startTop = W < 640 ? .14 : .1;
      const startSpread = W < 640 ? .72 : .8;
      const startY = (startTop + n * startSpread) * H;
      const lane = (i - (lineCount - 1) / 2) * (W < 640 ? .2 : .34);
      const joinY = focus.y + lane * .12;
      const endY = focus.y + lane;
      const join = { x: focus.x, y: joinY };
      return {
        incoming: [
          { x: -W * .08, y: startY },
          { x: W * .14, y: startY },
          { x: focus.x - W * .19, y: focus.y + (startY - focus.y) * .12 },
          join
        ],
        outgoing: [
          join,
          { x: focus.x + W * .12, y: focus.y + lane * .72 },
          { x: W * .78, y: endY },
          { x: W * 1.08, y: endY }
        ]
      };
    });

    const packetCount = W < 640 ? 20 : 38;
    packets = Array.from({ length: packetCount }, (_, i) => ({
      path: Math.floor(seeded(i + 4) * lineCount),
      t: seeded(i + 18),
      speed: .035 + seeded(i + 33) * .035,
      length: 3 + seeded(i + 51) * 9,
      alpha: .45 + seeded(i + 78) * .5
    }));
  }
  seedFlow();
  addEventListener('resize', seedFlow);
  // Fraunces arrives after first paint and reflows the headline, moving
  // the subtitle and button — re-measure once the real fonts are in, and again
  // on full load as a belt-and-braces pass.
  addEventListener('load', seedFlow);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(seedFlow);

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
  const heroEl = $('#hero'), act2 = $('#act2'), ctaEl = $('#cta'), resEl = $('#resources');
  let anchors = {};
  function measure() {
    const y = el => el.getBoundingClientRect().top + scrollY;
    anchors = {
      dawnStart: y(act2) - innerHeight * .95,   // sky starts warming as act2 approaches
      dayFull:   y(act2) + innerHeight * .08,   // fully paper
      duskStart: y(ctaEl) - innerHeight * .75,  // paper starts cooling
      duskFull:  y(ctaEl) + innerHeight * .05,
      // The light sheet (resources onward) — nav flips back to day mode
      // while the sky stays dark behind the sheet's rounded shoulders.
      lightReturn: resEl ? y(resEl) - innerHeight * .45 : Infinity
    };
  }
  measure();
  addEventListener('resize', () => { measure(); });

  const clamp01 = v => Math.max(0, Math.min(1, v));
  let flowAlpha = 1, skyState = { color: 'rgb(10,18,32)', day: false };

  function skyAt(sy) {
    const a = anchors;
    if (sy < a.dawnStart) {                       // deep night, slight lift with scroll
      const t = clamp01(sy / Math.max(1, a.dawnStart));
      return { c: mixLab(NIGHT_DEEP, NIGHT, t * .6), flow: 1, aur: 1, grain: .03, day: false };
    }
    if (sy < a.dayFull) {                          // dawn: night -> dawn -> paper
      const t = clamp01((sy - a.dawnStart) / (a.dayFull - a.dawnStart));
      const c = t < .45 ? mixLab(NIGHT, DAWN, t / .45) : mixLab(DAWN, PAPER, (t - .45) / .55);
      return { c, flow: 1 - clamp01(t * 1.6), aur: 1 - t, grain: .03 - t * .01, day: t > .6 };
    }
    if (sy < a.duskStart) {                        // full day
      return { c: 'rgb(245,241,230)', flow: 0, aur: 0, grain: .02, day: true };
    }
    // dusk: paper -> night
    const t = clamp01((sy - a.duskStart) / Math.max(1, a.duskFull - a.duskStart));
    const c = t < .5 ? mixLab(PAPER, DAWN, t / .5) : mixLab(DAWN, NIGHT, (t - .5) / .5);
    return { c, flow: 0, aur: t * .35, grain: .02 + t * .01, day: t < .4 || sy > a.lightReturn };
  }

  function drawFlow(dt) {
    ctx.clearRect(0, 0, W, H);
    if (flowAlpha <= .01) return;

    ctx.save();
    ctx.globalAlpha = flowAlpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(174, 197, 214, .12)';
    for (const path of paths) {
      ctx.beginPath();
      ctx.moveTo(path.incoming[0].x, path.incoming[0].y);
      ctx.bezierCurveTo(path.incoming[1].x, path.incoming[1].y, path.incoming[2].x, path.incoming[2].y, path.incoming[3].x, path.incoming[3].y);
      ctx.bezierCurveTo(path.outgoing[1].x, path.outgoing[1].y, path.outgoing[2].x, path.outgoing[2].y, path.outgoing[3].x, path.outgoing[3].y);
      ctx.stroke();
    }

    for (const packet of packets) {
      if (!reduced) packet.t = (packet.t + packet.speed * dt / 1000) % 1;
      const p = pointOnPath(paths[packet.path], packet.t);
      const ahead = pointOnPath(paths[packet.path], Math.min(.999, packet.t + .004));
      const angle = Math.atan2(ahead.y - p.y, ahead.x - p.x);
      ctx.save();
      ctx.translate(p.x + px * 3, p.y + py * 2);
      ctx.rotate(angle);
      ctx.globalAlpha = flowAlpha * packet.alpha;
      ctx.fillStyle = '#D8844E';
      ctx.shadowColor = 'rgba(216,132,78,.75)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.roundRect(-packet.length / 2, -1, packet.length, 2, 1);
      ctx.fill();
      ctx.restore();
    }

    // The central anchor makes the convergence legible without competing with the hero copy.
    // Hidden below 760px: at phone widths the hero text is vertically centred right
    // where the anchor sits, so the mark would land on top of the subhead.
    if (W >= 760) {
      ctx.globalAlpha = flowAlpha;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(245,241,230,.48)';
      ctx.fillStyle = 'rgba(245,241,230,.72)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(focus.x, focus.y, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(focus.x, focus.y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.font = '500 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(245,241,230,.54)';
      ctx.fillText('AIR NOTE', focus.x, focus.y + 25);
    }

    // Source labels run down the left edge near where the streams originate —
    // same treatment on mobile as desktop, just tucked closer to the edge.
    const sourceLabels = ['MEETINGS', 'VOICE NOTES', 'MESSAGES', 'IDEAS'];
    ctx.globalAlpha = flowAlpha;
    ctx.fillStyle = 'rgba(245,241,230,.28)';
    ctx.font = '500 8px Inter, sans-serif';
    ctx.textAlign = 'left';
    const labelX = W < 760 ? 16 : 24;
    sourceLabels.forEach((label, i) => {
      ctx.fillText(label, labelX, H * (.27 + i * .17));
    });
    ctx.restore();
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
    flowAlpha = s.flow;

    // aurora + parallax depths (max 12px)
    if (!reduced) {
      aurora.style.setProperty('--px1', (px * 6) + 'px');  aurora.style.setProperty('--py1', (py * 4) + 'px');
      aurora.style.setProperty('--px2', (px * 9) + 'px');  aurora.style.setProperty('--py2', (py * 6) + 'px');
      aurora.style.setProperty('--px3', (px * 12) + 'px'); aurora.style.setProperty('--py3', (py * 8) + 'px');
    }

    drawFlow(dt);
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
  // Hero elements are the landing screen — reveal them on load unconditionally.
  // The .25 visibility threshold kept the phone mockup invisible on short
  // screens where only its top ~20% peeks above the fold.
  $$('.reveal').forEach(el => {
    if (el.closest('.hero')) requestAnimationFrame(() => el.classList.add('in'));
    else ro.observe(el);
  });

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

  /* ---------- early access signup ---------- */
  const signup = $('#signup');
  const signupDialog = $('.signup-dialog', signup);
  const signupForm = $('#signupForm');
  const signupSteps = $$('.signup-step', signup);
  const signupBack = $('#signupBack');
  const signupFooter = $('#signupFooter');
  const signupProgress = $('#signupProgress');
  const signupStepLabel = $('#signupStepLabel');
  const signupSuccess = $('#signupSuccess');
  const signupEmail = $('#signupEmail');
  const signupConsent = $('#signupConsent');
  const signupSubmit = $('#signupSubmit');
  const signupError = $('#signupError');
  const answers = {};
  let signupStep = 0;
  let previousFocus = null;

  const config = window.AIRNOTE_SUPABASE;
  const supabaseClient = window.supabase && config
    ? window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

  const params = new URLSearchParams(location.search);
  const attribution = {
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_content: params.get('utm_content'),
    utm_term: params.get('utm_term'),
    landing_page: location.href.split('#')[0],
    referrer: document.referrer || null
  };
  const signupSession = sessionStorage.getItem('airnote_signup_session') || crypto.randomUUID();
  sessionStorage.setItem('airnote_signup_session', signupSession);

  async function trackSignup(eventName, stepName = null) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from('early_access_events').insert({
        session_id: signupSession,
        event_name: eventName,
        step_name: stepName,
        properties: attribution
      });
    } catch (_) { /* Analytics must never interrupt the signup. */ }
  }

  function showSignupStep(index) {
    signupStep = Math.max(0, Math.min(index, signupSteps.length - 1));
    signupSteps.forEach((step, i) => step.classList.toggle('is-active', i === signupStep));
    signupProgress.style.width = `${((signupStep + 1) / signupSteps.length) * 100}%`;
    signupStepLabel.textContent = `A few quick questions · ${signupStep + 1} of ${signupSteps.length}`;
    signupBack.disabled = signupStep === 0;
    const active = signupSteps[signupStep];
    const selected = $('.choice.is-selected', active);
    (selected || $('.choice, input', active))?.focus({ preventScroll: true });
    trackSignup('signup_step_viewed', active.dataset.step);
  }

  function openSignup(event) {
    event?.preventDefault();
    previousFocus = document.activeElement;
    signup.classList.add('is-open');
    signup.setAttribute('aria-hidden', 'false');
    document.body.classList.add('signup-open');
    showSignupStep(signupStep);
    requestAnimationFrame(() => signupDialog.focus({ preventScroll: true }));
    trackSignup('signup_opened');
  }

  function closeSignup() {
    signup.classList.remove('is-open');
    signup.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('signup-open');
    previousFocus?.focus?.();
  }

  $$('[data-signup-open]').forEach(trigger => trigger.addEventListener('click', openSignup));
  $$('[data-signup-close]').forEach(trigger => trigger.addEventListener('click', closeSignup));
  signupBack.addEventListener('click', () => showSignupStep(signupStep - 1));

  $$('.choice', signup).forEach(choice => choice.addEventListener('click', () => {
    const field = choice.dataset.field;
    answers[field] = choice.dataset.value;
    $$(`[data-field="${field}"]`, signup).forEach(item => item.classList.toggle('is-selected', item === choice));
    trackSignup('signup_answered', field);
    setTimeout(() => showSignupStep(signupStep + 1), reduced ? 0 : 180);
  }));

  signupForm.addEventListener('submit', async event => {
    event.preventDefault();
    const email = signupEmail.value.trim().toLowerCase();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    signupEmail.classList.toggle('invalid', !validEmail);
    signupError.textContent = !validEmail ? 'Enter a valid email address.' : !signupConsent.checked ? 'Please confirm you’d like early access updates.' : '';
    if (!validEmail) return signupEmail.focus();
    if (!signupConsent.checked) return signupConsent.focus();
    if (!supabaseClient) {
      signupError.textContent = 'Signup is temporarily unavailable. Please try again shortly.';
      return;
    }

    signupSubmit.disabled = true;
    signupSubmit.textContent = 'Saving your place…';
    const { error } = await supabaseClient.from('early_access_signups').insert({
      session_id: signupSession,
      email,
      gender: answers.gender,
      age_range: answers.age_range,
      work_role: answers.work_role,
      primary_use_case: answers.primary_use_case,
      consent_marketing: true,
      ...attribution,
      user_agent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    if (error) {
      signupSubmit.disabled = false;
      signupSubmit.textContent = 'Join the early access list';
      signupError.textContent = error.code === '23505'
        ? 'That email is already on the early access list.'
        : 'We couldn’t save your place. Please try again.';
      return;
    }

    trackSignup('signup_completed', 'email');
    signupSteps.forEach(step => step.classList.remove('is-active'));
    signupSuccess.classList.add('is-active');
    signupStepLabel.textContent = 'Early access confirmed';
    signupProgress.style.width = '100%';
    signupFooter.hidden = true;
  });

  document.addEventListener('keydown', event => {
    if (!signup.classList.contains('is-open')) return;
    if (event.key === 'Escape') closeSignup();
    if (event.key !== 'Tab') return;
    const focusable = $$('button:not([disabled]), input:not([disabled])', signup).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  /* re-measure anchors once fonts/layout settle */
  addEventListener('load', () => { measure(); seedFlow(); });
  document.fonts?.ready.then(() => { measure(); seedFlow(); });
})();
