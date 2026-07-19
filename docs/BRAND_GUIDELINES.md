# Air Note — Brand & Product Design Guidelines

**This document is the single source of truth for Air Note's visual design.**
If any other document disagrees with this one — including `ADMIN_DASHBOARD_SPEC.md` §5,
`air-note/docs/design-system.html`, or the palette table in the app repo's
Product Spec §1.2 — **this document wins and those documents should be updated
to match it.** In particular: any doc that lists terracotta (`#C96F3F`) or
paper/cream (`#F5F1E6`, `#FDFAF2`) as *app* colors is out of date.

---

## 0. The one rule that prevents all confusion

Air Note has **two visual worlds**. Never mix them up:

| World | Where | Palette family |
|---|---|---|
| **Editorial** | Marketing site (`index.html`) and Journal (`blog/`) ONLY | Night navy skies, warm paper, serif storytelling. Terracotta allowed as a rare editorial accent. |
| **Product** | The iPhone app, the admin dashboard, and ANY interface a user operates | **White, light blue, navy. Nothing else.** No terracotta. No cream. No paper. |

If you are building or restyling **product UI, use only Section 1 onward of this
document.** The editorial world is described in Section 8 purely so you know it
exists and don't port its colors into the product.

---

## 1. Product palette

Light mode only. Cool, airy, calm — whites and light blues on deep navy ink.

### Core tokens

| Token | Hex | Role |
|---|---|---|
| `bg` | `#F4F7FA` | Page background (cool blue-white) |
| `sheet` | `#FFFFFF` | The raised content "front plate" and modal surfaces |
| `tint` | `#F3F7FB` | Tonal cards, panels, input fills — surfaces *on* the white sheet |
| `hairline` | `#E2E9F1` | Row separators inside surfaces (never outlines around cards) |
| `hairline-2` | `#D3DEE9` | Slightly stronger separator, rare |
| `ink` | `#0F2438` | Primary text, primary buttons, active segmented pills |
| `body` | `#3F566B` | Secondary text (slate blue — never warm grey) |
| `muted` | `#7E93A6` | Tertiary text, labels, placeholders |
| `accent` | `#2E5E8E` | Links, active nav states, data visualization |
| `accent-strong` | `#24486C` | Accent hover/pressed |
| `accent-soft` | `#EAF1F8` | Active-state washes, selected backgrounds |
| `sky` | `#7FA6C7` | Focus rings, chart gradient ends, small highlights |

### Semantic

| State | Text | Background |
|---|---|---|
| Success | `#2F6440` | `#E6F2EA` |
| Warning / error | `#94491F` | `#FBEDE6` |

### Usage rules

- Text and primary actions are **ink**, not accent. Accent is for links, active
  states, and data — if a whole screen is accent-blue, it's wrong.
- Surfaces layer **tonally**: `bg` → white `sheet` → `tint` cards. Separation
  comes from tone and shadow, **never from borders around cards**.
- Focus rings are always `sky` (`0 0 0 3px rgba(127,166,199,.22)` + `sky` border).
- Data visualization: gradient `sky → accent`, on white tracks.

### Explicitly banned in product UI

- ❌ Terracotta `#C96F3F` — in any amount, including "sparingly"
- ❌ Paper/cream `#F5F1E6`, `#FDFAF2`, `#E5DFCE` and any warm beige family
- ❌ Warm greys for text (`#5F5B4E`, `#9A937F`) — body text is slate blue
- ❌ Purple, gradient text, emoji as icons
- ❌ Dark mode (light is home base; dark mode is a future, deliberate project)

### Token migration map (old app system → this system)

If the app currently uses the old warm palette, replace mechanically:

| Old (deprecated) | New |
|---|---|
| Paper bg `#F5F1E6` | `#F4F7FA` |
| Card `#FDFAF2` | `#FFFFFF` (sheet) or `#F3F7FB` (tonal card on sheet) |
| Hairline `#E5DFCE` | `#E2E9F1` |
| Ink `#0F2438` | `#0F2438` (unchanged) |
| Body `#5F5B4E` | `#3F566B` |
| Muted `#9A937F` | `#7E93A6` |
| Accent terracotta `#C96F3F` | `#2E5E8E` |

After swapping tokens, sweep the codebase for any hard-coded hex from the left
column (and rgba equivalents like `rgba(201,111,63,…)`) — nothing may remain.

---

## 2. Typography

Two families, strict roles. Same pairing on web and iOS:

| Role | Web | iOS |
|---|---|---|
| Display (page titles, section titles, stat numerals, editorial moments) | **Source Serif 4** | **New York** |
| Everything else (body, labels, buttons, tables, inputs) | **Inter** | **SF Pro** |

Scale (web reference, adapt proportionally on iOS):

- Page title: 30–32px serif semibold, letter-spacing −0.01em
- Panel/section title: 18–19px serif semibold
- Stat numerals: 32px serif semibold, `font-variant-numeric: tabular-nums`
- Body: 15px, line-height ≥1.55
- Secondary/label: 13px
- Micro-labels: 10–11px, uppercase, letter-spacing 0.06–0.14em, weight 500–600

Rules: sentence case everywhere (headings, buttons, labels). No ALL CAPS except
micro-labels. Numbers in data contexts are always tabular.

---

## 3. Shape language

Round and soft. The radius scale:

| Element | Radius |
|---|---|
| Buttons, inputs, chips, segmented controls, badges | **Fully rounded (999px pills)** |
| Cards, panels, tiles | 20px |
| Sheets, modals, the content front plate | 24–32px |
| Standalone icon buttons | Circles |

Nothing sharper than 14px anywhere in product UI. Cards have **no borders** —
tone + shadow only. Hairlines exist only *inside* surfaces as row separators.

---

## 4. Depth & elevation

Three layers, one metaphor — a light sheet floating over the page:

1. **Page background** (`bg`) — the sidebar/nav live directly on it, no card
2. **The sheet** (`#FFFFFF`, large radius, soft shadow) — main content floats
   on it, inset from the viewport edges
3. **Tonal tiles** (`tint`) — cards and panels on the sheet, borderless

Shadows are always soft, diffuse, and navy-tinted:

- Card: `0 1px 2px rgba(15,36,56,.03), 0 10px 30px rgba(15,36,56,.05)`
- Lifted (hover/modal): `0 2px 6px rgba(15,36,56,.05), 0 18px 44px rgba(15,36,56,.09)`

Modal/overlay backdrops: heavy frosted blur of the page behind (iOS-style),
not a plain dark scrim.

---

## 5. Motion

One easing curve for everything: `cubic-bezier(0.22, 1, 0.36, 1)`.

- Entrances: fade + rise 12–16px, 400–600ms, staggered 60–90ms between siblings
- Numbers count up from zero, ~700ms, ease-out
- Loading states: shimmer skeletons shaped like the real content (never spinners
  inside content, never "…")
- Hover: 1–2px lift + shadow deepen, 300ms
- Bars/progress: sweep from zero, ~900ms
- Animate only `transform` and `opacity`. Nothing bounces. Ambient loops 6s+.
- `prefers-reduced-motion` must always be respected: loops stop, reveals become
  instant fades, count-ups render final values.

---

## 6. Components

- **Primary button**: ink-navy pill, white text, weight 500. Hover: darken to
  `accent-strong`, lift 1px, shadow. Active: scale 0.99.
- **Secondary button**: `tint` pill, `body` text; hover: `ink` text.
- **Segmented control** (the only way to switch ranges/modes): `tint` pill
  track, 4px padding, active segment = ink-navy pill with white text and a
  soft shadow.
- **Inputs**: `tint` fill, transparent border, pill or 14px radius. On focus:
  fill whitens to `#FFFFFF`, `sky` border + ring. Placeholder in `muted`.
- **Tables**: micro-label uppercase headers in `muted`, hairline row separators,
  row hover wash `rgba(46,94,142,.045)`, first column `ink` medium.
- **Chips/badges**: pill, `accent-soft` bg, `accent` text, 10–11px uppercase.
- **Avatars**: circle, gradient `accent → sky`, white initial.
- **Empty states**: a designed moment (icon or short serif line + one action),
  never a bare grey sentence.

---

## 7. Accessibility

- Body text contrast ≥ 4.5:1 against its surface; `muted` only for
  non-essential text
- Visible focus for every interactive element (`sky` ring)
- Hit targets ≥ 44px on touch
- Reduced motion honored everywhere (see §5)

---

## 8. The editorial world (marketing site + journal only)

For awareness only — **never use these in product UI.** The marketing site
tells a "night sky to paper" story: night navies (`#0A1220`, `#0F2438`), warm
paper (`#F5F1E6`), glass surfaces, and terracotta (`#C96F3F`) as a rare
editorial accent (once per viewport, max). The journal lives in the light
paper end of that world. These surfaces are narrative, not interface — the
moment a screen has data, settings, or user tasks on it, it is product UI and
Section 1 applies.

---

## 9. Checklist for any AI/agent restyling the app

1. Replace all tokens per the migration map in §1 — then grep for every old
   hex value and rgba equivalent; zero may remain
2. Kill all borders around cards; convert cards to tonal `tint` fills + soft
   navy shadows
3. Convert buttons, inputs, chips, and toggles to pills; radius scale per §3
4. Range/mode switchers become segmented pill controls (§6)
5. Apply the type roles in §2 (serif display / sans everything else, sentence
   case, tabular numerals)
6. Add motion per §5 with the single easing curve, incl. reduced-motion support
7. Verify no terracotta, cream, or warm grey survives anywhere — including
   old assets, gradients, and alpha variants
