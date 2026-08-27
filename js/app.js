const STORAGE_KEY = "mealBudgetPlanner.settings.v1";
const PLAN_KEY = "mealBudgetPlanner.plan.v1";

const $ = (sel) => document.querySelector(sel);

function readSettings() {
  return {
    days: Number($("#days").value),
    dailyCalories: Number($("#calories").value),
    macroSplit: {
      protein: Number($("#macroProtein").value),
      carbs: Number($("#macroCarbs").value),
      fat: Number($("#macroFat").value),
    },
    budgetPeriod: $("#budgetPeriod").value,
    budgetAmount: Number($("#budgetAmount").value),
    snacksPerDay: Number($("#snacks").value),
    vegetarianOnly: $("#vegetarian").checked,
  };
}

function writeSettingsToForm(s) {
  $("#days").value = s.days;
  $("#calories").value = s.dailyCalories;
  $("#macroProtein").value = s.macroSplit.protein;
  $("#macroCarbs").value = s.macroSplit.carbs;
  $("#macroFat").value = s.macroSplit.fat;
  $("#budgetPeriod").value = s.budgetPeriod;
  $("#budgetAmount").value = s.budgetAmount;
  $("#snacks").value = s.snacksPerDay;
  $("#vegetarian").checked = s.vegetarianOnly;
}

function macroTargetGrams(dailyCalories, split) {
  // protein/carbs = 4 cal/g, fat = 9 cal/g
  return {
    protein: (dailyCalories * (split.protein / 100)) / 4,
    carbs: (dailyCalories * (split.carbs / 100)) / 4,
    fat: (dailyCalories * (split.fat / 100)) / 9,
  };
}

const money = (n) => `$${n.toFixed(2)}`;
const grams = (n) => `${Math.round(n)}g`;

function slotIcon(slot) {
  return { breakfast: "🌅", lunch: "🥗", dinner: "🍽️", snack: "🍎" }[slot] || "🍴";
}

function renderMealCard(meal) {
  const n = meal.nutrition;
  const items = meal.items.map(i => `<li>${FOODS[i.food].name} — ${grams(i.grams)}</li>`).join("");
  const steps = meal.instructions.map(s => `<li>${s}</li>`).join("");
  return `
    <div class="meal-card">
      <div class="meal-head">
        <span class="meal-icon">${slotIcon(meal.slot)}</span>
        <div>
          <div class="meal-slot">${meal.slot}</div>
          <div class="meal-name">${meal.name}</div>
        </div>
        <div class="meal-cost">${money(n.cost)}</div>
      </div>
      <div class="meal-macros">
        <span>${Math.round(n.cal)} kcal</span>
        <span>P ${grams(n.protein)}</span>
        <span>C ${grams(n.carbs)}</span>
        <span>F ${grams(n.fat)}</span>
      </div>
      <details>
        <summary>Ingredients &amp; instructions</summary>
        <div class="meal-detail">
          <div>
            <strong>Ingredients</strong>
            <ul>${items}</ul>
          </div>
          <div>
            <strong>Instructions</strong>
            <ol>${steps}</ol>
          </div>
        </div>
      </details>
    </div>`;
}

function renderDayTab(day, dailyBudget, dailyCalories) {
  const t = day.totals;
  const overBudget = t.cost > dailyBudget * 1.05;
  const budgetClass = overBudget ? "bad" : "good";
  const calDiff = t.cal - dailyCalories;
  return `
    <div class="day-summary">
      <div class="day-summary-item">
        <div class="label">Calories</div>
        <div class="value">${Math.round(t.cal)} <span class="muted">/ ${dailyCalories} target (${calDiff >= 0 ? "+" : ""}${Math.round(calDiff)})</span></div>
      </div>
      <div class="day-summary-item">
        <div class="label">Macros (P/C/F)</div>
        <div class="value">${grams(t.protein)} / ${grams(t.carbs)} / ${grams(t.fat)}</div>
      </div>
      <div class="day-summary-item ${budgetClass}">
        <div class="label">Cost vs Budget</div>
        <div class="value">${money(t.cost)} <span class="muted">/ ${money(dailyBudget)}</span></div>
      </div>
    </div>
    <div class="meal-grid">
      ${day.meals.map(renderMealCard).join("")}
    </div>`;
}

function renderShoppingList(shoppingList, totalCost, totalBudget) {
  const rows = shoppingList.map(i => `
    <tr>
      <td>${i.name}</td>
      <td>${grams(i.grams)}</td>
      <td>${money(i.cost)}</td>
    </tr>`).join("");
  const overBudget = totalCost > totalBudget * 1.02;
  return `
    <table class="shopping-table">
      <thead><tr><th>Item</th><th>Total Qty</th><th>Est. Cost</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td><strong>Total</strong></td>
          <td></td>
          <td class="${overBudget ? "bad" : "good"}"><strong>${money(totalCost)}</strong> / ${money(totalBudget)}</td>
        </tr>
      </tfoot>
    </table>`;
}

function renderPlan(result) {
  const { plan, shoppingList, summary } = result;
  const targets = macroTargetGrams(summary.dailyCalories, summary.macroSplit);

  $("#planMeta").innerHTML = `
    <div class="meta-item"><div class="label">Plan length</div><div class="value">${summary.days} days</div></div>
    <div class="meta-item"><div class="label">Daily calorie target</div><div class="value">${summary.dailyCalories} kcal</div></div>
    <div class="meta-item"><div class="label">Macro targets / day</div><div class="value">P ${grams(targets.protein)} · C ${grams(targets.carbs)} · F ${grams(targets.fat)}</div></div>
    <div class="meta-item ${summary.totalCost > summary.totalBudget * 1.02 ? "bad" : "good"}">
      <div class="label">Estimated total cost</div>
      <div class="value">${money(summary.totalCost)} <span class="muted">/ ${money(summary.totalBudget)} budget</span></div>
    </div>`;

  const tabs = plan.map(d => `<button class="day-tab" data-day="${d.day}">Day ${d.day}</button>`).join("");
  $("#dayTabs").innerHTML = tabs;

  const dayViews = plan.map(d => `<div class="day-view" data-day="${d.day}">${renderDayTab(d, summary.dailyBudget, summary.dailyCalories)}</div>`).join("");
  $("#dayViews").innerHTML = dayViews;

  $("#shoppingList").innerHTML = renderShoppingList(shoppingList, summary.totalCost, summary.totalBudget);

  activateDay(1);
  $("#results").classList.remove("hidden");
}

function activateDay(dayNum) {
  document.querySelectorAll(".day-tab").forEach(b => b.classList.toggle("active", Number(b.dataset.day) === dayNum));
  document.querySelectorAll(".day-view").forEach(v => v.classList.toggle("active", Number(v.dataset.day) === dayNum));
}

function init() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) writeSettingsToForm(JSON.parse(saved));

  const savedPlan = localStorage.getItem(PLAN_KEY);
  if (savedPlan) renderPlan(JSON.parse(savedPlan));

  $("#planForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const settings = readSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    const result = generatePlan(settings);
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
    $("#results").scrollIntoView({ behavior: "smooth" });
  });

  $("#regenerateBtn").addEventListener("click", () => {
    const settings = readSettings();
    const result = generatePlan(settings);
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
  });

  $("#dayTabs").addEventListener("click", (e) => {
    if (e.target.matches(".day-tab")) activateDay(Number(e.target.dataset.day));
  });
}

document.addEventListener("DOMContentLoaded", init);
