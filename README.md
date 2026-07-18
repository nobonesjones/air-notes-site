# Air Notes — marketing site

One-page marketing site for Air Notes. Static — no build step, no dependencies.

## Run it

Any static server from this folder:

```bash
python3 -m http.server 4321
# → http://localhost:4321
```

(or `npx serve`, or just open `index.html` — everything works from file:// too, fonts load from Google Fonts.)

## Files

| File | What it is |
|---|---|
| `index.html` | All content and structure. Copy lives here. |
| `styles.css` | Design tokens at the top (`:root`), then components. Night/dusk glass + day paper styles. |
| `app.js` | The motion engine. One rAF loop drives the scroll linked sky colour, the context convergence canvas, and pointer parallax. IntersectionObservers drive reveals, the sticky phone screen swaps, and counters. |

## The concept — "night sky to paper"

One scroll, three acts: night hero → the sky literally brightens through dawn into warm paper for the product sections → dusk returns for the closing CTA. The background colour is interpolated in OKLab per frame from scroll position (see `skyAt()` in `app.js`); the context flow and aurora fade with it.

## Rules if you're editing

- Tokens in `:root` are the brand — don't invent colours. Terracotta (`--accent`) appears **once per viewport, max**.
- Serif (`Source Serif 4`) for H1/H2/pull-quotes only; Inter for everything else. Sentence case everywhere.
- One easing: `cubic-bezier(0.22, 1, 0.36, 1)`. Ambient loops 6–14s. Nothing bounces.
- Animate only `transform`/`opacity`.
- `prefers-reduced-motion` must keep working (ambient loops stop, reveals become fades).
- Glass surfaces need all four: blur + inner stroke + specular top edge + shadow.
- No emoji, no icon grids, no gradient text, no purple.

The email form is front-end only (validation + success state) — wiring it to a real list is open work.

Related repo: the Air Note iPhone app (design system and product docs live there under `docs/`).
