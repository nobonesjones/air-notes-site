/* ============================================================
   Air Note — Admin analytics
   ------------------------------------------------------------
   One page that answers three questions, in this order:
     1. What needs fixing this week?   (the issue list)
     2. How did the period go?         (KPIs vs the period before)
     3. Where exactly are people lost? (charts, funnels, cohorts)

   Everything is computed in the browser from three reads:
   profiles, captures (no transcripts, no segment lists) and
   analytics_events. At Air Note's size that is a few thousand
   rows; if it ever gets slow, move the aggregation into a
   SECURITY DEFINER RPC and keep the rendering below.
   ============================================================ */

(function () {
  "use strict";

  // ---- definitions that decide what the numbers mean ----------------------

  // Every new account gets a seeded welcome note, stored as a 'recording' with
  // meta.welcome = true (air-note migration 20260725120000). Counting it made
  // "users who recorded" equal to "users who signed up". It is never a
  // recording anyone made.
  const isRealRecording = (c) => c.type === "recording" && c.welcome !== true;

  // A recording still pending or processing after this long is stuck, not slow.
  const STUCK_AFTER_MS = 60 * 60 * 1000;
  // Under this, a recording is almost always an accidental start.
  const ACCIDENTAL_SECONDS = 30;
  // Matches FREE_RECORDING_COUNT in the app (lib/hooks/use-recording-usage.ts).
  const FREE_RECORDING_LIMIT = 3;

  const PERIODS = [
    ["yesterday", "Yesterday"],
    ["7", "Last 7 days"],
    ["30", "Last 30 days"],
  ];

  // Onboarding, counted per device. Every event carries anon_id, signed in or
  // not, so one key follows a person from first launch to first recording.
  // Counting user_id where present and anon_id otherwise (as the old funnel
  // did) gave the same person two identities either side of sign-in.
  const ONBOARDING = [
    { label: "Opened the app", keys: ["app_opened"] },
    { label: "Tapped Get started", keys: ["onboarding_get_started"] },
    { label: "Created account", keys: ["account_created"] },
    { label: "Finished the intro", keys: ["onboarding_finished"] },
    { label: "Reached Home", keys: ["home_viewed"] },
    { label: "Allowed the microphone", keys: ["microphone_allowed"] },
    { label: "Made a recording", keys: ["first_capture"], fromCaptures: true },
  ];

  const COLOR = { data: "#2F6BA8", failed: "#D0613F" };

  // ---- small utilities ----------------------------------------------------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };
  const DAY = 86400000;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayKey = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const fmtShortDay = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const fmtWhen = (d) => new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const plural = (n, word) => `${n.toLocaleString()} ${n === 1 ? word : word === "person" ? "people" : word + "s"}`;
  const fmtMinutes = (sec) => {
    if (sec == null) return "—";
    if (sec < 60) return `${Math.round(sec)}s`;
    const m = sec / 60;
    if (m < 60) return `${m < 10 ? m.toFixed(1) : Math.round(m)} min`;
    return `${(m / 60).toFixed(1)} h`;
  };
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const inRange = (iso, r) => { const t = new Date(iso).getTime(); return t >= r.from.getTime() && t < r.to.getTime(); };

  // The selected window and the one immediately before it, same length.
  function periodRanges(period, now) {
    const today = startOfDay(now);
    if (period === "yesterday") {
      const from = addDays(today, -1);
      return { cur: { from, to: today }, prev: { from: addDays(today, -2), to: from }, days: 1,
        label: fmtDay(from), prevLabel: "the day before" };
    }
    const days = Number(period);
    // "Last 7 days" = today plus the six before it, so today's activity shows.
    const from = addDays(today, -(days - 1));
    const to = new Date(now.getTime() + 1);
    return { cur: { from, to }, prev: { from: addDays(from, -days), to: from }, days,
      label: `${fmtShortDay(from)} – today`, prevLabel: `the ${days} days before` };
  }

  // ---- data ---------------------------------------------------------------
  // PostgREST on Supabase caps a response at 1,000 rows whatever .limit() asks
  // for, so a plain select silently truncates. Page until a short page.
  async function fetchAll(sb, table, columns, orderCol) {
    const out = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select(columns)
        .order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async function loadData(sb, cfg) {
    const internal = new Set((cfg.internalEmails || []).map((e) => e.toLowerCase()));
    const [profiles, captures, events] = await Promise.all([
      fetchAll(sb, cfg.tables.profiles, "*", "created_at"),
      fetchAll(sb, "captures",
        "id,user_id,type,processing_status,created_at,updated_at,duration_seconds,welcome:meta->welcome,partial:meta->partial",
        "created_at"),
      fetchAll(sb, cfg.tables.analytics, "anon_id,user_id,event_name,created_at", "created_at").catch(() => null),
    ]);

    const emailOf = (p) => p.email || p.email_address || p.user_email || null;
    const internalIds = new Set(profiles.filter((p) => internal.has((emailOf(p) || "").toLowerCase())).map((p) => p.id));
    const users = new Map();
    profiles.filter((p) => !internalIds.has(p.id)).forEach((p) => users.set(p.id, { id: p.id, email: emailOf(p), created_at: p.created_at }));

    const recordings = captures.filter((c) => isRealRecording(c) && !internalIds.has(c.user_id));
    const ev = events ? events.filter((e) => !internalIds.has(e.user_id)) : null;
    return { users, recordings, events: ev, eventsAvailable: events !== null, internalCount: internalIds.size };
  }

  // ---- metrics ------------------------------------------------------------
  function computeWindow(data, r) {
    const newUsers = [...data.users.values()].filter((u) => inRange(u.created_at, r));
    const recs = data.recordings.filter((c) => inRange(c.created_at, r));
    const recorders = new Set(recs.map((c) => c.user_id));
    const failed = recs.filter((c) => c.processing_status === "failed");
    const seconds = recs.reduce((s, c) => s + (c.duration_seconds || 0), 0);
    // Activation: new accounts in the window that have made a real recording since.
    const firstRec = firstRecordingByUser(data);
    const activated = newUsers.filter((u) => firstRec.has(u.id));
    return { newUsers, recs, recorders, failed, seconds, activated };
  }

  let _firstRecCache = null;
  function firstRecordingByUser(data) {
    if (_firstRecCache && _firstRecCache.data === data) return _firstRecCache.map;
    const map = new Map();
    data.recordings.forEach((c) => {
      const t = new Date(c.created_at).getTime();
      if (!map.has(c.user_id) || t < map.get(c.user_id)) map.set(c.user_id, t);
    });
    _firstRecCache = { data, map };
    return map;
  }

  function onboardingFunnel(data, r) {
    if (!data.events) return null;
    const byDevice = new Map();
    const deviceUser = new Map();
    data.events.forEach((e) => {
      if (!e.anon_id) return;
      if (!byDevice.has(e.anon_id)) byDevice.set(e.anon_id, new Set());
      byDevice.get(e.anon_id).add(e.event_name);
      if (e.user_id) deviceUser.set(e.anon_id, e.user_id);
    });
    // The cohort is every device whose first launch fell in the window; each is
    // then followed to now, so a step taken the day after still counts.
    const opened = data.events.filter((e) => e.event_name === "app_opened" && inRange(e.created_at, r)).map((e) => e.anon_id);
    const cohort = [...new Set(opened)];
    const recorded = new Set(data.recordings.map((c) => c.user_id));
    const steps = ONBOARDING.map((s) => ({
      label: s.label,
      count: cohort.filter((d) => {
        const seen = byDevice.get(d) || new Set();
        if (s.keys.some((k) => seen.has(k))) return true;
        return s.fromCaptures && deviceUser.has(d) && recorded.has(deviceUser.get(d));
      }).length,
    }));
    return { cohortSize: cohort.length, steps };
  }

  // Account-side ladder. Built only from profiles and captures, so it is right
  // even if a build ever stops sending events.
  function activationLadder(data, r, now) {
    const firstRec = firstRecordingByUser(data);
    const cohort = [...data.users.values()].filter((u) => inRange(u.created_at, r));
    const recsByUser = new Map();
    data.recordings.forEach((c) => {
      if (!recsByUser.has(c.user_id)) recsByUser.set(c.user_id, []);
      recsByUser.get(c.user_id).push(c);
    });
    const within24 = cohort.filter((u) => firstRec.has(u.id) && firstRec.get(u.id) - new Date(u.created_at).getTime() <= DAY);
    const ever = cohort.filter((u) => firstRec.has(u.id));
    const two = cohort.filter((u) => (recsByUser.get(u.id) || []).length >= 2);
    const twoDays = cohort.filter((u) => new Set((recsByUser.get(u.id) || []).map((c) => dayKey(c.created_at))).size >= 2);
    const limit = cohort.filter((u) => (recsByUser.get(u.id) || []).length >= FREE_RECORDING_LIMIT);
    const times = ever.map((u) => (firstRec.get(u.id) - new Date(u.created_at).getTime()) / 60000).filter((m) => m >= 0);
    return {
      cohortSize: cohort.length,
      // A cohort that is less than a day old can't have finished its first day.
      young: r.to.getTime() - r.from.getTime() <= DAY && now.getTime() - r.to.getTime() < DAY,
      // Each step is a strict subset of the one before, so "% of previous
      // step" can never pass 100. Recording within a day isn't a subset of
      // anything later, so it lives in the summary line instead.
      steps: [
        { label: "Created an account", count: cohort.length },
        { label: "Made a recording", count: ever.length },
        { label: "Made 2 or more", count: two.length },
        { label: "Came back another day", count: twoDays.length },
      ],
      within24: within24.length,
      hitLimit: limit.length,
      medianMinutesToFirst: median(times),
    };
  }

  // ---- the issue list -----------------------------------------------------
  // Each issue is one thing that can be fixed, with the number that proves it
  // and the people affected. Ranked by severity, then by how many it touches.
  function findIssues(data, period, ranges, now, onboarding, ladder) {
    const issues = [];
    const cur = computeWindow(data, ranges.cur);
    const prev = computeWindow(data, ranges.prev);
    const email = (id) => (data.users.get(id) || {}).email || id;
    const people = (ids) => [...new Set(ids)].map((id) => ({ id, label: email(id) }));

    // 1. Stuck recordings, any age in the last 30 days. A stuck note is a user
    //    looking at a spinner, so it outranks everything.
    const thirty = addDays(startOfDay(now), -30).getTime();
    const stuck = data.recordings.filter((c) =>
      (c.processing_status === "pending" || c.processing_status === "processing") &&
      new Date(c.created_at).getTime() >= thirty &&
      now.getTime() - new Date(c.updated_at || c.created_at).getTime() > STUCK_AFTER_MS);
    if (stuck.length) issues.push({
      severity: "critical", area: "Processing",
      title: `${plural(stuck.length, "recording")} stuck in processing`,
      detail: "Still pending or processing more than an hour after the last update. These people are looking at a note that never finishes.",
      people: people(stuck.map((c) => c.user_id)),
      rows: stuck.map((c) => ({ when: c.created_at, who: email(c.user_id), status: c.processing_status, dur: c.duration_seconds, userId: c.user_id })),
    });

    // 2. Failed processing in the window.
    if (cur.failed.length) {
      const rate = pct(cur.failed.length, cur.recs.length);
      issues.push({
        severity: rate >= 10 ? "critical" : "warning", area: "Processing",
        title: `${rate}% of recordings failed to process`,
        detail: `${cur.failed.length} of ${cur.recs.length} recordings ended as failed${prev.recs.length ? `, against ${pct(prev.failed.length, prev.recs.length)}% in ${ranges.prevLabel}` : ""}. Check the process-capture logs for these.`,
        people: people(cur.failed.map((c) => c.user_id)),
        rows: cur.failed.map((c) => ({ when: c.created_at, who: email(c.user_id), status: "failed", dur: c.duration_seconds, userId: c.user_id })),
      });
    }

    // 3. Partial notes: built from incomplete audio.
    const partial = cur.recs.filter((c) => c.partial === true);
    if (partial.length) issues.push({
      severity: "warning", area: "Recording",
      title: `${plural(partial.length, "note")} built from incomplete audio`,
      detail: "Segments were missing or still uploading when the note was written. Usually a lost connection or an interrupted recording.",
      people: people(partial.map((c) => c.user_id)),
    });

    // 4. Signed up, never recorded. Only accounts old enough to have had a day.
    const settled = cur.newUsers.filter((u) => now.getTime() - new Date(u.created_at).getTime() >= DAY);
    const firstRec = firstRecordingByUser(data);
    const silent = settled.filter((u) => !firstRec.has(u.id));
    if (silent.length && settled.length) {
      const rate = pct(silent.length, settled.length);
      const young = cur.newUsers.length - settled.length;
      issues.push({
        // A percentage of two people is noise; only escalate on a real sample.
        severity: rate >= 50 && settled.length >= 5 ? "warning" : "info", area: "Activation",
        title: `${silent.length} of ${settled.length} new accounts haven't made a recording`,
        detail: `${rate}% of people who signed up in this period and have had at least a day have not recorded anything.` +
          (young ? ` ${plural(young, "newer account")} are left out until they've had a day.` : "") +
          " This is the activation gap.",
        people: people(silent.map((u) => u.id)),
      });
    }

    // 5. Biggest onboarding leak, by share of people lost at one step.
    if (onboarding && onboarding.cohortSize >= 3) {
      let worst = null;
      for (let i = 1; i < onboarding.steps.length; i++) {
        const a = onboarding.steps[i - 1].count;
        const b = onboarding.steps[i].count;
        if (a >= 3 && (!worst || (a - b) / a > worst.loss)) worst = { from: onboarding.steps[i - 1], to: onboarding.steps[i], loss: (a - b) / a, lost: a - b };
      }
      if (worst && worst.lost > 0) issues.push({
        severity: worst.loss >= 0.4 ? "warning" : "info", area: "Onboarding",
        title: `Biggest onboarding leak: ${worst.from.label} → ${worst.to.label}`,
        detail: `${Math.round(worst.loss * 100)}% drop at this step. ${worst.lost} of ${worst.from.count} devices that got to "${worst.from.label}" did not go further.`,
      });
    }

    // 6. Event delivery gap: accounts appear in the events but launches don't.
    if (onboarding && onboarding.cohortSize === 0 && data.events &&
        data.events.some((e) => e.event_name === "account_created" && inRange(e.created_at, ranges.cur))) {
      issues.push({
        severity: "warning", area: "Data",
        title: "Pre-sign-in events are not arriving",
        detail: "Accounts were created but no app_opened events exist, so the onboarding funnel has no starting point. Check the analytics_events insert policy allows rows with a null user_id.",
      });
    }

    // 7. Accidental starts.
    const tiny = cur.recs.filter((c) => c.duration_seconds != null && c.duration_seconds < ACCIDENTAL_SECONDS);
    if (cur.recs.length >= 5 && tiny.length / cur.recs.length >= 0.2) issues.push({
      severity: "info", area: "Recording",
      title: `${pct(tiny.length, cur.recs.length)}% of recordings are under ${ACCIDENTAL_SECONDS} seconds`,
      detail: "Usually accidental starts or people testing the button. Worth checking whether the record flow is confusing.",
      people: people(tiny.map((c) => c.user_id)),
    });

    // 8. Went quiet: recorded in the previous window, not in this one.
    if (period !== "yesterday") {
      const quiet = [...prev.recorders].filter((id) => !cur.recorders.has(id) && data.users.has(id));
      if (quiet.length) issues.push({
        severity: "info", area: "Retention",
        title: `${plural(quiet.length, "person")} stopped recording`,
        detail: `Recorded in ${ranges.prevLabel} but not in this period.`,
        people: people(quiet),
      });
    }

    // 9. Hit the free limit in this window: everyone here has seen the paywall.
    const counts = new Map();
    const hitAt = new Map();
    [...data.recordings].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach((c) => {
      const n = (counts.get(c.user_id) || 0) + 1;
      counts.set(c.user_id, n);
      if (n === FREE_RECORDING_LIMIT) hitAt.set(c.user_id, c.created_at);
    });
    const hit = [...hitAt.entries()].filter(([, at]) => inRange(at, ranges.cur)).map(([id]) => id);
    if (hit.length) issues.push({
      severity: "info", area: "Revenue",
      title: `${plural(hit.length, "person")} reached the free limit`,
      detail: `Made their ${FREE_RECORDING_LIMIT}rd recording in this period, so the next one shows the paywall. These are your most engaged free users.`,
      people: people(hit),
    });

    const rank = { critical: 0, warning: 1, info: 2 };
    return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || ((b.people || []).length - (a.people || []).length));
  }

  // ---- rendering: building blocks -----------------------------------------
  function section(main, title, sub) {
    const s = el("section", "ax-section");
    const h = el("div", "ax-section-head");
    h.appendChild(el("h2", "ax-section-title", title));
    if (sub) h.appendChild(el("p", "ax-section-sub", sub));
    s.appendChild(h);
    main.appendChild(s);
    return s;
  }

  // Delta vs the previous window. Up is not always good, so the caller says
  // which direction is.
  function delta(cur, prev, goodWhenUp = true, asPoints = false) {
    const d = el("span", "ax-delta");
    if (prev == null || cur == null) { d.textContent = ""; return d; }
    if (asPoints) {
      const diff = cur - prev;
      if (diff === 0) { d.textContent = "no change"; d.classList.add("flat"); return d; }
      d.textContent = `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} pt${Math.abs(diff) === 1 ? "" : "s"}`;
      d.classList.add((diff > 0) === goodWhenUp ? "good" : "bad");
      return d;
    }
    if (prev === 0 && cur === 0) { d.textContent = "no change"; d.classList.add("flat"); return d; }
    if (prev === 0) { d.textContent = "new"; d.classList.add(goodWhenUp ? "good" : "bad"); return d; }
    const change = Math.round(((cur - prev) / prev) * 100);
    if (change === 0) { d.textContent = "no change"; d.classList.add("flat"); return d; }
    d.textContent = `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}%`;
    d.classList.add((change > 0) === goodWhenUp ? "good" : "bad");
    return d;
  }

  function kpiTile(grid, label, value, d, foot) {
    const c = el("div", "ax-kpi");
    c.appendChild(el("div", "ax-kpi-label", label));
    const row = el("div", "ax-kpi-row");
    row.appendChild(el("div", "ax-kpi-value", value));
    if (d) row.appendChild(d);
    c.appendChild(row);
    if (foot) c.appendChild(el("div", "ax-kpi-foot", foot));
    grid.appendChild(c);
  }

  // A tooltip shared by every chart on the page.
  let tip = null;
  function showTip(evt, lines) {
    if (!tip) { tip = el("div", "ax-tip"); document.body.appendChild(tip); }
    tip.innerHTML = "";
    lines.forEach(([k, v, swatch], i) => {
      const row = el("div", i === 0 ? "ax-tip-head" : "ax-tip-row");
      if (swatch) { const s = el("span", "ax-swatch"); s.style.background = swatch; row.appendChild(s); }
      row.appendChild(el("span", null, k));
      if (v != null) row.appendChild(el("strong", null, String(v)));
      tip.appendChild(row);
    });
    tip.style.display = "block";
    const pad = 14;
    const w = tip.offsetWidth;
    const x = Math.min(window.innerWidth - w - 8, evt.clientX + pad);
    tip.style.left = `${x}px`;
    tip.style.top = `${evt.clientY + pad}px`;
  }
  const hideTip = () => { if (tip) tip.style.display = "none"; };
  // The tooltip lives on <body>, so leaving the page must hide it explicitly.
  window.addEventListener("hashchange", hideTip);

  // Daily bar chart over the last 30 days. series = [{name, color, values[]}],
  // stacked in order. The selected window is shaded so the KPIs above and the
  // bars line up visually.
  function barChart(container, days, series, highlight) {
    // Drawn at the card's real width, not scaled from a fixed viewBox: scaling
    // shrank 10px tick labels to about 5px in a three-column grid.
    const cs = getComputedStyle(container);
    const W = Math.max(220, container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const H = 170, padL = 30, padR = 6, padT = 10, padB = 22;
    const totals = days.map((_, i) => series.reduce((s, ser) => s + ser.values[i], 0));
    const max = Math.max(1, ...totals);
    const niceMax = max <= 4 ? max : Math.ceil(max / (max > 20 ? 10 : 2)) * (max > 20 ? 10 : 2);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "ax-chart", role: "img" });
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const step = plotW / days.length;
    const barW = Math.max(3, step - 3);
    const y = (v) => padT + plotH - (v / niceMax) * plotH;

    // Selected window band.
    const hi = days.map((d, i) => (highlight(d) ? i : -1)).filter((i) => i >= 0);
    if (hi.length && hi.length < days.length) {
      svg.appendChild(svgEl("rect", { x: padL + hi[0] * step, y: padT, width: hi.length * step, height: plotH, class: "ax-band" }));
    }
    // Recessive grid: baseline, midline, top.
    [0, niceMax / 2, niceMax].forEach((v) => {
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: v === 0 ? "ax-axis" : "ax-grid" }));
      const t = svgEl("text", { x: padL - 6, y: y(v) + 3, class: "ax-tick", "text-anchor": "end" });
      t.textContent = Number.isInteger(v) ? v : v.toFixed(1);
      svg.appendChild(t);
    });
    // Bars, stacked bottom-up, with a 2px surface gap between segments.
    days.forEach((d, i) => {
      let base = 0;
      const x = padL + i * step + (step - barW) / 2;
      series.forEach((ser, si) => {
        const v = ser.values[i];
        if (!v) return;
        const top = y(base + v);
        const h = y(base) - top - (si > 0 ? 2 : 0);
        const isTop = series.slice(si + 1).every((s) => !s.values[i]);
        const r = Math.min(4, barW / 2, h);
        // Rounded data end only on the top of the stack.
        const path = isTop
          ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`
          : `M${x},${top + h} V${top} H${x + barW} V${top + h} Z`;
        svg.appendChild(svgEl("path", { d: path, fill: ser.color }));
        base += v;
      });
      // Date labels: first, last, and Mondays.
      const date = new Date(d);
      // Mondays near either end would collide with the end labels.
      const edge = i === 0 || i === days.length - 1;
      if (edge || (date.getDay() === 1 && i > 3 && i < days.length - 4)) {
        const t = svgEl("text", { x: padL + i * step + step / 2, y: H - 6, class: "ax-tick", "text-anchor": i === 0 ? "start" : i === days.length - 1 ? "end" : "middle" });
        t.textContent = fmtShortDay(d);
        svg.appendChild(t);
      }
      // Hit target: the full column, bigger than the bar.
      const hit = svgEl("rect", { x: padL + i * step, y: padT, width: step, height: plotH, class: "ax-hit" });
      hit.addEventListener("mousemove", (e) => {
        const lines = [[fmtDay(d), null]];
        series.forEach((s) => lines.push([s.name, s.values[i], series.length > 1 ? s.color : null]));
        if (series.length > 1) lines.push(["Total", totals[i]]);
        showTip(e, lines);
      });
      hit.addEventListener("mouseleave", hideTip);
      svg.appendChild(hit);
    });
    container.appendChild(svg);
    if (series.length > 1) {
      const legend = el("div", "ax-legend");
      series.forEach((s) => {
        const item = el("span", "ax-legend-item");
        const sw = el("span", "ax-swatch"); sw.style.background = s.color;
        item.append(sw, document.createTextNode(s.name));
        legend.appendChild(item);
      });
      container.appendChild(legend);
    }
  }

  function chartCard(grid, title, total, sub) {
    const c = el("div", "ax-card");
    const h = el("div", "ax-card-head");
    h.appendChild(el("div", "ax-card-title", title));
    if (total != null) h.appendChild(el("div", "ax-card-total", total));
    c.appendChild(h);
    if (sub) c.appendChild(el("div", "ax-card-sub", sub));
    grid.appendChild(c);
    return c;
  }

  // Horizontal funnel. Each row: share of the starting group, the step's own
  // conversion, and the same figure for the previous window.
  function funnelRows(container, steps, prevSteps, startLabel) {
    const start = steps[0].count;
    let worstIdx = -1, worstLoss = 0;
    steps.forEach((s, i) => {
      if (!i) return;
      const a = steps[i - 1].count;
      const loss = a ? (a - s.count) / a : 0;
      if (a >= 3 && loss > worstLoss) { worstLoss = loss; worstIdx = i; }
    });
    const list = el("div", "ax-funnel");
    steps.forEach((s, i) => {
      const row = el("div", "ax-frow" + (i === worstIdx ? " worst" : ""));
      row.appendChild(el("div", "ax-flabel", s.label));
      const track = el("div", "ax-ftrack");
      const fill = el("div", "ax-ffill");
      fill.style.width = `${start ? Math.max(1.5, (s.count / start) * 100) : 0}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("div", "ax-fcount", s.count.toLocaleString()));
      const share = pct(s.count, start);
      row.appendChild(el("div", "ax-fpct", share == null ? "—" : `${share}%`));
      const stepCell = el("div", "ax-fstep");
      if (i) {
        const conv = pct(s.count, steps[i - 1].count);
        stepCell.textContent = conv == null ? "—" : `${conv}% of previous step`;
        if (i === worstIdx) stepCell.appendChild(el("span", "ax-flag", "Biggest drop"));
      } else {
        stepCell.textContent = startLabel;
      }
      row.appendChild(stepCell);
      const prevCell = el("div", "ax-fprev");
      if (prevSteps && prevSteps[0].count) {
        const p = pct(prevSteps[i].count, prevSteps[0].count);
        prevCell.textContent = `before: ${p}%`;
        if (i && share != null) prevCell.appendChild(delta(share, p, true, true));
      }
      row.appendChild(prevCell);
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  function peopleList(container, people) {
    const wrap = el("div", "ax-people");
    const shown = people.slice(0, 12);
    shown.forEach((p) => {
      const a = el("a", "ax-person", p.label);
      a.href = "#/user/" + encodeURIComponent(p.id);
      wrap.appendChild(a);
    });
    if (people.length > shown.length) wrap.appendChild(el("span", "ax-more", `+${people.length - shown.length} more`));
    container.appendChild(wrap);
  }

  // ---- rendering: the page ------------------------------------------------
  async function render(main, sb, cfg, initialPeriod) {
    const head = el("div", "funnel-page-head");
    const titleWrap = el("div", "page-head");
    titleWrap.appendChild(el("h1", "page-title", "Analytics"));
    const sub = el("p", "page-sub", "Loading…");
    titleWrap.appendChild(sub);
    head.appendChild(titleWrap);

    let period = initialPeriod || "7";
    const seg = el("div", "seg funnel-range");
    const segBtns = PERIODS.map(([v, label]) => {
      const b = el("button", "seg-btn" + (v === period ? " active" : ""), label);
      b.type = "button";
      b.addEventListener("click", () => {
        if (period === v) return;
        period = v;
        segBtns.forEach((x) => x.classList.toggle("active", x === b));
        try { localStorage.setItem("airnote-admin-period", v); } catch (e) { /* private mode */ }
        draw();
      });
      seg.appendChild(b);
      return b;
    });
    head.appendChild(seg);
    main.appendChild(head);

    const body = el("div", "ax-body");
    main.appendChild(body);
    body.appendChild(el("div", "funnel-loading", null)).innerHTML = "<span class='spinner'></span><span>Loading data…</span>";

    let data;
    try {
      data = await loadData(sb, cfg);
    } catch (e) {
      body.innerHTML = "";
      body.appendChild(el("p", "muted", "Couldn't load data. The admin read policies on profiles, captures and analytics_events must all allow is_admin()."));
      console.error("[analytics]", e);
      return;
    }

    function draw() {
      body.innerHTML = "";
      hideTip();
      const now = new Date();
      const ranges = periodRanges(period, now);
      const cur = computeWindow(data, ranges.cur);
      const prev = computeWindow(data, ranges.prev);
      const onboarding = onboardingFunnel(data, ranges.cur);
      const onboardingPrev = onboardingFunnel(data, ranges.prev);
      const ladder = activationLadder(data, ranges.cur, now);
      const ladderPrev = activationLadder(data, ranges.prev, now);
      sub.textContent = `${ranges.label}, compared with ${ranges.prevLabel}.` +
        (data.internalCount ? ` Excludes ${plural(data.internalCount, "internal account")}.` : "");

      // 1. Issues.
      const issues = findIssues(data, period, ranges, now, onboarding, ladder);
      const issueSec = section(body, "What needs attention", issues.length
        ? "Ranked by severity. Fix the top one, then check back next week."
        : null);
      if (!issues.length) {
        issueSec.appendChild(el("div", "ax-allclear", "Nothing flagged in this period. No stuck or failed recordings, and no step losing more than the others."));
      }
      const iList = el("div", "ax-issues");
      issues.forEach((iss, n) => {
        const card = el("details", `ax-issue ${iss.severity}`);
        if (n === 0 && iss.severity !== "info") card.open = true;
        const summary = el("summary");
        const badge = el("span", `ax-sev ${iss.severity}`);
        badge.appendChild(el("span", "ax-sev-icon", iss.severity === "critical" ? "!" : iss.severity === "warning" ? "▲" : "i"));
        badge.appendChild(document.createTextNode(iss.severity === "critical" ? "Fix now" : iss.severity === "warning" ? "Fix this week" : "Worth a look"));
        summary.appendChild(badge);
        summary.appendChild(el("span", "ax-issue-title", iss.title));
        summary.appendChild(el("span", "ax-issue-area", iss.area));
        card.appendChild(summary);
        const inner = el("div", "ax-issue-body");
        inner.appendChild(el("p", null, iss.detail));
        if (iss.rows && iss.rows.length) {
          const t = el("table", "data-table ax-mini-table");
          const tb = el("tbody");
          iss.rows.slice(0, 10).forEach((r) => {
            const tr = el("tr", "clickable");
            tr.append(el("td", null, fmtWhen(r.when)), el("td", "strong", r.who), el("td", null, r.status), el("td", null, fmtMinutes(r.dur)));
            tr.addEventListener("click", () => { location.hash = "#/user/" + encodeURIComponent(r.userId); });
            tb.appendChild(tr);
          });
          t.appendChild(tb);
          inner.appendChild(t);
        } else if (iss.people && iss.people.length) {
          peopleList(inner, iss.people);
        }
        card.appendChild(inner);
        iList.appendChild(card);
      });
      issueSec.appendChild(iList);

      // 2. KPIs.
      const kpiSec = section(body, "The period at a glance");
      const grid = el("div", "ax-kpis");
      kpiSec.appendChild(grid);
      kpiTile(grid, "New accounts", cur.newUsers.length.toLocaleString(), delta(cur.newUsers.length, prev.newUsers.length));
      const actRate = pct(cur.activated.length, cur.newUsers.length);
      const actPrev = pct(prev.activated.length, prev.newUsers.length);
      kpiTile(grid, "Activation rate", actRate == null ? "—" : `${actRate}%`,
        actRate == null || actPrev == null ? null : delta(actRate, actPrev, true, true),
        `${cur.activated.length} of ${cur.newUsers.length} new accounts have recorded`);
      kpiTile(grid, "Recordings", cur.recs.length.toLocaleString(), delta(cur.recs.length, prev.recs.length));
      kpiTile(grid, "People who recorded", cur.recorders.size.toLocaleString(), delta(cur.recorders.size, prev.recorders.size));
      kpiTile(grid, "Hours recorded", (cur.seconds / 3600).toFixed(1), delta(cur.seconds, prev.seconds),
        cur.recs.length ? `median ${fmtMinutes(median(cur.recs.map((c) => c.duration_seconds || 0)))} per recording` : null);
      const failRate = pct(cur.failed.length, cur.recs.length);
      const failPrev = pct(prev.failed.length, prev.recs.length);
      kpiTile(grid, "Failed processing", failRate == null ? "—" : `${failRate}%`,
        failRate == null || failPrev == null ? null : delta(failRate, failPrev, false, true),
        `${cur.failed.length} of ${cur.recs.length} recordings`);

      // 3. Trends, always the last 30 days, selected window shaded.
      const trendSec = section(body, "Last 30 days, day by day", "The shaded area is the selected period. Hover a day for its numbers.");
      const charts = el("div", "ax-charts");
      trendSec.appendChild(charts);
      const today = startOfDay(now);
      const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
      const idx = new Map(days.map((d, i) => [dayKey(d), i]));
      const zero = () => days.map(() => 0);
      const signups = zero(), ok = zero(), bad = zero();
      const recorderSets = days.map(() => new Set());
      data.users.forEach((u) => { const i = idx.get(dayKey(u.created_at)); if (i != null) signups[i]++; });
      data.recordings.forEach((c) => {
        const i = idx.get(dayKey(c.created_at));
        if (i == null) return;
        (c.processing_status === "failed" ? bad : ok)[i]++;
        recorderSets[i].add(c.user_id);
      });
      const highlight = (d) => inRange(d, { from: startOfDay(ranges.cur.from), to: ranges.cur.to });
      const sum = (xs) => xs.reduce((a, b) => a + b, 0);
      barChart(chartCard(charts, "New accounts", sum(signups).toLocaleString(), "Accounts created per day"), days,
        [{ name: "New accounts", color: COLOR.data, values: signups }], highlight);
      barChart(chartCard(charts, "Recordings", (sum(ok) + sum(bad)).toLocaleString(), "Real recordings per day, welcome note excluded"), days,
        [{ name: "Processed", color: COLOR.data, values: ok }, { name: "Failed", color: COLOR.failed, values: bad }], highlight);
      barChart(chartCard(charts, "People who recorded", null, "Distinct people with at least one recording that day"), days,
        [{ name: "People", color: COLOR.data, values: recorderSets.map((s) => s.size) }], highlight);

      // 4. Onboarding funnel (devices).
      const obSec = section(body, "Onboarding: first launch to first recording",
        "Every device that opened the app for the first time in this period, followed to today. Counted per device, so a step taken the next day still counts.");
      const obCard = el("div", "ax-card");
      obSec.appendChild(obCard);
      if (!data.eventsAvailable) {
        obCard.appendChild(el("p", "muted", "Onboarding events couldn't be read. Check the admin read policy on analytics_events."));
      } else if (!onboarding.cohortSize) {
        obCard.appendChild(el("p", "muted", "No first launches recorded in this period. Builds before 1.0.1 don't send onboarding events, so older installs never appear here."));
      } else {
        obCard.appendChild(el("div", "ax-card-sub", `${plural(onboarding.cohortSize, "device")} opened the app for the first time.`));
        funnelRows(obCard, onboarding.steps, onboardingPrev && onboardingPrev.cohortSize ? onboardingPrev.steps : null, "starting group");
      }

      // 5. Activation ladder (accounts).
      const acSec = section(body, "Activation: what new accounts went on to do",
        "Accounts created in this period, from the database rather than from events.");
      const acCard = el("div", "ax-card");
      acSec.appendChild(acCard);
      if (!ladder.cohortSize) {
        acCard.appendChild(el("p", "muted", "No accounts created in this period."));
      } else {
        const meta = el("div", "ax-card-sub");
        meta.textContent = `${plural(ladder.cohortSize, "account")}. ` +
          `${pct(ladder.within24, ladder.cohortSize)}% recorded within 24 hours of signing up. ` +
          (ladder.medianMinutesToFirst != null ? `Median time to first recording: ${fmtMinutes(ladder.medianMinutesToFirst * 60)}.` : "Nobody has recorded yet.") +
          (ladder.young ? " These accounts are less than a day old, so the later steps are still filling in." : "");
        acCard.appendChild(meta);
        funnelRows(acCard, ladder.steps, ladderPrev.cohortSize ? ladderPrev.steps : null, "starting group");
      }

      // 6. Recording shape.
      const recSec = section(body, "Recordings in this period");
      const recGrid = el("div", "ax-charts two");
      recSec.appendChild(recGrid);
      const buckets = [["Under 30s", 0, 30], ["30s – 5 min", 30, 300], ["5 – 15 min", 300, 900], ["15 – 30 min", 900, 1800], ["30 – 60 min", 1800, 3600], ["Over 1 h", 3600, Infinity]];
      const lenCard = chartCard(recGrid, "How long recordings are", null, "Short ones are often accidental starts. Long ones stress processing.");
      hbars(lenCard, buckets.map(([label, lo, hi]) => [label, cur.recs.filter((c) => (c.duration_seconds || 0) >= lo && (c.duration_seconds || 0) < hi).length]));
      const perUser = new Map();
      cur.recs.forEach((c) => perUser.set(c.user_id, (perUser.get(c.user_id) || 0) + 1));
      const pu = [...perUser.values()];
      const puCard = chartCard(recGrid, "Recordings per person", null, "How many recordings each active person made in this period.");
      hbars(puCard, [["1 recording", pu.filter((n) => n === 1).length], ["2", pu.filter((n) => n === 2).length], ["3 – 5", pu.filter((n) => n >= 3 && n <= 5).length], ["6 or more", pu.filter((n) => n >= 6).length]], "people");

      // 7. Weekly cohorts.
      const coSec = section(body, "Weekly cohorts: do people keep recording?",
        "Each row is the people who signed up that week. Each cell is the share who made a recording in that week after signing up, counting only people whose week is over. Dashed cells are still filling in.");
      cohortTable(coSec, data, now);
    }

    function hbars(container, rows, unit) {
      const max = Math.max(1, ...rows.map((r) => r[1]));
      const total = rows.reduce((s, r) => s + r[1], 0);
      const list = el("div", "ax-hbars");
      rows.forEach(([label, n]) => {
        const row = el("div", "ax-hbar");
        row.appendChild(el("div", "ax-hbar-label", label));
        const track = el("div", "ax-ftrack");
        const fill = el("div", "ax-ffill");
        fill.style.width = `${n ? Math.max(2, (n / max) * 100) : 0}%`;
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("div", "ax-fcount", n.toLocaleString()));
        row.appendChild(el("div", "ax-fpct", total ? `${pct(n, total)}%` : "—"));
        row.addEventListener("mousemove", (e) => showTip(e, [[label, null], [unit === "people" ? "People" : "Recordings", n], ["Share", total ? `${pct(n, total)}%` : "—"]]));
        row.addEventListener("mouseleave", hideTip);
        list.appendChild(row);
      });
      container.appendChild(list);
      if (!total) container.appendChild(el("p", "muted", "No recordings in this period."));
    }

    function cohortTable(container, data, now) {
      const WEEKS = 6;
      const thisWeek = startOfDay(now);
      thisWeek.setDate(thisWeek.getDate() - ((thisWeek.getDay() + 6) % 7)); // Monday
      const recDaysByUser = new Map();
      data.recordings.forEach((c) => {
        if (!recDaysByUser.has(c.user_id)) recDaysByUser.set(c.user_id, []);
        recDaysByUser.get(c.user_id).push(new Date(c.created_at).getTime());
      });
      const card = el("div", "ax-card ax-cohort-wrap");
      const t = el("table", "ax-cohort");
      const hr = el("tr");
      hr.appendChild(el("th", null, "Signed up"));
      hr.appendChild(el("th", null, "People"));
      for (let w = 0; w < WEEKS; w++) hr.appendChild(el("th", null, `Week ${w}`));
      const thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
      const tb = el("tbody");
      for (let k = WEEKS - 1; k >= 0; k--) {
        const from = addDays(thisWeek, -7 * k);
        const to = addDays(from, 7);
        const cohort = [...data.users.values()].filter((u) => inRange(u.created_at, { from, to }));
        const tr = el("tr");
        tr.appendChild(el("td", "ax-cohort-week", `${fmtShortDay(from)}`));
        tr.appendChild(el("td", "ax-cohort-n", String(cohort.length)));
        for (let w = 0; w < WEEKS; w++) {
          const td = el("td", "ax-cell");
          // Week w is measured from each person's own sign-up, and only over
          // people whose week w has finished. Counting an unfinished week as
          // "didn't record" made every recent cohort look like it churned.
          const done = cohort.filter((u) => new Date(u.created_at).getTime() + (w + 1) * 7 * DAY <= now.getTime());
          if (!done.length) { td.classList.add("future"); tr.appendChild(td); continue; }
          const active = done.filter((u) => {
            const s = new Date(u.created_at).getTime() + w * 7 * DAY;
            return (recDaysByUser.get(u.id) || []).some((ts) => ts >= s && ts < s + 7 * DAY);
          }).length;
          const p = pct(active, done.length);
          td.textContent = `${p}%`;
          if (done.length < cohort.length) td.classList.add("partial");
          // Sequential single hue: opacity of the brand blue tracks the share.
          td.style.background = `rgba(47,107,168,${0.06 + (p / 100) * 0.74})`;
          if (p >= 55) td.classList.add("dark");
          td.title = done.length < cohort.length
            ? `${active} of ${done.length} recorded in week ${w}. ${cohort.length - done.length} more haven't reached the end of week ${w} yet.`
            : `${active} of ${cohort.length} recorded in week ${w}`;
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      t.appendChild(tb);
      card.appendChild(t);
      container.appendChild(card);
    }

    draw();
    let resizeTimer = null;
    const onResize = () => {
      if (!document.body.contains(body)) { window.removeEventListener("resize", onResize); return; }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(draw, 150);
    };
    window.addEventListener("resize", onResize);
  }

  window.AdminAnalytics = { render };
})();
