// Scale a template's item list by a factor, rounding grams to the nearest 5g.
function scaleItems(items, factor) {
  return items.map(({ food, grams }) => ({ food, grams: Math.max(5, Math.round((grams * factor) / 5) * 5) }));
}

function dailyBudgetFor(period, amount) {
  if (period === "weekly") return amount / 7;
  if (period === "monthly") return amount / 30;
  return amount; // daily
}

// Pick a template for a slot, preferring variety (avoid recent repeats) and
// favoring cheaper options when the day is already tracking over budget.
function pickTemplate(slot, recentIds, vegetarianOnly, overBudget) {
  let pool = MEAL_TEMPLATES.filter(t => t.slot === slot);
  if (vegetarianOnly) pool = pool.filter(t => isVegetarian(t.items));
  let fresh = pool.filter(t => !recentIds.includes(t.id));
  if (fresh.length === 0) fresh = pool; // all recently used, allow repeats

  // Rank by base cost; when over budget, bias toward the cheaper half.
  const withCost = fresh.map(t => ({ t, cost: computeNutrition(t.items).cost }));
  withCost.sort((a, b) => a.cost - b.cost);
  const candidates = overBudget ? withCost.slice(0, Math.max(1, Math.ceil(withCost.length / 2))) : withCost;
  const choice = candidates[Math.floor(Math.random() * candidates.length)];
  return choice.t;
}

// Build a full multi-day plan.
function generatePlan(settings) {
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
      const template = pickTemplate(slot, recent[slot], vegetarianOnly, overBudgetSoFar);

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
    summary: { totalCost, totalBudget, dailyBudget, dailyCalories, macroSplit, days },
  };
}
