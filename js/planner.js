// Scale a template's item list by a factor, rounding grams to the nearest 5g.
function scaleItems(items, factor) {
  return items.map(({ food, grams }) => ({ food, grams: Math.max(5, Math.round((grams * factor) / 5) * 5) }));
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
  const n = computeNutrition(template.items);
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
function pickTemplate(slot, recentIds, vegetarianOnly, overBudget, preferences, macroSplit) {
  let pool = MEAL_TEMPLATES.filter(t => t.slot === slot);
  if (vegetarianOnly) pool = pool.filter(t => isVegetarian(t.items));
  let fresh = pool.filter(t => !recentIds.includes(t.id));
  if (fresh.length === 0) fresh = pool; // all recently used, allow repeats

  // Rank by base cost; when over budget, bias toward the cheaper half.
  const withCost = fresh.map(t => ({ t, cost: computeNutrition(t.items).cost }));
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
// to that slot's target calories with the same bounds generatePlan() uses.
// Used to warn upfront when a budget can't realistically be met.
function estimateMinDailyCost(dailyCalories, snacksPerDay, vegetarianOnly) {
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
  const snackPct = 0.10 / Math.max(1, snacksPerDay);
  const slots = ["breakfast", "lunch", "dinner", ...Array(snacksPerDay).fill("snack")];

  let total = 0;
  for (const slot of slots) {
    let pool = MEAL_TEMPLATES.filter(t => t.slot === slot);
    if (vegetarianOnly) pool = pool.filter(t => isVegetarian(t.items));
    const pct = slot === "snack" ? snackPct : slotPct[slot];
    const targetCal = dailyCalories * pct;

    let cheapest = Infinity;
    for (const t of pool) {
      const base = computeNutrition(t.items);
      let factor = base.cal > 0 ? targetCal / base.cal : 1;
      factor = Math.min(1.4, Math.max(0.7, factor));
      cheapest = Math.min(cheapest, base.cost * factor);
    }
    total += cheapest === Infinity ? 0 : cheapest;
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
// single-meal swap, so the two never drift.
function buildShoppingList(plan) {
  const shoppingMap = {};
  for (const day of plan) {
    for (const meal of day.meals) {
      for (const { food, grams } of meal.items) {
        shoppingMap[food] = (shoppingMap[food] || 0) + grams;
      }
    }
  }
  return Object.entries(shoppingMap).map(([food, grams]) => ({
    food, name: FOODS[food].name, grams, cost: (FOODS[food].price * grams) / 100,
  })).sort((a, b) => b.cost - a.cost);
}

// Picks `count` distinct templates for a slot up front — used by meal prep
// mode to fix a small rotating set for the whole week instead of a fresh
// pick per day. Reuses pickTemplate's full weighting (macro-fit,
// preferences, budget); each pick feeds the next call's avoid-list so the
// pool members are distinct, the same trick the day loop already uses.
function selectPrepPool(slot, count, vegetarianOnly, preferences, macroSplit) {
  const pool = [];
  const usedIds = [];
  for (let i = 0; i < count; i++) {
    const template = pickTemplate(slot, usedIds, vegetarianOnly, false, preferences, macroSplit);
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
        groups[m.id] = { id: m.id, name: m.name, slot: m.slot, instructions: m.instructions, occurrences: 0, itemTotals: {}, cost: 0 };
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
      id: g.id, name: g.name, slot: g.slot, instructions: g.instructions, occurrences: g.occurrences, cost: g.cost,
      items: Object.entries(g.itemTotals).map(([food, grams]) => ({ food, grams })),
    }));
}

// Build a full multi-day plan. preferences (see foods.js/meals.js tags) is
// optional — omitting it reproduces the original untargeted behavior.
// settings.mealPrep ({breakfast, lunch, dinner}, each a 0-7 count) fixes
// one recipe per named slot for that many occurrences — "prep lunch 4
// times" cooks one lunch recipe once and reuses it for the first 4 days;
// the remaining days (and any slot left at 0) pick fresh as usual.
function generatePlan(settings, preferences) {
  const {
    days, dailyCalories, macroSplit, budgetPeriod, budgetAmount,
    snacksPerDay, vegetarianOnly, mealPrep,
  } = settings;

  const dailyBudget = dailyBudgetFor(budgetPeriod, budgetAmount);
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
  const snackPct = 0.10 / Math.max(1, snacksPerDay);

  const recent = { breakfast: [], lunch: [], dinner: [], snack: [] };
  const prepRemaining = {};
  ["breakfast", "lunch", "dinner"].forEach(slot => {
    const count = Math.min(days, Math.max(0, (mealPrep && mealPrep[slot]) || 0));
    if (count > 0) {
      const [template] = selectPrepPool(slot, 1, vegetarianOnly, preferences, macroSplit);
      prepRemaining[slot] = { template, remaining: count };
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
        template = pickTemplate(slot, recent[slot], vegetarianOnly, overBudgetSoFar, preferences, macroSplit);
      }

      const base = computeNutrition(template.items);
      let factor = base.cal > 0 ? targetCal / base.cal : 1;
      factor = Math.min(1.4, Math.max(0.7, factor));
      const items = scaleItems(template.items, factor);
      const nutrition = computeNutrition(items);

      dayMeals.push({
        slot, id: template.id, name: template.name, items, instructions: template.instructions, nutrition,
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

  const shoppingList = buildShoppingList(plan);
  const totalCost = shoppingList.reduce((s, i) => s + i.cost, 0);
  const totalBudget = dailyBudget * days;

  return {
    plan, shoppingList,
    summary: {
      totalCost, totalBudget, dailyBudget, dailyCalories, macroSplit, days, snacksPerDay, vegetarianOnly,
      mealPrep: mealPrep || { breakfast: 0, lunch: 0, dinner: 0 },
      mealPrepEnabled: Object.keys(prepRemaining).length > 0,
    },
  };
}

// Rerolls exactly one meal in an already-generated plan (mutates `result` in
// place). Reuses the same per-slot target-calorie math and pickTemplate()
// used during initial generation, so preference weighting, dislikes, and
// budget-awareness all apply identically to a manual swap.
function regenerateMeal(result, dayIndex, mealIndex, settings, preferences) {
  const { dailyCalories, macroSplit, snacksPerDay, vegetarianOnly, budgetPeriod, budgetAmount } = settings;
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
  const template = pickTemplate(slot, avoidIds, vegetarianOnly, overBudget, preferences, macroSplit);

  const base = computeNutrition(template.items);
  let factor = base.cal > 0 ? targetCal / base.cal : 1;
  factor = Math.min(1.4, Math.max(0.7, factor));
  const items = scaleItems(template.items, factor);
  const nutrition = computeNutrition(items);

  day.meals[mealIndex] = {
    slot, id: template.id, name: template.name, items, instructions: template.instructions, nutrition,
    prepTime: template.prepTime, cookTime: template.cookTime,
  };
  recomputeDayTotals(day);

  result.shoppingList = buildShoppingList(result.plan);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}

// Recomputes every non-custom meal's nutrition from its already-scaled
// items — used after a price edit so displayed costs refresh immediately
// without re-picking any meals. Custom/logged meals are skipped since
// their nutrition is user-entered, not derived from FOODS prices.
function recomputeAllCosts(result) {
  result.plan.forEach(day => {
    day.meals.forEach(m => {
      if (m.custom) return;
      m.nutrition = computeNutrition(m.items);
    });
    recomputeDayTotals(day);
  });
  result.shoppingList = buildShoppingList(result.plan);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}

// Drops a user-entered meal (known macros, or an open "fill in later"
// placeholder — see js/app.js's customMeal shape) into one slot of an
// already-generated plan. When rebalance is true, every *other* still
// auto-picked slot in that day is re-picked so the day's calorie total
// still aims for the same target around the fixed meal — custom/pending
// meals elsewhere in the day are left untouched either way.
function applyCustomMeal(result, dayIndex, mealIndex, customMeal, settings, preferences, rebalance) {
  const { dailyCalories, macroSplit, vegetarianOnly, budgetPeriod, budgetAmount } = settings;
  const dailyBudget = dailyBudgetFor(budgetPeriod, budgetAmount);
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
  const snackPct = 0.10 / Math.max(1, settings.snacksPerDay);
  const weightOf = (slot) => (slot === "snack" ? snackPct : slotPct[slot]);

  const day = result.plan[dayIndex];
  day.meals[mealIndex] = customMeal;

  if (rebalance) {
    const spentCal = day.meals.filter(m => m.custom).reduce((s, m) => s + m.nutrition.cal, 0);
    const openSlots = day.meals.map((m, i) => ({ m, i })).filter(({ m }) => !m.custom);
    const totalWeight = openSlots.reduce((s, { m }) => s + weightOf(m.slot), 0);
    const remainingCal = Math.max(0, dailyCalories - spentCal);
    const overBudget = day.totals ? day.totals.cost > dailyBudget : false;

    openSlots.forEach(({ m, i }) => {
      const share = totalWeight > 0 ? weightOf(m.slot) / totalWeight : 1 / openSlots.length;
      const targetCal = remainingCal * share;

      const nearbyDays = result.plan.filter((d, di) => Math.abs(di - dayIndex) <= 3 && di !== dayIndex);
      const avoidIds = nearbyDays.flatMap(d => d.meals.filter(mm => mm.slot === m.slot && !mm.custom).map(mm => mm.id));
      avoidIds.push(m.id);

      const template = pickTemplate(m.slot, avoidIds, vegetarianOnly, overBudget, preferences, macroSplit);
      const base = computeNutrition(template.items);
      let factor = base.cal > 0 ? targetCal / base.cal : 1;
      factor = Math.min(1.4, Math.max(0.7, factor));
      const items = scaleItems(template.items, factor);
      const nutrition = computeNutrition(items);
      day.meals[i] = {
        slot: m.slot, id: template.id, name: template.name, items, instructions: template.instructions, nutrition,
        prepTime: template.prepTime, cookTime: template.cookTime,
      };
    });
  }

  recomputeDayTotals(day);
  result.shoppingList = buildShoppingList(result.plan);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}
