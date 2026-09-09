const STORAGE_KEY = "biteBudget.settings.v1";
const PLAN_KEY = "biteBudget.plan.v1";
const FONT_SCALE_KEY = "biteBudget.fontScale.v1";
const FONT_SCALES = [90, 100, 112, 125, 140];
const PREFS_KEY = "biteBudget.preferences.v1";
const ONBOARDED_KEY = "biteBudget.onboarded.v1";
const SHOPPING_CHECKED_KEY = "biteBudget.shoppingChecked.v1";
const THEME_KEY = "biteBudget.theme.v1";
const FAVORITES_KEY = "biteBudget.favorites.v1";
const DISLIKED_RECIPES_KEY = "biteBudget.dislikedRecipes.v1";
const PANTRY_KEY = "biteBudget.pantry.v1";
const HISTORY_KEY = "biteBudget.history.v1";
const MY_MEALS_KEY = "biteBudget.myMeals.v1";
const CUSTOM_RECIPES_KEY = "biteBudget.customRecipes.v1";
const PRICE_OVERRIDES_KEY = "biteBudget.priceOverrides.v1";
// Snapshot of FOODS' shipped national-average prices, captured before any
// override is ever applied — lets the Edit Prices dialog show "(default
// $X.XX)" next to each field and power "reset to defaults".
const DEFAULT_PRICES = Object.fromEntries(Object.keys(FOODS).map(k => [k, FOODS[k].price]));
const RECIPES_TRIED_KEY = "biteBudget.recipesTried.v1";
// How many days a plan can sit before nudging "ready to plan next week?" —
// loose enough that a plan generated mid-week (not always on the same day)
// doesn't get flagged early, but still lands well inside a second week.
const PLAN_STALE_DAYS = 6;
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
const SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"];
const PREP_STORAGE_NOTE = "Store in airtight containers in the fridge up to 4 days, or freeze up to 3 months. Reheat covered until steaming.";
const WIZARD_TOTAL_STEPS = 4;
// Only appliances that actually change which recipes are available get a
// bubble — no shortcuts here either: several recipes already mention an
// air fryer or microwave, but always as an optional alternative to the
// oven/stovetop already in the instructions, so excluding them wouldn't
// change anything. Blender and slow cooker each gate real recipes with
// no such alternative (see requiresAppliance in js/meals.js).
const ALL_APPLIANCES = ["blender", "slow_cooker"];
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
// The floor scales with household size (servings) — a $20/week minimum
// makes sense for 1 person but not for a family of 6, so it's harder to
// casually land the slider somewhere the budget-feasibility warning would
// immediately flag anyway.
function applyBudgetSliderRange(rangeSel, numberSel, period, servings = 1) {
  const range = BUDGET_SLIDER_RANGES[period] || BUDGET_SLIDER_RANGES.weekly;
  const rangeEl = $(rangeSel), numberEl = $(numberSel);
  const min = Math.min(range.min * Math.max(1, servings), range.max - range.step);
  rangeEl.min = numberEl.min = min;
  rangeEl.max = numberEl.max = range.max;
  rangeEl.step = numberEl.step = range.step;
  const clamped = clamp(Number(numberEl.value) || min, min, range.max);
  rangeEl.value = clamped; // range inputs snap to the nearest step on assignment
  numberEl.value = rangeEl.value; // read back the snapped value so both controls agree exactly
}

// A budget set for 1 person doesn't stretch to 2 — without this, bumping
// "servings" up silently leaves the same dollar amount behind and every
// plan reads as over budget the moment you touch the field. Scales the
// existing budget by the same ratio the household size just changed by,
// so a deliberately-set number for N people becomes the equivalent for
// N+1 rather than needing to be manually doubled. The previous value is
// tracked on the servings input itself (not a module variable) so it
// survives across repeated changes and stays correct whether this is the
// Settings panel's own fields or the onboarding wizard's separate copies.
function scaleBudgetForServings(servingsSel, amountSel, sliderSel, period) {
  const servingsEl = $(servingsSel);
  const prev = Number(servingsEl.dataset.lastValue) || 1;
  const next = Math.max(1, Number(servingsEl.value) || 1);
  servingsEl.dataset.lastValue = next;
  if (prev === next) return;

  const range = BUDGET_SLIDER_RANGES[period] || BUDGET_SLIDER_RANGES.weekly;
  const amountEl = $(amountSel);
  const scaled = Math.round((Number(amountEl.value) * (next / prev)) / range.step) * range.step;
  amountEl.value = scaled;
  // Also re-applies the servings-scaled slider floor for the new headcount.
  applyBudgetSliderRange(sliderSel, amountSel, period, next);
}

let wizardStep = 1;

// Keeps a bubble's aria-pressed/aria-label in sync with its visual state
// (selected/disliked/excluded via CSS class, currently the only signal a
// sighted user gets) — called after every state change, both from real
// clicks and from prefillOnboarding()'s programmatic restores.
function updateBubbleAria(btn) {
  const base = btn.dataset.baseLabel ?? (btn.dataset.baseLabel = btn.textContent.trim());
  if (btn.classList.contains("selected")) {
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-label", `${base} — selected`);
  } else if (btn.classList.contains("excluded")) {
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-label", `${base} — excluded`);
  } else if (btn.classList.contains("disliked")) {
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-label", `${base} — disliked`);
  } else {
    btn.setAttribute("aria-pressed", "false");
    btn.removeAttribute("aria-label");
  }
}

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
      } else {
        const noPref = container.querySelector('.bubble[data-value="no_preference"]');
        if (noPref) noPref.classList.remove("selected");
        if (btn.classList.contains("selected")) {
          btn.classList.remove("selected");
        } else if (container.querySelectorAll(".bubble.selected").length < max) {
          btn.classList.add("selected");
        }
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
    } else if (mode === "style-tristate") {
      // Like multi-limited (capped preferred picks, "no preference"
      // exclusive) but with a third state: tap a preferred style again to
      // rule it out entirely (hard-excluded, no cap on how many).
      if (btn.dataset.value === "no_preference") {
        [...container.querySelectorAll(".bubble")].forEach(b => b.classList.toggle("selected", b === btn));
        container.querySelectorAll(".bubble").forEach(b => b.classList.remove("excluded"));
      } else {
        const noPref = container.querySelector('.bubble[data-value="no_preference"]');
        if (btn.classList.contains("selected")) {
          btn.classList.remove("selected");
          btn.classList.add("excluded");
        } else if (btn.classList.contains("excluded")) {
          btn.classList.remove("excluded");
        } else if (container.querySelectorAll(".bubble.selected").length < max) {
          if (noPref) noPref.classList.remove("selected");
          btn.classList.add("selected");
        } else {
          // Preferred cap already reached — this bubble can't become
          // preferred, but excluding has no cap, so a tap still does
          // something useful instead of being silently ignored.
          if (noPref) noPref.classList.remove("selected");
          btn.classList.add("excluded");
        }
      }
    } else {
      [...container.querySelectorAll(".bubble")].forEach(b => b.classList.toggle("selected", b === btn));
    }
    container.querySelectorAll(".bubble").forEach(updateBubbleAria);
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
  $("#appNav").classList.add("hidden");
  Object.values(SECTION_IDS).forEach(id => $(`#${id}`).classList.add("hidden"));
}

function hideOnboarding() {
  $("#onboarding").classList.add("hidden");
  $("#appNav").classList.remove("hidden");
  showSection(activeSection);
}

function clearBubbleSelections() {
  // Scoped to the wizard itself — Signature meal's bubbles now live in
  // Settings and must survive reopening "🎯 Preferences".
  document.querySelectorAll("#onboarding .bubble.selected, #onboarding .bubble.disliked, #onboarding .bubble.excluded").forEach(b => b.classList.remove("selected", "disliked", "excluded"));
}

function prefillOnboarding(prefs) {
  clearBubbleSelections();

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
    Object.entries(prefs.excludedMealStyle || {}).forEach(([slot, vals]) => {
      const groupId = STYLE_GROUP_IDS[slot];
      if (!groupId) return;
      [].concat(vals).forEach(val => {
        const b = document.querySelector(`#${groupId} .bubble[data-value="${val}"]`);
        if (b) b.classList.add("excluded");
      });
    });
  }

  // Appliance bubbles start selected in the markup, but clearBubbleSelections()
  // above wiped that along with everything else — restore "has it" (selected)
  // for every appliance except the ones actually saved as missing, so
  // reopening Preferences with nothing saved yet still defaults to "has
  // everything" rather than leaving every bubble blank.
  const missingAppliances = (prefs && prefs.missingAppliances) || [];
  ALL_APPLIANCES.forEach(a => {
    const b = document.querySelector(`#applianceBubbles .bubble[data-value="${a}"]`);
    if (b) b.classList.toggle("selected", !missingAppliances.includes(a));
  });

  // Calorie/budget/servings aren't part of PREFS_KEY — they live in
  // Settings already, so seed the wizard's copies from whatever Settings
  // currently holds. lastValue is seeded too so the next servings edit
  // scales budget relative to this real starting point, not a stale one.
  $("#obServings").value = $("#servings").value;
  $("#obServings").dataset.lastValue = $("#obServings").value;

  $("#obCalories").value = $("#calories").value;
  $("#obCaloriesSlider").value = $("#calories").value;
  const trackCalories = $("#trackCalories").checked;
  document.querySelector(`#obTrackCaloriesYesNo .bubble[data-value="${trackCalories ? "yes" : "no"}"]`)
    ?.dispatchEvent(new Event("click", { bubbles: true }));

  const period = $("#budgetPeriod").value;
  const periodBtn = document.querySelector(`#obBudgetPeriod .bubble[data-value="${period}"]`);
  if (periodBtn) periodBtn.classList.add("selected");
  $("#obBudgetAmount").value = $("#budgetAmount").value;
  applyBudgetSliderRange("#obBudgetAmountSlider", "#obBudgetAmount", period, Number($("#obServings").value) || 1);

  // Most of the state above was just set via classList.add directly
  // (bypassing the click handler that normally keeps aria in sync) — one
  // sweep catches all of it.
  document.querySelectorAll(".bubble").forEach(updateBubbleAria);
}

function collectPreferences() {
  const proteins = [...document.querySelectorAll("#proteinBubbles .bubble.selected")].map(b => b.dataset.value);
  const dislikedProteins = [...document.querySelectorAll("#proteinBubbles .bubble.disliked")].map(b => b.dataset.value);

  const mealStyle = {};
  const excludedMealStyle = {};
  Object.entries(STYLE_GROUP_IDS).forEach(([slot, groupId]) => {
    const sel = [...document.querySelectorAll(`#${groupId} .bubble.selected`)]
      .map(b => b.dataset.value)
      .filter(v => v !== "no_preference");
    if (sel.length) mealStyle[slot] = sel;
    const excluded = [...document.querySelectorAll(`#${groupId} .bubble.excluded`)].map(b => b.dataset.value);
    if (excluded.length) excludedMealStyle[slot] = excluded;
  });

  // Bubbles start selected (has it) — anything left unselected is what
  // the user actively said they don't have, mirroring excludedMealStyle's
  // "positive list of exclusions" shape rather than a list of what they do have.
  const missingAppliances = ALL_APPLIANCES.filter(a => !document.querySelector(`#applianceBubbles .bubble[data-value="${a}"]`)?.classList.contains("selected"));

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
    excludedMealStyle: Object.keys(excludedMealStyle).length ? excludedMealStyle : undefined,
    missingAppliances: missingAppliances.length ? missingAppliances : undefined,
    signature,
  };
}

// Copies the wizard's calorie/budget/meal-prep answers into the real
// Settings fields (and their sliders), matching Settings' own lazy-persist
// convention — nothing is written to STORAGE_KEY until Generate Plan runs.
function syncOnboardingIntoSettings() {
  $("#servings").value = $("#obServings").value;
  $("#servings").dataset.lastValue = $("#servings").value;

  const trackCalories = document.querySelector("#obTrackCaloriesYesNo .bubble.selected")?.dataset.value === "yes";
  $("#trackCalories").checked = trackCalories;
  toggleCalorieFields(trackCalories);
  $("#calories").value = $("#obCalories").value;
  $("#caloriesSlider").value = $("#obCalories").value;

  const periodBtn = document.querySelector("#obBudgetPeriod .bubble.selected");
  const period = periodBtn ? periodBtn.dataset.value : $("#budgetPeriod").value;
  $("#budgetPeriod").value = period;
  $("#budgetAmount").value = $("#obBudgetAmount").value;
  applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", period, Number($("#servings").value) || 1);

  checkBudgetFeasibility();
}

// Signature meal now lives only in Settings, not the wizard — merge its
// current DOM state into PREFS_KEY without clobbering wizard-only fields
// (proteins, mealStyle, excludedMealStyle, missingAppliances).
function saveSignaturePreference() {
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
  const saved = localStorage.getItem(PREFS_KEY);
  const prefs = saved ? JSON.parse(saved) : {};
  if (signature) prefs.signature = signature;
  else delete prefs.signature;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// Seeds Signature meal's bubbles/note from saved preferences — called once
// at init, since these fields live in Settings and aren't part of the wizard.
function seedSignatureFields(prefs) {
  if (!prefs || !prefs.signature) return;
  if (prefs.signature.slot) {
    const b = document.querySelector(`#signatureSlot .bubble[data-value="${prefs.signature.slot}"]`);
    if (b) b.classList.add("selected");
  }
  if (prefs.signature.preset) {
    const b = document.querySelector(`#signaturePreset .bubble[data-value="${prefs.signature.preset}"]`);
    if (b) b.classList.add("selected");
  }
  $("#signatureNote").value = prefs.signature.note || "";
  document.querySelectorAll("#signatureSlot .bubble, #signaturePreset .bubble").forEach(updateBubbleAria);
}

function finishOnboarding() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(collectPreferences()));
  localStorage.setItem(ONBOARDED_KEY, "1");
  syncOnboardingIntoSettings();
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

function setFavoriteButtonsState(templateId, nowFavorite) {
  document.querySelectorAll(`.favorite-btn[data-template-id="${templateId}"]`).forEach(btn => {
    btn.textContent = nowFavorite ? "❤️" : "🤍";
    btn.classList.toggle("active", nowFavorite);
    btn.setAttribute("aria-label", nowFavorite ? "Remove from favorites" : "Favorite this meal");
    btn.setAttribute("aria-pressed", nowFavorite ? "true" : "false");
  });
  if (currentRecipeMealId === templateId) {
    $("#recipeFavoriteBtn").textContent = nowFavorite ? "❤️ Favorited" : "🤍 Favorite this recipe";
    $("#recipeFavoriteBtn").classList.toggle("active", nowFavorite);
  }
}

// Toggles one template's favorite state and updates every visible button
// for it at once (the same recipe can appear more than once in a week).
// Favoriting a recipe you'd previously marked "not for me" clears that —
// they're two verdicts on the same thing, not independent toggles.
function toggleFavorite(templateId) {
  const favorites = loadFavorites();
  if (favorites.has(templateId)) favorites.delete(templateId); else favorites.add(templateId);
  saveFavorites(favorites);
  const nowFavorite = favorites.has(templateId);

  if (nowFavorite) {
    const disliked = loadDislikedRecipes();
    if (disliked.has(templateId)) {
      disliked.delete(templateId);
      saveDislikedRecipes(disliked);
      setDislikeButtonsState(templateId, false);
    }
  }

  setFavoriteButtonsState(templateId, nowFavorite);
  return nowFavorite;
}

function loadDislikedRecipes() {
  const saved = localStorage.getItem(DISLIKED_RECIPES_KEY);
  return saved ? new Set(JSON.parse(saved)) : new Set();
}

function saveDislikedRecipes(disliked) {
  localStorage.setItem(DISLIKED_RECIPES_KEY, JSON.stringify([...disliked]));
}

function isDislikedRecipe(templateId) {
  return loadDislikedRecipes().has(templateId);
}

function setDislikeButtonsState(templateId, nowDisliked) {
  document.querySelectorAll(`.dislike-btn[data-template-id="${templateId}"]`).forEach(btn => {
    btn.classList.toggle("active", nowDisliked);
    btn.setAttribute("aria-label", nowDisliked ? "Remove \"not for me\"" : "Not for me — don't suggest this again");
    btn.setAttribute("aria-pressed", nowDisliked ? "true" : "false");
  });
  if (currentRecipeMealId === templateId) {
    $("#recipeDislikeBtn").textContent = nowDisliked ? "👎 Not for me" : "👎 Not for me?";
    $("#recipeDislikeBtn").classList.toggle("active", nowDisliked);
  }
}

// Marking a recipe "not for me" is a real, permanent exclusion (see
// pickTemplate in planner.js) — much stronger than the soft preference
// bias everything else in this system uses, since it's the most specific,
// deliberate feedback a user can give about one exact recipe. Mutually
// exclusive with favoriting, same reasoning as toggleFavorite above.
function toggleDislikedRecipe(templateId) {
  const disliked = loadDislikedRecipes();
  if (disliked.has(templateId)) disliked.delete(templateId); else disliked.add(templateId);
  saveDislikedRecipes(disliked);
  const nowDisliked = disliked.has(templateId);

  if (nowDisliked) {
    const favorites = loadFavorites();
    if (favorites.has(templateId)) {
      favorites.delete(templateId);
      saveFavorites(favorites);
      setFavoriteButtonsState(templateId, false);
    }
  }

  setDislikeButtonsState(templateId, nowDisliked);
  return nowDisliked;
}

// Preferences saved during onboarding, plus favorites/dislikes layered on
// top — both work even if onboarding was skipped entirely. Stays
// undefined (matching generatePlan's no-preferences behavior) only when
// none of the three exist.
function loadPreferences() {
  const saved = localStorage.getItem(PREFS_KEY);
  const prefs = saved ? JSON.parse(saved) : null;
  const favoriteIds = [...loadFavorites()];
  const dislikedRecipeIds = [...loadDislikedRecipes()];
  if (!prefs && favoriteIds.length === 0 && dislikedRecipeIds.length === 0) return undefined;
  return { ...(prefs || {}), favoriteIds, dislikedRecipeIds };
}

// {food: grams} of what's already on hand — see the Pantry dialog. Never
// written by generating/shuffling/swapping a plan, only by the dialog
// itself (adding a suggestion, a manual edit, a removal, or Clear): the
// shopping list always discounts whatever's *currently* here, however
// long it's been there, until the user says otherwise.
function loadPantry() {
  const saved = localStorage.getItem(PANTRY_KEY);
  return saved ? JSON.parse(saved) : {};
}

function savePantry(pantry) {
  localStorage.setItem(PANTRY_KEY, JSON.stringify(pantry));
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
  Object.values(STYLE_GROUP_IDS).forEach(id => wireBubbleGroup($(`#${id}`), "style-tristate", { max: 3 }));
  wireBubbleGroup($("#applianceBubbles"), "multi");
  wireBubbleGroup($("#signatureSlot"), "single");
  wireBubbleGroup($("#signaturePreset"), "single");

  wireBubbleGroup($("#obBudgetPeriod"), "single");
  $("#obBudgetPeriod").addEventListener("click", (e) => {
    const btn = e.target.closest(".bubble");
    if (btn) applyBudgetSliderRange("#obBudgetAmountSlider", "#obBudgetAmount", btn.dataset.value, Number($("#obServings").value) || 1);
  });

  $("#obServings").dataset.lastValue = $("#obServings").value;
  $("#obServings").addEventListener("change", () => {
    const period = document.querySelector("#obBudgetPeriod .bubble.selected")?.dataset.value || "weekly";
    scaleBudgetForServings("#obServings", "#obBudgetAmount", "#obBudgetAmountSlider", period);
  });

  wireBubbleGroup($("#obTrackCaloriesYesNo"), "single");
  $("#obTrackCaloriesYesNo").addEventListener("click", (e) => {
    const btn = e.target.closest(".bubble");
    if (btn) $("#obCaloriesDetails").classList.toggle("hidden", btn.dataset.value !== "yes");
  });

  // Establishes correct aria-pressed/aria-label for whatever's selected by
  // default in the static HTML (e.g. "No, keep it varied") before any
  // click or prefill has run.
  document.querySelectorAll(".bubble").forEach(updateBubbleAria);

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
    servings: Number($("#servings").value) || 1,
    trackCalories: $("#trackCalories").checked,
    mealPrep: {
      breakfast: Number($("#prepBreakfast").value),
      lunch: Number($("#prepLunch").value),
      dinner: Number($("#prepDinner").value),
      snack: Number($("#prepSnack").value),
    },
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
  $("#servings").value = s.servings || 1;
  $("#servings").dataset.lastValue = $("#servings").value;
  $("#trackCalories").checked = s.trackCalories !== false;
  toggleCalorieFields($("#trackCalories").checked);
  const prep = s.mealPrep || { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  $("#prepBreakfast").value = prep.breakfast;
  $("#prepLunch").value = prep.lunch;
  $("#prepDinner").value = prep.dinner;
  $("#prepSnack").value = prep.snack || 0;
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

function toggleCalorieFields(tracking) {
  $("#calorieTargetRow").classList.toggle("hidden", !tracking);
}

function checkBudgetFeasibility() {
  const dailyCalories = Number($("#calories").value) || 0;
  const snacksPerDay = Number($("#snacks").value) || 1;
  const vegetarianOnly = $("#vegetarian").checked;
  const trackCalories = $("#trackCalories").checked;
  const servings = Number($("#servings").value) || 1;
  const dailyBudget = dailyBudgetFor($("#budgetPeriod").value, Number($("#budgetAmount").value) || 0);
  const minDailyCost = estimateMinDailyCost(dailyCalories, snacksPerDay, vegetarianOnly, trackCalories, servings);

  const banner = $("#budgetWarning");
  if (dailyBudget < minDailyCost) {
    const forWhom = trackCalories ? "at this calorie target" : servings > 1 ? `for ${servings} people` : "for the cheapest meals";
    const fix = trackCalories ? "raising your budget, lowering calories, or turning on Vegetarian only" : "raising your budget or turning on Vegetarian only";
    banner.innerHTML = `⚠️ ${money(dailyBudget)}/day may not cover even the cheapest meals ${forWhom} (~${money(minDailyCost)}/day minimum). Try ${fix}.`;
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
  const disliked = !meal.custom && isDislikedRecipe(meal.id);
  const actionButtons = meal.custom
    ? `
        <button type="button" class="custom-meal-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Edit this meal" title="Edit this meal">✏️</button>
        <button type="button" class="meal-swap-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Replace with an auto-picked meal" title="Replace with an auto-picked meal">↩️</button>`
    : `
        <button type="button" class="favorite-btn ${favorite ? "active" : ""}" data-template-id="${meal.id}" aria-label="${favorite ? "Remove from favorites" : "Favorite this meal"}" aria-pressed="${favorite}" title="Favorite this meal">${favorite ? "❤️" : "🤍"}</button>
        <button type="button" class="dislike-btn ${disliked ? "active" : ""}" data-template-id="${meal.id}" aria-label="${disliked ? "Remove \"not for me\"" : "Not for me — don't suggest this again"}" aria-pressed="${disliked}" title="Not for me — don't suggest this again">👎</button>
        <button type="button" class="meal-swap-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Swap this meal" title="Swap this meal">🔀</button>
        <button type="button" class="custom-meal-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Log your own meal instead" title="Log your own meal instead">📝</button>`;

  return `
    <div class="meal-card ${meal.custom ? "custom-meal-card" : ""}">
      <div class="meal-head">
        <span class="meal-icon">${slotIcon(meal.slot)}</span>
        <div class="meal-title">
          <div class="meal-slot">${meal.slot}</div>
          <div class="meal-name">${meal.name}</div>
        </div>
        <div class="meal-head-actions">
          ${actionButtons}
          <div class="meal-cost">${money(n.cost)}</div>
        </div>
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

// One card per matching template — its own scaled-to-nobody's-target
// base nutrition/cost (a template's own designed size, same numbers
// shown before any calorie-target or servings scaling happens), the
// same ❤️/👎 buttons meal cards use (keyed by template id, so favoriting
// or ruling out a recipe here does the exact same thing it would from a
// generated plan), and a "View Recipe" that opens the same cookbook page.
function renderRecipeBookCard(t) {
  const n = computeNutrition(t.items);
  const favorite = isFavorite(t.id);
  const disliked = isDislikedRecipe(t.id);
  const time = formatTime(t.prepTime, t.cookTime);
  return `
    <div class="meal-card">
      <div class="meal-head">
        <span class="meal-icon">${slotIcon(t.slot)}</span>
        <div class="meal-title">
          <div class="meal-slot">${t.slot}${t.userRecipe ? ` · <span class="user-recipe-badge">✨ Yours</span>` : ""}</div>
          <div class="meal-name">${t.name}</div>
        </div>
        <div class="meal-head-actions">
          ${t.userRecipe ? `<button type="button" class="recipe-edit-btn" data-template-id="${t.id}" aria-label="Edit this recipe" title="Edit this recipe">✏️</button>` : ""}
          <button type="button" class="favorite-btn ${favorite ? "active" : ""}" data-template-id="${t.id}" aria-label="${favorite ? "Remove from favorites" : "Favorite this meal"}" aria-pressed="${favorite}" title="Favorite this meal">${favorite ? "❤️" : "🤍"}</button>
          <button type="button" class="dislike-btn ${disliked ? "active" : ""}" data-template-id="${t.id}" aria-label="${disliked ? "Remove \"not for me\"" : "Not for me — don't suggest this again"}" aria-pressed="${disliked}" title="Not for me — don't suggest this again">👎</button>
          <div class="meal-cost">${money(n.cost)}</div>
        </div>
      </div>
      <div class="meal-macros">
        <span>${Math.round(n.cal)} kcal</span>
        <span>P ${grams(n.protein)}</span>
        <span>C ${grams(n.carbs)}</span>
        <span>F ${grams(n.fat)}</span>
        ${time ? `<span>${time}</span>` : ""}
      </div>
      <button type="button" class="recipe-book-view-btn" data-template-id="${t.id}">📖 View Recipe</button>
    </div>`;
}

function renderRecipeBook() {
  const search = $("#recipeSearch").value.trim().toLowerCase();
  const slot = document.querySelector("#recipeSlotFilter .bubble.selected")?.dataset.value || "all";
  const protein = document.querySelector("#recipeProteinFilter .bubble.selected")?.dataset.value || "all";
  const vegOnly = $("#recipeVegOnly").checked;

  const matches = MEAL_TEMPLATES.filter(t => {
    if (slot !== "all" && t.slot !== slot) return false;
    if (protein !== "all" && !templateProteinFamilies(t).includes(protein)) return false;
    if (vegOnly && !isVegetarian(t.items)) return false;
    if (search && !t.name.toLowerCase().includes(search)) return false;
    return true;
  });

  $("#recipeBookCount").textContent = `${matches.length} recipe${matches.length === 1 ? "" : "s"}`;
  $("#recipeBookList").innerHTML = matches.length
    ? matches.map(renderRecipeBookCard).join("")
    : `<p class="history-empty">No recipes match — try a different search or filter.</p>`;
}

function loadCustomRecipes() {
  const saved = localStorage.getItem(CUSTOM_RECIPES_KEY);
  return saved ? JSON.parse(saved) : [];
}

function saveCustomRecipes(recipes) {
  localStorage.setItem(CUSTOM_RECIPES_KEY, JSON.stringify(recipes));
}

// A user recipe is a real MEAL_TEMPLATES entry (tagged userRecipe: true) so
// it's picked up automatically everywhere a template already is — the
// planner's pool, the shopping list, favorites/dislikes, the print
// booklet — with zero changes to any of that code. Re-run after every
// add/edit/delete so the current session's pool never goes stale.
function syncCustomRecipesIntoTemplates() {
  for (let i = MEAL_TEMPLATES.length - 1; i >= 0; i--) {
    if (MEAL_TEMPLATES[i].userRecipe) MEAL_TEMPLATES.splice(i, 1);
  }
  loadCustomRecipes().forEach(r => MEAL_TEMPLATES.push({ ...r, userRecipe: true }));
}

// Grouped-by-category <option> list for an ingredient row's food picker —
// same grouping as the Edit Prices dialog and the shopping list.
function foodOptionsHTML(selectedFood) {
  const groups = {};
  Object.keys(FOODS).forEach(food => {
    const cat = FOODS[food].category || "Pantry & Grains";
    (groups[cat] = groups[cat] || []).push(food);
  });
  return SHOPPING_CATEGORY_ORDER.filter(cat => groups[cat]).map(cat => {
    const options = [...groups[cat]].sort((a, b) => FOODS[a].name.localeCompare(FOODS[b].name))
      .map(food => `<option value="${food}" ${food === selectedFood ? "selected" : ""}>${FOODS[food].name}</option>`).join("");
    return `<optgroup label="${cat}">${options}</optgroup>`;
  }).join("");
}

function customRecipeIngredientRowHTML(food, grams) {
  const defaultFood = food || Object.keys(FOODS)[0];
  return `
    <div class="custom-recipe-ingredient-row">
      <select class="custom-recipe-food-select" aria-label="Ingredient">${foodOptionsHTML(defaultFood)}</select>
      <input type="number" class="custom-recipe-grams-input" min="0" step="5" value="${grams != null ? grams : 100}" aria-label="Grams">
      <span class="unit-label">g</span>
      <button type="button" class="custom-recipe-remove-ingredient" aria-label="Remove ingredient">✕</button>
    </div>`;
}

function readCustomRecipeIngredients() {
  return [...document.querySelectorAll("#customRecipeIngredients .custom-recipe-ingredient-row")]
    .map(row => ({
      food: row.querySelector(".custom-recipe-food-select").value,
      grams: Math.max(0, Number(row.querySelector(".custom-recipe-grams-input").value) || 0),
    }))
    .filter(({ grams }) => grams > 0);
}

function updateCustomRecipeNutritionPreview() {
  const items = readCustomRecipeIngredients();
  const n = items.length ? computeNutrition(items) : { cal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 };
  $("#customRecipeNutritionPreview").textContent =
    `${Math.round(n.cal)} kcal · P ${grams(n.protein)} · C ${grams(n.carbs)} · F ${grams(n.fat)} · ${money(n.cost)}`;
  if (items.length) $("#customRecipeError").classList.add("hidden");
}

let customRecipeEditingId = null;

// `existing` is a saved custom recipe to edit, or null/undefined to create
// a new one from a blank single-ingredient-row form.
function openCustomRecipeDialog(existing) {
  customRecipeEditingId = existing ? existing.id : null;
  $("#customRecipeTitle").textContent = existing ? "✏️ Edit Your Recipe" : "✨ Add Your Recipe";
  $("#customRecipeDeleteBtn").classList.toggle("hidden", !existing);
  $("#customRecipeError").classList.add("hidden");
  $("#customRecipeName").value = existing ? existing.name : "";
  $("#customRecipeInstructions").value = existing ? existing.instructions.join("\n") : "";

  const slot = existing ? existing.slot : "breakfast";
  document.querySelectorAll("#customRecipeSlot .bubble").forEach(b => b.classList.toggle("selected", b.dataset.value === slot));
  document.querySelectorAll("#customRecipeSlot .bubble").forEach(updateBubbleAria);

  const rows = existing && existing.items.length ? existing.items : [{ food: null, grams: 100 }];
  $("#customRecipeIngredients").innerHTML = rows.map(i => customRecipeIngredientRowHTML(i.food, i.grams)).join("");
  updateCustomRecipeNutritionPreview();

  $("#customRecipeDialog").showModal();
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
  const disliked = isDislikedRecipe(meal.id);
  $("#recipeDislikeBtn").textContent = disliked ? "👎 Not for me" : "👎 Not for me?";
  $("#recipeDislikeBtn").classList.toggle("active", disliked);
  $("#nutritionLabel").innerHTML = renderNutritionLabel(n);
  $("#recipeIngredients").innerHTML = meal.items.map(i => `<li>${FOODS[i.food].name} — ${formatServing(i.food, i.grams)}</li>`).join("");
  $("#recipeInstructions").innerHTML = meal.instructions.map(s => `<li>${s}</li>`).join("");
  $("#recipeModal").showModal();
}

function renderDayTab(day, dayIndex, dailyBudget, dailyCalories, minDailyCost, trackCalories = true) {
  const t = day.totals;
  const overBudget = t.cost > dailyBudget * 1.05;
  const budgetClass = overBudget ? "bad" : "good";
  const calDiff = t.cal - dailyCalories;
  const suggestion = overBudget && dailyBudget < minDailyCost
    ? `<div class="budget-suggestion">Try raising your budget to ~${money(minDailyCost)}/day or turning on Vegetarian only.</div>`
    : "";
  const calValue = trackCalories
    ? `${Math.round(t.cal)} <span class="muted">/ ${dailyCalories} target (${calDiff >= 0 ? "+" : ""}${Math.round(calDiff)})</span>`
    : `${Math.round(t.cal)} kcal`;
  return `
    <div class="day-summary">
      <div class="day-summary-item">
        <div class="label">Calories</div>
        <div class="value">${calValue}</div>
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
    const rows = items.map(i => {
      const haveEnough = i.grams <= 0 && i.fromPantry > 0;
      const qtyDisplay = haveEnough ? `<span class="shopping-item-have">✓ Have enough</span>` : formatShoppingQty(i.food, i.grams);
      const pantryNote = i.fromPantry > 0 && !haveEnough ? `<span class="shopping-item-pantry-note">🥫 using ${formatServing(i.food, i.fromPantry)} from pantry</span>` : "";
      return `
      <li class="shopping-item ${checked.has(i.food) ? "checked" : ""} ${haveEnough ? "have-enough" : ""}">
        <label>
          <input type="checkbox" class="shopping-check" data-food="${i.food}" ${checked.has(i.food) ? "checked" : ""}>
          <span class="shopping-item-name">${i.name}${pantryNote}</span>
          <span class="shopping-item-qty">${qtyDisplay}</span>
          <span class="shopping-item-cost">${money(i.cost)}</span>
        </label>
      </li>`;
    }).join("");
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

// Suggestions not yet in the pantry — foods already added don't need to
// be suggested again (re-suggesting something the user already confirmed
// would just be noise). Purely a read; nothing here touches storage.
// A real week's shopping list can have a meaningful rounding surplus on
// a couple dozen different foods at once — technically real, but a list
// that long isn't something anyone will actually read. Caps to the 8
// worth the most (surplus grams × price), so what's shown is the stuff
// actually worth remembering, not a wall of 50-cent odds and ends.
function pendingPantrySuggestions() {
  if (!currentPlanResult) return {};
  const pantry = loadPantry();
  const surplus = estimateLeftoverSurplus(currentPlanResult.shoppingList);
  const entries = Object.entries(surplus)
    .filter(([food]) => !(food in pantry))
    .sort(([foodA, gramsA], [foodB, gramsB]) => (FOODS[foodB].price * gramsB) - (FOODS[foodA].price * gramsA))
    .slice(0, 8);
  return Object.fromEntries(entries);
}

// Shows a live count on the Pantry button so an unreviewed suggestion is
// actually discoverable instead of sitting silently behind a dialog
// nobody thinks to open.
function updatePantryButtonBadge() {
  const btn = $("#pantryBtn");
  if (!btn) return;
  const count = Object.keys(pendingPantrySuggestions()).length;
  btn.textContent = count > 0 ? `🥫 Pantry (${count})` : "🥫 Pantry";
}

function renderPantryDialog() {
  const pantry = loadPantry();
  const pending = pendingPantrySuggestions();

  const suggestedEntries = Object.entries(pending);
  $("#pantrySuggested").innerHTML = suggestedEntries.length ? `
    <p class="pantry-section-label">Might be left over from this week's shopping</p>
    <div class="pantry-suggested-list">
      ${suggestedEntries.map(([food, grams]) => `
        <div class="pantry-suggested-row">
          <span>${FOODS[food].name} — ${formatServing(food, grams)}</span>
          <button type="button" class="pantry-add-btn" data-food="${food}" data-grams="${grams}">+ Add</button>
        </div>`).join("")}
    </div>` : "";

  const pantryEntries = Object.entries(pantry);
  $("#pantryItems").innerHTML = pantryEntries.length ? `
    <p class="pantry-section-label">Your pantry</p>
    ${pantryEntries.map(([food, grams]) => `
      <div class="pantry-row">
        <span class="pantry-row-name">${FOODS[food].name}</span>
        <span class="pantry-row-hint">${formatServing(food, grams)}</span>
        <input type="number" class="pantry-row-input" data-food="${food}" value="${Math.round(grams)}" min="0" aria-label="${FOODS[food].name} on hand, in grams"> g
        <button type="button" class="pantry-remove-btn" data-food="${food}" aria-label="Remove ${FOODS[food].name} from pantry">✕</button>
      </div>`).join("")}
  ` : `<p class="pantry-empty">Nothing in your pantry yet.</p>`;
}

// Builds the full printable meal-plan booklet: every day, every meal, full
// ingredients/instructions — the same content openRecipeModal shows for one
// meal, laid out single-column (no spine) for clean print pagination.
function renderPrintBooklet(result) {
  const { plan, summary } = result;
  const calSegment = summary.trackCalories !== false ? ` · ${summary.dailyCalories} kcal/day` : "";
  const servingsSegment = (summary.servings || 1) > 1 ? ` · for ${summary.servings} people` : "";
  const header = `
    <div class="booklet-header">
      <h1>BiteBudget Meal Plan</h1>
      <p>${summary.days} days${calSegment}${servingsSegment} · ${money(summary.totalCost)} / ${money(summary.totalBudget)} budget</p>
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
              <ul>${m.items.map(i => `<li>${FOODS[i.food].name} — ${formatServing(i.food, i.grams)}</li>`).join("")}</ul>
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

// "Makes 3 meals" alone gets ambiguous once a household size is set — a
// batch of 3 meal-prepped occurrences at servings=4 actually makes 12 real
// portions, so spell that out once servings isn't the default 1.
function prepBatchServingsLabel(b) {
  const mealWord = `meal${b.occurrences === 1 ? "" : "s"}`;
  if (!b.servings || b.servings === 1) return `Makes ${b.occurrences} ${mealWord}`;
  return `Makes ${b.occurrences} ${mealWord} × ${b.servings} servings each`;
}

// On-screen batch-cooking summary shown only in meal prep mode — one card
// per distinct recipe across the whole plan (see groupIntoPrepBatches),
// instead of the day-by-day cards below it.
function renderPrepBatches(batches) {
  const sorted = [...batches].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  return sorted.map(b => `
    <div class="prep-batch-card">
      <div class="prep-batch-head">
        <div>
          <div class="prep-batch-slot">${slotIcon(b.slot)} ${b.slot}</div>
          <div class="prep-batch-name">${b.name}</div>
        </div>
        <button type="button" class="prep-batch-shuffle-btn" data-batch-id="${b.id}" aria-label="Prep a different recipe instead" title="Prep a different recipe instead">🔀</button>
      </div>
      <div class="prep-batch-servings">🧺 ${prepBatchServingsLabel(b)} · ${money(b.cost)}</div>
      <ul class="prep-batch-items">${b.items.map(i => `<li>${FOODS[i.food].name} — ${formatServing(i.food, i.grams)}</li>`).join("")}</ul>
      <details class="prep-batch-instructions">
        <summary>📋 How to make this batch</summary>
        <ol>${b.instructions.map(s => `<li>${s}</li>`).join("")}</ol>
      </details>
      <p class="prep-batch-note">${PREP_STORAGE_NOTE}</p>
    </div>`).join("");
}

// Printable version of the same batch grouping — its own separate print
// document, same pattern as renderPrintBooklet.
function renderPrintPrepGuide(result) {
  const batches = groupIntoPrepBatches(result.plan);
  const sorted = [...batches].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const header = `
    <div class="booklet-header">
      <h1>BiteBudget Prep Guide</h1>
      <p>${result.summary.days} days · cook each recipe once, portion out for the week</p>
    </div>`;
  const cards = sorted.map(b => `
    <div class="booklet-meal">
      <h3>${slotIcon(b.slot)} ${b.slot} — ${b.name}</h3>
      <p class="booklet-meal-macros">${prepBatchServingsLabel(b)} · ${money(b.cost)} total</p>
      <div class="booklet-meal-body">
        <div>
          <strong>Total ingredients</strong>
          <ul>${b.items.map(i => `<li>${FOODS[i.food].name} — ${formatServing(i.food, i.grams)}</li>`).join("")}</ul>
        </div>
        <div>
          <strong>Instructions</strong>
          <ol>${b.instructions.map(s => `<li>${s}</li>`).join("")}</ol>
        </div>
      </div>
      <p class="booklet-meal-macros">${PREP_STORAGE_NOTE}</p>
    </div>`).join("");
  return header + cards;
}

// Calories and cost per day, side by side across the whole week — each
// day tab already shows its own totals, but seeing all of them at once is
// what actually reveals a pattern (e.g. one blown-out day dragging the
// whole week over budget) that paging through days one at a time hides.
// Built entirely from day.totals, already computed by recomputeDayTotals —
// no new planner logic needed.
function renderWeekDashboard(plan, summary) {
  if (!plan.length) return "";
  const trackCalories = summary.trackCalories !== false;
  const dailyCalories = summary.dailyCalories;
  const dailyBudget = summary.dailyBudget;

  const maxCal = Math.max(...plan.map(d => d.totals.cal), trackCalories ? dailyCalories : 0, 1);
  const maxCost = Math.max(...plan.map(d => d.totals.cost), dailyBudget, 1);
  const calTargetPct = trackCalories ? clamp((dailyCalories / maxCal) * 100, 0, 100) : null;
  const budgetPct = clamp((dailyBudget / maxCost) * 100, 0, 100);

  const calBars = plan.map(d => `
    <div class="dashboard-bar-col">
      <div class="dashboard-bar-value">${Math.round(d.totals.cal)}</div>
      <div class="dashboard-bar-track">
        <div class="dashboard-bar-fill" style="height: ${clamp((d.totals.cal / maxCal) * 100, 0, 100)}%"></div>
        ${trackCalories ? `<div class="dashboard-target-line" style="bottom: ${calTargetPct}%"></div>` : ""}
      </div>
      <div class="dashboard-bar-label">Day ${d.day}</div>
    </div>`).join("");

  const costBars = plan.map(d => {
    const over = d.totals.cost > dailyBudget * 1.05;
    return `
    <div class="dashboard-bar-col">
      <div class="dashboard-bar-value">${money(d.totals.cost)}</div>
      <div class="dashboard-bar-track">
        <div class="dashboard-bar-fill ${over ? "bad" : "good"}" style="height: ${clamp((d.totals.cost / maxCost) * 100, 0, 100)}%"></div>
        <div class="dashboard-target-line" style="bottom: ${budgetPct}%"></div>
      </div>
      <div class="dashboard-bar-label">Day ${d.day}</div>
    </div>`;
  }).join("");

  const days = plan.length;
  const avg = (key) => plan.reduce((s, d) => s + d.totals[key], 0) / days;
  const avgMeta = trackCalories ? `
    <div class="meta-item"><div class="label">Avg calories / day</div><div class="value">${Math.round(avg("cal"))} kcal</div></div>
    <div class="meta-item"><div class="label">Avg macros / day (P/C/F)</div><div class="value">${grams(avg("protein"))} / ${grams(avg("carbs"))} / ${grams(avg("fat"))}</div></div>` : "";

  return `
    <div class="dashboard-charts">
      <div class="dashboard-chart">
        <h4>Calories per day${trackCalories ? ` <span class="muted">(dashed = target)</span>` : ""}</h4>
        <div class="dashboard-bars">${calBars}</div>
      </div>
      <div class="dashboard-chart">
        <h4>Cost per day <span class="muted">(dashed = daily budget)</span></h4>
        <div class="dashboard-bars">${costBars}</div>
      </div>
    </div>
    <div class="meta-grid dashboard-averages">
      <div class="meta-item"><div class="label">Avg cost / day</div><div class="value">${money(avg("cost"))} <span class="muted">/ ${money(dailyBudget)}</span></div></div>
      ${avgMeta}
    </div>`;
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
  const trackCalories = summary.trackCalories !== false;
  const servings = summary.servings || 1;
  const targets = macroTargetGrams(summary.dailyCalories, summary.macroSplit);
  const minDailyCost = estimateMinDailyCost(summary.dailyCalories, summary.snacksPerDay, summary.vegetarianOnly, trackCalories, servings);
  const totalOverBudget = summary.totalCost > summary.totalBudget * 1.02;
  const totalSuggestion = totalOverBudget && summary.dailyBudget < minDailyCost
    ? `<div class="budget-suggestion">${money(summary.totalCost - summary.totalBudget)} over — try raising your budget to ~${money(minDailyCost * summary.days)} or turning on Vegetarian only.</div>`
    : "";

  const targetMeta = trackCalories ? `
    <div class="meta-item"><div class="label">Daily calorie target</div><div class="value">${summary.dailyCalories} kcal</div></div>
    <div class="meta-item"><div class="label">Macro targets / day</div><div class="value">P ${grams(targets.protein)} · C ${grams(targets.carbs)} · F ${grams(targets.fat)}</div></div>` : "";

  $("#planMeta").innerHTML = `
    <div class="meta-item"><div class="label">Plan length</div><div class="value">${summary.days} days</div></div>
    <div class="meta-item"><div class="label">Cooking for</div><div class="value">${servings} ${servings === 1 ? "person" : "people"}</div></div>
    ${targetMeta}
    <div class="meta-item ${totalOverBudget ? "bad" : "good"}">
      <div class="label">Estimated total cost</div>
      <div class="value">${money(summary.totalCost)} <span class="muted">/ ${money(summary.totalBudget)} budget</span></div>
      ${totalSuggestion}
    </div>`;

  const prepBatches = groupIntoPrepBatches(plan);
  $("#printPrepGuideBtn").classList.toggle("hidden", prepBatches.length === 0);
  $("#prepBatchesSection").classList.toggle("hidden", prepBatches.length === 0);
  if (prepBatches.length > 0) {
    $("#prepBatches").innerHTML = renderPrepBatches(prepBatches);
  }

  $("#weekDashboard").innerHTML = renderWeekDashboard(plan, summary);

  $("#weekOverview").innerHTML = renderWeekOverview(plan);

  const tabs = plan.map(d => `<button class="day-tab" data-day="${d.day}">Day ${d.day}</button>`).join("");
  $("#dayTabs").innerHTML = tabs;

  const dayViews = plan.map((d, di) => `<div class="day-view" data-day="${d.day}">${renderDayTab(d, di, summary.dailyBudget, summary.dailyCalories, minDailyCost, summary.trackCalories !== false)}</div>`).join("");
  $("#dayViews").innerHTML = dayViews;

  $("#shoppingList").innerHTML = renderShoppingList(shoppingList, summary.totalCost, summary.totalBudget);

  activateDay(activeDayNum);
  $('.app-nav-btn[data-section="week"]').disabled = false;
  $('.app-nav-btn[data-section="shopping"]').disabled = false;

  recordRecipesTried(plan);
  renderProgressStrip();
  renderPlanNudge();
  updatePantryButtonBadge();
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
    <button type="button" id="historyBtn" class="secondary-btn">📊 History</button>
    <button type="button" id="achievementsBtn" class="secondary-btn">🏅 Achievements</button>`;
  strip.classList.remove("hidden");
}

// Dismissed for the rest of this page load only (not persisted) — closing
// it means "not right now," not "never remind me again." It reappears
// naturally on the next visit if the plan is still stale then.
let planNudgeDismissed = false;

// "Ready to plan next week?" — the app has no accounts or push
// notifications, so this is the only real way it can prompt a returning
// visitor back into the habit: notice the active plan's history entry
// hasn't been refreshed in a while and say so, right on the page they
// already opened. Reuses the same date a genuine Generate Plan stamps
// (recordNewHistoryEntry) — Shuffle/meal-swaps update that entry in place
// without touching its date, so those don't reset the "week" clock.
function renderPlanNudge() {
  const nudge = $("#planNudge");
  const history = loadHistory();
  if (planNudgeDismissed || !currentPlanResult || history.length === 0) {
    nudge.classList.add("hidden");
    return;
  }
  const plannedAt = new Date(history[history.length - 1].date);
  const daysSince = Math.floor((Date.now() - plannedAt) / (1000 * 60 * 60 * 24));
  if (daysSince < PLAN_STALE_DAYS) {
    nudge.classList.add("hidden");
    return;
  }
  nudge.innerHTML = `
    <span>🗓️ This plan is from ${daysSince} days ago — ready to plan next week?</span>
    <span class="plan-nudge-actions">
      <button type="button" id="planNudgeGoBtn" class="secondary-btn">Plan next week</button>
      <button type="button" id="planNudgeDismissBtn" class="text-link-btn" aria-label="Dismiss">✕</button>
    </span>`;
  nudge.classList.remove("hidden");
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

// One row per planning session (loadHistory() — a genuine Generate Plan,
// refined in place by any later Shuffle/swap/price-edit on that same
// plan), most recent first, each a cost-vs-budget bar on a shared scale
// so weeks are visually comparable to each other, not just to their own
// budget. No charting library — this is a small, static bar list, well
// within what plain CSS divs can do without a dependency.
function renderHistoryView() {
  const history = loadHistory();
  const stats = computeHistoryStats(history);

  $("#historySummary").innerHTML = `
    <div class="progress-stat"><span class="progress-stat-value">${money(stats.totalSaved)}</span><span class="progress-stat-label">Total Saved</span></div>
    <div class="progress-stat"><span class="progress-stat-value">${stats.currentStreak}</span><span class="progress-stat-label">Current Streak</span></div>
    <div class="progress-stat"><span class="progress-stat-value">${stats.longestStreak}</span><span class="progress-stat-label">Best Streak</span></div>
    <div class="progress-stat"><span class="progress-stat-value">${stats.plansGenerated}</span><span class="progress-stat-label">Plans</span></div>`;

  if (history.length === 0) {
    $("#historyList").innerHTML = `<p class="history-empty">Generate your first plan to start building a history.</p>`;
    return;
  }

  const maxValue = Math.max(1, ...history.flatMap(h => [h.totalCost, h.totalBudget]));
  const rows = [...history].reverse().map(h => {
    const over = h.totalCost > h.totalBudget;
    const diff = Math.abs(h.totalBudget - h.totalCost);
    const dateLabel = new Date(`${h.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const costPct = clamp((h.totalCost / maxValue) * 100, 0, 100);
    const budgetPct = clamp((h.totalBudget / maxValue) * 100, 0, 100);
    return `
      <div class="history-row">
        <div class="history-date">${dateLabel}<span class="history-days">${h.days}d</span></div>
        <div class="history-bar-track">
          <div class="history-bar-cost ${over ? "bad" : "good"}" style="width: ${costPct}%"></div>
          <div class="history-budget-marker" style="left: ${budgetPct}%" title="Budget: ${money(h.totalBudget)}"></div>
        </div>
        <div class="history-amount ${over ? "bad" : "good"}">${over ? "+" : "−"}${money(diff)}</div>
      </div>`;
  }).join("");
  $("#historyList").innerHTML = rows;
}

const SECTION_IDS = { settings: "settingsPanel", week: "resultsWeek", shopping: "resultsShopping", recipes: "resultsRecipes" };
let activeSection = "settings";

// Switches which top-level section is visible — same show/hide-by-id
// pattern the rest of the app already uses (welcome/onboarding/settings),
// just generalized to three sections plus a nav bar to pick between them.
function showSection(name) {
  if (!SECTION_IDS[name]) return;
  activeSection = name;
  Object.entries(SECTION_IDS).forEach(([sectionName, id]) => {
    $(`#${id}`).classList.toggle("hidden", sectionName !== name);
  });
  document.querySelectorAll(".app-nav-btn").forEach(b => {
    const isActive = b.dataset.section === name;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-current", isActive ? "true" : "false");
  });
  $(`#${SECTION_IDS[name]}`).scrollIntoView({ behavior: "smooth", block: "start" });
}

let activeDayNum = 1;
let currentPlanResult = null;

function activateDay(dayNum) {
  activeDayNum = dayNum;
  document.querySelectorAll(".day-tab").forEach(b => {
    const isActive = Number(b.dataset.day) === dayNum;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-current", isActive ? "true" : "false");
  });
  document.querySelectorAll(".day-view").forEach(v => v.classList.toggle("active", Number(v.dataset.day) === dayNum));
}

function init() {
  initFontScale();
  initTheme();
  initOnboarding();
  seedSignatureFields(loadPreferences());
  applyPriceOverrides();

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) writeSettingsToForm(JSON.parse(saved));

  applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", $("#budgetPeriod").value, Number($("#servings").value) || 1);
  syncSlider("#calories", "#caloriesSlider");
  syncSlider("#budgetAmount", "#budgetAmountSlider");
  $("#budgetPeriod").addEventListener("change", () => {
    applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", $("#budgetPeriod").value, Number($("#servings").value) || 1);
  });

  const savedPlan = localStorage.getItem(PLAN_KEY);
  if (savedPlan) renderPlan(recomputeAllCosts(JSON.parse(savedPlan), loadPantry()));
  else renderProgressStrip();
  activeSection = savedPlan ? "week" : "settings";
  showSection(activeSection);

  document.querySelectorAll(".app-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!btn.disabled) showSection(btn.dataset.section);
    });
  });

  // Recipe Book — browsable independent of any generated plan, so it's
  // wired and rendered here in init() rather than alongside renderPlan().
  syncCustomRecipesIntoTemplates();
  wireBubbleGroup($("#recipeSlotFilter"), "single");
  wireBubbleGroup($("#recipeProteinFilter"), "single");
  ["#recipeSlotFilter", "#recipeProteinFilter"].forEach(sel => $(sel).addEventListener("click", renderRecipeBook));
  $("#recipeSearch").addEventListener("input", renderRecipeBook);
  $("#recipeVegOnly").addEventListener("change", renderRecipeBook);
  $("#recipeBookList").addEventListener("click", (e) => {
    const favoriteBtn = e.target.closest(".favorite-btn");
    if (favoriteBtn) {
      toggleFavorite(favoriteBtn.dataset.templateId);
      return;
    }
    const dislikeBtn = e.target.closest(".dislike-btn");
    if (dislikeBtn) {
      toggleDislikedRecipe(dislikeBtn.dataset.templateId);
      return;
    }
    const editBtn = e.target.closest(".recipe-edit-btn");
    if (editBtn) {
      const recipe = loadCustomRecipes().find(r => r.id === editBtn.dataset.templateId);
      if (recipe) openCustomRecipeDialog(recipe);
      return;
    }
    const viewBtn = e.target.closest(".recipe-book-view-btn");
    if (viewBtn) {
      const t = MEAL_TEMPLATES.find(x => x.id === viewBtn.dataset.templateId);
      if (t) openRecipeModal({ ...t, nutrition: computeNutrition(t.items) });
    }
  });
  renderRecipeBook();

  $("#addRecipeBtn").addEventListener("click", () => openCustomRecipeDialog(null));
  wireBubbleGroup($("#customRecipeSlot"), "single");
  $("#customRecipeCloseBtn").addEventListener("click", () => $("#customRecipeDialog").close());
  $("#customRecipeDialog").addEventListener("click", (e) => {
    if (e.target === $("#customRecipeDialog")) $("#customRecipeDialog").close();
  });
  $("#customRecipeAddIngredientBtn").addEventListener("click", () => {
    $("#customRecipeIngredients").insertAdjacentHTML("beforeend", customRecipeIngredientRowHTML());
    updateCustomRecipeNutritionPreview();
  });
  $("#customRecipeIngredients").addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".custom-recipe-remove-ingredient");
    if (!removeBtn) return;
    const rows = document.querySelectorAll("#customRecipeIngredients .custom-recipe-ingredient-row");
    if (rows.length > 1) removeBtn.closest(".custom-recipe-ingredient-row").remove();
    updateCustomRecipeNutritionPreview();
  });
  $("#customRecipeIngredients").addEventListener("input", updateCustomRecipeNutritionPreview);
  $("#customRecipeIngredients").addEventListener("change", updateCustomRecipeNutritionPreview);
  $("#customRecipeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const items = readCustomRecipeIngredients();
    if (!items.length) {
      $("#customRecipeError").classList.remove("hidden");
      return;
    }
    const name = $("#customRecipeName").value.trim();
    if (!name) return;
    const slot = document.querySelector("#customRecipeSlot .bubble.selected")?.dataset.value || "breakfast";
    const instructions = $("#customRecipeInstructions").value.split("\n").map(s => s.trim()).filter(Boolean);
    const id = customRecipeEditingId || `custom-recipe-${Date.now()}`;
    const recipe = { id, slot, name, items, instructions };

    const recipes = loadCustomRecipes();
    const idx = recipes.findIndex(r => r.id === id);
    if (idx >= 0) recipes[idx] = recipe; else recipes.push(recipe);
    saveCustomRecipes(recipes);
    syncCustomRecipesIntoTemplates();

    $("#customRecipeDialog").close();
    renderRecipeBook();
  });
  $("#customRecipeDeleteBtn").addEventListener("click", () => {
    if (!customRecipeEditingId) return;
    const name = $("#customRecipeName").value.trim() || "this recipe";
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    saveCustomRecipes(loadCustomRecipes().filter(r => r.id !== customRecipeEditingId));
    syncCustomRecipesIntoTemplates();
    $("#customRecipeDialog").close();
    renderRecipeBook();
  });

  $("#planForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const settings = readSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    saveSignaturePreference();
    const result = generatePlan(settings, loadPreferences(), loadPantry());
    localStorage.removeItem(SHOPPING_CHECKED_KEY);
    activeDayNum = 1;
    recordNewHistoryEntry(result.summary);
    localStorage.setItem(PLAN_KEY, JSON.stringify(result));
    renderPlan(result);
    showSection("week");
  });

  $("#regenerateBtn").addEventListener("click", () => {
    const settings = readSettings();
    const result = generatePlan(settings, loadPreferences(), loadPantry());
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
      regenerateMeal(currentPlanResult, dayIndex, mealIndex, readSettings(), loadPreferences(), loadPantry());
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
      return;
    }

    const dislikeBtn = e.target.closest(".dislike-btn");
    if (dislikeBtn) {
      toggleDislikedRecipe(dislikeBtn.dataset.templateId);
    }
  });

  $("#prepBatches").addEventListener("click", (e) => {
    if (!currentPlanResult) return;
    const shuffleBtn = e.target.closest(".prep-batch-shuffle-btn");
    if (!shuffleBtn) return;
    regeneratePrepBatch(currentPlanResult, shuffleBtn.dataset.batchId, readSettings(), loadPreferences(), loadPantry());
    updateLatestHistoryEntry(currentPlanResult.summary);
    localStorage.setItem(PLAN_KEY, JSON.stringify(currentPlanResult));
    renderPlan(currentPlanResult);
  });

  $("#recipeCloseBtn").addEventListener("click", () => $("#recipeModal").close());
  $("#recipeModal").addEventListener("click", (e) => {
    if (e.target === $("#recipeModal")) $("#recipeModal").close();
  });
  $("#recipeFavoriteBtn").addEventListener("click", () => {
    if (!currentRecipeMealId) return;
    toggleFavorite(currentRecipeMealId); // updates #recipeFavoriteBtn itself too
  });
  $("#recipeDislikeBtn").addEventListener("click", () => {
    if (!currentRecipeMealId) return;
    toggleDislikedRecipe(currentRecipeMealId); // updates #recipeDislikeBtn itself too
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
    applyCustomMeal(currentPlanResult, dayIndex, mealIndex, customMeal, readSettings(), loadPreferences(), rebalance, loadPantry());
    updateLatestHistoryEntry(currentPlanResult.summary);
    localStorage.setItem(PLAN_KEY, JSON.stringify(currentPlanResult));
    renderPlan(currentPlanResult);
    $("#customMealDialog").close();
  });

  $("#progressStrip").addEventListener("click", (e) => {
    if (e.target.closest("#achievementsBtn")) {
      renderAchievements();
      $("#achievementsDialog").showModal();
    } else if (e.target.closest("#historyBtn")) {
      renderHistoryView();
      $("#historyDialog").showModal();
    }
  });
  $("#historyCloseBtn").addEventListener("click", () => $("#historyDialog").close());
  $("#historyDialog").addEventListener("click", (e) => {
    if (e.target === $("#historyDialog")) $("#historyDialog").close();
  });

  $("#pantryBtn").addEventListener("click", () => {
    renderPantryDialog();
    $("#pantryDialog").showModal();
  });
  $("#pantryCloseBtn").addEventListener("click", () => $("#pantryDialog").close());
  $("#pantryDialog").addEventListener("click", (e) => {
    if (e.target === $("#pantryDialog")) { $("#pantryDialog").close(); return; }

    const addBtn = e.target.closest(".pantry-add-btn");
    if (addBtn) {
      const pantry = loadPantry();
      pantry[addBtn.dataset.food] = (pantry[addBtn.dataset.food] || 0) + Number(addBtn.dataset.grams);
      savePantry(pantry);
      renderPantryDialog();
      updatePantryButtonBadge();
      return;
    }

    const removeBtn = e.target.closest(".pantry-remove-btn");
    if (removeBtn) {
      const pantry = loadPantry();
      delete pantry[removeBtn.dataset.food];
      savePantry(pantry);
      renderPantryDialog();
      updatePantryButtonBadge();
      return;
    }

    if (e.target.closest("#pantryClearBtn")) {
      if (!confirm("Clear your pantry? This removes everything you've added.")) return;
      savePantry({});
      renderPantryDialog();
      updatePantryButtonBadge();
    }
  });
  $("#pantryItems").addEventListener("change", (e) => {
    const input = e.target.closest(".pantry-row-input");
    if (!input) return;
    const pantry = loadPantry();
    const grams = Math.max(0, Number(input.value) || 0);
    if (grams <= 0) delete pantry[input.dataset.food]; else pantry[input.dataset.food] = grams;
    savePantry(pantry);
    renderPantryDialog();
    updatePantryButtonBadge();
  });

  $("#planNudge").addEventListener("click", (e) => {
    if (e.target.closest("#planNudgeGoBtn")) {
      showSection("settings");
      $("#planForm").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (e.target.closest("#planNudgeDismissBtn")) {
      planNudgeDismissed = true;
      $("#planNudge").classList.add("hidden");
    }
  });
  $("#achievementsCloseBtn").addEventListener("click", () => $("#achievementsDialog").close());
  $("#achievementsDialog").addEventListener("click", (e) => {
    if (e.target === $("#achievementsDialog")) $("#achievementsDialog").close();
  });

  // Re-syncs the currently displayed plan (if any) with whatever prices are
  // now in effect — reused by both the Save and Reset paths below.
  function commitPriceChanges() {
    if (!currentPlanResult) return;
    recomputeAllCosts(currentPlanResult, loadPantry());
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

  $("#servings").dataset.lastValue = $("#servings").value;
  $("#servings").addEventListener("change", () => {
    scaleBudgetForServings("#servings", "#budgetAmount", "#budgetAmountSlider", $("#budgetPeriod").value);
  });

  ["#calories", "#budgetPeriod", "#budgetAmount", "#snacks", "#vegetarian", "#servings", "#trackCalories"].forEach(sel => {
    $(sel).addEventListener("input", checkBudgetFeasibility);
    $(sel).addEventListener("change", checkBudgetFeasibility);
  });
  $("#trackCalories").addEventListener("change", (e) => toggleCalorieFields(e.target.checked));
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

  $("#printPrepGuideBtn").addEventListener("click", () => {
    if (!currentPlanResult) return;
    $("#printPrepGuide").innerHTML = renderPrintPrepGuide(currentPlanResult);
    document.body.classList.add("print-prep-guide");
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
    document.body.classList.remove("print-prep-guide");
  });

  $("#macroProtein").addEventListener("input", () => balanceMacros("protein"));
  $("#macroCarbs").addEventListener("input", () => balanceMacros("carbs"));
  $("#macroFat").addEventListener("input", () => balanceMacros("fat"));
  balanceMacros("protein"); // ensure whatever loaded from storage/defaults sums to 100
}

document.addEventListener("DOMContentLoaded", init);
