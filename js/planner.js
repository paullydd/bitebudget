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
  if (preferences.mealStyle && preferences.mealStyle[slot] && preferences.mealStyle[slot] === template.style) {
    weight += 2;
  }
  if (preferences.signature && preferences.signature.slot === slot && preferences.signature.preset) {
    const groups = SIGNATURE_PRESETS[preferences.signature.preset] || [];
    if (groups.length && groups.every(group => group.some(f => families.includes(f)))) {
      weight += 4;
    }
  }
  if (preferences.dislikedProteins && preferences.dislikedProteins.some(p => families.includes(p))) {
    // Strong bias, not a hard ban: outweighs the bonuses above (max +8) so a
    // disliked template drops to rare, but a floor keeps it possible so a
    // slot's pool never effectively empties out from dislikes alone.
    weight = Math.max(0.15, weight - 4);
  }
  return weight;
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

// Pick a template for a slot: filters for variety (avoid recent repeats) and
// budget (bias toward the cheaper half when over), then weights the remaining
// candidates by how well they match stated taste preferences.
function pickTemplate(slot, recentIds, vegetarianOnly, overBudget, preferences) {
  let pool = MEAL_TEMPLATES.filter(t => t.slot === slot);
  if (vegetarianOnly) pool = pool.filter(t => isVegetarian(t.items));
  let fresh = pool.filter(t => !recentIds.includes(t.id));
  if (fresh.length === 0) fresh = pool; // all recently used, allow repeats

  // Rank by base cost; when over budget, bias toward the cheaper half.
  const withCost = fresh.map(t => ({ t, cost: computeNutrition(t.items).cost }));
  withCost.sort((a, b) => a.cost - b.cost);
  const candidates = overBudget ? withCost.slice(0, Math.max(1, Math.ceil(withCost.length / 2))) : withCost;

  const templates = candidates.map(c => c.t);
  const weights = templates.map(t => preferenceWeight(t, slot, preferences));
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

// Build a full multi-day plan. preferences (see foods.js/meals.js tags) is
// optional — omitting it reproduces the original untargeted behavior.
function generatePlan(settings, preferences) {
  const {
    days, dailyCalories, macroSplit, budgetPeriod, budgetAmount,
    snacksPerDay, vegetarianOnly,
  } = settings;

  const dailyBudget = dailyBudgetFor(budgetPeriod, budgetAmount);
  const slotPct = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
  const snackPct = 0.10 / Math.max(1, snacksPerDay);

  const recent = { breakfast: [], lunch: [], dinner: [], snack: [] };
  const plan = [];
  let runningCost = 0;

  for (let d = 0; d < days; d++) {
    const dayMeals = [];
    const overBudgetSoFar = runningCost > dailyBudget * d;

    const slotsToday = ["breakfast", "lunch", "dinner", ...Array(snacksPerDay).fill("snack")];
    for (const slot of slotsToday) {
      const pct = slot === "snack" ? snackPct : slotPct[slot];
      const targetCal = dailyCalories * pct;
      const template = pickTemplate(slot, recent[slot], vegetarianOnly, overBudgetSoFar, preferences);

      const base = computeNutrition(template.items);
      let factor = base.cal > 0 ? targetCal / base.cal : 1;
      factor = Math.min(1.4, Math.max(0.7, factor));
      const items = scaleItems(template.items, factor);
      const nutrition = computeNutrition(items);

      dayMeals.push({
        slot, id: template.id, name: template.name, items, instructions: template.instructions, nutrition,
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
    summary: { totalCost, totalBudget, dailyBudget, dailyCalories, macroSplit, days, snacksPerDay, vegetarianOnly },
  };
}

// Rerolls exactly one meal in an already-generated plan (mutates `result` in
// place). Reuses the same per-slot target-calorie math and pickTemplate()
// used during initial generation, so preference weighting, dislikes, and
// budget-awareness all apply identically to a manual swap.
function regenerateMeal(result, dayIndex, mealIndex, settings, preferences) {
  const { dailyCalories, snacksPerDay, vegetarianOnly, budgetPeriod, budgetAmount } = settings;
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
  const template = pickTemplate(slot, avoidIds, vegetarianOnly, overBudget, preferences);

  const base = computeNutrition(template.items);
  let factor = base.cal > 0 ? targetCal / base.cal : 1;
  factor = Math.min(1.4, Math.max(0.7, factor));
  const items = scaleItems(template.items, factor);
  const nutrition = computeNutrition(items);

  day.meals[mealIndex] = { slot, id: template.id, name: template.name, items, instructions: template.instructions, nutrition };
  recomputeDayTotals(day);

  result.shoppingList = buildShoppingList(result.plan);
  result.summary.totalCost = result.shoppingList.reduce((s, i) => s + i.cost, 0);
  return result;
}
