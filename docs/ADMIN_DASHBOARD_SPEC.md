# Air Note — Admin Dashboard Spec

**Date:** 19 July 2026
**Status:** Spec only — not built. Hand to an agent once reviewed.
**Repo:** this lives in `air-notes-site` (the marketing site), as a small self-contained area — not in the `air-note` mobile app repo.

**Purpose:** replace a rubbish third-party analytics tool with something we control — a simple, good-looking, admin-only view of real users and real activity, sitting on our own site, reading our own Supabase project. Start basic, leave clearly labelled room to grow.

---

## 1. Access — how you get in

**The public site gets no visible "Login" button.** The entry point is the existing footer credit line, restyled as the trigger:

- Today: `© 2026 Air Note` (plain text, `site/index.html` line 318, inside `.footer-bottom`)
- New: `Est. 2026` — same spot, same understated styling, now a clickable element. Click opens a Supabase Auth screen (modal or a dedicated `/login` page — agent's call, modal is probably less work).

*(Flagging this as my interpretation of "call in EST 2026" — confirm the wording before handing off; easy to change either way.)*

**Auth flow:** standard Supabase email/password (or magic link) with both sign-up and log-in on the same screen — the normal Supabase Auth UI default.

**Critical: sign-up does NOT grant dashboard access.** Anyone can create an account (same as the app), but that only makes them a normal user. Dashboard access requires a separate `is_admin = true` flag, set manually, never through self-service sign-up. Concretely:

- Add `is_admin boolean not null default false` to the `profiles` table (confirm the real table/column names via Supabase MCP before building — this spec assumes a `profiles` table keyed to `auth.users`, same as the app likely already has).
- After any successful auth (sign-up or log-in) on the site, check `profiles.is_admin` for the current user. `true` → into the dashboard. `false`/missing → "not authorized," sign them back out, bounce to the homepage.
- Harry's own account gets `is_admin = true` via one manual SQL statement after his account exists — not part of the app or site UI. No self-promotion path, ever.

**Security note for whoever builds this — this is a static site with no server.** All Supabase calls happen client-side with the public anon key; there is no safe place to hold a `service_role` key in this repo. That means every piece of data the dashboard shows must be reachable through Row Level Security, keyed off `auth.uid()` and `is_admin`, e.g.:

```sql
create policy "admins can read all profiles" on profiles for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
```

Same pattern for captures/meetings and the new `analytics_events` table. **Do not embed a service-role key in any site JS file, ever** — that would expose the whole database to anyone who views page source.

---

## 2. Data source

The dashboard reads from the **same Supabase project as the mobile app** (`pukxgbtwamgifdjhyckb`) — this is meant to show real app data (real users, real captures), not a separate database. Add the Supabase JS client to the site via CDN script tag (no build step — matches how the rest of the site already works, plain HTML/CSS/JS, no bundler).

New table needed: **`analytics_events`** (`user_id`, `event_name`, `properties jsonb`, `created_at`) — this is the same table already scoped in `air-note/docs/SPRINT_PLAN.md`'s track 2O. Build it once, both the app (writing events) and this dashboard (reading them) point at it.

---

## 3. Layout

Left sidebar, persistent, main content area to the right. Sidebar sections, top to bottom:

**Live now:**
- **Home** (default landing page)
- **Users**
- **User Analytics**

**Labelled, greyed out, "soon" tag — not built yet, just reserving the spot:**
- Revenue
- WhatsApp Agent *(ties to the WhatsApp backend track once it ships)*
- Claude / MCP Connections *(ties to the MCP backend track)*
- Notifications
- Settings

Sidebar items are icon + label, active section highlighted. Keep it minimal — this is an internal tool, not a marketing surface, so "high quality but basic" beats dense/clever.

---

## 4. Pages

### Home (landing page after login)

KPI cards, nothing fancier yet:
- Total users
- Total captures/meetings recorded
- New signups (last 7 / 30 days)
- Active users today *(depends on `analytics_events` existing — if it's not populated yet, just omit this card rather than show a fake zero)*

Optional if time allows: a short "recent signups" list below the cards.

### Users

Table: email, display name, signup date, last active, capture count. Sortable, searchable by email/name. Click a row → user detail.

### User detail (click into a user)

- Profile: email, user id, signup date, last sign-in.
- Their captures: title, date, duration — same data the app's Home feed would show for them.
- Their recent activity: latest rows from `analytics_events` for that user.

### User Analytics (product-wide, not per-user)

- Event counts by type, over a selectable time range.
- Top events.
- Rough DAU/WAU if `analytics_events` has enough data yet.

Keep visualisation basic — a clean table or simple bars is enough for v1; no charting library needed unless it's genuinely easier than not.

---

## 5. Visual style

> **⚠️ Superseded.** The palette that used to live here (paper/cream with a
> terracotta accent) is deprecated for ALL product UI. The dashboard now uses
> the white / light-blue / navy product system defined in
> **`docs/BRAND_GUIDELINES.md` — that document is the single source of truth**
> for colors, typography, shapes, and motion. Any older doc that lists
> terracotta or paper as app colors (including `air-note/docs/design-system.html`
> and the app repo's Product Spec §1.2) is out of date and should be brought in
> line with BRAND_GUIDELINES.md, not the other way round.

Summary (see BRAND_GUIDELINES.md for the full tables): page bg `#F4F7FA`, white
floating content sheet, tonal borderless cards `#F3F7FB`, ink `#0F2438`, slate
body text `#3F566B`, blue accent `#2E5E8E`, sky `#7FA6C7` focus rings.
**No terracotta anywhere in product UI.**

Typography: **Fraunces** for page/section titles and stat numerals, **Inter**
for everything else (Source Serif 4 is retired brand-wide — see
BRAND_GUIDELINES.md §2). Sentence
case throughout, no ALL CAPS. Pill buttons and inputs, 20px card radius,
borderless tonal cards, soft navy-tinted shadows.

Light mode only for v1 (matches the app's stance — light is home base).

---

## 6. Explicitly out of scope for v1

- Anything under the greyed-out sidebar labels (Revenue, WhatsApp, MCP, Notifications, Settings) — reserve the spot, build nothing.
- Charting/graphing libraries — plain numbers and tables first.
- Wiring `track()` calls into the actual app screens — that's tracked separately in `air-note/docs/SPRINT_PLAN.md` track 2O and lands as each screen gets rebuilt.
- Any self-service path to becoming an admin — there isn't one, by design.

---

## 7. Open items to confirm before build

1. Footer wording — "Est. 2026" is my guess at what was meant; confirm exact copy.
2. Confirm the real `profiles` table/column names (and whether `is_admin` needs adding fresh) via Supabase MCP before writing any RLS policy — don't assume this spec's names are exactly right.
3. Modal vs dedicated login page — spec doesn't mandate either, pick whichever is less work given the static-site setup.
