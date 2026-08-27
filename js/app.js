const STORAGE_KEY = "biteBudget.settings.v1";
const PLAN_KEY = "biteBudget.plan.v1";
const FONT_SCALE_KEY = "biteBudget.fontScale.v1";
const FONT_SCALES = [90, 100, 112, 125, 140];
const PREFS_KEY = "biteBudget.preferences.v1";
const ONBOARDED_KEY = "biteBudget.onboarded.v1";
const WIZARD_TOTAL_STEPS = 3;
const STYLE_GROUP_IDS = { breakfast: "styleBreakfast", lunch: "styleLunch", dinner: "styleDinner" };

const $ = (sel) => document.querySelector(sel);

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function applyFontScale(pct) {
  document.documentElement.style.fontSize = pct + "%";
  $("#textSizeLabel").textContent = pct + "%";
  localStorage.setItem(FONT_SCALE_KEY, String(pct));
}

function initFontScale() {
  const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
  let index = FONT_SCALES.indexOf(saved);
  if (index === -1) index = FONT_SCALES.indexOf(100);
  applyFontScale(FONT_SCALES[index]);

  $("#textSizeDown").addEventListener("click", () => {
    index = Math.max(0, index - 1);
    applyFontScale(FONT_SCALES[index]);
  });
  $("#textSizeUp").addEventListener("click", () => {
    index = Math.min(FONT_SCALES.length - 1, index + 1);
    applyFontScale(FONT_SCALES[index]);
  });
}

// Keeps protein/carbs/fat locked to a 100% total. Protein is the anchor field
// (styled gray in the UI) — editing it redistributes carbs/fat proportionally
// to fill the remainder. Editing carbs or fat keeps protein fixed and solves
// the third field so the three always sum to exactly 100.
function balanceMacros(changed) {
  let p = clamp(Math.round(Number($("#macroProtein").value) || 0), 0, 100);
  let c = Math.round(Number($("#macroCarbs").value) || 0);
  let f = Math.round(Number($("#macroFat").value) || 0);

  if (changed === "protein") {
    const remaining = 100 - p;
    const curSum = c + f;
    if (curSum <= 0) {
      c = Math.round(remaining / 2);
      f = remaining - c;
    } else {
      c = Math.round((remaining * c) / curSum);
      f = remaining - c;
    }
  } else if (changed === "carbs") {
    c = clamp(c, 0, 100 - p);
    f = 100 - p - c;
  } else if (changed === "fat") {
    f = clamp(f, 0, 100 - p);
    c = 100 - p - f;
  }

  $("#macroProtein").value = p;
  $("#macroCarbs").value = c;
  $("#macroFat").value = f;
}

let wizardStep = 1;

function wireBubbleGroup(container, multi) {
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".bubble");
    if (!btn) return;
    if (multi) {
      btn.classList.toggle("selected");
    } else {
      [...container.querySelectorAll(".bubble")].forEach(b => b.classList.toggle("selected", b === btn));
    }
  });
}

function goToWizardStep(n) {
  wizardStep = n;
  document.querySelectorAll(".wizard-step").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.step) === n);
  });
  $("#wizardProgress").textContent = `Step ${n} of ${WIZARD_TOTAL_STEPS}`;
  $("#wizardBack").classList.toggle("hidden", n === 1);
  $("#wizardNext").textContent = n === WIZARD_TOTAL_STEPS ? "Finish" : "Next";
}

function showOnboarding() {
  goToWizardStep(1);
  $("#onboarding").classList.remove("hidden");
  $("#settingsPanel").classList.add("hidden");
}

function hideOnboarding() {
  $("#onboarding").classList.add("hidden");
  $("#settingsPanel").classList.remove("hidden");
}

function clearBubbleSelections() {
  document.querySelectorAll(".bubble.selected").forEach(b => b.classList.remove("selected"));
}

function prefillOnboarding(prefs) {
  clearBubbleSelections();
  $("#signatureNote").value = "";
  if (!prefs) return;

  (prefs.proteins || []).forEach(v => {
    const b = document.querySelector(`#proteinBubbles .bubble[data-value="${v}"]`);
    if (b) b.classList.add("selected");
  });
  Object.entries(prefs.mealStyle || {}).forEach(([slot, val]) => {
    const groupId = STYLE_GROUP_IDS[slot];
    const b = groupId && document.querySelector(`#${groupId} .bubble[data-value="${val}"]`);
    if (b) b.classList.add("selected");
  });
  if (prefs.signature) {
    if (prefs.signature.slot) {
      const b = document.querySelector(`#signatureSlot .bubble[data-value="${prefs.signature.slot}"]`);
      if (b) b.classList.add("selected");
    }
    if (prefs.signature.preset) {
      const b = document.querySelector(`#signaturePreset .bubble[data-value="${prefs.signature.preset}"]`);
      if (b) b.classList.add("selected");
    }
    $("#signatureNote").value = prefs.signature.note || "";
  }
}

function collectPreferences() {
  const proteins = [...document.querySelectorAll("#proteinBubbles .bubble.selected")].map(b => b.dataset.value);

  const mealStyle = {};
  Object.entries(STYLE_GROUP_IDS).forEach(([slot, groupId]) => {
    const sel = document.querySelector(`#${groupId} .bubble.selected`);
    if (sel && sel.dataset.value !== "no_preference") mealStyle[slot] = sel.dataset.value;
  });

  const sigSlotBtn = document.querySelector("#signatureSlot .bubble.selected");
  const sigPresetBtn = document.querySelector("#signaturePreset .bubble.selected");
  const note = $("#signatureNote").value.trim();
  let signature;
  if (sigSlotBtn || sigPresetBtn || note) {
    signature = {
      slot: sigSlotBtn ? sigSlotBtn.dataset.value : null,
      preset: sigPresetBtn ? sigPresetBtn.dataset.value : null,
      note,
    };
  }

  return {
    proteins: proteins.length ? proteins : undefined,
    mealStyle: Object.keys(mealStyle).length ? mealStyle : undefined,
    signature,
  };
}

function finishOnboarding() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(collectPreferences()));
  localStorage.setItem(ONBOARDED_KEY, "1");
  hideOnboarding();
}

function loadPreferences() {
  const saved = localStorage.getItem(PREFS_KEY);
  return saved ? JSON.parse(saved) : undefined;
}

function initOnboarding() {
  wireBubbleGroup($("#proteinBubbles"), true);
  Object.values(STYLE_GROUP_IDS).forEach(id => wireBubbleGroup($(`#${id}`), false));
  wireBubbleGroup($("#signatureSlot"), false);
  wireBubbleGroup($("#signaturePreset"), false);

  $("#wizardNext").addEventListener("click", () => {
    if (wizardStep < WIZARD_TOTAL_STEPS) goToWizardStep(wizardStep + 1);
    else finishOnboarding();
  });
  $("#wizardBack").addEventListener("click", () => {
    if (wizardStep > 1) goToWizardStep(wizardStep - 1);
  });
  $("#wizardSkip").addEventListener("click", () => {
    localStorage.setItem(ONBOARDED_KEY, "1");
    hideOnboarding();
  });
  $("#preferencesBtn").addEventListener("click", () => {
    prefillOnboarding(loadPreferences());
    showOnboarding();
  });

  if (localStorage.getItem(ONBOARDED_KEY)) hideOnboarding();
  else showOnboarding();
}

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

function checkBudgetFeasibility() {
  const dailyCalories = Number($("#calories").value) || 0;
  const snacksPerDay = Number($("#snacks").value) || 1;
  const vegetarianOnly = $("#vegetarian").checked;
  const dailyBudget = dailyBudgetFor($("#budgetPeriod").value, Number($("#budgetAmount").value) || 0);
  const minDailyCost = estimateMinDailyCost(dailyCalories, snacksPerDay, vegetarianOnly);

  const banner = $("#budgetWarning");
  if (dailyBudget < minDailyCost) {
    banner.innerHTML = `⚠️ ${money(dailyBudget)}/day may not cover even the cheapest meals at this calorie target (~${money(minDailyCost)}/day minimum). Try raising your budget, lowering calories, or turning on Vegetarian only.`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

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

function renderDayTab(day, dailyBudget, dailyCalories, minDailyCost) {
  const t = day.totals;
  const overBudget = t.cost > dailyBudget * 1.05;
  const budgetClass = overBudget ? "bad" : "good";
  const calDiff = t.cal - dailyCalories;
  const suggestion = overBudget && dailyBudget < minDailyCost
    ? `<div class="budget-suggestion">Try raising your budget to ~${money(minDailyCost)}/day or turning on Vegetarian only.</div>`
    : "";
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
        ${suggestion}
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
  const minDailyCost = estimateMinDailyCost(summary.dailyCalories, summary.snacksPerDay, summary.vegetarianOnly);
  const totalOverBudget = summary.totalCost > summary.totalBudget * 1.02;
  const totalSuggestion = totalOverBudget && summary.dailyBudget < minDailyCost
    ? `<div class="budget-suggestion">${money(summary.totalCost - summary.totalBudget)} over — try raising your budget to ~${money(minDailyCost * summary.days)} or turning on Vegetarian only.</div>`
    : "";

  $("#planMeta").innerHTML = `
    <div class="meta-item"><div class="label">Plan length</div><div class="value">${summary.days} days</div></div>
    <div class="meta-item"><div class="label">Daily calorie target</div><div class="value">${summary.dailyCalories} kcal</div></div>
    <div class="meta-item"><div class="label">Macro targets / day</div><div class="value">P ${grams(targets.protein)} · C ${grams(targets.carbs)} · F ${grams(targets.fat)}</div></div>
    <div class="meta-item ${totalOverBudget ? "bad" : "good"}">
      <div class="label">Estimated total cost</div>
      <div class="value">${money(summary.totalCost)} <span class="muted">/ ${money(summary.totalBudget)} budget</span></div>
      ${totalSuggestion}
    </div>`;

  const tabs = plan.map(d => `<button class="day-tab" data-day="${d.day}">Day ${d.day}</button>`).join("");
  $("#dayTabs").innerHTML = tabs;

  const dayViews = plan.map(d => `<div class="day-view" data-day="${d.day}">${renderDayTab(d, summary.dailyBudget, summary.dailyCalories, minDailyCost)}</div>`).join("");
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
  initFontScale();
  initOnboarding();

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) writeSettingsToForm(JSON.parse(saved));

  const savedPlan = localStorage.getItem(PLAN_KEY);
  if (savedPlan) renderPlan(JSON.parse(savedPlan));

  $("#planForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const settings = readSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    const result = generatePlan(settings, loadPreferences());
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
    $("#results").scrollIntoView({ behavior: "smooth" });
  });

  $("#regenerateBtn").addEventListener("click", () => {
    const settings = readSettings();
    const result = generatePlan(settings, loadPreferences());
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
  });

  $("#dayTabs").addEventListener("click", (e) => {
    if (e.target.matches(".day-tab")) activateDay(Number(e.target.dataset.day));
  });

  ["#calories", "#budgetPeriod", "#budgetAmount", "#snacks", "#vegetarian"].forEach(sel => {
    $(sel).addEventListener("input", checkBudgetFeasibility);
    $(sel).addEventListener("change", checkBudgetFeasibility);
  });
  checkBudgetFeasibility();

  $("#printListBtn").addEventListener("click", () => {
    document.body.classList.add("print-shopping-list");
    window.print();
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-shopping-list");
  });

  $("#macroProtein").addEventListener("input", () => balanceMacros("protein"));
  $("#macroCarbs").addEventListener("input", () => balanceMacros("carbs"));
  $("#macroFat").addEventListener("input", () => balanceMacros("fat"));
  balanceMacros("protein"); // ensure whatever loaded from storage/defaults sums to 100
}

document.addEventListener("DOMContentLoaded", init);
