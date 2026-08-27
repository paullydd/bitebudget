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
    let dayCal = 0, dayProtein = 0, dayCarbs = 0, dayFat = 0, dayCost = 0;
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
        slot, name: template.name, items, instructions: template.instructions, nutrition,
      });

      recent[slot].push(template.id);
      if (recent[slot].length > 3) recent[slot].shift();

      dayCal += nutrition.cal;
      dayProtein += nutrition.protein;
      dayCarbs += nutrition.carbs;
      dayFat += nutrition.fat;
      dayCost += nutrition.cost;
    }

    runningCost += dayCost;
    plan.push({
      day: d + 1,
      meals: dayMeals,
      totals: { cal: dayCal, protein: dayProtein, carbs: dayCarbs, fat: dayFat, cost: dayCost },
    });
  }

  // Aggregate shopping list across the whole plan.
  const shoppingMap = {};
  for (const day of plan) {
    for (const meal of day.meals) {
      for (const { food, grams } of meal.items) {
        shoppingMap[food] = (shoppingMap[food] || 0) + grams;
      }
    }
  }
  const shoppingList = Object.entries(shoppingMap).map(([food, grams]) => ({
    food, name: FOODS[food].name, grams, cost: (FOODS[food].price * grams) / 100,
  })).sort((a, b) => b.cost - a.cost);

  const totalCost = shoppingList.reduce((s, i) => s + i.cost, 0);
  const totalBudget = dailyBudget * days;

  return {
    plan, shoppingList,
    summary: { totalCost, totalBudget, dailyBudget, dailyCalories, macroSplit, days, snacksPerDay, vegetarianOnly },
  };
}
