# BiteBudget

A lightweight, dependency-free web app that generates a varied, calorie- and
macro-tracked meal plan (breakfast/lunch/dinner/snacks) that fits a grocery
budget you set (daily, weekly, or monthly).

No build step, no npm install, no backend required — it's plain HTML/CSS/JS
that runs in any modern browser.

## What it does

- **Meal planning** — generates breakfast, lunch, dinner, and 1–2 snacks per
  day for a plan of 1–14 days, rotating through 22 built-in recipe templates
  so you don't get the same meal twice in a row.
- **Calorie & macro tracking** — set a daily calorie target and a
  protein/carb/fat split; every meal and day shows calories, protein, carbs,
  and fat (MyFitnessPal-style breakdown), scaled from the ingredient
  quantities.
- **Budget tracking** — set a daily, weekly, or monthly grocery budget. Each
  day and the whole plan show estimated cost vs. budget, and the planner
  actively favors cheaper meals once you're tracking over budget.
- **Instructions** — every meal includes ingredient quantities (in grams) and
  step-by-step prep instructions.
- **Shopping list** — aggregates all ingredients across the whole plan into
  one list with quantities and total estimated cost.
- **Vegetarian filter** and a "shuffle" button to regenerate with more
  variety without changing your settings.
- **Adjustable text size** — A−/A+ controls in the header scale the whole
  UI (90%–140%), remembered across visits, for readability across ages.
- **Printable shopping list** — a dedicated print button formats just the
  shopping list for a physical copy to take to the store.
- **Installable (PWA)** — has a manifest and service worker so it can be
  added to a phone/desktop home screen and used offline after the first
  visit.
- **Budget feasibility warning** — warns *before* you generate a plan if
  your budget can't realistically cover even the cheapest meals at your
  calorie target, and over-budget results now include a concrete suggestion
  (raise the budget to $X, or try Vegetarian only) instead of just red text.
- **Taste-preference onboarding** — a welcome screen (name, tagline, a
  rotating funny quote, "Get Started" / "Skip setup for now") leads into a
  skippable, Spotify-style wizard: liked
  *and disliked* proteins (tap a protein once to like it, again to say "not
  for me," a third time to clear it) → meal style per meal → your calorie
  target → your grocery budget → your all-time go-to meal. Likes and
  dislikes both bias meal selection (dislikes strongly, but never to a hard
  ban) without turning into a filter — variety is still preserved. Revisit
  anytime via the "🎯 Preferences" button in the header.
- **Slide-or-type controls** — calorie target and budget amount can be set
  with a slider or typed directly, in both the onboarding wizard and the
  Settings panel; the budget slider's range adapts to whichever period
  (daily/weekly/monthly) is selected.
- **Collapsible Settings** — the Settings panel is split into "Plan basics"
  (open by default) and "Advanced" (macros, vegetarian — collapsed by
  default) so the everyday page stays short even with both sliders in it.

## Running it

No installation needed — just open `index.html` in a browser:

```
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

Or serve it locally (useful for testing before deploying):

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying

Since it's fully static, you can deploy it anywhere that serves static
files, with no server-side setup:

- **Netlify / Vercel**: drag-and-drop the folder in their dashboard, or
  connect the repo — no build command needed.
- **GitHub Pages**: push this folder to a repo and enable Pages on the
  `main` branch.
- Any static file host (S3, Cloudflare Pages, nginx, etc.) works too.

## Editing the data

This ships with **average U.S. grocery prices**, not live prices from a
specific store (there's no public API for that). To make it accurate for
you:

- **`js/foods.js`** — edit `price` (USD per 100g) for any food to match your
  local store. Add new foods here (with `protein`, `carbs`, `fat`, `price`,
  `veg`, and optionally `proteinFamily` — see below). There's no `cal` field
  to set: calories are always derived from protein/carbs/fat (4/4/9 cal per
  gram), so they can never drift out of sync with the macros shown alongside
  them.
- **`js/meals.js`** — add or edit meal templates. Each references foods from
  `foods.js` by key, with a base gram amount, instructions, and a `style` tag
  used by the preference system. The planner automatically scales portions
  up/down to hit calorie targets.

## How the planner works (`js/planner.js`)

1. Splits your daily calorie target across meal slots (breakfast 25%, lunch
   30%, dinner 35%, snacks 10% split across however many you chose).
2. For each slot, filters to templates you haven't had in the last 3 days,
   then to the cheaper half of those when you're pacing over budget, then
   picks a *weighted* random choice from what's left — templates matching
   your saved taste preferences (liked proteins, preferred meal style, your
   signature meal) get a higher weight, and templates matching a *disliked*
   protein get a strong penalty (rare, never zero) — but everything can
   still appear. Skipping the preference wizard means every weight is equal,
   which is mathematically identical to a plain uniform pick.
3. Scales the chosen template's ingredient quantities toward the slot's
   calorie target (bounded to 0.7x–1.4x so portions stay realistic), and
   computes nutrition + cost.
4. Aggregates every ingredient across the whole plan into a shopping list
   with a total cost estimate.

`estimateMinDailyCost()` in the same file computes a realistic best-case
daily cost (cheapest eligible template per slot, same scaling bounds) — this
is what powers the budget feasibility warning.

## Project structure

```
bitebudget/
├── index.html          # UI markup
├── manifest.json        # PWA install metadata
├── sw.js                 # Service worker (offline app-shell caching)
├── icons/                # App icons (source SVGs + rasterized PNGs)
├── css/style.css        # Styling
├── js/foods.js          # Nutrition + price database (per 100g)
├── js/meals.js           # Meal templates (ingredients + instructions)
├── js/planner.js         # Plan-generation algorithm
└── js/app.js              # UI wiring, rendering, localStorage persistence
```

## Ideas for extending it

- Swap the flat food/price database for a real nutrition API (e.g. USDA
  FoodData Central) for more foods and more accurate values.
- Add a store-locator integration (Google Places API) to find nearby
  grocery stores — the current version intentionally skips this since it
  needs a paid API key and real-time inventory/pricing isn't publicly
  available from most chains.
- Persist plans per-user with a small backend (e.g. SQLite + a simple
  Node/Express or Python/Flask API) if you want multi-device sync.
- Add a "log what I actually ate" mode for real MyFitnessPal-style daily
  tracking against the plan.
- Derive the calorie target from body weight and a stated goal (lose/
  maintain/gain), instead of the user picking a raw calorie number directly.
