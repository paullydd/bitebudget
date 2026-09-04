# BiteBudget

A lightweight, dependency-free web app that generates a varied, calorie- and
macro-tracked meal plan (breakfast/lunch/dinner/snacks) that fits a grocery
budget you set (daily, weekly, or monthly).

No build step, no npm install, no backend required — it's plain HTML/CSS/JS
that runs in any modern browser.

## What it does

- **Meal planning** — generates breakfast, lunch, dinner, and 1–2 snacks per
  day for a plan of 1–14 days, rotating through 65 built-in recipe templates
  (a mix of familiar staples and more adventurous options), with at least 3
  templates for every meal style (bowl, wrap/sandwich, stir-fry, soup,
  salad) at both lunch and dinner, plus high-protein snacks (protein shake,
  protein bar, peanut butter protein balls) for hitting a protein target
  without another full meal, so you don't get the same meal twice in a row.
- **Calorie & macro tracking** — set a daily calorie target and a
  protein/carb/fat split; every meal and day shows calories, protein, carbs,
  and fat (MyFitnessPal-style breakdown), scaled from the ingredient
  quantities. The split isn't just a label: the planner actively favors
  meals whose own protein/carb/fat ratio is close to your target (see
  "How the planner works" below), so a high-protein split actually results
  in high-protein meals instead of just tracking whatever gets picked.
- **Budget tracking** — set a daily, weekly, or monthly grocery budget. Each
  day and the whole plan show estimated cost vs. budget, and the planner
  actively favors cheaper meals once you're tracking over budget.
- **Cookbook-style recipes** — "📖 View Recipe" on any meal opens it as a
  full recipe page (parchment styling, serif type, an ingredients/
  instructions spread with a spine line down the middle) instead of a
  cramped inline expand — full ingredient list with measurements, a
  prep/cook time line, and detailed, numbered steps (specific
  temperatures, timing, and visual doneness cues, not just "cook until
  done") so a recipe can actually be followed start to finish.
- **Shopping list** — aggregates all ingredients across the whole plan into
  one list with quantities and total estimated cost.
- **Vegetarian filter** and a "shuffle" button to regenerate with more
  variety without changing your settings.
- **Adjustable text size** — A−/A+ controls in the header scale the whole
  UI (90%–140%), remembered across visits, for readability across ages.
- **Accessible to screen readers and keyboard users** — one heading per
  page, every form control has a real associated label, every toggle
  bubble and favorite/day-tab button exposes its current state via
  `aria-pressed`/`aria-current` (not just a color change), and the budget
  warning announces itself the moment it appears.
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
  for me," a third time to clear it) → up to 3 meal styles per meal (or "no
  preference") → your calorie target → your grocery budget → your all-time
  go-to meal → how many times a week you meal prep each meal, if at all.
  Likes and dislikes both bias meal selection (dislikes
  strongly, but never to a hard ban) without turning into a filter —
  variety is still preserved. Meal styles are the one exception: tap a
  style a second time to cross it off (red, struck through) and it's
  genuinely excluded — e.g. rule out soup for dinner and you'll never get
  a soup dinner, full stop. Revisit anytime via the "🎯 Preferences" button
  in the header.
- **Log your own meal** — a 📝 button on any meal card lets you swap it for
  something you're actually eating: type a name and protein/carbs/fat (cost
  optional), and the rest of that day's meals automatically recalculate to
  still land near your calorie target. Going out and don't know what you'll
  order yet? Check "Leave this open" instead — it becomes a placeholder you
  fill in later without disturbing anything else in the plan. A logged meal
  can always be reverted to an auto-picked one with ↩️. Check "💾 Save this
  meal" to add it to a short personal list you can pick from next time
  instead of retyping the same macros.
- **Export / Import your data** — footer links download everything stored
  locally (settings, preferences, favorites, history, achievements, saved
  meals) as one JSON file, and import it back — a manual backup/restore or
  a way to move to another browser or device, with no account and no
  server involved.
- **Slide-or-type controls** — calorie target and budget amount can be set
  with a slider or typed directly, in both the onboarding wizard and the
  Settings panel; the budget slider's range adapts to whichever period
  (daily/weekly/monthly) is selected.
- **Collapsible Settings** — the Settings panel is split into "Plan basics"
  (open by default) and "Advanced" (macros, vegetarian — collapsed by
  default) so the everyday page stays short even with both sliders in it.
- **Reset app** — a footer link that clears everything (preferences,
  settings, saved plan, onboarding status) and reloads to the welcome
  screen, so you can see the app exactly as a brand-new visitor would.
- **Swap a single meal** — a 🔀 button on every meal card rerolls just that
  meal (same slot, same variety/preference/budget rules as a full generate)
  instead of "Shuffle" regenerating the whole week.
- **Interactive shopping list** — grouped by grocery-store section (Produce,
  Protein, Dairy, Pantry & Grains) instead of sorted by cost, with checkboxes
  you can tick off while actually shopping. Checked state survives a reload
  and a single-meal swap, but resets on a new Generate/Shuffle.
- **Dark mode** — follows your system's light/dark setting by default; a
  toggle in the header lets you override it, and the choice is remembered.
  Printing always stays light regardless of the on-screen theme.
- **Week at a Glance** — a compact grid (days × meal slots) above the day
  tabs shows your whole week's shape at once; click a cell to jump straight
  to that day instead of clicking through tabs one at a time.
- **Nutrition Facts label** — every recipe page includes a real FDA-style
  label (Calories, Total Fat/Carbohydrate with %DV, Protein), deliberately
  monochrome like the label on actual packaging.
- **Favorite a recipe** — a ❤️ on any meal (card or recipe page) boosts it
  in future plans, on top of the existing protein-preference system — works
  even if you skipped onboarding entirely.
- **Print Full Plan** — a second print button turns the whole week into a
  paginated booklet (every day, every meal, full ingredients and
  instructions) instead of just the shopping list.
- **Meal prep** — step 6 of onboarding asks "Do you like to meal prep?";
  say yes and you pick, per meal, how many times a week to batch-cook it
  (e.g. "Lunch — 4× this week") instead of a one-size-fits-all toggle —
  the other meals that week still stay fully varied. The same three
  controls also live in Settings' Advanced section for editing later
  without re-running the wizard. A "🧺 This Week's Batches" summary (and a
  matching print guide) shows only the recipes you actually chose to
  batch — total quantity, servings made, and a storage/reheating note —
  never a coincidental repeat from ordinary variety-picking.
- **Edit Prices** — a "💲 Edit Prices" button in the header opens every
  food's price in one place, grouped by grocery-store section, each shown
  next to its shipped national-average default. Change what you actually
  pay locally and it's remembered from then on — costs on the current plan
  update immediately, no API, no account, no ongoing cost. "Reset all to
  defaults" clears your overrides in one click.
- **Savings history & achievements** — a progress strip (current streak,
  total saved, plans generated) appears once you've generated at least one
  plan, and an Achievements dialog tracks milestones (budget streaks, total
  saved, recipes tried, favorites) — all computed from data already stored
  locally, nothing new to sign up for.

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
specific store — there's no free public API for real-time grocery pricing
from any major chain, and one would need a paid plan and a backend to use
safely, which runs against this being a free, backend-free budget app. To
make it accurate for you:

- **In the app** — click "💲 Edit Prices" in the header for a UI to override
  any food's price without touching code. Fastest way to make your budget
  numbers reflect your actual store.
- **`js/foods.js`** — edit `price` (USD per 100g) for any food to change the
  shipped default for every visitor (rather than just your own browser). Add
  new foods here (with `protein`, `carbs`, `fat`, `price`, `veg`, and
  optionally `proteinFamily` — see below). There's no `cal` field to set:
  calories are always derived from protein/carbs/fat (4/4/9 cal per gram),
  so they can never drift out of sync with the macros shown alongside them.
- **`js/meals.js`** — add or edit meal templates. Each references foods from
  `foods.js` by key, with a base gram amount, instructions, and a `style` tag
  used by the preference system. The planner automatically scales portions
  up/down to hit calorie targets.

## How the planner works (`js/planner.js`)

1. Splits your daily calorie target across meal slots (breakfast 25%, lunch
   30%, dinner 35%, snacks 10% split across however many you chose).
2. For each slot, first drops any template whose style you've crossed off
   entirely (a real filter, not a bias — the only preference that works
   this way; skipped instead of ever leaving a slot with zero options).
   Filters to templates you haven't had in the last 3 days, then to the
   cheaper half of those when you're pacing over budget, then narrows to
   the closest-fitting quarter by comparing each template's own
   protein/carb/fat ratio to your macro split (so a 40/30/30 high-protein
   target actually results in high-protein meals, not just a label) — with
   one exception: if a template matches a taste preference you've stated
   (style, signature, favorite) it always survives that macro-fit cut even
   when it's a poor fit numerically, so a real preference never becomes
   mathematically unreachable just because of your macro split. From
   what's left, picks a *weighted* random choice — templates matching your
   saved taste preferences get a higher weight, and templates matching a
   *disliked* protein get a strong penalty (rare, never zero) — but
   everything can still appear. Skipping the preference wizard (and never
   favoriting anything) means preference weight is equal for everyone, so
   only the macro-fit narrowing applies.
3. Scales the chosen template's ingredient quantities toward the slot's
   calorie target (bounded to 0.7x–1.4x so portions stay realistic), and
   computes nutrition + cost.
4. Aggregates every ingredient across the whole plan into a shopping list
   with a total cost estimate.

For each of breakfast/lunch/dinner you've set a meal-prep count on (e.g.
lunch = 4), step 2 runs just once up front (via `selectPrepPool()`, same
weighting as always) to fix one recipe, which then fills that many
occurrences of the slot before the remaining days fall back to normal
fresh picking — each occurrence still scales to its own day's calorie
target like step 3 always does. Every meal placed this way is flagged
`prepped: true`; `groupIntoPrepBatches()` groups only those for the batch
view, so a recipe that happens to repeat later from ordinary variety
never gets mistaken for something you asked to batch-cook. Nothing about
totals, the shopping list, or history needs to know the difference.

`estimateMinDailyCost()` in the same file computes a realistic best-case
daily cost (cheapest eligible template per slot, same scaling bounds) — this
is what powers the budget feasibility warning. `regenerateMeal()` reuses the
same per-slot logic to reroll exactly one meal in place (the 🔀 button),
then rebuilds the day's totals and the shopping list so nothing drifts out
of sync. `applyCustomMeal()` drops a user-entered meal into one slot and,
when it's the first time that slot is going from auto-picked to a *known*
custom meal, re-picks every other still-auto-picked slot in that day so the
day's calorie total still aims for the same target around the fixed meal —
re-editing an already-custom meal, or leaving one open to fill in later,
never re-triggers that rebalance.

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
