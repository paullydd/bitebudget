const STORAGE_KEY = "biteBudget.settings.v1";
const PLAN_KEY = "biteBudget.plan.v1";
const FONT_SCALE_KEY = "biteBudget.fontScale.v1";
const FONT_SCALES = [90, 100, 112, 125, 140];
const PREFS_KEY = "biteBudget.preferences.v1";
const ONBOARDED_KEY = "biteBudget.onboarded.v1";
const SHOPPING_CHECKED_KEY = "biteBudget.shoppingChecked.v1";
const THEME_KEY = "biteBudget.theme.v1";
const FAVORITES_KEY = "biteBudget.favorites.v1";
const HISTORY_KEY = "biteBudget.history.v1";
const MY_MEALS_KEY = "biteBudget.myMeals.v1";
const PRICE_OVERRIDES_KEY = "biteBudget.priceOverrides.v1";
// Snapshot of FOODS' shipped national-average prices, captured before any
// override is ever applied — lets the Edit Prices dialog show "(default
// $X.XX)" next to each field and power "reset to defaults".
const DEFAULT_PRICES = Object.fromEntries(Object.keys(FOODS).map(k => [k, FOODS[k].price]));
const RECIPES_TRIED_KEY = "biteBudget.recipesTried.v1";
const BADGES = [
  { id: "first_plan", icon: "🌱", name: "First Plan", desc: "Generate your first meal plan.", check: s => s.plansGenerated >= 1 },
  { id: "streak_3", icon: "🔥", name: "On a Roll", desc: "3 plans in a row under budget.", check: s => s.longestStreak >= 3 },
  { id: "streak_10", icon: "🏆", name: "Budget Master", desc: "10 plans in a row under budget.", check: s => s.longestStreak >= 10 },
  { id: "saved_50", icon: "💰", name: "Big Saver", desc: "Save $50 total vs. your budget.", check: s => s.totalSaved >= 50 },
  { id: "saved_200", icon: "💎", name: "Super Saver", desc: "Save $200 total vs. your budget.", check: s => s.totalSaved >= 200 },
  { id: "explorer_10", icon: "🍽️", name: "Recipe Explorer", desc: "Try 10 different recipes.", check: s => s.recipesTried >= 10 },
  { id: "explorer_25", icon: "👨‍🍳", name: "Recipe Connoisseur", desc: "Try 25 different recipes.", check: s => s.recipesTried >= 25 },
  { id: "favorites_5", icon: "❤️", name: "Favorite Fan", desc: "Favorite 5 recipes.", check: s => s.favoritesCount >= 5 },
];
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

function wireBubbleGroup(container, mode, options = {}) {
  const max = options.max || Infinity;
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".bubble");
    if (!btn) return;
    if (mode === "multi") {
      btn.classList.toggle("selected");
    } else if (mode === "multi-limited") {
      // "No preference" is exclusive with everything else in the group;
      // otherwise toggle, capped at `max` simultaneous picks.
      if (btn.dataset.value === "no_preference") {
        [...container.querySelectorAll(".bubble")].forEach(b => b.classList.toggle("selected", b === btn));
        return;
      }
      const noPref = container.querySelector('.bubble[data-value="no_preference"]');
      if (noPref) noPref.classList.remove("selected");
      if (btn.classList.contains("selected")) {
        btn.classList.remove("selected");
      } else if (container.querySelectorAll(".bubble.selected").length < max) {
        btn.classList.add("selected");
      }
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
    Object.entries(prefs.mealStyle || {}).forEach(([slot, vals]) => {
      const groupId = STYLE_GROUP_IDS[slot];
      if (!groupId) return;
      [].concat(vals).forEach(val => {
        const b = document.querySelector(`#${groupId} .bubble[data-value="${val}"]`);
        if (b) b.classList.add("selected");
      });
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
    const sel = [...document.querySelectorAll(`#${groupId} .bubble.selected`)]
      .map(b => b.dataset.value)
      .filter(v => v !== "no_preference");
    if (sel.length) mealStyle[slot] = sel;
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

function loadFavorites() {
  const saved = localStorage.getItem(FAVORITES_KEY);
  return saved ? new Set(JSON.parse(saved)) : new Set();
}

function saveFavorites(favorites) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

function isFavorite(templateId) {
  return loadFavorites().has(templateId);
}

// Toggles one template's favorite state and updates every visible button
// for it at once (the same recipe can appear more than once in a week).
function toggleFavorite(templateId) {
  const favorites = loadFavorites();
  if (favorites.has(templateId)) favorites.delete(templateId); else favorites.add(templateId);
  saveFavorites(favorites);

  const nowFavorite = favorites.has(templateId);
  document.querySelectorAll(`.favorite-btn[data-template-id="${templateId}"]`).forEach(btn => {
    btn.textContent = nowFavorite ? "❤️" : "🤍";
    btn.classList.toggle("active", nowFavorite);
  });
  return nowFavorite;
}

// Preferences saved during onboarding, plus favorites layered on top —
// favorites work even if onboarding was skipped entirely. Stays undefined
// (matching generatePlan's no-preferences behavior) when neither exists.
function loadPreferences() {
  const saved = localStorage.getItem(PREFS_KEY);
  const prefs = saved ? JSON.parse(saved) : null;
  const favoriteIds = [...loadFavorites()];
  if (!prefs && favoriteIds.length === 0) return undefined;
  return { ...(prefs || {}), favoriteIds };
}

function loadHistory() {
  const saved = localStorage.getItem(HISTORY_KEY);
  return saved ? JSON.parse(saved) : [];
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// Called when Generate Plan produces a genuinely new plan — starts a new
// "planning session" row.
function recordNewHistoryEntry(summary) {
  const history = loadHistory();
  history.push({
    date: new Date().toISOString().slice(0, 10),
    days: summary.days,
    totalBudget: summary.totalBudget,
    totalCost: summary.totalCost,
  });
  saveHistory(history);
}

// Called on Shuffle or a single-meal swap — updates the current session's
// row in place rather than logging a new one, so refining the same plan
// doesn't inflate the streak/plan count.
function updateLatestHistoryEntry(summary) {
  const history = loadHistory();
  if (history.length === 0) {
    recordNewHistoryEntry(summary);
    return;
  }
  const last = history[history.length - 1];
  last.days = summary.days;
  last.totalBudget = summary.totalBudget;
  last.totalCost = summary.totalCost;
  saveHistory(history);
}

// Framed as "plans," not "weeks" — a plan can be 1-14 days and the budget
// period varies, so a weekly cadence isn't something this data can honestly claim.
function computeHistoryStats(history) {
  let currentStreak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].totalCost <= history[i].totalBudget) currentStreak++;
    else break;
  }

  let longestStreak = 0, running = 0;
  history.forEach(h => {
    if (h.totalCost <= h.totalBudget) {
      running++;
      longestStreak = Math.max(longestStreak, running);
    } else {
      running = 0;
    }
  });

  const totalSaved = history.reduce((s, h) => s + Math.max(0, h.totalBudget - h.totalCost), 0);

  return { plansGenerated: history.length, currentStreak, longestStreak, totalSaved };
}

function loadRecipesTried() {
  const saved = localStorage.getItem(RECIPES_TRIED_KEY);
  return saved ? new Set(JSON.parse(saved)) : new Set();
}

function saveRecipesTried(tried) {
  localStorage.setItem(RECIPES_TRIED_KEY, JSON.stringify([...tried]));
}

function recordRecipesTried(plan) {
  const tried = loadRecipesTried();
  plan.forEach(day => day.meals.forEach(m => { if (!m.custom) tried.add(m.id); }));
  saveRecipesTried(tried);
}

function computeStats() {
  return {
    ...computeHistoryStats(loadHistory()),
    recipesTried: loadRecipesTried().size,
    favoritesCount: loadFavorites().size,
  };
}

function initOnboarding() {
  wireBubbleGroup($("#proteinBubbles"), "tristate");
  Object.values(STYLE_GROUP_IDS).forEach(id => wireBubbleGroup($(`#${id}`), "multi-limited", { max: 3 }));
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

// Builds a "⏱ 10 min prep · 12 min cook" segment (or just "⏱ 5 min" when
// there's nothing to cook) — undefined for custom/logged meals, which have
// no prepTime/cookTime since they're not a recipe template.
function formatTime(prepTime, cookTime) {
  if (prepTime == null || cookTime == null) return "";
  if (cookTime === 0) return `⏱ ${prepTime} min`;
  return `⏱ ${prepTime} min prep · ${cookTime} min cook`;
}

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
  if (meal.custom && meal.pending) {
    return `
      <div class="meal-card pending-meal-card">
        <div class="meal-head">
          <span class="meal-icon">${slotIcon(meal.slot)}</span>
          <div>
            <div class="meal-slot">${meal.slot}</div>
            <div class="meal-name">${meal.name}</div>
          </div>
        </div>
        <p class="pending-meal-note">Left open — add what you had once you know.</p>
        <button type="button" class="custom-meal-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}">✏️ Fill this in</button>
      </div>`;
  }

  const n = meal.nutrition;
  const favorite = !meal.custom && isFavorite(meal.id);
  const actionButtons = meal.custom
    ? `
        <button type="button" class="custom-meal-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Edit this meal" title="Edit this meal">✏️</button>
        <button type="button" class="meal-swap-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Replace with an auto-picked meal" title="Replace with an auto-picked meal">↩️</button>`
    : `
        <button type="button" class="favorite-btn ${favorite ? "active" : ""}" data-template-id="${meal.id}" aria-label="Favorite this meal" title="Favorite this meal">${favorite ? "❤️" : "🤍"}</button>
        <button type="button" class="meal-swap-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Swap this meal" title="Swap this meal">🔀</button>
        <button type="button" class="custom-meal-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Log your own meal instead" title="Log your own meal instead">📝</button>`;

  return `
    <div class="meal-card ${meal.custom ? "custom-meal-card" : ""}">
      <div class="meal-head">
        <span class="meal-icon">${slotIcon(meal.slot)}</span>
        <div>
          <div class="meal-slot">${meal.slot}</div>
          <div class="meal-name">${meal.name}</div>
        </div>
        ${actionButtons}
        <div class="meal-cost">${money(n.cost)}</div>
      </div>
      <div class="meal-macros">
        <span>${Math.round(n.cal)} kcal</span>
        <span>P ${grams(n.protein)}</span>
        <span>C ${grams(n.carbs)}</span>
        <span>F ${grams(n.fat)}</span>
      </div>
      ${meal.custom ? "" : `<button type="button" class="recipe-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}">📖 View Recipe</button>`}
    </div>`;
}

// Builds an FDA-style "Nutrition Facts" box. %DV uses the standard FDA
// 2,000-calorie reference values (fat 78g, carbohydrate 275g); protein gets
// no %DV, matching real labels, which don't require one.
function renderNutritionLabel(n) {
  const fatDV = Math.round((n.fat / 78) * 100);
  const carbDV = Math.round((n.carbs / 275) * 100);
  return `
    <div class="nutrition-label">
      <div class="nutrition-title">Nutrition Facts</div>
      <div class="nutrition-rule thick"></div>
      <div class="nutrition-calories">
        <span>Calories</span>
        <span>${Math.round(n.cal)}</span>
      </div>
      <div class="nutrition-rule medium"></div>
      <div class="nutrition-dv-header">% Daily Value*</div>
      <div class="nutrition-row"><span><strong>Total Fat</strong> ${grams(n.fat)}</span><span>${fatDV}%</span></div>
      <div class="nutrition-rule thin"></div>
      <div class="nutrition-row"><span><strong>Total Carbohydrate</strong> ${grams(n.carbs)}</span><span>${carbDV}%</span></div>
      <div class="nutrition-rule thin"></div>
      <div class="nutrition-row"><span><strong>Protein</strong> ${grams(n.protein)}</span><span></span></div>
      <div class="nutrition-rule thick"></div>
      <div class="nutrition-footnote">*Percent Daily Values are based on a 2,000 calorie diet.</div>
    </div>`;
}

function loadMyMeals() {
  const saved = localStorage.getItem(MY_MEALS_KEY);
  return saved ? JSON.parse(saved) : [];
}

function saveMyMeals(meals) {
  localStorage.setItem(MY_MEALS_KEY, JSON.stringify(meals));
}

// Upsert by name (case-insensitive) so re-saving the same meal just updates
// its numbers instead of piling up duplicates.
function upsertMyMeal(meal) {
  const meals = loadMyMeals();
  const idx = meals.findIndex(m => m.name.toLowerCase() === meal.name.toLowerCase());
  if (idx >= 0) meals[idx] = meal; else meals.push(meal);
  saveMyMeals(meals);
}

function removeMyMeal(name) {
  saveMyMeals(loadMyMeals().filter(m => m.name.toLowerCase() !== name.toLowerCase()));
}

// The "pick from a meal you've saved before" list at the top of the custom-
// meal dialog — hidden entirely once there's nothing saved yet.
function renderMyMealsList() {
  const meals = loadMyMeals();
  const container = $("#myMealsList");
  if (!meals.length) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="my-meals-label">Your saved meals</div>
    ${meals.map(m => `
      <div class="my-meal-row">
        <button type="button" class="my-meal-pick" data-name="${m.name}">${m.name} — ${Math.round(m.protein * 4 + m.carbs * 4 + m.fat * 9)} kcal</button>
        <button type="button" class="my-meal-remove" data-name="${m.name}" aria-label="Remove saved meal" title="Remove saved meal">✕</button>
      </div>`).join("")}`;
}

function loadPriceOverrides() {
  const saved = localStorage.getItem(PRICE_OVERRIDES_KEY);
  return saved ? JSON.parse(saved) : {};
}

function savePriceOverrides(overrides) {
  localStorage.setItem(PRICE_OVERRIDES_KEY, JSON.stringify(overrides));
}

// Mutates FOODS' price fields in place from any saved overrides — called
// once at startup so every downstream calculation (planning, shopping
// list, nutrition label) just sees the corrected price with no special
// casing needed anywhere else.
function applyPriceOverrides() {
  const overrides = loadPriceOverrides();
  Object.entries(overrides).forEach(([food, price]) => {
    if (FOODS[food]) FOODS[food].price = price;
  });
}

// Builds the grouped-by-category price list inside the Edit Prices dialog.
function renderPricesList() {
  const groups = {};
  Object.keys(FOODS).forEach(food => {
    const cat = FOODS[food].category || "Pantry & Grains";
    (groups[cat] = groups[cat] || []).push(food);
  });

  $("#pricesList").innerHTML = SHOPPING_CATEGORY_ORDER.filter(cat => groups[cat]).map(cat => {
    const rows = [...groups[cat]].sort((a, b) => FOODS[a].name.localeCompare(FOODS[b].name)).map(food => `
      <div class="price-row">
        <div class="price-row-info">
          <span class="price-row-name">${FOODS[food].name}</span>
          <span class="price-row-default">default $${DEFAULT_PRICES[food].toFixed(2)}/100g</span>
        </div>
        <div class="price-row-input-wrap">
          <span>$</span>
          <input type="number" min="0" step="0.01" class="price-input" data-food="${food}" value="${FOODS[food].price.toFixed(2)}">
        </div>
      </div>`).join("");
    return `<div class="price-group"><h4>${cat}</h4>${rows}</div>`;
  }).join("");
}

let customMealTarget = null; // { dayIndex, mealIndex, wasCustom }

function updateCustomMealCalories() {
  const p = Number($("#customMealProtein").value) || 0;
  const c = Number($("#customMealCarbs").value) || 0;
  const f = Number($("#customMealFat").value) || 0;
  $("#customMealCalories").textContent = `${Math.round(p * 4 + c * 4 + f * 9)} kcal`;
}

// Opens the "log your own meal" dialog for one slot — pre-filled with its
// current values when re-editing an already-custom meal, blank otherwise.
function openCustomMealDialog(dayIndex, mealIndex) {
  const meal = currentPlanResult.plan[dayIndex].meals[mealIndex];
  customMealTarget = { dayIndex, mealIndex, wasCustom: !!meal.custom };

  $("#customMealTitle").textContent = meal.pending
    ? `Fill in your ${meal.slot}`
    : meal.custom ? `Edit your ${meal.slot}` : `Add your own ${meal.slot}`;
  const known = meal.custom && !meal.pending;
  $("#customMealName").value = known ? meal.name : "";
  $("#customMealProtein").value = known ? Math.round(meal.nutrition.protein) : 0;
  $("#customMealCarbs").value = known ? Math.round(meal.nutrition.carbs) : 0;
  $("#customMealFat").value = known ? Math.round(meal.nutrition.fat) : 0;
  $("#customMealCost").value = known ? meal.nutrition.cost.toFixed(2) : 0;
  $("#customMealOpen").checked = false;
  $("#customMealSave").checked = false;
  updateCustomMealCalories();
  renderMyMealsList();
  $("#customMealDialog").showModal();
}

let currentRecipeMealId = null;

// Opens the shared recipe dialog styled as a cookbook page for one meal.
function openRecipeModal(meal) {
  const n = meal.nutrition;
  currentRecipeMealId = meal.id;
  $("#recipeSlot").textContent = meal.slot;
  $("#recipeTitle").textContent = meal.name;
  const time = formatTime(meal.prepTime, meal.cookTime);
  $("#recipeMacros").textContent = `${Math.round(n.cal)} kcal · P ${grams(n.protein)} · C ${grams(n.carbs)} · F ${grams(n.fat)}${time ? " · " + time : ""}`;
  const favorite = isFavorite(meal.id);
  $("#recipeFavoriteBtn").textContent = favorite ? "❤️ Favorited" : "🤍 Favorite this recipe";
  $("#recipeFavoriteBtn").classList.toggle("active", favorite);
  $("#nutritionLabel").innerHTML = renderNutritionLabel(n);
  $("#recipeIngredients").innerHTML = meal.items.map(i => `<li>${FOODS[i.food].name} — ${grams(i.grams)}</li>`).join("");
  $("#recipeInstructions").innerHTML = meal.instructions.map(s => `<li>${s}</li>`).join("");
  $("#recipeModal").showModal();
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

// Builds the full printable meal-plan booklet: every day, every meal, full
// ingredients/instructions — the same content openRecipeModal shows for one
// meal, laid out single-column (no spine) for clean print pagination.
function renderPrintBooklet(result) {
  const { plan, summary } = result;
  const header = `
    <div class="booklet-header">
      <h1>BiteBudget Meal Plan</h1>
      <p>${summary.days} days · ${summary.dailyCalories} kcal/day · ${money(summary.totalCost)} / ${money(summary.totalBudget)} budget</p>
    </div>`;

  const days = plan.map(day => `
    <div class="booklet-day">
      <h2>Day ${day.day}</h2>
      ${day.meals.map(m => {
        if (m.custom && m.pending) {
          return `
            <div class="booklet-meal">
              <h3>${slotIcon(m.slot)} ${m.slot} — ${m.name}</h3>
              <p class="booklet-meal-macros">Left open — not yet logged.</p>
            </div>`;
        }
        if (m.custom) {
          return `
            <div class="booklet-meal">
              <h3>${slotIcon(m.slot)} ${m.slot} — ${m.name}</h3>
              <p class="booklet-meal-macros">${Math.round(m.nutrition.cal)} kcal · P ${grams(m.nutrition.protein)} · C ${grams(m.nutrition.carbs)} · F ${grams(m.nutrition.fat)} · ${money(m.nutrition.cost)}</p>
              <p class="booklet-meal-macros">Logged by you.</p>
            </div>`;
        }
        const time = formatTime(m.prepTime, m.cookTime);
        return `
        <div class="booklet-meal">
          <h3>${slotIcon(m.slot)} ${m.slot} — ${m.name}</h3>
          <p class="booklet-meal-macros">${Math.round(m.nutrition.cal)} kcal · P ${grams(m.nutrition.protein)} · C ${grams(m.nutrition.carbs)} · F ${grams(m.nutrition.fat)} · ${money(m.nutrition.cost)}${time ? " · " + time : ""}</p>
          <div class="booklet-meal-body">
            <div>
              <strong>Ingredients</strong>
              <ul>${m.items.map(i => `<li>${FOODS[i.food].name} — ${grams(i.grams)}</li>`).join("")}</ul>
            </div>
            <div>
              <strong>Instructions</strong>
              <ol>${m.instructions.map(s => `<li>${s}</li>`).join("")}</ol>
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`).join("");

  return header + days;
}

// Grid: one row per day, one column per meal slot (positional — every day
// has the same slot sequence since generatePlan's slotsToday is
// deterministic per settings). Clicking a cell reuses activateDay(), the
// same single place that already owns "switch to day N" for the tabs.
function renderWeekOverview(plan) {
  if (!plan.length) return "";

  const slotCounts = {};
  plan[0].meals.forEach(m => { slotCounts[m.slot] = (slotCounts[m.slot] || 0) + 1; });
  const seen = {};
  const headers = plan[0].meals.map(m => {
    seen[m.slot] = (seen[m.slot] || 0) + 1;
    const label = m.slot.charAt(0).toUpperCase() + m.slot.slice(1);
    return slotCounts[m.slot] > 1 ? `${label} ${seen[m.slot]}` : label;
  });

  const headerRow = `
    <div class="week-overview-row week-overview-header">
      <div class="week-overview-daylabel"></div>
      ${headers.map(h => `<div>${h}</div>`).join("")}
    </div>`;

  const rows = plan.map(day => `
    <div class="week-overview-row">
      <button type="button" class="week-overview-daylabel" data-day="${day.day}">Day ${day.day}</button>
      ${day.meals.map(m => `<button type="button" class="week-overview-cell" data-day="${day.day}" title="${m.name}">${m.name}</button>`).join("")}
    </div>`).join("");

  return `<div class="week-overview-grid" style="--week-cols: ${headers.length}">${headerRow}${rows}</div>`;
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

  $("#weekOverview").innerHTML = renderWeekOverview(plan);

  const tabs = plan.map(d => `<button class="day-tab" data-day="${d.day}">Day ${d.day}</button>`).join("");
  $("#dayTabs").innerHTML = tabs;

  const dayViews = plan.map((d, di) => `<div class="day-view" data-day="${d.day}">${renderDayTab(d, di, summary.dailyBudget, summary.dailyCalories, minDailyCost)}</div>`).join("");
  $("#dayViews").innerHTML = dayViews;

  $("#shoppingList").innerHTML = renderShoppingList(shoppingList, summary.totalCost, summary.totalBudget);

  activateDay(activeDayNum);
  $("#results").classList.remove("hidden");

  recordRecipesTried(plan);
  renderProgressStrip();
}

// Compact stats strip shown once there's any history — hidden for a
// brand-new visitor with nothing to show yet.
function renderProgressStrip() {
  const history = loadHistory();
  const strip = $("#progressStrip");
  if (history.length === 0) {
    strip.classList.add("hidden");
    return;
  }
  const stats = computeStats();
  strip.innerHTML = `
    <div class="progress-stat"><span class="progress-stat-value">${stats.currentStreak}</span><span class="progress-stat-label">Streak</span></div>
    <div class="progress-stat"><span class="progress-stat-value">${money(stats.totalSaved)}</span><span class="progress-stat-label">Saved</span></div>
    <div class="progress-stat"><span class="progress-stat-value">${stats.plansGenerated}</span><span class="progress-stat-label">Plans</span></div>
    <button type="button" id="achievementsBtn" class="secondary-btn">🏅 Achievements</button>`;
  strip.classList.remove("hidden");
}

function renderAchievements() {
  const stats = computeStats();
  $("#achievementsGrid").innerHTML = BADGES.map(b => {
    const earned = b.check(stats);
    return `
      <div class="badge-card ${earned ? "earned" : "locked"}">
        <div class="badge-icon">${earned ? b.icon : "🔒"}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>`;
  }).join("");
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
  applyPriceOverrides();

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) writeSettingsToForm(JSON.parse(saved));

  applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", $("#budgetPeriod").value);
  syncSlider("#calories", "#caloriesSlider");
  syncSlider("#budgetAmount", "#budgetAmountSlider");
  $("#budgetPeriod").addEventListener("change", () => {
    applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", $("#budgetPeriod").value);
  });

  const savedPlan = localStorage.getItem(PLAN_KEY);
  if (savedPlan) renderPlan(recomputeAllCosts(JSON.parse(savedPlan)));
  else renderProgressStrip();

  $("#planForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const settings = readSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    const result = generatePlan(settings, loadPreferences());
    localStorage.removeItem(SHOPPING_CHECKED_KEY);
    activeDayNum = 1;
    recordNewHistoryEntry(result.summary);
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
    $("#results").scrollIntoView({ behavior: "smooth" });
  });

  $("#regenerateBtn").addEventListener("click", () => {
    const settings = readSettings();
    const result = generatePlan(settings, loadPreferences());
    localStorage.removeItem(SHOPPING_CHECKED_KEY);
    activeDayNum = 1;
    updateLatestHistoryEntry(result.summary);
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
  });

  $("#dayTabs").addEventListener("click", (e) => {
    if (e.target.matches(".day-tab")) activateDay(Number(e.target.dataset.day));
  });

  $("#weekOverview").addEventListener("click", (e) => {
    const cell = e.target.closest("[data-day]");
    if (!cell) return;
    activateDay(Number(cell.dataset.day));
    $("#dayTabs").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  $("#dayViews").addEventListener("click", (e) => {
    if (!currentPlanResult) return;

    const swapBtn = e.target.closest(".meal-swap-btn");
    if (swapBtn) {
      const dayIndex = Number(swapBtn.dataset.dayIndex);
      const mealIndex = Number(swapBtn.dataset.mealIndex);
      regenerateMeal(currentPlanResult, dayIndex, mealIndex, readSettings(), loadPreferences());
      updateLatestHistoryEntry(currentPlanResult.summary);
      localStorage.setItem(PLAN_KEY, JSON.stringify(currentPlanResult));
      renderPlan(currentPlanResult);
      return;
    }

    const recipeBtn = e.target.closest(".recipe-btn");
    if (recipeBtn) {
      const dayIndex = Number(recipeBtn.dataset.dayIndex);
      const mealIndex = Number(recipeBtn.dataset.mealIndex);
      openRecipeModal(currentPlanResult.plan[dayIndex].meals[mealIndex]);
      return;
    }

    const customBtn = e.target.closest(".custom-meal-btn");
    if (customBtn) {
      openCustomMealDialog(Number(customBtn.dataset.dayIndex), Number(customBtn.dataset.mealIndex));
      return;
    }

    const favoriteBtn = e.target.closest(".favorite-btn");
    if (favoriteBtn) {
      toggleFavorite(favoriteBtn.dataset.templateId);
    }
  });

  $("#recipeCloseBtn").addEventListener("click", () => $("#recipeModal").close());
  $("#recipeModal").addEventListener("click", (e) => {
    if (e.target === $("#recipeModal")) $("#recipeModal").close();
  });
  $("#recipeFavoriteBtn").addEventListener("click", () => {
    if (!currentRecipeMealId) return;
    const nowFavorite = toggleFavorite(currentRecipeMealId);
    $("#recipeFavoriteBtn").textContent = nowFavorite ? "❤️ Favorited" : "🤍 Favorite this recipe";
    $("#recipeFavoriteBtn").classList.toggle("active", nowFavorite);
  });

  $("#customMealCloseBtn").addEventListener("click", () => $("#customMealDialog").close());
  $("#customMealDialog").addEventListener("click", (e) => {
    if (e.target === $("#customMealDialog")) $("#customMealDialog").close();
  });
  $("#myMealsList").addEventListener("click", (e) => {
    const pick = e.target.closest(".my-meal-pick");
    if (pick) {
      const meal = loadMyMeals().find(m => m.name === pick.dataset.name);
      if (meal) {
        $("#customMealName").value = meal.name;
        $("#customMealProtein").value = meal.protein;
        $("#customMealCarbs").value = meal.carbs;
        $("#customMealFat").value = meal.fat;
        $("#customMealCost").value = meal.cost.toFixed(2);
        $("#customMealOpen").checked = false;
        updateCustomMealCalories();
      }
      return;
    }
    const remove = e.target.closest(".my-meal-remove");
    if (remove) {
      removeMyMeal(remove.dataset.name);
      renderMyMealsList();
    }
  });
  ["#customMealProtein", "#customMealCarbs", "#customMealFat"].forEach(sel => {
    $(sel).addEventListener("input", updateCustomMealCalories);
  });
  $("#customMealForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!customMealTarget || !currentPlanResult) return;
    const { dayIndex, mealIndex, wasCustom } = customMealTarget;
    const slot = currentPlanResult.plan[dayIndex].meals[mealIndex].slot;
    const leaveOpen = $("#customMealOpen").checked;
    const name = $("#customMealName").value.trim();

    let customMeal;
    if (leaveOpen) {
      customMeal = {
        slot, id: `custom-${Date.now()}`, name: name || "Eating out", items: [], instructions: [],
        custom: true, pending: true, nutrition: { cal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 },
      };
    } else {
      const protein = Math.max(0, Number($("#customMealProtein").value) || 0);
      const carbs = Math.max(0, Number($("#customMealCarbs").value) || 0);
      const fat = Math.max(0, Number($("#customMealFat").value) || 0);
      const cost = Math.max(0, Number($("#customMealCost").value) || 0);
      const cal = protein * 4 + carbs * 4 + fat * 9;
      customMeal = {
        slot, id: `custom-${Date.now()}`, name: name || "Custom meal", items: [], instructions: [],
        custom: true, pending: false, nutrition: { cal, protein, carbs, fat, cost },
      };
      if ($("#customMealSave").checked && name) {
        upsertMyMeal({ name, protein, carbs, fat, cost });
      }
    }

    const rebalance = !wasCustom && !leaveOpen;
    applyCustomMeal(currentPlanResult, dayIndex, mealIndex, customMeal, readSettings(), loadPreferences(), rebalance);
    updateLatestHistoryEntry(currentPlanResult.summary);
    localStorage.setItem(PLAN_KEY, JSON.stringify(currentPlanResult));
    renderPlan(currentPlanResult);
    $("#customMealDialog").close();
  });

  $("#progressStrip").addEventListener("click", (e) => {
    if (!e.target.closest("#achievementsBtn")) return;
    renderAchievements();
    $("#achievementsDialog").showModal();
  });
  $("#achievementsCloseBtn").addEventListener("click", () => $("#achievementsDialog").close());
  $("#achievementsDialog").addEventListener("click", (e) => {
    if (e.target === $("#achievementsDialog")) $("#achievementsDialog").close();
  });

  // Re-syncs the currently displayed plan (if any) with whatever prices are
  // now in effect — reused by both the Save and Reset paths below.
  function commitPriceChanges() {
    if (!currentPlanResult) return;
    recomputeAllCosts(currentPlanResult);
    updateLatestHistoryEntry(currentPlanResult.summary);
    localStorage.setItem(PLAN_KEY, JSON.stringify(currentPlanResult));
    renderPlan(currentPlanResult);
  }

  $("#pricesBtn").addEventListener("click", () => {
    renderPricesList();
    $("#pricesDialog").showModal();
  });
  $("#pricesCloseBtn").addEventListener("click", () => $("#pricesDialog").close());
  $("#pricesDialog").addEventListener("click", (e) => {
    if (e.target === $("#pricesDialog")) $("#pricesDialog").close();
  });
  $("#pricesForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const overrides = {};
    [...document.querySelectorAll(".price-input")].forEach(input => {
      const food = input.dataset.food;
      const val = Math.max(0, Number(input.value) || 0);
      FOODS[food].price = val;
      if (Math.abs(val - DEFAULT_PRICES[food]) > 0.001) overrides[food] = val;
    });
    savePriceOverrides(overrides);
    commitPriceChanges();
    $("#pricesDialog").close();
  });
  $("#pricesResetBtn").addEventListener("click", () => {
    Object.keys(FOODS).forEach(food => { FOODS[food].price = DEFAULT_PRICES[food]; });
    savePriceOverrides({});
    renderPricesList();
    commitPriceChanges();
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

  $("#printBookletBtn").addEventListener("click", () => {
    if (!currentPlanResult) return;
    $("#printBooklet").innerHTML = renderPrintBooklet(currentPlanResult);
    document.body.classList.add("print-full-plan");
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

  $("#exportDataBtn").addEventListener("click", () => {
    const payload = { exportedAt: new Date().toISOString(), version: 1, data: {} };
    Object.keys(localStorage)
      .filter(k => k.startsWith("biteBudget."))
      .forEach(k => { payload.data[k] = localStorage.getItem(k); });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bitebudget-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#importDataBtn").addEventListener("click", () => $("#importDataInput").click());
  $("#importDataInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed.data !== "object") throw new Error("Not a BiteBudget backup file.");
      if (!confirm("Import this backup? This replaces your current settings, preferences, favorites, and history.")) return;
      Object.entries(parsed.data).forEach(([k, v]) => {
        if (k.startsWith("biteBudget.")) localStorage.setItem(k, v);
      });
      location.reload();
    } catch (err) {
      alert("Couldn't read that file — make sure it's a BiteBudget export.");
    } finally {
      e.target.value = "";
    }
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
    document.body.classList.remove("print-full-plan");
  });

  $("#macroProtein").addEventListener("input", () => balanceMacros("protein"));
  $("#macroCarbs").addEventListener("input", () => balanceMacros("carbs"));
  $("#macroFat").addEventListener("input", () => balanceMacros("fat"));
  balanceMacros("protein"); // ensure whatever loaded from storage/defaults sums to 100
}

document.addEventListener("DOMContentLoaded", init);
