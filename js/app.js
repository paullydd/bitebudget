const STORAGE_KEY = "biteBudget.settings.v1";
const PLAN_KEY = "biteBudget.plan.v1";
const FONT_SCALE_KEY = "biteBudget.fontScale.v1";
const FONT_SCALES = [90, 100, 112, 125, 140];
const PREFS_KEY = "biteBudget.preferences.v1";
const ONBOARDED_KEY = "biteBudget.onboarded.v1";
const SHOPPING_CHECKED_KEY = "biteBudget.shoppingChecked.v1";
const THEME_KEY = "biteBudget.theme.v1";
const SHOPPING_CATEGORY_ORDER = ["Produce", "Protein", "Dairy", "Pantry & Grains"];
const WIZARD_TOTAL_STEPS = 5;
const STYLE_GROUP_IDS = { breakfast: "styleBreakfast", lunch: "styleLunch", dinner: "styleDinner" };
const BUDGET_SLIDER_RANGES = {
  daily: { min: 5, max: 150, step: 5 },
  weekly: { min: 20, max: 700, step: 5 }, // step divides 55 (75 - min) so the $75 default lands exactly on a step
  monthly: { min: 75, max: 2500, step: 25 },
};
const WELCOME_QUOTES = [
  "Eating well shouldn't require winning the lottery.",
  "Your wallet called — it wants snacks too.",
  "Ramen has feelings. Let's diversify.",
  "Budgets are just spicy math.",
  "Groceries: the original subscription service.",
  "Home cooking: 10% skill, 90% not wasting the cilantro.",
  "A balanced diet is a cookie in each hand — we can do better.",
];

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

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("#themeToggle").textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (systemDark ? "dark" : "light"));

  $("#themeToggle").addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
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

// Keeps a <input type=range> and <input type=number> showing the same value.
// The number input stays the single source of truth everything else reads —
// dragging the slider just types into it (via a synthetic input event) so
// every listener already on the number input keeps working untouched.
function syncSlider(numberSel, rangeSel) {
  const numberEl = $(numberSel), rangeEl = $(rangeSel);
  rangeEl.min = numberEl.min;
  rangeEl.max = numberEl.max;
  rangeEl.step = numberEl.step;
  rangeEl.value = numberEl.value;
  numberEl.value = rangeEl.value; // range inputs snap to the nearest step on assignment; match that
  rangeEl.addEventListener("input", () => {
    numberEl.value = rangeEl.value;
    numberEl.dispatchEvent(new Event("input", { bubbles: true }));
  });
  numberEl.addEventListener("input", () => {
    rangeEl.value = numberEl.value;
  });
}

// Applies the budget slider's period-dependent min/max/step to both the
// range and number input, clamping the current value into the new bounds.
function applyBudgetSliderRange(rangeSel, numberSel, period) {
  const range = BUDGET_SLIDER_RANGES[period] || BUDGET_SLIDER_RANGES.weekly;
  const rangeEl = $(rangeSel), numberEl = $(numberSel);
  rangeEl.min = numberEl.min = range.min;
  rangeEl.max = numberEl.max = range.max;
  rangeEl.step = numberEl.step = range.step;
  const clamped = clamp(Number(numberEl.value) || range.min, range.min, range.max);
  rangeEl.value = clamped; // range inputs snap to the nearest step on assignment
  numberEl.value = rangeEl.value; // read back the snapped value so both controls agree exactly
}

let wizardStep = 1;

function wireBubbleGroup(container, mode) {
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".bubble");
    if (!btn) return;
    if (mode === "multi") {
      btn.classList.toggle("selected");
    } else if (mode === "tristate") {
      if (btn.classList.contains("selected")) {
        btn.classList.remove("selected");
        btn.classList.add("disliked");
      } else if (btn.classList.contains("disliked")) {
        btn.classList.remove("disliked");
      } else {
        btn.classList.add("selected");
      }
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

let quoteRotationTimer = null;

function startQuoteRotation() {
  const el = $("#welcomeQuote");
  if (!el) return;
  let index = Math.floor(Math.random() * WELCOME_QUOTES.length);
  el.textContent = WELCOME_QUOTES[index];
  quoteRotationTimer = setInterval(() => {
    index = (index + 1) % WELCOME_QUOTES.length;
    el.classList.add("fade-out");
    setTimeout(() => {
      el.textContent = WELCOME_QUOTES[index];
      el.classList.remove("fade-out");
    }, 300);
  }, 3500);
}

function stopQuoteRotation() {
  clearInterval(quoteRotationTimer);
  quoteRotationTimer = null;
}

function hideWelcome() {
  $("#welcomeScreen").classList.add("hidden");
  stopQuoteRotation();
}

function showOnboarding() {
  hideWelcome();
  goToWizardStep(1);
  $("#onboarding").classList.remove("hidden");
  $("#settingsPanel").classList.add("hidden");
}

function hideOnboarding() {
  $("#onboarding").classList.add("hidden");
  $("#settingsPanel").classList.remove("hidden");
}

function clearBubbleSelections() {
  document.querySelectorAll(".bubble.selected, .bubble.disliked").forEach(b => b.classList.remove("selected", "disliked"));
}

function prefillOnboarding(prefs) {
  clearBubbleSelections();
  $("#signatureNote").value = "";

  if (prefs) {
    (prefs.proteins || []).forEach(v => {
      const b = document.querySelector(`#proteinBubbles .bubble[data-value="${v}"]`);
      if (b) b.classList.add("selected");
    });
    (prefs.dislikedProteins || []).forEach(v => {
      const b = document.querySelector(`#proteinBubbles .bubble[data-value="${v}"]`);
      if (b) b.classList.add("disliked");
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

  // Calorie/budget aren't part of PREFS_KEY — they live in Settings already,
  // so seed the wizard's copies from whatever Settings currently holds.
  $("#obCalories").value = $("#calories").value;
  $("#obCaloriesSlider").value = $("#calories").value;

  const period = $("#budgetPeriod").value;
  const periodBtn = document.querySelector(`#obBudgetPeriod .bubble[data-value="${period}"]`);
  if (periodBtn) periodBtn.classList.add("selected");
  $("#obBudgetAmount").value = $("#budgetAmount").value;
  applyBudgetSliderRange("#obBudgetAmountSlider", "#obBudgetAmount", period);
}

function collectPreferences() {
  const proteins = [...document.querySelectorAll("#proteinBubbles .bubble.selected")].map(b => b.dataset.value);
  const dislikedProteins = [...document.querySelectorAll("#proteinBubbles .bubble.disliked")].map(b => b.dataset.value);

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
    dislikedProteins: dislikedProteins.length ? dislikedProteins : undefined,
    mealStyle: Object.keys(mealStyle).length ? mealStyle : undefined,
    signature,
  };
}

// Copies the wizard's calorie/budget-period/budget answers into the real
// Settings fields (and their sliders), matching Settings' own lazy-persist
// convention — nothing is written to STORAGE_KEY until Generate Plan runs.
function applyOnboardingBudgetCaloriesToSettings() {
  $("#calories").value = $("#obCalories").value;
  $("#caloriesSlider").value = $("#obCalories").value;

  const periodBtn = document.querySelector("#obBudgetPeriod .bubble.selected");
  const period = periodBtn ? periodBtn.dataset.value : $("#budgetPeriod").value;
  $("#budgetPeriod").value = period;
  $("#budgetAmount").value = $("#obBudgetAmount").value;
  applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", period);

  checkBudgetFeasibility();
}

function finishOnboarding() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(collectPreferences()));
  localStorage.setItem(ONBOARDED_KEY, "1");
  applyOnboardingBudgetCaloriesToSettings();
  hideOnboarding();
}

function loadPreferences() {
  const saved = localStorage.getItem(PREFS_KEY);
  return saved ? JSON.parse(saved) : undefined;
}

function initOnboarding() {
  wireBubbleGroup($("#proteinBubbles"), "tristate");
  Object.values(STYLE_GROUP_IDS).forEach(id => wireBubbleGroup($(`#${id}`), "single"));
  wireBubbleGroup($("#signatureSlot"), "single");
  wireBubbleGroup($("#signaturePreset"), "single");

  wireBubbleGroup($("#obBudgetPeriod"), "single");
  $("#obBudgetPeriod").addEventListener("click", (e) => {
    const btn = e.target.closest(".bubble");
    if (btn) applyBudgetSliderRange("#obBudgetAmountSlider", "#obBudgetAmount", btn.dataset.value);
  });

  syncSlider("#obCalories", "#obCaloriesSlider");
  syncSlider("#obBudgetAmount", "#obBudgetAmountSlider");

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

  $("#getStartedBtn").addEventListener("click", showOnboarding);
  $("#welcomeSkip").addEventListener("click", () => {
    localStorage.setItem(ONBOARDED_KEY, "1");
    hideWelcome();
    hideOnboarding();
  });

  if (localStorage.getItem(ONBOARDED_KEY)) {
    hideWelcome();
    hideOnboarding();
  } else {
    // Welcome screen is visible by default in the markup — just start its quote rotation.
    startQuoteRotation();
  }
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

function renderMealCard(meal, dayIndex, mealIndex) {
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
        <button type="button" class="meal-swap-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Swap this meal" title="Swap this meal">🔀</button>
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

function renderDayTab(day, dayIndex, dailyBudget, dailyCalories, minDailyCost) {
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
      ${day.meals.map((m, mi) => renderMealCard(m, dayIndex, mi)).join("")}
    </div>`;
}

function loadCheckedShoppingItems() {
  const saved = localStorage.getItem(SHOPPING_CHECKED_KEY);
  return saved ? new Set(JSON.parse(saved)) : new Set();
}

function saveCheckedShoppingItems(checked) {
  localStorage.setItem(SHOPPING_CHECKED_KEY, JSON.stringify([...checked]));
}

function renderShoppingList(shoppingList, totalCost, totalBudget) {
  const checked = loadCheckedShoppingItems();

  const groups = {};
  shoppingList.forEach(item => {
    const cat = FOODS[item.food].category || "Pantry & Grains";
    (groups[cat] = groups[cat] || []).push(item);
  });

  const sections = SHOPPING_CATEGORY_ORDER.filter(cat => groups[cat]).map(cat => {
    const items = [...groups[cat]].sort((a, b) => a.name.localeCompare(b.name));
    const rows = items.map(i => `
      <li class="shopping-item ${checked.has(i.food) ? "checked" : ""}">
        <label>
          <input type="checkbox" class="shopping-check" data-food="${i.food}" ${checked.has(i.food) ? "checked" : ""}>
          <span class="shopping-item-name">${i.name}</span>
          <span class="shopping-item-qty">${grams(i.grams)}</span>
          <span class="shopping-item-cost">${money(i.cost)}</span>
        </label>
      </li>`).join("");
    return `
      <div class="shopping-group">
        <h4>${cat}</h4>
        <ul class="shopping-items">${rows}</ul>
      </div>`;
  }).join("");

  const overBudget = totalCost > totalBudget * 1.02;
  return `
    ${sections}
    <div class="shopping-total ${overBudget ? "bad" : "good"}">
      <strong>Total</strong>
      <span>${money(totalCost)} / ${money(totalBudget)}</span>
    </div>`;
}

function renderPlan(result) {
  currentPlanResult = result;
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

  const dayViews = plan.map((d, di) => `<div class="day-view" data-day="${d.day}">${renderDayTab(d, di, summary.dailyBudget, summary.dailyCalories, minDailyCost)}</div>`).join("");
  $("#dayViews").innerHTML = dayViews;

  $("#shoppingList").innerHTML = renderShoppingList(shoppingList, summary.totalCost, summary.totalBudget);

  activateDay(activeDayNum);
  $("#results").classList.remove("hidden");
}

let activeDayNum = 1;
let currentPlanResult = null;

function activateDay(dayNum) {
  activeDayNum = dayNum;
  document.querySelectorAll(".day-tab").forEach(b => b.classList.toggle("active", Number(b.dataset.day) === dayNum));
  document.querySelectorAll(".day-view").forEach(v => v.classList.toggle("active", Number(v.dataset.day) === dayNum));
}

function init() {
  initFontScale();
  initTheme();
  initOnboarding();

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) writeSettingsToForm(JSON.parse(saved));

  applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", $("#budgetPeriod").value);
  syncSlider("#calories", "#caloriesSlider");
  syncSlider("#budgetAmount", "#budgetAmountSlider");
  $("#budgetPeriod").addEventListener("change", () => {
    applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", $("#budgetPeriod").value);
  });

  const savedPlan = localStorage.getItem(PLAN_KEY);
  if (savedPlan) renderPlan(JSON.parse(savedPlan));

  $("#planForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const settings = readSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    const result = generatePlan(settings, loadPreferences());
    localStorage.removeItem(SHOPPING_CHECKED_KEY);
    activeDayNum = 1;
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
    $("#results").scrollIntoView({ behavior: "smooth" });
  });

  $("#regenerateBtn").addEventListener("click", () => {
    const settings = readSettings();
    const result = generatePlan(settings, loadPreferences());
    localStorage.removeItem(SHOPPING_CHECKED_KEY);
    activeDayNum = 1;
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
  });

  $("#dayTabs").addEventListener("click", (e) => {
    if (e.target.matches(".day-tab")) activateDay(Number(e.target.dataset.day));
  });

  $("#dayViews").addEventListener("click", (e) => {
    const btn = e.target.closest(".meal-swap-btn");
    if (!btn || !currentPlanResult) return;
    const dayIndex = Number(btn.dataset.dayIndex);
    const mealIndex = Number(btn.dataset.mealIndex);
    regenerateMeal(currentPlanResult, dayIndex, mealIndex, readSettings(), loadPreferences());
    localStorage.setItem(PLAN_KEY, JSON.stringify(currentPlanResult));
    renderPlan(currentPlanResult);
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

  $("#shoppingList").addEventListener("change", (e) => {
    if (!e.target.matches(".shopping-check")) return;
    const checked = loadCheckedShoppingItems();
    const food = e.target.dataset.food;
    if (e.target.checked) checked.add(food); else checked.delete(food);
    saveCheckedShoppingItems(checked);
    e.target.closest(".shopping-item").classList.toggle("checked", e.target.checked);
  });

  $("#resetAppBtn").addEventListener("click", () => {
    if (!confirm("Reset BiteBudget? This clears your preferences, settings, and saved plan, and starts fresh like a new visitor.")) return;
    Object.keys(localStorage)
      .filter(k => k.startsWith("biteBudget."))
      .forEach(k => localStorage.removeItem(k));
    location.reload();
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
