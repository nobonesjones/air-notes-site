/* ============================================================
   Air Note — Admin Dashboard
   Static, no build step. Supabase client-side with the anon key;
   everything the dashboard reads is gated by RLS + is_admin.
   ============================================================ */

(function () {
  "use strict";

  const cfg = window.ADMIN_CONFIG || {};
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ---- small helpers -------------------------------------------------------
  const fmtDate = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };
  const fmtDateTime = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d)) return "—";
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const daysAgoISO = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };
  const startOfTodayISO = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };
  // Resolve a value from a row using the first candidate key that exists.
  const pick = (row, candidates) => {
    for (const k of candidates) {
      if (row && row[k] != null && row[k] !== "") return row[k];
    }
    return null;
  };
  // Animate a numeric stat up from zero; falls back to a plain set when the
  // user prefers reduced motion.
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function animateCount(node, n) {
    if (reducedMotion() || !n) {
      node.textContent = (n || 0).toLocaleString();
      return;
    }
    const dur = 700;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(n * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  // Resolve a loading (skeleton) stat: null → em dash, number → count up.
  function setStat(node, n) {
    node.classList.remove("skeleton");
    if (n == null) node.textContent = "—";
    else animateCount(node, n);
  }

  const CREATED_KEYS = ["created_at", "inserted_at", "createdAt", "created"];
  const EMAIL_KEYS = ["email", "email_address", "user_email"];
  const NAME_KEYS = ["display_name", "full_name", "name", "username", "first_name"];
  const LASTSEEN_KEYS = ["last_active", "last_seen", "last_sign_in_at", "updated_at"];
  const DURATION_KEYS = ["duration", "duration_seconds", "length", "length_seconds"];
  const TITLE_KEYS = ["title", "name", "subject", "heading"];

  // ---- Supabase client -----------------------------------------------------
  let sb = null;
  let currentUser = null;
  let captureTable = undefined; // undefined = not probed yet, null = none found
  let analyticsOk = undefined;

  function configReady() {
    return (
      cfg.SUPABASE_URL &&
      cfg.SUPABASE_ANON_KEY &&
      !/PASTE_YOUR/i.test(cfg.SUPABASE_ANON_KEY)
    );
  }

  // ---- view switching ------------------------------------------------------
  const views = {
    loading: $("#view-loading"),
    login: $("#view-login"),
    app: $("#view-app"),
  };
  function show(name) {
    Object.keys(views).forEach((k) => views[k] && views[k].classList.toggle("hidden", k !== name));
  }

  // =========================================================================
  // AUTH
  // =========================================================================
  async function boot() {
    if (!configReady()) {
      show("login");
      showAuthMessage(
        "Add your Supabase anon key in admin/config.js to enable sign-in.",
        "warn"
      );
      $("#login-form").classList.add("hidden");
      return;
    }

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    const { data } = await sb.auth.getSession();
    if (data && data.session) {
      await afterAuth(data.session.user);
    } else {
      show("login");
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        show("login");
      }
    });
  }

  async function afterAuth(user) {
    show("loading");
    // Dashboard access is gated on is_admin — NOT on merely having an account.
    let isAdmin = false;
    try {
      const { data, error } = await sb
        .from(cfg.tables.profiles)
        .select(cfg.columns.isAdmin)
        .eq(cfg.columns.profileId, user.id)
        .single();
      if (!error && data) isAdmin = data[cfg.columns.isAdmin] === true;
    } catch (e) {
      isAdmin = false;
    }

    if (!isAdmin) {
      await sb.auth.signOut();
      show("login");
      showAuthMessage("That account isn't authorized for the dashboard.", "warn");
      return;
    }

    currentUser = user;
    $("#who").textContent = user.email || "admin";
    $("#who-avatar").textContent = (user.email || "A").charAt(0).toUpperCase();
    show("app");
    if (!location.hash) location.hash = "#/home";
    route();
  }

  function wireLogin() {
    const form = $("#login-form");
    const email = $("#f-email");
    const pass = $("#f-pass");
    let mode = "login"; // or "signup"

    $("#toggle-mode").addEventListener("click", (e) => {
      e.preventDefault();
      mode = mode === "login" ? "signup" : "login";
      $("#login-submit").textContent = mode === "login" ? "Log in" : "Sign up";
      $("#toggle-mode").textContent =
        mode === "login" ? "Need an account? Sign up" : "Have an account? Log in";
      showAuthMessage("", "");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!sb) return;
      const btn = $("#login-submit");
      btn.disabled = true;
      showAuthMessage("", "");
      try {
        if (mode === "signup") {
          const { error } = await sb.auth.signUp({
            email: email.value.trim(),
            password: pass.value,
          });
          if (error) throw error;
          showAuthMessage(
            "Account created. If email confirmation is on, confirm then log in.",
            "ok"
          );
          // Note: signing up does not grant access — afterAuth still checks is_admin.
          const { data } = await sb.auth.getSession();
          if (data && data.session) await afterAuth(data.session.user);
        } else {
          const { data, error } = await sb.auth.signInWithPassword({
            email: email.value.trim(),
            password: pass.value,
          });
          if (error) throw error;
          await afterAuth(data.user);
        }
      } catch (err) {
        showAuthMessage(err.message || "Something went wrong.", "warn");
      } finally {
        btn.disabled = false;
      }
    });

    $("#back-home").addEventListener("click", () => {
      location.href = "../index.html";
    });
  }

  function showAuthMessage(msg, kind) {
    const box = $("#auth-msg");
    box.textContent = msg || "";
    box.className = "auth-msg" + (kind ? " " + kind : "");
    box.classList.toggle("hidden", !msg);
  }

  // =========================================================================
  // DATA — defensive against unknown schema
  // =========================================================================
  async function countRows(table, buildQuery) {
    try {
      let q = sb.from(table).select("*", { count: "exact", head: true });
      if (buildQuery) q = buildQuery(q);
      const { count, error } = await q;
      if (error) return null;
      return count;
    } catch (e) {
      return null;
    }
  }

  // Find the capture table once, caching the result (or null if none).
  async function resolveCaptureTable() {
    if (captureTable !== undefined) return captureTable;
    for (const name of cfg.tables.captureCandidates || []) {
      const c = await countRows(name);
      if (c !== null) {
        captureTable = name;
        return captureTable;
      }
    }
    captureTable = null;
    return captureTable;
  }

  async function hasAnalytics() {
    if (analyticsOk !== undefined) return analyticsOk;
    const c = await countRows(cfg.tables.analytics);
    analyticsOk = c !== null;
    return analyticsOk;
  }

  // =========================================================================
  // ROUTER
  // =========================================================================
  function route() {
    const hash = location.hash || "#/home";
    document.querySelectorAll(".nav-item").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === hash.replace(/\/user\/.*$/, "/users"));
    });
    const main = $("#main");
    main.innerHTML = "";

    if (hash.startsWith("#/user/")) return renderUserDetail(main, decodeURIComponent(hash.slice("#/user/".length)));
    if (hash === "#/funnel") return renderFunnel(main);
    if (hash === "#/users") return renderUsers(main);
    if (hash === "#/analytics") return renderAnalytics(main);
    return renderHome(main);
  }

  // ---- page: Home ----------------------------------------------------------
  async function renderHome(main) {
    main.appendChild(pageTitle("Home", "A quick pulse on real users and activity."));

    const grid = el("div", "kpi-grid");
    main.appendChild(grid);
    const card = (label) => {
      const c = el("div", "kpi-card");
      c.appendChild(el("div", "kpi-label", label));
      const v = el("div", "kpi-value skeleton", "");
      c.appendChild(v);
      grid.appendChild(c);
      return v;
    };

    const vUsers = card("Total users");
    const vCaptures = card("Total captures");
    const v7 = card("New signups · 7 days");
    const v30 = card("New signups · 30 days");

    // Total users
    countRows(cfg.tables.profiles).then((n) => setStat(vUsers, n));

    // Total captures
    resolveCaptureTable().then(async (t) => {
      if (!t) { setStat(vCaptures, null); return; }
      setStat(vCaptures, await countRows(t));
    });

    // New signups — needs a created_at on profiles; probe once.
    signupsSince(7).then((n) => setStat(v7, n));
    signupsSince(30).then((n) => setStat(v30, n));

    // Active users today — only if analytics_events exists & has data.
    if (await hasAnalytics()) {
      const v = card("Active users today");
      try {
        const { data, error } = await sb
          .from(cfg.tables.analytics)
          .select("user_id")
          .gte("created_at", startOfTodayISO());
        if (error) throw error;
        const uniq = new Set((data || []).map((r) => r.user_id).filter(Boolean));
        setStat(v, uniq.size);
      } catch (e) {
        setStat(v, null);
      }
    }

    // Recent signups list (best-effort).
    const recent = el("div", "panel");
    recent.appendChild(el("h2", "panel-title", "Recent signups"));
    main.appendChild(recent);
    try {
      const createdKey = await profilesCreatedKey();
      let q = sb.from(cfg.tables.profiles).select("*").limit(8);
      if (createdKey) q = q.order(createdKey, { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) {
        recent.appendChild(el("p", "muted", "No profiles yet."));
      } else {
        const list = el("div", "mini-list");
        data.forEach((r) => {
          const row = el("div", "mini-row");
          const left = el("div");
          left.appendChild(el("div", "mini-primary", pick(r, EMAIL_KEYS) || pick(r, NAME_KEYS) || "Unknown"));
          left.appendChild(el("div", "mini-secondary", pick(r, NAME_KEYS) || ""));
          row.appendChild(left);
          row.appendChild(el("div", "mini-secondary", fmtDate(pick(r, CREATED_KEYS))));
          list.appendChild(row);
        });
        recent.appendChild(list);
      }
    } catch (e) {
      recent.appendChild(el("p", "muted", "Couldn't load recent signups."));
    }
  }

  let _createdKeyCache = undefined;
  async function profilesCreatedKey() {
    if (_createdKeyCache !== undefined) return _createdKeyCache;
    try {
      const { data } = await sb.from(cfg.tables.profiles).select("*").limit(1);
      const row = (data && data[0]) || {};
      _createdKeyCache = CREATED_KEYS.find((k) => k in row) || null;
    } catch (e) {
      _createdKeyCache = null;
    }
    return _createdKeyCache;
  }

  async function signupsSince(days) {
    const key = await profilesCreatedKey();
    if (!key) return null;
    return countRows(cfg.tables.profiles, (q) => q.gte(key, daysAgoISO(days)));
  }

  // ---- page: Funnel --------------------------------------------------------
  async function renderFunnel(main) {
    const head = el("div", "funnel-page-head");
    head.appendChild(pageTitle("Funnel", "See where interest becomes an email — then where new users become active."));

    const rangeSeg = el("div", "seg funnel-range");
    let range = "7";
    const rangeButtons = [["7", "This week"], ["30", "30 days"], ["3650", "All time"]].map(([value, label]) => {
      const button = el("button", "seg-btn" + (value === range ? " active" : ""), label);
      button.type = "button";
      button.addEventListener("click", () => {
        if (range === value) return;
        range = value;
        rangeButtons.forEach((item) => item.classList.toggle("active", item === button));
        load();
      });
      rangeSeg.appendChild(button);
      return button;
    });
    head.appendChild(rangeSeg);
    main.appendChild(head);

    const tabs = el("div", "funnel-tabs");
    tabs.setAttribute("role", "tablist");
    let funnel = "early";
    const tabButtons = [["early", "Early access"], ["onboarding", "App onboarding"]].map(([value, label]) => {
      const button = el("button", "funnel-tab" + (value === funnel ? " active" : ""), label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(value === funnel));
      button.addEventListener("click", () => {
        if (funnel === value) return;
        funnel = value;
        tabButtons.forEach((item) => {
          item.classList.toggle("active", item === button);
          item.setAttribute("aria-selected", String(item === button));
        });
        load();
      });
      tabs.appendChild(button);
      return button;
    });
    main.appendChild(tabs);

    const panel = el("section", "funnel-panel");
    const panelHead = el("div", "funnel-panel-head");
    const titleWrap = el("div");
    const panelTitle = el("h2", "funnel-panel-title", "Email acquisition");
    const panelSub = el("p", "funnel-panel-sub", "Every step from CTA click to email captured.");
    titleWrap.append(panelTitle, panelSub);
    const entrants = el("span", "funnel-entrants", "Loading…");
    panelHead.append(titleWrap, entrants);
    panel.appendChild(panelHead);
    const flow = el("div", "funnel-flow");
    panel.appendChild(flow);
    main.appendChild(panel);

    const metrics = el("div", "funnel-metrics");
    main.appendChild(metrics);
    const insight = el("div", "funnel-insight");
    main.appendChild(insight);

    const earlyStages = [
      { key: "signup_opened", label: "Clicked CTA", hint: "Opened the form" },
      { key: "gender", label: "Gender", hint: "First answer" },
      { key: "age_range", label: "Age", hint: "Second answer" },
      { key: "work_role", label: "Work", hint: "Role selected" },
      { key: "primary_use_case", label: "Use case", hint: "Intent selected" },
      { key: "email", label: "Reached email", hint: "Final step viewed" },
      { key: "signup_completed", label: "Left email", hint: "Email captured" },
    ];
    const onboardingStages = [
      { keys: ["app_opened", "opened_app", "first_launch"], label: "Opened app", hint: "First launch" },
      { keys: ["onboarding_get_started", "get_started_tapped", "tapped_get_started"], label: "Get started", hint: "Welcome complete" },
      { keys: ["account_created", "signed_up", "user_signed_up"], label: "Created account", hint: "Email or Apple" },
      { keys: ["microphone_allowed", "allowed_microphone"], label: "Microphone", hint: "Permission granted" },
      { keys: ["onboarding_finished", "tour_finished"], label: "Finished tour", hint: "Intro complete" },
      { keys: ["home_viewed", "landed_on_home"], label: "Landed home", hint: "Onboarding done" },
      { keys: ["first_capture", "capture_created"], label: "First capture", hint: "Activation moment" },
    ];

    const unique = (rows, predicate, identity) => new Set(rows.filter(predicate).map(identity).filter(Boolean)).size;

    function drawStages(stages) {
      flow.innerHTML = "";
      const entered = stages[0]?.count || 0;
      stages.forEach((stage, index) => {
        const conversion = entered ? Math.round((stage.count / entered) * 100) : 0;
        const previous = index ? stages[index - 1].count : stage.count;
        const stepRate = previous ? Math.round((stage.count / previous) * 100) : 0;
        const item = el("article", "funnel-stage" + (index === stages.length - 1 ? " is-goal" : ""));
        item.style.setProperty("--stage-scale", entered ? Math.max(.58, stage.count / entered) : .58);
        item.appendChild(el("span", "funnel-step", String(index + 1).padStart(2, "0")));
        item.appendChild(el("div", "funnel-stage-label", stage.label));
        item.appendChild(el("div", "funnel-stage-hint", stage.hint));
        item.appendChild(el("strong", "funnel-stage-count", stage.count.toLocaleString()));
        item.appendChild(el("div", "funnel-stage-rate", `${conversion}% of clicks`));
        if (index) item.appendChild(el("div", "funnel-step-rate", `${stepRate}% →`));
        flow.appendChild(item);
      });
    }

    function metric(label, value, note, accent) {
      const card = el("article", "funnel-metric" + (accent ? " accent" : ""));
      card.appendChild(el("span", "funnel-metric-label", label));
      card.appendChild(el("strong", "funnel-metric-value", value));
      card.appendChild(el("span", "funnel-metric-note", note));
      metrics.appendChild(card);
    }

    async function loadEarlyAccess() {
      const since = daysAgoISO(parseInt(range, 10));
      const [{ data: events, error: eventError }, { data: signups, error: signupError }] = await Promise.all([
        sb.from(cfg.tables.earlyAccessEvents).select("session_id,event_name,step_name,created_at").gte("created_at", since).limit(50000),
        sb.from(cfg.tables.earlyAccessSignups).select("session_id,email,submitted_at").gte("submitted_at", since).limit(50000),
      ]);
      if (eventError || signupError) throw eventError || signupError;
      const eventRows = events || [];
      const signupRows = signups || [];
      const stages = earlyStages.map((stage) => ({ ...stage, count:
        stage.key === "signup_opened"
          ? unique(eventRows, (row) => row.event_name === "signup_opened", (row) => row.session_id)
          : stage.key === "signup_completed"
            ? new Set(signupRows.map((row) => row.session_id || row.email).filter(Boolean)).size
            : unique(eventRows, (row) => row.event_name === "signup_step_viewed" && row.step_name === stage.key, (row) => row.session_id)
      }));
      return stages;
    }

    async function loadOnboarding() {
      const since = daysAgoISO(parseInt(range, 10));
      const { data, error } = await sb.from(cfg.tables.analytics)
        .select("user_id,event_name,created_at").gte("created_at", since).limit(50000);
      if (error) throw error;
      const rows = data || [];
      return onboardingStages.map((stage) => ({ ...stage, count:
        unique(rows, (row) => stage.keys.includes(row.event_name), (row) => row.user_id)
      }));
    }

    async function load() {
      flow.innerHTML = "<div class='funnel-loading'><span class='spinner'></span><span>Loading funnel…</span></div>";
      metrics.innerHTML = "";
      insight.innerHTML = "";
      panelTitle.textContent = funnel === "early" ? "Email acquisition" : "App onboarding";
      panelSub.textContent = funnel === "early" ? "Every step from CTA click to email captured." : "Every step from first launch to first capture.";
      try {
        const stages = funnel === "early" ? await loadEarlyAccess() : await loadOnboarding();
        drawStages(stages);
        const entered = stages[0]?.count || 0;
        const reachedGoal = stages[stages.length - 1]?.count || 0;
        const reachedEmail = funnel === "early" ? stages.find((stage) => stage.key === "email")?.count || 0 : reachedGoal;
        const overall = entered ? Math.round((reachedGoal / entered) * 100) : 0;
        entrants.textContent = `${entered.toLocaleString()} user${entered === 1 ? "" : "s"} entered`;
        metric(funnel === "early" ? "CTA clicks" : "Opened app", entered.toLocaleString(), range === "7" ? "This week" : range === "30" ? "Last 30 days" : "All time");
        if (funnel === "early") metric("Reached email", reachedEmail.toLocaleString(), entered ? `${Math.round(reachedEmail / entered * 100)}% of clicks` : "No clicks yet");
        metric(funnel === "early" ? "Emails captured" : "First captures", reachedGoal.toLocaleString(), entered ? `${overall}% overall conversion` : "No entrants yet", true);
        metric("Drop-off", entered ? `${100 - overall}%` : "—", entered ? `${Math.max(0, entered - reachedGoal)} user${entered - reachedGoal === 1 ? "" : "s"} lost` : "Waiting for data");

        let biggestDrop = null;
        for (let i = 1; i < stages.length; i++) {
          const lost = stages[i - 1].count - stages[i].count;
          if (!biggestDrop || lost > biggestDrop.lost) biggestDrop = { from: stages[i - 1], to: stages[i], lost };
        }
        const message = biggestDrop && biggestDrop.lost > 0
          ? `Biggest drop-off: ${biggestDrop.from.label} → ${biggestDrop.to.label}. ${biggestDrop.lost} user${biggestDrop.lost === 1 ? "" : "s"} left here.`
          : entered ? "No drop-off yet — every entrant reached the goal." : "No funnel activity in this time range yet.";
        insight.appendChild(el("span", "insight-dot"));
        insight.appendChild(el("p", null, message));
      } catch (error) {
        flow.innerHTML = "";
        flow.appendChild(el("p", "muted", "Couldn't load this funnel. Check the admin read policy for its event tables."));
        entrants.textContent = "Unavailable";
      }
    }

    load();
  }

  // ---- page: Users ---------------------------------------------------------
  async function renderUsers(main) {
    main.appendChild(pageTitle("Users", "Everyone with an Air Note account."));

    const controls = el("div", "controls");
    const search = el("input", "search");
    search.type = "search";
    search.placeholder = "Search by email or name…";
    controls.appendChild(search);
    main.appendChild(controls);

    const panel = el("div", "panel");
    main.appendChild(panel);
    panel.appendChild(el("p", "muted", "Loading users…"));

    let profiles = [];
    let captureCounts = {};
    try {
      const createdKey = await profilesCreatedKey();
      let q = sb.from(cfg.tables.profiles).select("*").limit(1000);
      if (createdKey) q = q.order(createdKey, { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      profiles = data || [];
    } catch (e) {
      panel.innerHTML = "";
      panel.appendChild(el("p", "muted", "Couldn't load users — check the profiles RLS policy."));
      return;
    }

    // Best-effort capture counts per user.
    const t = await resolveCaptureTable();
    if (t) {
      try {
        const { data } = await sb.from(t).select("user_id").limit(10000);
        (data || []).forEach((r) => {
          if (r.user_id) captureCounts[r.user_id] = (captureCounts[r.user_id] || 0) + 1;
        });
      } catch (e) { /* leave counts empty */ }
    }

    let sortKey = "created";
    let sortDir = -1;

    function draw() {
      panel.innerHTML = "";
      const term = search.value.trim().toLowerCase();
      let rows = profiles.filter((r) => {
        if (!term) return true;
        const hay = ((pick(r, EMAIL_KEYS) || "") + " " + (pick(r, NAME_KEYS) || "")).toLowerCase();
        return hay.includes(term);
      });

      rows.sort((a, b) => {
        let av, bv;
        if (sortKey === "email") { av = pick(a, EMAIL_KEYS) || ""; bv = pick(b, EMAIL_KEYS) || ""; }
        else if (sortKey === "name") { av = pick(a, NAME_KEYS) || ""; bv = pick(b, NAME_KEYS) || ""; }
        else if (sortKey === "captures") { av = captureCounts[a.id] || 0; bv = captureCounts[b.id] || 0; }
        else { av = pick(a, CREATED_KEYS) || ""; bv = pick(b, CREATED_KEYS) || ""; }
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
      });

      const table = el("table", "data-table");
      const thead = el("thead");
      const htr = el("tr");
      const heads = [
        ["email", "Email"],
        ["name", "Name"],
        ["created", "Signed up"],
        ["lastactive", "Last active"],
        ["captures", "Captures"],
      ];
      heads.forEach(([k, label]) => {
        const th = el("th", k === sortKey ? "sortable active" : "sortable", label);
        if (k === sortKey) th.textContent = label + (sortDir < 0 ? " ↓" : " ↑");
        th.addEventListener("click", () => {
          if (sortKey === k) sortDir *= -1;
          else { sortKey = k; sortDir = k === "captures" ? -1 : 1; }
          draw();
        });
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);

      const tbody = el("tbody");
      if (!rows.length) {
        const tr = el("tr");
        const td = el("td");
        td.colSpan = 5;
        td.className = "muted";
        td.textContent = "No matching users.";
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
      rows.forEach((r) => {
        const tr = el("tr", "clickable");
        tr.appendChild(el("td", "strong", pick(r, EMAIL_KEYS) || "—"));
        tr.appendChild(el("td", null, pick(r, NAME_KEYS) || "—"));
        tr.appendChild(el("td", null, fmtDate(pick(r, CREATED_KEYS))));
        tr.appendChild(el("td", null, fmtDate(pick(r, LASTSEEN_KEYS))));
        tr.appendChild(el("td", null, t ? String(captureCounts[r.id] || 0) : "—"));
        tr.addEventListener("click", () => { location.hash = "#/user/" + encodeURIComponent(r.id); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      panel.appendChild(table);
    }

    search.addEventListener("input", draw);
    draw();
  }

  // ---- page: User detail ---------------------------------------------------
  async function renderUserDetail(main, id) {
    const back = el("a", "back-link", "← Back to users");
    back.href = "#/users";
    main.appendChild(back);

    let profile = null;
    try {
      const { data, error } = await sb.from(cfg.tables.profiles).select("*").eq(cfg.columns.profileId, id).single();
      if (error) throw error;
      profile = data;
    } catch (e) {
      main.appendChild(el("p", "muted", "Couldn't load this user."));
      return;
    }

    main.appendChild(pageTitle(pick(profile, EMAIL_KEYS) || pick(profile, NAME_KEYS) || "User", null));

    const info = el("div", "panel");
    const dl = el("div", "detail-grid");
    const addField = (k, v) => {
      dl.appendChild(el("div", "detail-key", k));
      dl.appendChild(el("div", "detail-val", v || "—"));
    };
    addField("Email", pick(profile, EMAIL_KEYS));
    addField("Name", pick(profile, NAME_KEYS));
    addField("User id", profile.id);
    addField("Signed up", fmtDate(pick(profile, CREATED_KEYS)));
    addField("Last active", fmtDateTime(pick(profile, LASTSEEN_KEYS)));
    info.appendChild(dl);
    main.appendChild(info);

    // Their captures
    const capPanel = el("div", "panel");
    capPanel.appendChild(el("h2", "panel-title", "Captures"));
    main.appendChild(capPanel);
    const t = await resolveCaptureTable();
    if (!t) {
      capPanel.appendChild(el("p", "muted", "No captures table found."));
    } else {
      try {
        const { data, error } = await sb.from(t).select("*").eq("user_id", id).limit(50);
        if (error) throw error;
        if (!data || !data.length) capPanel.appendChild(el("p", "muted", "No captures yet."));
        else {
          const table = el("table", "data-table");
          const tbody = el("tbody");
          data.forEach((c) => {
            const tr = el("tr");
            tr.appendChild(el("td", "strong", pick(c, TITLE_KEYS) || "Untitled"));
            tr.appendChild(el("td", null, fmtDate(pick(c, CREATED_KEYS))));
            const dur = pick(c, DURATION_KEYS);
            tr.appendChild(el("td", null, dur != null ? String(dur) : "—"));
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          capPanel.appendChild(table);
        }
      } catch (e) {
        capPanel.appendChild(el("p", "muted", "Couldn't load captures."));
      }
    }

    // Their recent activity
    if (await hasAnalytics()) {
      const actPanel = el("div", "panel");
      actPanel.appendChild(el("h2", "panel-title", "Recent activity"));
      main.appendChild(actPanel);
      try {
        const { data, error } = await sb
          .from(cfg.tables.analytics)
          .select("*")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(25);
        if (error) throw error;
        if (!data || !data.length) actPanel.appendChild(el("p", "muted", "No activity recorded."));
        else {
          const list = el("div", "mini-list");
          data.forEach((ev) => {
            const row = el("div", "mini-row");
            row.appendChild(el("div", "mini-primary", ev.event_name || "event"));
            row.appendChild(el("div", "mini-secondary", fmtDateTime(ev.created_at)));
            list.appendChild(row);
          });
          actPanel.appendChild(list);
        }
      } catch (e) {
        actPanel.appendChild(el("p", "muted", "Couldn't load activity."));
      }
    }
  }

  // ---- page: User Analytics ------------------------------------------------
  async function renderAnalytics(main) {
    main.appendChild(pageTitle("User analytics", "Product-wide event activity."));

    if (!(await hasAnalytics())) {
      const panel = el("div", "panel");
      panel.appendChild(el("p", "muted", "The analytics_events table isn't set up or has no data yet. Run docs/supabase-admin-setup.sql and start sending events."));
      main.appendChild(panel);
      return;
    }

    const controls = el("div", "controls");
    const seg = el("div", "seg");
    let range = "30";
    const segBtns = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["3650", "All time"]].map(([v, label]) => {
      const b = el("button", "seg-btn" + (v === range ? " active" : ""), label);
      b.type = "button";
      b.addEventListener("click", () => {
        if (range === v) return;
        range = v;
        segBtns.forEach((x) => x.classList.toggle("active", x === b));
        load();
      });
      seg.appendChild(b);
      return b;
    });
    controls.appendChild(seg);
    main.appendChild(controls);

    const kpis = el("div", "kpi-grid");
    main.appendChild(kpis);
    const panel = el("div", "panel");
    panel.appendChild(el("h2", "panel-title", "Top events"));
    const holder = el("div");
    panel.appendChild(holder);
    main.appendChild(panel);

    async function load() {
      kpis.innerHTML = "";
      holder.innerHTML = "<p class='muted'>Loading…</p>";
      const days = parseInt(range, 10);
      let rows = [];
      try {
        const { data, error } = await sb
          .from(cfg.tables.analytics)
          .select("event_name,user_id,created_at")
          .gte("created_at", daysAgoISO(days))
          .limit(50000);
        if (error) throw error;
        rows = data || [];
      } catch (e) {
        holder.innerHTML = "<p class='muted'>Couldn't load events.</p>";
        return;
      }

      const totalEvents = rows.length;
      const dau = new Set(rows.filter((r) => r.created_at >= startOfTodayISO()).map((r) => r.user_id).filter(Boolean)).size;
      const wau = new Set(rows.filter((r) => r.created_at >= daysAgoISO(7)).map((r) => r.user_id).filter(Boolean)).size;

      const kpi = (label, val) => {
        const c = el("div", "kpi-card");
        c.appendChild(el("div", "kpi-label", label));
        const v = el("div", "kpi-value", "");
        animateCount(v, val);
        c.appendChild(v);
        kpis.appendChild(c);
      };
      kpi("Total events", totalEvents);
      kpi("DAU (today)", dau);
      kpi("WAU (7 days)", wau);

      // Top events by count.
      const counts = {};
      rows.forEach((r) => { counts[r.event_name] = (counts[r.event_name] || 0) + 1; });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
      holder.innerHTML = "";
      if (!sorted.length) { holder.appendChild(el("p", "muted", "No events in this range.")); return; }
      const max = sorted[0][1];
      sorted.forEach(([name, n]) => {
        const row = el("div", "bar-row");
        row.appendChild(el("div", "bar-label", name));
        const track = el("div", "bar-track");
        const fill = el("div", "bar-fill");
        // Start at 0 and set the real width a frame later so the CSS
        // transition sweeps the bar in.
        const target = Math.max(4, (n / max) * 100) + "%";
        fill.style.width = "0%";
        requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = target; }));
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("div", "bar-value", String(n)));
        holder.appendChild(row);
      });
    }

    load();
  }

  // ---- shared bits ---------------------------------------------------------
  function pageTitle(title, sub) {
    const wrap = el("div", "page-head");
    wrap.appendChild(el("h1", "page-title", title));
    if (sub) wrap.appendChild(el("p", "page-sub", sub));
    return wrap;
  }

  // =========================================================================
  // WIRING
  // =========================================================================
  document.addEventListener("DOMContentLoaded", () => {
    wireLogin();
    $("#sign-out").addEventListener("click", async () => {
      if (sb) await sb.auth.signOut();
      location.href = "../index.html";
    });
    window.addEventListener("hashchange", () => {
      if (currentUser) route();
    });
    boot();
  });
})();
