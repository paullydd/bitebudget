// Whether the automatic planner may pick a template. Built-in recipes always
// can. A personal recipe can unless its Include-in-automatic-plans setting is
// explicitly off — recipes saved before that setting existed have no value
// and keep being planned exactly as before. (Drafts never reach
// MEAL_TEMPLATES at all; see syncCustomRecipesIntoTemplates in js/app.js.)
// Add to Plan is a deliberate, manual placement and ignores this.
function isPlannable(t) {
  return !t.userRecipe || (!t.draft && t.autoPlan !== false);
}

// A recipe's `items` are the WHOLE batch it makes; `yieldServings` is how
// many servings that batch makes. Built-in recipes and legacy user recipes
// have no field and are one serving — exactly how the planner has always
// read them — so nothing already saved changes meaning.
function templateYield(t) {
  const y = t && t.yieldServings;
  return Number.isInteger(y) && y >= 1 ? y : 1;
}

// One serving of a recipe (unrounded). Everything the planner does per
// person — macro fit, cost ranking, calorie scaling — starts from this.
function servingItems(t) {
  const y = templateYield(t);
  return y === 1 ? t.items : t.items.map(({ food, grams }) => ({ food, grams: grams / y }));
}

// Scale a template's item list by a factor, rounding grams to the nearest 5g.
function scaleItems(items, factor, step = 5) {
  return items.map(({ food, grams }) => {
    const scaled = grams * factor;
    // step 0 = exact: no rounding and no minimum (see itemStep).
    return { food, grams: step > 0 ? Math.max(step, Math.round(scaled / step) * step) : scaled };
  });
}

// Built-in recipes are written one serving at a time with 5g granularity,
// so 5g rounding is right for them. A multi-serving recipe divides a whole
// batch down to one person: a 1g pinch of spice in a 4-serving batch is
// 0.25g each, and ANY rounding step — 5g, or even half a gram — inflates it
// (and rounding the per-person amount before multiplying by household size
// compounds the error). So multi-serving recipes scale exactly, in one pass,
// like placed meals do; display rounds, the shopping list rounds up to real
// packages anyway.
function itemStep(template) {
  // The same applies to ANY user recipe, even a one-serving one: its
  // amounts are the user's own (a 2g pinch means 2g), not built-in
  // numbers designed around 5g granularity.
  return template.userRecipe || templateYield(template) > 1 ? 0 : 5;
}

// How much to stretch/shrink a recipe from its own designed base size.
// With calorie tracking off there's no target to hit, so every recipe just
// uses its own portion as written — no clamped scaling.
function computeFactor(base, targetCal, trackCalories) {
  if (!trackCalories) return 1;
  if (base.cal <= 0) return 1;
  return Math.min(1.4, Math.max(0.7, targetCal / base.cal));
}

function dailyBudgetFor(period, amount) {
  if (period === "weekly") return amount / 7;
  if (period === "monthly") return amount / 30;
  return amount; // daily
}

// The unique set of proteinFamily tags (see foods.js) present in a template's items.
function templateProteinFamilies(template) {
  const families = template.items.map(({ food }) => FOODS[food].proteinFamily).filter(Boolean);
  return [...new Set(families)];
}

// Signature-meal presets (step 3 of onboarding) map to a protein-family combo.
// Each preset is a list of family groups; a template matches when it satisfies
// every group, and a group is satisfied by having ANY one of its families
// (e.g. eggs_meat = egg AND (red_meat OR poultry), not egg AND red_meat AND poultry).
const SIGNATURE_PRESETS = {
  eggs_meat: [["egg"], ["red_meat", "poultry"]],
  yogurt_oats: [["dairy"]],
  chicken_rice: [["poultry"]],
  fish: [["fish"]],
  plant_based: [["plant"]],
};

// How much a template matches stated preferences — additive bias, not a filter.
// Base weight 1 means "no preferences saved" behaves identically to a uniform pick.
function preferenceWeight(template, slot, preferences) {
  if (!preferences) return 1;
  let weight = 1;
  const families = templateProteinFamilies(template);

  if (preferences.proteins && preferences.proteins.some(p => families.includes(p))) {
    weight += 2;
  }
  if (preferences.mealStyle && preferences.mealStyle[slot] && [].concat(preferences.mealStyle[slot]).includes(template.style)) {
    weight += 2;
  }
  if (preferences.signature && preferences.signature.slot === slot && preferences.signature.preset) {
    const groups = SIGNATURE_PRESETS[preferences.signature.preset] || [];
    if (groups.length && groups.every(group => group.some(f => families.includes(f)))) {
      weight += 4;
    }
  }
  if (preferences.favoriteIds && preferences.favoriteIds.includes(template.id)) {
    weight += 3;
  }
  if (preferences.dislikedProteins && preferences.dislikedProteins.some(p => families.includes(p))) {
    // Strong bias, not a hard ban: a meaningful penalty relative to the
    // bonuses above so a disliked template drops toward rare, but a floor
    // keeps it possible so a slot's pool never effectively empties out
    // from dislikes alone.
    weight = Math.max(0.15, weight - 4);
  }
  return weight;
}

// How far a template's own protein/carb/fat ratio is from the daily macro
// split. Manhattan distance between two ratios that each sum to 1, so it
// ranges 0 (identical split) to 2 (completely disjoint).
function macroDistance(template, macroSplit) {
  const n = computeNutrition(servingItems(template));
  if (n.cal <= 0) return 2;
  const proteinPct = (n.protein * 4) / n.cal;
  const carbPct = (n.carbs * 4) / n.cal;
  const fatPct = (n.fat * 9) / n.cal;
  return Math.abs(proteinPct - macroSplit.protein / 100)
    + Math.abs(carbPct - macroSplit.carbs / 100)
    + Math.abs(fatPct - macroSplit.fat / 100);
}

// Fine-grained weighting within an already macro-filtered candidate set (see
// pickTemplate) — additive bias like preferenceWeight, not what does the
// heavy lifting on its own.
function macroFitWeight(template, macroSplit) {
  if (!macroSplit) return 0;
  return Math.max(0, 8 - macroDistance(template, macroSplit) * 5);
}

function weightedPick(candidates, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// Pick a template for a slot: filters for variety (avoid recent repeats),
// budget (bias toward the cheaper half when over), and macro fit (narrow to
// the better-fitting half of what's left when a split is set — the same
// filter-then-weight pattern budget-awareness uses, so a real nutritional
// target does more than nudge among many other signals), then weights the
// remaining candidates by how well they match stated taste preferences and
// fine-grained macro fit within that narrowed set.
function pickTemplate(slot, recentIds, diet, overBudget, preferences, macroSplit) {
  let pool = MEAL_TEMPLATES.filter(t => t.slot === slot && isPlannable(t));

  // Dietary restrictions (vegetarian, gluten-free, dairy-free) are
  // safety-critical for people with allergies or celiac disease, not a
  // taste preference — unlike every other filter below, this one is NOT
  // allowed a safety valve. If combining restrictions genuinely leaves no
  // recipe in this slot's pool, return null and let the caller leave the
  // slot unfilled rather than silently serving something that violates
  // the restriction.
  if (diet) {
    const filtered = pool.filter(t => matchesDiet(t.items, diet));
    if (filtered.length === 0) return null;
    pool = filtered;
  }

  // Equipment you don't have is a hard constraint, not a taste
  // preference — a recipe that needs a blender or slow cooker is
  // genuinely uncookable without one, so this is checked before any
  // style/taste filtering. Same safety valve as every other hard filter
  // here: never let it empty the pool out entirely.
  if (preferences && preferences.missingAppliances && preferences.missingAppliances.length) {
    const missing = preferences.missingAppliances;
    const filtered = pool.filter(t => !(t.requiresAppliance || []).some(a => missing.includes(a)));
    if (filtered.length > 0) pool = filtered;
  }

  // A style the user has crossed off is a genuine hard filter (unlike the
  // rest of the preference system, which only ever biases weight) — but
  // never let it empty a slot out entirely; skip it rather than break
  // planning if every style for this slot somehow got excluded.
  if (preferences && preferences.excludedMealStyle && preferences.excludedMealStyle[slot]) {
    const excluded = preferences.excludedMealStyle[slot];
    const filtered = pool.filter(t => !excluded.includes(t.style));
    if (filtered.length > 0) pool = filtered;
  }

  // A specific recipe marked "not for me" is an even stronger, more
  // deliberate signal than a crossed-off style — the user actually looked
  // at (or cooked) this exact recipe and said no — so it's excluded the
  // same hard-filter-with-safety-valve way.
  if (preferences && preferences.dislikedRecipeIds && preferences.dislikedRecipeIds.length) {
    const filtered = pool.filter(t => !preferences.dislikedRecipeIds.includes(t.id));
    if (filtered.length > 0) pool = filtered;
  }

  let fresh = pool.filter(t => !recentIds.includes(t.id));
  if (fresh.length === 0) fresh = pool; // all recently used, allow repeats

  // Rank by base cost; when over budget, bias toward the cheaper half.
  const withCost = fresh.map(t => ({ t, cost: computeNutrition(servingItems(t)).cost }));
  withCost.sort((a, b) => a.cost - b.cost);
  let candidates = overBudget ? withCost.slice(0, Math.max(1, Math.ceil(withCost.length / 2))) : withCost;

  // Narrow further to the closest-fitting quarter when a split is set —
  // tighter than the budget filter's half, since a stated macro target
  // (e.g. a high-protein diet) is a stronger signal than a soft cost nudge.
  if (macroSplit) {
    const withFit = candidates.map(c => ({ ...c, distance: macroDistance(c.t, macroSplit) }));
    withFit.sort((a, b) => a.distance - b.distance);
    const kept = withFit.slice(0, Math.max(1, Math.round(withFit.length * 0.25)));

    // A template matching a stated taste preference (style/signature/
    // favorite) shouldn't become mathematically unreachable just because
    // it's a macro-fit outlier — that would turn preferenceWeight's
    // additive bias into a silent hard filter. Guarantee the single best
    // preference match survives the cut too; it still has to compete on
    // weight from there, same as everything else.
    if (preferences) {
      const bestPref = withFit.reduce((best, c) => {
        const w = preferenceWeight(c.t, slot, preferences);
        return !best || w > best.w ? { ...c, w } : best;
      }, null);
      if (bestPref && bestPref.w > 1 && !kept.some(c => c.t.id === bestPref.t.id)) {
        kept.push(bestPref);
      }
    }
    candidates = kept;
  }

  const templates = candidates.map(c => c.t);
  const weights = templates.map(t => preferenceWeight(t, slot, preferences) + macroFitWeight(t, macroSplit));
  return weightedPick(templates, weights);
}

// Realistic best-case daily cost: cheapest eligible template per slot, scaled
// to that slot's target calories with the same bounds generatePlan() uses
// (or left at its own designed size when calorie tracking is off), times
// however many people the plan is feeding. Used to warn upfront when a
// budget can't realistically be met.
function estimateMinDailyCost(dailyCalories, snacksPerDay, diet, trackCalories = true, servings = 1) {
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
  const snackPct = 0.10 / Math.max(1, snacksPerDay);
  const slots = ["breakfast", "lunch", "dinner", ...Array(snacksPerDay).fill("snack")];

  let total = 0;
  for (const slot of slots) {
    let pool = MEAL_TEMPLATES.filter(t => t.slot === slot && isPlannable(t));
    const filtered = pool.filter(t => matchesDiet(t.items, diet));
    if (filtered.length > 0) pool = filtered;
    const pct = slot === "snack" ? snackPct : slotPct[slot];
    const targetCal = dailyCalories * pct;

    let cheapest = Infinity;
    for (const t of pool) {
      const base = computeNutrition(servingItems(t));
      const factor = computeFactor(base, targetCal, trackCalories);
      cheapest = Math.min(cheapest, base.cost * factor);
    }
    total += cheapest === Infinity ? 0 : cheapest * servings;
  }
  return total;
}

// Recomputes a day's totals from its current meals — used both by initial
// plan generation and after a single-meal swap, so the two never drift.
function recomputeDayTotals(day) {
  day.totals = day.meals.reduce((acc, m) => {
    acc.cal += m.nutrition.cal;
    acc.protein += m.nutrition.protein;
    acc.carbs += m.nutrition.carbs;
    acc.fat += m.nutrition.fat;
    acc.cost += m.nutrition.cost;
    return acc;
  }, { cal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 });
}

// Aggregates every ingredient across a plan into a shopping list with a
// total cost estimate — used both by initial plan generation and after a
// single-meal swap, so the two never drift. `pantry` ({food: grams}, see
// js/app.js's loadPantry) discounts whatever's already on hand from what
// still needs to be bought — `grams` keeps its existing meaning ("still
// need to buy") for every current reader, cost drops to match, and
// `fromPantry` is new (how much of this food's weekly need the pantry is
// covering). An item can end up with `grams: 0` if the pantry fully
// covers it — still included, not filtered out, so the UI can show
// "already have enough" instead of it silently disappearing.
function buildShoppingList(plan, pantry = {}) {
  return shoppingLinesFromNeeds(planNeeds(plan), pantry);
}

// Total grams of every food a plan needs ({food: grams}), repeated rows and
// repeated meals combined. `skip` ({dayIndex, mealIndex}) leaves one slot out
// — used to ask "what would the plan need if this meal weren't there?".
function planNeeds(plan, skip) {
  const needs = {};
  plan.forEach((day, di) => {
    day.meals.forEach((meal, mi) => {
      if (skip && skip.dayIndex === di && skip.mealIndex === mi) return;
      for (const { food, grams } of meal.items) needs[food] = (needs[food] || 0) + grams;
    });
  });
  return needs;
}

// The pantry-discounted, purchase-rounded, priced lines for a {food: grams}
// need map. buildShoppingList is this plus planNeeds, so anything that
// prices a hypothetical basket (What can I make?) can't drift from the real
// shopping list.
function shoppingLinesFromNeeds(needs, pantry = {}) {
  return Object.entries(needs).map(([food, neededGrams]) => {
    const fromPantry = Math.min(neededGrams, Math.max(0, pantry[food] || 0));
    const grams = neededGrams - fromPantry;
    // Priced from what you're actually told to buy (e.g. a whole dozen
    // eggs), not the raw grams a recipe uses — you can't buy 1 egg's
    // worth at the store. See roundUpToPurchase/shoppingPurchaseGrams in
    // js/foods.js, the same rounding formatShoppingQty displays.
    const purchaseGrams = shoppingPurchaseGrams(food, grams);
    const cost = (FOODS[food].price * purchaseGrams) / 100;
    return { food, name: FOODS[food].name, grams, fromPantry, cost };
  }).sort((a, b) => b.cost - a.cost);
}

// The gap between a real purchasable quantity (see shoppingPurchaseGrams
// in js/foods.js) and what's actually needed this trip — e.g. told to
// buy a dozen eggs when the week's recipes only use 10, that's 2 eggs'
// worth likely left over. A first-pass suggestion for the Pantry dialog,
// not a source of truth — the user confirms before anything is added.
// Based on `grams` (post-pantry-discount, what's actually being bought),
// not the raw weekly need, so it compounds correctly with pantry stock
// already in hand instead of over-suggesting.
// Only surfaces a surplus once it's at least 40% of that food's own
// purchase unit — a gram or two of rounding noise on nearly every
// ingredient isn't a "leftover" anyone would notice, and a suggestion
// list nobody can act on defeats the point. Foods with no SERVING_UNITS
// entry never round up to begin with, so there's nothing to suggest.
function estimateLeftoverSurplus(shoppingList) {
  const surplus = {};
  shoppingList.forEach(item => {
    if (item.grams <= 0) return;
    const su = SERVING_UNITS[item.food];
    if (!su) return;
    const extra = shoppingPurchaseGrams(item.food, item.grams) - item.grams;
    if (extra >= su.grams * 0.4) surplus[item.food] = Math.round(extra);
  });
  return surplus;
}

// Styles that don't hold up as a cook-once-eat-all-week batch — a wrap or
// salad assembled Sunday is soggy/wilted by Wednesday, and a smoothie
// separates in the fridge. Bowls, stir-fries, and soups portion and reheat
// fine, so meal prep only ever auto-picks from those by default. Snacks
// don't carry a meal style at all (no bowl/wrap/etc.), so they're tagged
// "batch" (real cook-or-mix-ahead effort worth batching — protein balls,
// baked chicken bites, hard-boiled eggs) or "quick" (assembled fresh in
// under a minute either way, or actively worse a few days old, like
// sliced apple) in js/meals.js instead — meal prep only ever draws from
// the "batch" ones.
const PREP_UNFRIENDLY_STYLES = { breakfast: ["smoothie"], lunch: ["wrap_sandwich", "salad"], dinner: ["wrap_sandwich", "salad"], snack: ["quick"] };

// Merges the prep-unfriendly styles into a slot's excludedMealStyle so
// pickTemplate's existing hard-filter-with-safety-valve does the work —
// this only affects which recipe gets chosen for a meal-prep batch, not
// the user's own style preferences for ordinary (non-prepped) days.
function withPrepStyleFilter(preferences, slot) {
  const unfriendly = PREP_UNFRIENDLY_STYLES[slot];
  if (!unfriendly) return preferences;
  const existing = (preferences && preferences.excludedMealStyle && preferences.excludedMealStyle[slot]) || [];
  const merged = [...new Set([...existing, ...unfriendly])];
  return {
    ...(preferences || {}),
    excludedMealStyle: { ...((preferences && preferences.excludedMealStyle) || {}), [slot]: merged },
  };
}

// Picks `count` distinct templates for a slot up front — used by meal prep
// mode to fix a small rotating set for the whole week instead of a fresh
// pick per day. Reuses pickTemplate's full weighting (macro-fit,
// preferences, budget); each pick feeds the next call's avoid-list so the
// pool members are distinct, the same trick the day loop already uses.
function selectPrepPool(slot, count, diet, preferences, macroSplit) {
  const prepPreferences = withPrepStyleFilter(preferences, slot);
  const pool = [];
  const usedIds = [];
  for (let i = 0; i < count; i++) {
    const template = pickTemplate(slot, usedIds, diet, false, prepPreferences, macroSplit);
    // No recipe satisfies the diet restriction for this slot at all —
    // stop here rather than crash on a null template. Caller gets
    // whatever distinct picks were found before this (possibly none),
    // and generatePlan's day loop falls back to pickTemplate per day,
    // which will also return null and mark the slot unmatched.
    if (!template) break;
    pool.push(template);
    usedIds.push(template.id);
  }
  return pool;
}

// Groups a plan's meals by recipe, for the prep-batch view — turns "same
// recipe on days 1, 3, 5" into one "cook once, makes N servings" card.
// Only meals actually assigned via meal prep (m.prepped, set in the day
// loop above) count — a custom meal, or a recipe that coincidentally
// repeats later from ordinary variety-picking, isn't something the user
// asked to batch-cook, so it's excluded even if the id matches.
function groupIntoPrepBatches(plan) {
  const groups = {};
  plan.forEach(day => {
    day.meals.forEach(m => {
      if (!m.prepped) return;
      if (!groups[m.id]) {
        groups[m.id] = { id: m.id, name: m.name, slot: m.slot, instructions: m.instructions, reference: m.reference, occurrences: 0, itemTotals: {}, cost: 0, servings: m.servings || 1 };
      }
      const g = groups[m.id];
      g.occurrences++;
      g.cost += m.nutrition.cost;
      m.items.forEach(({ food, grams }) => {
        g.itemTotals[food] = (g.itemTotals[food] || 0) + grams;
      });
    });
  });
  return Object.values(groups)
    .map(g => ({
      id: g.id, name: g.name, slot: g.slot, instructions: g.instructions, ...(g.reference ? { reference: g.reference } : {}), occurrences: g.occurrences, cost: g.cost, servings: g.servings,
      items: Object.entries(g.itemTotals).map(([food, grams]) => ({ food, grams })),
    }));
}

// Build a full multi-day plan. preferences (see foods.js/meals.js tags) is
// optional — omitting it reproduces the original untargeted behavior.
// settings.mealPrep ({breakfast, lunch, dinner}, each a 0-7 count) fixes
// one recipe per named slot for that many occurrences — "prep lunch 4
// times" cooks one lunch recipe once and reuses it for the first 4 days;
// the remaining days (and any slot left at 0) pick fresh as usual.
// True when at least one recipe for this slot satisfies the diet — i.e.
// exactly when pickTemplate will NOT return null for it. Lets callers that
// re-pick several slots at once (applyCustomMeal's rebalance) tell a slot
// they can fill from one that has to stay unmatched, before they start
// doing calorie math around it.
function hasDietMatch(slot, diet) {
  return MEAL_TEMPLATES.some(t => t.slot === slot && isPlannable(t) && matchesDiet(t.items, diet));
}

// Human-readable reason shown on an unfilled slot card — which active
// restriction(s) left no matching recipe, so the user knows what to relax
// rather than just seeing an empty meal.
function dietRestrictionLabel(diet) {
  const active = [];
  if (diet.vegetarian) active.push("vegetarian");
  if (diet.glutenFree) active.push("gluten-free");
  if (diet.dairyFree) active.push("dairy-free");
  if (active.length === 0) return "No matching recipe was found for this meal.";
  return `No ${active.join(" + ")} recipe is available for this meal. Add a recipe that fits, or relax this restriction for this meal.`;
}

// The placeholder that stands in for a slot no recipe can fill under the
// active diet. One definition, so generation, swap and rebalance can't drift.
function unmatchedMeal(slot, servings, diet) {
  return {
    slot, id: null, name: null, items: [], instructions: [],
    nutrition: { cal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 },
    servings, prepTime: null, cookTime: null, prepped: false,
    unmatched: true, unmatchedReason: dietRestrictionLabel(diet),
  };
}

function generatePlan(settings, preferences, pantry = {}) {
  const {
    days, dailyCalories, macroSplit, budgetPeriod, budgetAmount,
    snacksPerDay, vegetarianOnly, glutenFree, dairyFree, mealPrep,
  } = settings;
  const trackCalories = settings.trackCalories !== false;
  const servings = settings.servings || 1;
  const effectiveMacroSplit = trackCalories ? macroSplit : null;
  const diet = { vegetarian: vegetarianOnly, glutenFree, dairyFree };

  const dailyBudget = dailyBudgetFor(budgetPeriod, budgetAmount);
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
  const snackPct = 0.10 / Math.max(1, snacksPerDay);

  const recent = { breakfast: [], lunch: [], dinner: [], snack: [] };
  const prepRemaining = {};
  ["breakfast", "lunch", "dinner", "snack"].forEach(slot => {
    const count = Math.min(days, Math.max(0, (mealPrep && mealPrep[slot]) || 0));
    if (count > 0) {
      const [template] = selectPrepPool(slot, 1, diet, preferences, effectiveMacroSplit);
      // No recipe fits this diet for this slot at all — skip meal prep for
      // it; the day loop below falls through to a per-day pickTemplate
      // call, which will also come back null and mark each day unmatched
      // (with the reason shown) instead of prepping something that
      // violates the restriction.
      if (template) prepRemaining[slot] = { template, remaining: count };
    }
  });

  const plan = [];
  let runningCost = 0;

  for (let d = 0; d < days; d++) {
    const dayMeals = [];
    const overBudgetSoFar = runningCost > dailyBudget * d;

    const slotsToday = ["breakfast", "lunch", "dinner", ...Array(snacksPerDay).fill("snack")];
    for (const slot of slotsToday) {
      const pct = slot === "snack" ? snackPct : slotPct[slot];
      const targetCal = dailyCalories * pct;

      let template;
      let prepped = false;
      const prep = prepRemaining[slot];
      if (prep && prep.remaining > 0) {
        template = prep.template;
        prep.remaining--;
        prepped = true;
      } else {
        template = pickTemplate(slot, recent[slot], diet, overBudgetSoFar, preferences, effectiveMacroSplit);
      }

      if (!template) {
        // No recipe in the library satisfies the active diet restriction(s)
        // for this slot. Leave it genuinely unfilled rather than falling
        // back to an unfiltered pick that could violate an allergy or
        // celiac restriction — the UI shows unmatchedReason and offers a
        // manual swap once the restriction is relaxed or a fitting recipe
        // is added.
        dayMeals.push(unmatchedMeal(slot, servings, diet));
        continue;
      }

      const base = computeNutrition(servingItems(template));
      const factor = computeFactor(base, targetCal, trackCalories);
      const personItems = scaleItems(servingItems(template), factor, itemStep(template));
      const personNutrition = computeNutrition(personItems);
      const items = servings !== 1 ? scaleItems(personItems, servings, itemStep(template)) : personItems;

      dayMeals.push({
        slot, id: template.id, name: template.name, items, instructions: template.instructions, ...(Array.isArray(template.reference) && template.reference.length ? { reference: template.reference } : {}),
        nutrition: { ...personNutrition, cost: personNutrition.cost * servings },
        servings,
        prepTime: template.prepTime, cookTime: template.cookTime, prepped,
      });

      recent[slot].push(template.id);
      if (recent[slot].length > 3) recent[slot].shift();
    }

    const day = { day: d + 1, meals: dayMeals, totals: null };
    recomputeDayTotals(day);
    runningCost += day.totals.cost;
    plan.push(day);
  }

  const shoppingList = buildShoppingList(plan, pantry);
  const totalCost = shoppingList.reduce((s, i) => s + i.cost, 0);
  const totalBudget = dailyBudget * days;

  return {
    plan, shoppingList,
    summary: {
      totalCost, totalBudget, dailyBudget, dailyCalories, macroSplit, days, snacksPerDay, vegetarianOnly,
      glutenFree, dairyFree,
      servings, trackCalories,
      mealPrep: mealPrep || { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
      mealPrepEnabled: Object.keys(prepRemaining).length > 0,
    },
  };
}

// Rerolls exactly one meal in an already-generated plan (mutates `result` in
// place). Reuses the same per-slot target-calorie math and pickTemplate()
// used during initial generation, so preference weighting, dislikes, and
// budget-awareness all apply identically to a manual swap.
function regenerateMeal(result, dayIndex, mealIndex, settings, preferences, pantry = {}) {
  const { dailyCalories, macroSplit, snacksPerDay, vegetarianOnly, glutenFree, dairyFree, budgetPeriod, budgetAmount } = settings;
  const trackCalories = settings.trackCalories !== false;
  const servings = settings.servings || 1;
  const effectiveMacroSplit = trackCalories ? macroSplit : null;
  const diet = { vegetarian: vegetarianOnly, glutenFree, dairyFree };
  const dailyBudget = dailyBudgetFor(budgetPeriod, budgetAmount);
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
  const snackPct = 0.10 / Math.max(1, snacksPerDay);

  const day = result.plan[dayIndex];
  const oldMeal = day.meals[mealIndex];
  const slot = oldMeal.slot;
  const pct = slot === "snack" ? snackPct : slotPct[slot];
  const targetCal = dailyCalories * pct;

  const nearbyDays = result.plan.filter((d, i) => Math.abs(i - dayIndex) <= 3 && i !== dayIndex);
  const avoidIds = nearbyDays.flatMap(d => d.meals.filter(m => m.slot === slot).map(m => m.id));
  avoidIds.push(oldMeal.id);

  const overBudget = day.totals.cost > dailyBudget;
  const template = pickTemplate(slot, avoidIds, diet, overBudget, preferences, effectiveMacroSplit);

  if (!template) {
    // No recipe for this slot satisfies the active diet restriction(s) at
    // all — same safety rule as initial generation. Leave the slot
    // genuinely unfilled rather than swapping in something that could
    // violate an allergy or celiac restriction.
    day.meals[mealIndex] = unmatchedMeal(slot, servings, diet);
    recomputeDayTotals(day);
    result.shoppingList = buildShoppingList(result.plan, pantry);
    result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
    return result;
  }

  const base = computeNutrition(servingItems(template));
  const factor = computeFactor(base, targetCal, trackCalories);
  const personItems = scaleItems(servingItems(template), factor, itemStep(template));
  const personNutrition = computeNutrition(personItems);
  const items = servings !== 1 ? scaleItems(personItems, servings, itemStep(template)) : personItems;

  day.meals[mealIndex] = {
    slot, id: template.id, name: template.name, items, instructions: template.instructions, ...(Array.isArray(template.reference) && template.reference.length ? { reference: template.reference } : {}),
    nutrition: { ...personNutrition, cost: personNutrition.cost * servings },
    servings,
    prepTime: template.prepTime, cookTime: template.cookTime,
  };
  recomputeDayTotals(day);

  result.shoppingList = buildShoppingList(result.plan, pantry);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}

// Rerolls a whole meal-prep batch — every day's occurrence of that recipe,
// not just one meal — to a different prep-friendly recipe for the same
// slot. All occurrences share one target calorie (a slot's target is the
// same every day) so the new pick is scaled once and reused everywhere,
// exactly like the initial batch pick in generatePlan.
function regeneratePrepBatch(result, batchId, settings, preferences, pantry = {}) {
  const { dailyCalories, macroSplit, vegetarianOnly, glutenFree, dairyFree } = settings;
  const trackCalories = settings.trackCalories !== false;
  const servings = settings.servings || 1;
  const effectiveMacroSplit = trackCalories ? macroSplit : null;
  const diet = { vegetarian: vegetarianOnly, glutenFree, dairyFree };
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };

  let slot = null;
  result.plan.forEach(day => {
    day.meals.forEach(m => {
      if (m.prepped && m.id === batchId) slot = m.slot;
    });
  });
  if (!slot) return result;

  const targetCal = dailyCalories * slotPct[slot];
  const prepPreferences = withPrepStyleFilter(preferences, slot);
  const template = pickTemplate(slot, [batchId], diet, false, prepPreferences, effectiveMacroSplit);
  // No other recipe for this slot satisfies the active diet restriction —
  // nothing safe to reroll to, so leave the existing prepped batch as-is
  // rather than crash or serve something that violates the restriction.
  if (!template) return result;

  const base = computeNutrition(servingItems(template));
  const factor = computeFactor(base, targetCal, trackCalories);
  const personItems = scaleItems(servingItems(template), factor, itemStep(template));
  const personNutrition = computeNutrition(personItems);
  const items = servings !== 1 ? scaleItems(personItems, servings, itemStep(template)) : personItems;

  result.plan.forEach(day => {
    day.meals.forEach((m, i) => {
      if (!m.prepped || m.id !== batchId) return;
      day.meals[i] = {
        slot, id: template.id, name: template.name, items, instructions: template.instructions, ...(Array.isArray(template.reference) && template.reference.length ? { reference: template.reference } : {}),
        nutrition: { ...personNutrition, cost: personNutrition.cost * servings },
        servings, prepTime: template.prepTime, cookTime: template.cookTime, prepped: true,
      };
    });
    recomputeDayTotals(day);
  });

  result.shoppingList = buildShoppingList(result.plan, pantry);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}

// Recomputes every non-custom meal's nutrition from its already-scaled
// items — used after a price edit so displayed costs refresh immediately
// without re-picking any meals. Custom/logged meals are skipped since
// their nutrition is user-entered, not derived from FOODS prices.
function recomputeAllCosts(result, pantry = {}) {
  result.plan.forEach(day => {
    day.meals.forEach(m => {
      if (m.custom) return;
      const n = computeNutrition(m.items);
      const servings = m.servings || 1;
      m.nutrition = { protein: n.protein / servings, carbs: n.carbs / servings, fat: n.fat / servings, cal: n.cal / servings, cost: n.cost };
    });
    recomputeDayTotals(day);
  });
  result.shoppingList = buildShoppingList(result.plan, pantry);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}

// Drops a user-entered meal (known macros, or an open "fill in later"
// placeholder — see js/app.js's customMeal shape) into one slot of an
// already-generated plan. When rebalance is true, every *other* still
// auto-picked slot in that day is re-picked so the day's calorie total
// still aims for the same target around the fixed meal — custom/pending
// meals elsewhere in the day are left untouched either way.
function applyCustomMeal(result, dayIndex, mealIndex, customMeal, settings, preferences, rebalance, pantry = {}) {
  const { dailyCalories, macroSplit, vegetarianOnly, glutenFree, dairyFree, budgetPeriod, budgetAmount } = settings;
  const trackCalories = settings.trackCalories !== false;
  const servings = settings.servings || 1;
  const effectiveMacroSplit = trackCalories ? macroSplit : null;
  const diet = { vegetarian: vegetarianOnly, glutenFree, dairyFree };
  const dailyBudget = dailyBudgetFor(budgetPeriod, budgetAmount);
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
  const snackPct = 0.10 / Math.max(1, settings.snacksPerDay);
  const weightOf = (slot) => (slot === "snack" ? snackPct : slotPct[slot]);

  const day = result.plan[dayIndex];
  day.meals[mealIndex] = customMeal;

  if (rebalance) {
    // Rebalancing re-evaluates every auto-picked meal against the CURRENT
    // diet. If no recipe fits a slot any more, the meal already sitting
    // there can't be re-picked — but it can't be kept either: it was chosen
    // under a looser diet, and leaving it would put a meal on the plan that
    // breaks the restriction (an allergen or gluten the user has since
    // ruled out). It becomes an unmatched placeholder, exactly as it would
    // at generation time. Logged meals and deliberately placed recipes are
    // the user's own choices and stay (placement is explicit, so it's the
    // user's call if a placed recipe doesn't fit the diet filter).
    day.meals.forEach((m, i) => {
      if (!m.custom && !m.placed && !m.unmatched && !hasDietMatch(m.slot, diet)) {
        day.meals[i] = unmatchedMeal(m.slot, servings, diet);
      }
    });

    // What's left is either a logged meal, an unmatched slot (0 cal), or an
    // auto-picked meal that can be re-picked. Fixed meals' calories come
    // off the day's target before the open slots split what remains.
    const canRepick = (m) => !m.custom && !m.placed && hasDietMatch(m.slot, diet);
    const spentCal = day.meals.filter(m => !canRepick(m)).reduce((s, m) => s + m.nutrition.cal, 0);
    const openSlots = day.meals.map((m, i) => ({ m, i })).filter(({ m }) => canRepick(m));
    const totalWeight = openSlots.reduce((s, { m }) => s + weightOf(m.slot), 0);
    const remainingCal = Math.max(0, dailyCalories - spentCal);
    const overBudget = day.totals ? day.totals.cost > dailyBudget : false;

    openSlots.forEach(({ m, i }) => {
      const share = totalWeight > 0 ? weightOf(m.slot) / totalWeight : 1 / openSlots.length;
      const targetCal = remainingCal * share;

      const nearbyDays = result.plan.filter((d, di) => Math.abs(di - dayIndex) <= 3 && di !== dayIndex);
      const avoidIds = nearbyDays.flatMap(d => d.meals.filter(mm => mm.slot === m.slot && !mm.custom).map(mm => mm.id));
      avoidIds.push(m.id);

      const template = pickTemplate(m.slot, avoidIds, diet, overBudget, preferences, effectiveMacroSplit);
      // canRepick already guarantees a diet match, so this can't fire today —
      // but a null here must never reach template.items, so it stays as a
      // guard against the two ever drifting apart.
      if (!template) return;
      const base = computeNutrition(servingItems(template));
      const factor = computeFactor(base, targetCal, trackCalories);
      const personItems = scaleItems(servingItems(template), factor, itemStep(template));
      const personNutrition = computeNutrition(personItems);
      const items = servings !== 1 ? scaleItems(personItems, servings, itemStep(template)) : personItems;
      day.meals[i] = {
        slot: m.slot, id: template.id, name: template.name, items, instructions: template.instructions, ...(Array.isArray(template.reference) && template.reference.length ? { reference: template.reference } : {}),
        nutrition: { ...personNutrition, cost: personNutrition.cost * servings },
        servings,
        prepTime: template.prepTime, cookTime: template.cookTime,
      };
    });
  }

  recomputeDayTotals(day);
  result.shoppingList = buildShoppingList(result.plan, pantry);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}


// Puts a specific recipe into one slot of an existing plan ("Add to Plan").
// The ONLY multiplier is requested servings / recipe yield — not calorie
// targets, not household size — so 2 servings of a 4-serving chili is
// exactly half the batch. The meal is flagged `placed` so a later rebalance
// (applyCustomMeal) treats it as fixed, like a logged meal. nutrition is
// per portion, matching every other meal (items / servings), and cost is
// the whole placed amount. The shopping list is rebuilt immediately, from
// purchasable quantities (buildShoppingList), not raw grams.
function placeRecipeInPlan(result, dayIndex, mealIndex, template, servings, pantry = {}) {
  const day = result.plan[dayIndex];
  const target = day && day.meals[mealIndex];
  if (!target) return result;
  const portions = Math.max(1, Math.round(Number(servings) || 1));
  const factor = portions / templateYield(template);
  // Exact, not rounded: rounding each placement can nudge a total over a
  // purchase-size boundary (453.6g -> 453.60001g buys an extra ounce).
  const items = template.items.map(({ food, grams }) => ({ food, grams: grams * factor }));
  const n = computeNutrition(items);
  day.meals[mealIndex] = {
    slot: target.slot, id: template.id, name: template.name, items, instructions: template.instructions, ...(Array.isArray(template.reference) && template.reference.length ? { reference: template.reference } : {}),
    nutrition: { cal: n.cal / portions, protein: n.protein / portions, carbs: n.carbs / portions, fat: n.fat / portions, cost: n.cost },
    servings: portions,
    prepTime: template.prepTime, cookTime: template.cookTime,
    placed: true,
  };
  recomputeDayTotals(day);
  result.shoppingList = buildShoppingList(result.plan, pantry);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}

// ---- What can I make? ------------------------------------------------------
// Float dust only (see ceilQtyExact in js/foods.js): any real shortfall counts.
const PANTRY_EPSILON = 1e-7;

// {food: grams} for a recipe cooked for `servings`, with repeated ingredient
// rows combined. Same factor placeRecipeInPlan uses, so what's checked is
// exactly what Add to Plan would put in the plan.
function recipeNeeds(template, servings) {
  const portions = Math.max(1, Math.round(Number(servings) || 1));
  const factor = portions / templateYield(template);
  const needs = {};
  for (const { food, grams } of template.items) needs[food] = (needs[food] || 0) + grams * factor;
  return needs;
}

// Can this recipe be cooked from the pantry, and what would it add to the
// shopping basket? `target` ({dayIndex, mealIndex}) is the slot it would
// replace: that slot's own ingredients are released first, so its pantry
// reservation is free to use. Every OTHER planned meal keeps its claim on
// the pantry — the pantry is one pool and the plan's meals draw from it, so
// the same groceries are never promised twice. With no target, the recipe is
// an extra meal on top of the whole plan. The pantry itself is never changed.
//   status: "ready" (nothing short), "near" (1–2 ingredients short), "far".
//   extraCost: whole-basket change, priced in purchasable quantities
//   (negative when the replacement is cheaper than what it displaces).
function evaluateRecipe(template, servings, plan, target, pantry = {}) {
  const needs = recipeNeeds(template, servings);
  const rows = plan || [];
  const current = planNeeds(rows);
  const others = target ? planNeeds(rows, target) : current;
  const after = { ...others };
  for (const [food, g] of Object.entries(needs)) after[food] = (after[food] || 0) + g;

  const linesOf = (n) => Object.fromEntries(shoppingLinesFromNeeds(n, pantry).map(l => [l.food, l]));
  const beforeLines = linesOf(current), afterLines = linesOf(after);
  const total = (lines) => Object.values(lines).reduce((s, l) => s + l.cost, 0);

  const short = [];
  for (const [food, need] of Object.entries(needs)) {
    const have = Math.max(0, pantry[food] || 0);
    const reserved = Math.min(have, others[food] || 0);
    const available = have - reserved;
    const shortGrams = need - available;
    if (shortGrams <= PANTRY_EPSILON) continue;
    short.push({
      food, name: FOODS[food].name, needGrams: need, haveGrams: have, reservedGrams: reserved,
      availableGrams: available, shortGrams,
      // The shopping list's own line for this food before and after: grams
      // still to buy once the pantry is used. The quantity shown to the user
      // and the price beside it both come from these, so they can't disagree.
      buyBeforeGrams: beforeLines[food] ? beforeLines[food].grams : 0,
      buyAfterGrams: afterLines[food] ? afterLines[food].grams : 0,
      cost: (afterLines[food] ? afterLines[food].cost : 0) - (beforeLines[food] ? beforeLines[food].cost : 0),
    });
  }
  short.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
  const basketBefore = total(beforeLines), basketAfter = total(afterLines);
  return {
    template, servings: Math.max(1, Math.round(Number(servings) || 1)),
    status: short.length === 0 ? "ready" : short.length <= 2 ? "near" : "far",
    short, missingCount: short.length,
    basketBefore, basketAfter, extraCost: basketAfter - basketBefore,
  };
}

// Every cookable recipe for one meal type, best first: Ready to cook, then
// missing one ingredient, then two; ties by whole-basket cost, then name.
// Personal recipes count whether or not "Include in automatic plans" is on
// (this is a manual recommendation); drafts and anything without ingredients
// never do. Recipes the user marked "not for me" are left out.
function findCookableRecipes({ slot, servings, plan, target, pantry, diet, dislikedIds, templates = MEAL_TEMPLATES }) {
  const out = [];
  for (const t of templates) {
    if (t.slot !== slot || t.draft || !Array.isArray(t.items) || t.items.length === 0) continue;
    if (dislikedIds && dislikedIds.has(t.id)) continue;
    if (!matchesDiet(t.items, diet)) continue;
    const r = evaluateRecipe(t, servings, plan, target, pantry);
    if (r.status !== "far") out.push(r);
  }
  const rank = { ready: 0, near: 1 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || a.missingCount - b.missingCount
    || a.extraCost - b.extraCost || a.template.name.localeCompare(b.template.name));
  return out;
}
