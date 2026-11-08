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

// ---------------------------------------------------------------------------
// Backup import validation
//
// A backup file is untrusted input: it can be hand-edited, truncated, copied
// from another version, or crafted. So nothing in it reaches localStorage
// as-is — every value is parsed, checked against what the app itself would
// have written, and REBUILT from known fields (unknown fields are dropped).
// A value that fails its check is skipped and the current value for that key
// is left untouched; nothing is repaired by guessing.
// ---------------------------------------------------------------------------

// A generous upper bound for any one text field pulled from an imported
// backup — long enough for a real recipe name/step, short enough that a
// hand-edited or malicious file can't bloat storage or the DOM with it.
// Only the free-text note keeps a ceiling (its input has maxlength=120).
// Recipes, steps, names and lists are user-authored with no limit in the
// editor, so the importer must not invent one — a backup has to restore
// everything the app itself was willing to save.
const IMPORT_NOTE_MAX_LEN = 2000;
// "Makes X servings" bounds — the recipe editor's input uses the same max.
const RECIPE_YIELD_MAX = 100;
// Servings a recipe can be placed with via Add to Plan (the dialog's max).
const PLACE_SERVINGS_MAX = 24;
// Cap on how many entries any one imported list (history, favorites, ...) may hold.
// Recipe/meal ids end up inside HTML attributes and CSS selectors. The app
// only ever generates ids from this alphabet (built-ins like "b1", user
// ones like "custom-recipe-1730000000000"), so anything else in a backup is
// rejected outright rather than trusted and escaped.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
// Preference values (protein families, meal styles) are fixed lower_snake
// tokens that get interpolated into selectors.
const TOKEN_PATTERN = /^[a-z0-9_]{1,40}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BUDGET_PERIODS = ["daily", "weekly", "monthly"];

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function inRange(v, min, max) {
  return isFiniteNumber(v) && v >= min && v <= max;
}
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
// Own-property check, deliberately NOT `FOODS[x]` truthiness: FOODS["constructor"]
// and FOODS["toString"] are truthy through the prototype chain, which would
// let a backup reference a "food" with no nutrition data and turn every
// downstream sum into NaN.
function isKnownFood(food) {
  return typeof food === "string" && hasOwn(FOODS, food);
}
function parseJson(str) {
  try { return JSON.parse(str); } catch { return undefined; }
}

// Shared by the recipe and plan-meal validators so the two can't disagree
// about what a well-formed ingredient list or step list is. Well-formed
// means: known foods, positive finite grams, strings for steps. No size
// limits — the recipe editor has none.
function cleanIngredientItems(raw, { allowZero = false } = {}) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items = [];
  for (const item of raw) {
    if (!isPlainObject(item) || !isKnownFood(item.food) || !isFiniteNumber(item.grams)) return null;
    if (allowZero ? item.grams < 0 : item.grams <= 0) return null;
    items.push({ food: item.food, grams: item.grams });
  }
  return items;
}
function cleanInstructionSteps(raw) {
  if (!Array.isArray(raw)) return null;
  const steps = [];
  for (const step of raw) {
    if (typeof step !== "string") return null;
    steps.push(step);
  }
  return steps;
}
function isNonNegative(v) {
  return isFiniteNumber(v) && v >= 0;
}

// Validates one recipe record before it's allowed into customRecipes — the
// shape the recipe editor writes ({id, slot, name, yieldServings?, items,
// instructions} plus the optional cookbook fields: draft, autoPlan, made,
// madeAt, createdAt, versionOf, tweak, source, unmatched). `takenIds` holds
// every id already in use (built-in recipes plus earlier records in this
// same import) so an imported recipe can't shadow a built-in one or
// duplicate another. Returns a clean copy, or null to drop the record.
// Records saved before the cookbook fields existed have none of them and
// validate exactly as they always did.
function validateImportedRecipe(r, takenIds) {
  if (!isPlainObject(r)) return null;
  if (typeof r.id !== "string" || !ID_PATTERN.test(r.id) || takenIds.has(r.id)) return null;
  if (typeof r.name !== "string" || !r.name.trim()) return null;
  if (!SLOT_ORDER.includes(r.slot)) return null;
  const isDraft = r.draft === true;
  // A "Want to make" draft may have no ingredients yet; anything else needs them.
  let items;
  if (isDraft && (r.items === undefined || (Array.isArray(r.items) && r.items.length === 0))) items = [];
  else items = cleanIngredientItems(r.items);
  if (!items) return null;
  const instructions = r.instructions === undefined ? [] : cleanInstructionSteps(r.instructions);
  if (!instructions) return null;
  // yieldServings: absent = legacy recipe (one serving, left absent so a
  // restored legacy recipe stays byte-identical). Present but not a whole
  // number in the editor's own 1-100 range = malformed, record dropped —
  // silently defaulting would change how much of the recipe gets planned.
  let yieldServings;
  if (r.yieldServings !== undefined) {
    if (!Number.isInteger(r.yieldServings) || r.yieldServings < 1 || r.yieldServings > RECIPE_YIELD_MAX) return null;
    yieldServings = r.yieldServings;
  }

  // Cookbook fields: a malformed optional field is dropped, not the recipe.
  const extra = {};
  if (isDraft) extra.draft = true;
  if (typeof r.autoPlan === "boolean") extra.autoPlan = r.autoPlan;
  if (r.made === true) {
    extra.made = true;
    if (isFiniteNumber(r.madeAt)) extra.madeAt = r.madeAt;
  }
  if (isFiniteNumber(r.createdAt)) extra.createdAt = r.createdAt;
  if (typeof r.versionOf === "string" && ID_PATTERN.test(r.versionOf)) extra.versionOf = r.versionOf;
  if (isPlainObject(r.tweak) && typeof r.tweak.kind === "string" && typeof r.tweak.summary === "string") {
    extra.tweak = { kind: r.tweak.kind, summary: r.tweak.summary };
  }
  if (isPlainObject(r.source)) {
    const source = {};
    if (typeof r.source.url === "string") {
      const link = parseRecipeLink(r.source.url);
      if (link) source.url = link.href; // http(s) only: never javascript:, data:, file:
    }
    if (typeof r.source.text === "string" && r.source.text) source.text = r.source.text;
    if (typeof r.source.image === "string" && DATA_URL_IMAGE.test(r.source.image)) source.image = r.source.image;
    if (Object.keys(source).length) extra.source = source;
  }
  if (Array.isArray(r.unmatched)) {
    const lines = r.unmatched.filter(l => typeof l === "string" && l.trim());
    if (lines.length) extra.unmatched = lines;
  }

  takenIds.add(r.id);
  // Same key order the recipe editor writes (orderedRecipeRecord), so a
  // restored recipe is byte-identical to the original.
  return orderedRecipeRecord({ id: r.id, slot: r.slot, name: r.name.trim(), yieldServings, items, instructions, ...extra });
}

function validateImportedRecipeList(list) {
  if (!Array.isArray(list)) return null;
  const takenIds = new Set(MEAL_TEMPLATES.filter(t => !t.userRecipe).map(t => t.id));
  return list.map(r => validateImportedRecipe(r, takenIds)).filter(Boolean);
}

// One logged "my meal" record (name + macros). Returns a clean copy, or null.
function validateImportedMyMeal(m) {
  if (!isPlainObject(m)) return null;
  if (typeof m.name !== "string" || !m.name.trim()) return null;
  if (!isNonNegative(m.protein) || !isNonNegative(m.carbs) || !isNonNegative(m.fat)) return null;
  const cost = isNonNegative(m.cost) ? m.cost : 0;
  return { name: m.name.trim(), protein: m.protein, carbs: m.carbs, fat: m.fat, cost };
}

function validateImportedMyMealList(list) {
  if (!Array.isArray(list)) return null;
  return list.map(validateImportedMyMeal).filter(Boolean);
}

function cleanMacroSplit(raw) {
  if (!isPlainObject(raw)) return null;
  const { protein, carbs, fat } = raw;
  if (![protein, carbs, fat].every(v => inRange(v, 0, 100))) return null;
  return { protein, carbs, fat };
}

// {breakfast, lunch, dinner, snack} -> each a 0-7 whole-number count.
function cleanMealPrep(raw) {
  const src = raw === undefined ? {} : raw;
  if (!isPlainObject(src)) return null;
  const out = {};
  for (const slot of SLOT_ORDER) {
    const n = src[slot] === undefined ? 0 : src[slot];
    if (!Number.isInteger(n) || n < 0 || n > 7) return null;
    out[slot] = n;
  }
  return out;
}

// What readSettings() writes. startup feeds this straight into
// writeSettingsToForm, which dereferences s.macroSplit.* — so a settings
// value of the wrong shape would throw on every load.
function validateImportedSettings(s) {
  if (!isPlainObject(s)) return null;
  const macroSplit = cleanMacroSplit(s.macroSplit);
  const mealPrep = cleanMealPrep(s.mealPrep);
  const servings = s.servings === undefined ? 1 : s.servings;
  if (!macroSplit || !mealPrep) return null;
  if (!Number.isInteger(s.days) || !inRange(s.days, 1, 14)) return null;
  if (!inRange(s.dailyCalories, 800, 10000)) return null;
  if (!BUDGET_PERIODS.includes(s.budgetPeriod)) return null;
  if (!inRange(s.budgetAmount, 1, 100000)) return null;
  if (![1, 2].includes(s.snacksPerDay)) return null;
  if (!Number.isInteger(servings) || !inRange(servings, 1, 12)) return null;
  return {
    days: s.days, dailyCalories: s.dailyCalories, macroSplit,
    budgetPeriod: s.budgetPeriod, budgetAmount: s.budgetAmount, snacksPerDay: s.snacksPerDay,
    vegetarianOnly: s.vegetarianOnly === true, glutenFree: s.glutenFree === true, dairyFree: s.dairyFree === true,
    servings, trackCalories: s.trackCalories !== false, mealPrep,
  };
}

// Preferences. seedSignatureFields interpolates signature.slot/preset into a
// querySelector string at startup, and the planner calls .includes/.some on
// every list — so each field must be exactly the type and alphabet the
// onboarding wizard produces, or startup / planning throws.
function cleanTokenList(v) {
  if (!Array.isArray(v) || v.length > 20) return null;
  return v.every(x => typeof x === "string" && TOKEN_PATTERN.test(x)) ? v.slice() : null;
}

function validateImportedPrefs(p) {
  if (!isPlainObject(p)) return null;
  const out = {};
  for (const field of ["proteins", "dislikedProteins"]) {
    if (p[field] === undefined) continue;
    const list = cleanTokenList(p[field]);
    if (!list) return null;
    out[field] = list;
  }
  if (p.missingAppliances !== undefined) {
    if (!Array.isArray(p.missingAppliances) || !p.missingAppliances.every(a => ALL_APPLIANCES.includes(a))) return null;
    out.missingAppliances = p.missingAppliances.slice();
  }
  for (const field of ["mealStyle", "excludedMealStyle"]) {
    if (p[field] === undefined) continue;
    if (!isPlainObject(p[field])) return null;
    const bySlot = {};
    for (const [slot, list] of Object.entries(p[field])) {
      const clean = cleanTokenList(list);
      if (!SLOT_ORDER.includes(slot) || !clean) return null;
      bySlot[slot] = clean;
    }
    out[field] = bySlot;
  }
  if (p.signature !== undefined) {
    const sg = p.signature;
    if (!isPlainObject(sg)) return null;
    const slot = sg.slot === undefined ? null : sg.slot;
    const preset = sg.preset === undefined ? null : sg.preset;
    if (slot !== null && !SLOT_ORDER.includes(slot)) return null;
    if (preset !== null && !(typeof preset === "string" && hasOwn(SIGNATURE_PRESETS, preset))) return null;
    out.signature = { slot, preset, note: typeof sg.note === "string" ? sg.note.slice(0, IMPORT_NOTE_MAX_LEN) : "" };
  }
  return out;
}

// {food: grams} — only foods the app knows, only sane amounts.
function validateImportedPantry(p) {
  if (!isPlainObject(p)) return null;
  const out = {};
  for (const [food, g] of Object.entries(p)) {
    if (isKnownFood(food) && isNonNegative(g)) out[food] = g;
  }
  return out;
}

// {food: pricePer100g}
function validateImportedPriceOverrides(p) {
  if (!isPlainObject(p)) return null;
  const out = {};
  for (const [food, price] of Object.entries(p)) {
    if (isKnownFood(food) && isNonNegative(price)) out[food] = price;
  }
  return out;
}

function validateImportedHistory(h) {
  if (!Array.isArray(h)) return null;
  return h
    .filter(e => isPlainObject(e) && typeof e.date === "string" && DATE_PATTERN.test(e.date)
      && inRange(e.days, 0, 400) && inRange(e.totalBudget, 0, 1e7) && inRange(e.totalCost, 0, 1e7))
    .map(e => ({ date: e.date, days: e.days, totalBudget: e.totalBudget, totalCost: e.totalCost }));
}

// Favorites / disliked / tried-recipes: lists of recipe ids. Bad entries are
// dropped; the list itself must be an array (loaders do `new Set(list)`).
function validateImportedIdList(list) {
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter(x => typeof x === "string" && ID_PATTERN.test(x)))]
}

function validateImportedCheckedItems(list) {
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter(isKnownFood))]
}

// One meal inside a saved plan. Rebuilt from known fields for each of the
// three kinds a plan can hold (auto-picked recipe, logged "custom" meal,
// unmatched placeholder). Nutrition for recipe meals is recomputed from the
// validated items rather than trusted. Returns a clean meal, or null.
function validateImportedPlanMeal(m) {
  if (!isPlainObject(m) || !SLOT_ORDER.includes(m.slot)) return null;

  if (m.custom === true) {
    if (typeof m.id !== "string" || !ID_PATTERN.test(m.id)) return null;
    if (typeof m.name !== "string" || !m.name) return null;
    if (!isPlainObject(m.nutrition)) return null;
    const nutrition = {};
    for (const k of ["cal", "protein", "carbs", "fat", "cost"]) {
      if (!isNonNegative(m.nutrition[k])) return null;
      nutrition[k] = m.nutrition[k];
    }
    return { slot: m.slot, id: m.id, name: m.name, items: [], instructions: [], custom: true, pending: m.pending === true, nutrition };
  }

  const servings = m.servings === undefined ? 1 : m.servings;
  if (!Number.isInteger(servings) || !inRange(servings, 1, PLACE_SERVINGS_MAX)) return null;

  if (m.unmatched === true) {
    return {
      slot: m.slot, id: null, name: null, items: [], instructions: [],
      nutrition: { cal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 },
      servings, prepTime: null, cookTime: null, prepped: false,
      unmatched: true,
      unmatchedReason: typeof m.unmatchedReason === "string" ? m.unmatchedReason : "",
    };
  }

  if (typeof m.id !== "string" || !ID_PATTERN.test(m.id)) return null;
  if (typeof m.name !== "string" || !m.name) return null;
  // Plan items are already scaled to the day's calorie target and servings,
  // so tiny or large gram values are normal here; only the shape is checked.
  const items = cleanIngredientItems(m.items, { allowZero: true });
  if (!items) return null;
  const instructions = cleanInstructionSteps(m.instructions);
  if (!instructions) return null;
  const n = computeNutrition(items);
  return {
    slot: m.slot, id: m.id, name: m.name, items, instructions, servings,
    nutrition: { cal: n.cal / servings, protein: n.protein / servings, carbs: n.carbs / servings, fat: n.fat / servings, cost: n.cost },
    prepTime: isFiniteNumber(m.prepTime) ? m.prepTime : null,
    cookTime: isFiniteNumber(m.cookTime) ? m.cookTime : null,
    prepped: m.prepped === true,
    ...(m.placed === true ? { placed: true } : {}),
  };
}

// The saved plan. Startup runs recomputeAllCosts + renderPlan over it, which
// walk every day, meal, item and summary field — so the whole structure is
// validated strictly and rebuilt; if any part is bad the plan is skipped (a
// plan is regenerable, a half-trusted one is not worth the risk). Day
// numbers, totals and the shopping list are derived, never taken from the file.
function validateImportedPlan(r) {
  if (!isPlainObject(r) || !Array.isArray(r.plan) || r.plan.length < 1 || r.plan.length > 14) return null;
  const s = r.summary;
  if (!isPlainObject(s)) return null;
  const macroSplit = cleanMacroSplit(s.macroSplit);
  const mealPrep = cleanMealPrep(s.mealPrep);
  const servings = s.servings === undefined ? 1 : s.servings;
  if (!macroSplit || !mealPrep) return null;
  if (!inRange(s.dailyCalories, 800, 10000) || !inRange(s.dailyBudget, 0, 1e6) || !inRange(s.totalBudget, 0, 1e7)) return null;
  if (![1, 2].includes(s.snacksPerDay)) return null;
  if (!Number.isInteger(servings) || !inRange(servings, 1, 12)) return null;

  const plan = [];
  for (let i = 0; i < r.plan.length; i++) {
    const day = r.plan[i];
    if (!isPlainObject(day) || !Array.isArray(day.meals) || day.meals.length < 1 || day.meals.length > 8) return null;
    const meals = [];
    for (const m of day.meals) {
      const clean = validateImportedPlanMeal(m);
      if (!clean) return null;
      meals.push(clean);
    }
    const cleanDay = { day: i + 1, meals, totals: null };
    recomputeDayTotals(cleanDay);
    plan.push(cleanDay);
  }

  const shoppingList = buildShoppingList(plan, {});
  return {
    plan, shoppingList,
    summary: {
      totalCost: shoppingList.reduce((sum, item) => sum + item.cost, 0),
      totalBudget: s.totalBudget, dailyBudget: s.dailyBudget, dailyCalories: s.dailyCalories, macroSplit,
      days: plan.length, snacksPerDay: s.snacksPerDay,
      vegetarianOnly: s.vegetarianOnly === true, glutenFree: s.glutenFree === true, dairyFree: s.dairyFree === true,
      servings, trackCalories: s.trackCalories !== false, mealPrep, mealPrepEnabled: s.mealPrepEnabled === true,
    },
  };
}

// Per-key import rules: key -> (rawStoredString) => { value: string, dropped: n } | null.
// The ONLY keys an import may write; anything else in a file is ignored.
// `dropped` counts list entries thrown away inside an otherwise-accepted
// value (e.g. one bad recipe out of five) so the user can be told.
function jsonValidator(fn) {
  return (str) => {
    const raw = parseJson(str);
    if (raw === undefined) return null;
    const clean = fn(raw);
    if (clean === null || clean === undefined) return null;
    const dropped = Array.isArray(raw) && Array.isArray(clean) ? Math.max(0, raw.length - clean.length) : 0;
    return { value: JSON.stringify(clean), dropped };
  };
}
// A few keys store a bare string rather than JSON (theme: dark, fontScale: 112).
function rawValidator(fn) {
  return (str) => {
    const clean = fn(str);
    return clean === null ? null : { value: clean, dropped: 0 };
  };
}

const IMPORT_VALIDATORS = {
  [STORAGE_KEY]: jsonValidator(validateImportedSettings),
  [PLAN_KEY]: jsonValidator(validateImportedPlan),
  [PREFS_KEY]: jsonValidator(validateImportedPrefs),
  [PANTRY_KEY]: jsonValidator(validateImportedPantry),
  [HISTORY_KEY]: jsonValidator(validateImportedHistory),
  [PRICE_OVERRIDES_KEY]: jsonValidator(validateImportedPriceOverrides),
  [MY_MEALS_KEY]: jsonValidator(validateImportedMyMealList),
  [CUSTOM_RECIPES_KEY]: jsonValidator(validateImportedRecipeList),
  [FAVORITES_KEY]: jsonValidator(validateImportedIdList),
  [DISLIKED_RECIPES_KEY]: jsonValidator(validateImportedIdList),
  [RECIPES_TRIED_KEY]: jsonValidator(validateImportedIdList),
  [SHOPPING_CHECKED_KEY]: jsonValidator(validateImportedCheckedItems),
  [THEME_KEY]: rawValidator(v => (v === "light" || v === "dark" ? v : null)),
  [FONT_SCALE_KEY]: rawValidator(v => (FONT_SCALES.includes(Number(v)) && String(v).trim() !== "" ? String(Number(v)) : null)),
  [ONBOARDED_KEY]: rawValidator(v => (v === "1" ? v : null)),
};

// Friendly names for the "couldn't import" note.
const IMPORT_LABELS = {
  [STORAGE_KEY]: "settings", [PLAN_KEY]: "saved plan", [PREFS_KEY]: "preferences", [PANTRY_KEY]: "pantry",
  [HISTORY_KEY]: "history", [PRICE_OVERRIDES_KEY]: "custom prices", [MY_MEALS_KEY]: "saved meals",
  [CUSTOM_RECIPES_KEY]: "your recipes", [FAVORITES_KEY]: "favorites", [DISLIKED_RECIPES_KEY]: "not-for-me recipes",
  [RECIPES_TRIED_KEY]: "recipes tried", [SHOPPING_CHECKED_KEY]: "shopping checkmarks",
  [THEME_KEY]: "theme", [FONT_SCALE_KEY]: "text size", [ONBOARDED_KEY]: "onboarding status",
};
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
  document.querySelectorAll(`.favorite-btn[data-template-id="${CSS.escape(templateId)}"]`).forEach(btn => {
    btn.textContent = nowFavorite ? "❤️" : "🤍";
    btn.classList.toggle("active", nowFavorite);
    btn.setAttribute("aria-label", nowFavorite ? "Remove from favorites" : "Favorite this meal");
    btn.setAttribute("aria-pressed", nowFavorite ? "true" : "false");
  });
  if (currentRecipeMealId === templateId) {
    $("#recipeFavoriteBtn").textContent = nowFavorite ? "❤️ Favorited" : "🤍 Favorite this recipe";
    $("#recipeFavoriteBtn").classList.toggle("active", nowFavorite);
  }
  // With "Favorites only" on, un-hearting a recipe should drop it from the list.
  const favOnly = document.querySelector("#recipeFavoritesOnly");
  if (favOnly && favOnly.checked) renderRecipeBook();
  if (myRecipesFilterValue() === "favorites" && !document.querySelector("#myRecipesView").classList.contains("hidden")) renderMyRecipes();
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
  document.querySelectorAll(`.dislike-btn[data-template-id="${CSS.escape(templateId)}"]`).forEach(btn => {
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
  plan.forEach(day => day.meals.forEach(m => { if (!m.custom && !m.unmatched) tried.add(m.id); }));
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
    glutenFree: $("#glutenFree").checked,
    dairyFree: $("#dairyFree").checked,
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
  $("#glutenFree").checked = !!s.glutenFree;
  $("#dairyFree").checked = !!s.dairyFree;
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

// Escapes text before it's inserted into any innerHTML template string, so
// a saved recipe name/step/ingredient (typed by the user, pasted from
// somewhere else, or loaded from an imported backup file) can never be
// interpreted as markup or run as script. Used anywhere user-authored
// recipe text reaches the DOM: the recipe modal, print layout, and
// anywhere a saved recipe's fields are rendered.
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  const diet = { vegetarian: $("#vegetarian").checked, glutenFree: $("#glutenFree").checked, dairyFree: $("#dairyFree").checked };
  const trackCalories = $("#trackCalories").checked;
  const servings = Number($("#servings").value) || 1;
  const dailyBudget = dailyBudgetFor($("#budgetPeriod").value, Number($("#budgetAmount").value) || 0);
  const minDailyCost = estimateMinDailyCost(dailyCalories, snacksPerDay, diet, trackCalories, servings);

  const banner = $("#budgetWarning");
  if (dailyBudget < minDailyCost) {
    const forWhom = trackCalories ? "at this calorie target" : servings > 1 ? `for ${servings} people` : "for the cheapest meals";
    const fix = trackCalories ? "raising your budget, lowering calories, or loosening a dietary filter" : "raising your budget or loosening a dietary filter";
    banner.innerHTML = `⚠️ ${money(dailyBudget)}/day may not cover even the cheapest meals ${forWhom} (~${money(minDailyCost)}/day minimum). Try ${fix}.`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

// ---------- My Recipes (the personal cookbook view) ----------

function myRecipesFilterValue() {
  return document.querySelector("#myRecipesFilter .bubble.selected")?.dataset.value || "all";
}

function updateMyRecipesTabCount() {
  const el = document.querySelector("#myRecipesTabCount");
  if (el) {
    const n = loadCustomRecipes().length;
    el.textContent = n ? `(${n})` : "";
  }
}

// The shopping list discounts the pantry when it's built, so a pantry edit
// has to rebuild it or the list keeps showing the old amounts. Called after
// every pantry change (the Pantry dialog and What can I make?).
function syncPlanWithPantry() {
  updatePantryButtonBadge();
  if (currentPlanResult) commitPlanMutation(() => recomputeAllCosts(currentPlanResult, loadPantry()));
}

// ---- What can I make?
const WCIM_PAGE_SIZE = 12;
const wcim = { slot: "dinner", targetKey: "", shown: { ready: WCIM_PAGE_SIZE, near: WCIM_PAGE_SIZE }, ready: false };
let wcimResults = [];

function wcimServings() {
  const s = Math.round(Number($("#wcimServings").value) || 1);
  return Math.min(PLACE_SERVINGS_MAX, Math.max(1, s));
}

function wcimIsOpenMeal(m) {
  return !!(m.unmatched || (m.custom && m.pending));
}

// The plan slots of the chosen meal type this could go into, labelled with
// what's there now. Placing into a filled slot replaces it, which is why
// its ingredients are released before the recipe is checked.
function wcimTargetOptions() {
  if (!currentPlanResult) return [];
  const opts = [];
  currentPlanResult.plan.forEach((day, di) => {
    day.meals.forEach((m, mi) => {
      if (m.slot !== wcim.slot) return;
      const open = wcimIsOpenMeal(m);
      const what = open ? "open" : `replaces ${m.custom ? "your logged meal " : ""}${m.name}`;
      opts.push({ key: `${di}:${mi}`, dayIndex: di, mealIndex: mi, open, label: `Day ${day.day} · ${wcim.slot.charAt(0).toUpperCase() + wcim.slot.slice(1)} (${what})` });
    });
  });
  return opts;
}

function wcimTarget() {
  const opt = wcimTargetOptions().find(o => o.key === wcim.targetKey);
  return opt ? { dayIndex: opt.dayIndex, mealIndex: opt.mealIndex } : null;
}

function wcimFillTargets({ fresh }) {
  const opts = wcimTargetOptions();
  $("#wcimTargetField").classList.toggle("hidden", opts.length === 0);
  if (!opts.some(o => o.key === wcim.targetKey)) {
    wcim.targetKey = fresh || wcim.targetKey === "" ? ((opts.find(o => o.open) || {}).key || "") : "";
  }
  $("#wcimTarget").innerHTML = [`<option value="">Just an extra meal (check against everything planned)</option>`]
    .concat(opts.map(o => `<option value="${o.key}">${escapeHtml(o.label)}</option>`)).join("");
  $("#wcimTarget").value = wcim.targetKey;
}

function renderWcimPantry() {
  const pantry = loadPantry();
  const entries = Object.entries(pantry).filter(([f]) => FOODS[f]);
  $("#wcimPantrySummary").textContent = `🥫 Pantry — ${entries.length} item${entries.length === 1 ? "" : "s"} · tap to update what you have`;
  $("#wcimPantryItems").innerHTML = entries.length ? entries.map(([food, g]) => `
    <div class="pantry-row">
      <span class="pantry-row-name">${escapeHtml(FOODS[food].name)}</span>
      <span class="pantry-row-hint">${escapeHtml(formatServing(food, g))}</span>
      <input type="number" class="wcim-pantry-input" data-food="${escapeHtml(food)}" value="${Math.round(g)}" min="0" aria-label="${escapeHtml(FOODS[food].name)} on hand, in grams"> g
      <button type="button" class="pantry-remove-btn wcim-pantry-remove" data-food="${escapeHtml(food)}" aria-label="Remove ${escapeHtml(FOODS[food].name)} from pantry">✕</button>
    </div>`).join("") : `<p class="pantry-empty">Nothing in your pantry yet — add what you have below.</p>`;
  const sel = $("#wcimPantryFood");
  if (!sel.options.length) {
    sel.innerHTML = `<option value="">Choose a food…</option>` + Object.keys(FOODS)
      .sort((a, b) => FOODS[a].name.localeCompare(FOODS[b].name))
      .map(f => `<option value="${escapeHtml(f)}">${escapeHtml(FOODS[f].name)}</option>`).join("");
  }
  fillWcimUnits();
}

function fillWcimUnits() {
  const food = $("#wcimPantryFood").value;
  const units = food ? kitchenUnitOptions(food) : [{ key: "g", label: "g", grams: 1 }];
  const prev = $("#wcimPantryUnit").value;
  $("#wcimPantryUnit").innerHTML = units.map(u => `<option value="${u.key}" data-grams="${u.grams}">${escapeHtml(u.label)}</option>`).join("");
  if (units.some(u => u.key === prev)) $("#wcimPantryUnit").value = prev;
}

function formatShort(s) {
  return escapeHtml(formatServing(s.food, s.shortGrams));
}

function renderWcimCard(r) {
  const t = r.template;
  const n = computeNutrition(servingItems(t));
  const favorite = isFavorite(t.id);
  const time = formatTime(t.prepTime, t.cookTime);
  const yieldN = templateYield(t);
  const status = r.status === "ready"
    ? `<span class="wcim-status ready">✅ Ready to cook</span>`
    : `<span class="wcim-status near">🛒 Missing ${r.missingCount} ingredient${r.missingCount === 1 ? "" : "s"}</span>`;
  const shortList = r.short.length ? `<ul class="wcim-short">${r.short.map(s => {
    const notes = [];
    notes.push(`need ${escapeHtml(formatServing(s.food, s.needGrams))}`);
    if (s.haveGrams > 0) notes.push(`pantry has ${escapeHtml(formatServing(s.food, s.haveGrams))}`);
    if (s.reservedGrams > 0) notes.push(`${escapeHtml(formatServing(s.food, s.reservedGrams))} already needed by other planned meals`);
    // What to buy and what it costs are the same shopping-list change: the
    // list's line for this food before -> after, priced in purchase
    // quantities. (Rounding the shortfall alone could say "buy 1 oz" next to
    // a price computed from a bigger or already-covered package.)
    const was = shoppingPurchaseGrams(s.food, s.buyBeforeGrams), now = shoppingPurchaseGrams(s.food, s.buyAfterGrams);
    const lbl = (g) => g > 0 ? formatShoppingQty(s.food, g) : "nothing";
    const cost = s.cost > 0.005 ? `+${money(s.cost)}` : s.cost < -0.005 ? `−${money(-s.cost)}` : `no extra cost`;
    const covered = Math.abs(now - was) < 1e-6
      ? `<span class="wcim-short-note">Shopping list unchanged: the ${escapeHtml(lbl(s.buyAfterGrams))} you're already buying covers it.</span>`
      : `<span class="wcim-short-note">Shopping list: ${escapeHtml(lbl(s.buyBeforeGrams))} → ${escapeHtml(lbl(s.buyAfterGrams))}</span>`;
    return `<li>
      <span class="wcim-short-main"><strong>${escapeHtml(s.name)}</strong> — short ${formatShort(s)}<span class="wcim-short-note">${notes.join(" · ")}</span>${covered}</span>
      <span>${cost}</span>
      <button type="button" class="wcim-have-btn" data-food="${escapeHtml(s.food)}" data-grams="${Math.ceil(s.shortGrams * 100) / 100}" title="Adds ${escapeHtml(formatServing(s.food, s.shortGrams))} to your pantry">✓ I have it</button>
    </li>`;
  }).join("")}</ul>` : "";
  const d = r.extraCost;
  const basket = Math.abs(d) < 0.005
    ? `Adds nothing to your shopping basket.`
    : d > 0 ? `Adds <strong>${money(d)}</strong> to your shopping basket (${money(r.basketBefore)} → ${money(r.basketAfter)}).`
            : `Lowers your shopping basket by <strong>${money(-d)}</strong> (${money(r.basketBefore)} → ${money(r.basketAfter)}).`;
  return `
    <div class="meal-card wcim-card">
      <div class="meal-head">
        <span class="meal-icon">${slotIcon(t.slot)}</span>
        <div class="meal-title">
          <div class="meal-slot">${t.slot}${t.userRecipe ? ` · <span class="user-recipe-badge">✨ Yours</span>` : ""}</div>
          <div class="meal-name">${escapeHtml(t.name)}</div>
        </div>
        <div class="meal-head-actions">${favorite ? "❤️" : ""}</div>
      </div>
      ${status}
      <div class="meal-macros">
        <span>${Math.round(n.cal)} kcal</span><span>P ${grams(n.protein)}</span><span>C ${grams(n.carbs)}</span><span>F ${grams(n.fat)}</span>
        ${yieldN > 1 ? `<span>Makes ${yieldN} servings</span>` : ""}${time ? `<span>${time}</span>` : ""}
        <span>per serving</span>
      </div>
      ${shortList}
      <p class="wcim-extra">${basket}${r.short.length === 0 && d > 0.005 ? " (only package rounding — everything you need is in your pantry)" : ""}</p>
      <div class="recipe-book-card-actions">
        <button type="button" class="wcim-view-btn" data-template-id="${escapeHtml(t.id)}">📖 View Recipe</button>
        <button type="button" class="wcim-add-btn" data-template-id="${escapeHtml(t.id)}">📌 Add to Plan</button>
      </div>
    </div>`;
}

function renderWhatCanIMake({ fresh } = {}) {
  if (!wcim.ready) {
    // First visit: cook for the household size from Settings.
    $("#wcimServings").value = Math.min(PLACE_SERVINGS_MAX, Math.max(1, Number($("#servings").value) || 1));
    wcim.ready = true;
  }
  document.querySelectorAll("#wcimSlot .bubble").forEach(b => {
    b.classList.toggle("selected", b.dataset.value === wcim.slot);
    updateBubbleAria(b);
  });
  wcimFillTargets({ fresh });
  renderWcimPantry();

  const s = readSettings();
  const pantry = loadPantry();
  const servings = wcimServings();
  wcimResults = findCookableRecipes({
    slot: wcim.slot, servings, plan: currentPlanResult ? currentPlanResult.plan : [], target: wcimTarget(),
    pantry, diet: { vegetarian: s.vegetarianOnly, glutenFree: s.glutenFree, dairyFree: s.dairyFree },
    dislikedIds: loadDislikedRecipes(),
  });
  const ready = wcimResults.filter(r => r.status === "ready");
  const near = wcimResults.filter(r => r.status === "near");
  // Nothing fits only because the plan already claims the pantry? Say so,
  // and point at the fix (pick a slot to replace, which releases its share).
  let heldByPlan = false;
  if (!wcimResults.length && currentPlanResult && Object.keys(pantry).length) {
    heldByPlan = findCookableRecipes({
      slot: wcim.slot, servings, plan: [], target: null, pantry,
      diet: { vegetarian: s.vegetarianOnly, glutenFree: s.glutenFree, dairyFree: s.dairyFree }, dislikedIds: loadDislikedRecipes(),
    }).length > 0;
  }
  const diets = [s.vegetarianOnly && "vegetarian", s.glutenFree && "gluten-free", s.dairyFree && "dairy-free"].filter(Boolean);
  const pantryCount = Object.keys(pantry).length;
  $("#wcimSummary").textContent =
    `${ready.length} ready to cook · ${near.length} missing 1–2 ingredients, for ${servings} serving${servings === 1 ? "" : "s"} of ${wcim.slot}` +
    (diets.length ? ` · ${diets.join(" + ")} only` : "") +
    (currentPlanResult ? "" : " · no plan yet, so results use your pantry only") +
    (pantryCount === 0 ? " · your pantry is empty, so only very short recipes can match yet" : "");

  const group = (key, title, list) => {
    if (!list.length) return "";
    const shown = list.slice(0, wcim.shown[key]);
    return `<h3 class="wcim-group-title">${title} (${list.length})</h3>
      <div class="recipe-book-grid">${shown.map(renderWcimCard).join("")}</div>
      ${list.length > shown.length ? `<button type="button" class="secondary-btn wcim-more" data-group="${key}">Show ${Math.min(WCIM_PAGE_SIZE, list.length - shown.length)} more</button>` : ""}`;
  };
  $("#wcimResults").innerHTML = (ready.length || near.length)
    ? group("ready", "✅ Ready to cook", ready) + group("near", "🛒 Missing 1–2 ingredients", near)
    : `<p class="history-empty">${heldByPlan
        ? (wcimTarget()
          ? "Your other planned meals already need most of your pantry. Try another slot to replace, or fewer servings."
          : "Your planned meals already need most of your pantry. Choose a meal in the plan to replace (its groceries are released), or try fewer servings.")
        : "Nothing matches yet. Add what you have to your pantry, try fewer servings, or choose another meal."}</p>`;
}

function wcimSavePantry(pantry) {
  savePantry(pantry);
  syncPlanWithPantry();
  renderWhatCanIMake();
}

function wireWhatCanIMake() {
  $("#wcimSlot").addEventListener("click", (e) => {
    const b = e.target.closest(".bubble");
    if (!b) return;
    wcim.slot = b.dataset.value;
    wcim.targetKey = "";
    wcim.shown = { ready: WCIM_PAGE_SIZE, near: WCIM_PAGE_SIZE };
    renderWhatCanIMake({ fresh: true });
  });
  $("#wcimServings").addEventListener("input", () => { wcim.shown = { ready: WCIM_PAGE_SIZE, near: WCIM_PAGE_SIZE }; renderWhatCanIMake(); });
  $("#wcimTarget").addEventListener("change", () => { wcim.targetKey = $("#wcimTarget").value; renderWhatCanIMake(); });
  $("#wcimPantryFood").addEventListener("change", fillWcimUnits);
  $("#wcimPantryAdd").addEventListener("submit", (e) => {
    e.preventDefault();
    const food = $("#wcimPantryFood").value;
    const amount = Number($("#wcimPantryAmount").value);
    if (!food || !(amount > 0)) return;
    const unitGrams = Number($("#wcimPantryUnit").selectedOptions[0].dataset.grams) || 1;
    const pantry = loadPantry();
    pantry[food] = Math.round(((pantry[food] || 0) + amount * unitGrams) * 100) / 100;
    $("#wcimPantryAmount").value = "";
    wcimSavePantry(pantry);
  });
  $("#wcimPantryItems").addEventListener("change", (e) => {
    const input = e.target.closest(".wcim-pantry-input");
    if (!input) return;
    const pantry = loadPantry();
    const g = Number(input.value);
    if (!(g > 0)) delete pantry[input.dataset.food]; else pantry[input.dataset.food] = g;
    wcimSavePantry(pantry);
  });
  $("#wcimPantryItems").addEventListener("click", (e) => {
    const btn = e.target.closest(".wcim-pantry-remove");
    if (!btn) return;
    const pantry = loadPantry();
    delete pantry[btn.dataset.food];
    wcimSavePantry(pantry);
  });
  $("#wcimResults").addEventListener("click", (e) => {
    const have = e.target.closest(".wcim-have-btn");
    if (have) {
      const pantry = loadPantry();
      pantry[have.dataset.food] = Math.round(((pantry[have.dataset.food] || 0) + Number(have.dataset.grams)) * 100) / 100;
      wcimSavePantry(pantry);
      return;
    }
    const more = e.target.closest(".wcim-more");
    if (more) { wcim.shown[more.dataset.group] += WCIM_PAGE_SIZE; renderWhatCanIMake(); return; }
    const view = e.target.closest(".wcim-view-btn");
    if (view) {
      const t = MEAL_TEMPLATES.find(x => x.id === view.dataset.templateId);
      if (t) openRecipeModal({ ...t, nutrition: computeNutrition(servingItems(t)), yieldServings: templateYield(t) });
      return;
    }
    const add = e.target.closest(".wcim-add-btn");
    if (add) openAddToPlanDialog(add.dataset.templateId, { servings: wcimServings(), target: wcimTarget() });
  });
}

function showRecipeBookTab(name) {
  document.querySelectorAll("#recipeBookTabs .bubble").forEach(b => {
    b.classList.toggle("selected", b.dataset.value === name);
    updateBubbleAria(b);
  });
  $("#recipeBookAllView").classList.toggle("hidden", name !== "all");
  $("#myRecipesView").classList.toggle("hidden", name !== "mine");
  $("#whatCanIMakeView").classList.toggle("hidden", name !== "cook");
  if (name === "mine") renderMyRecipes();
  else if (name === "cook") renderWhatCanIMake({ fresh: true });
  else renderRecipeBook();
}

function formatMissingList(missing) {
  return missing.join(", ");
}

function renderMyRecipeCard(r, byId) {
  const isDraft = !!r.draft;
  const link = r.source && r.source.url ? parseRecipeLink(r.source.url) : null;
  const favorite = isFavorite(r.id);
  const missing = isDraft ? recipeMissing(r) : [];
  const yieldN = templateYield(r);
  const parent = r.versionOf ? byId.get(r.versionOf) : null;
  const variations = [...byId.values()].filter(x => x.versionOf === r.id).length;

  const badges = [
    isDraft ? `<span class="status-chip chip-draft">📝 Want to make · incomplete</span>`
      : r.made ? `<span class="status-chip chip-made">✅ Made</span>`
      : `<span class="status-chip chip-want">📝 Want to make</span>`,
    isDraft && r.made ? `<span class="status-chip chip-made">✅ Made</span>` : "",
    r.versionOf ? `<span class="status-chip chip-version">↳ Variation${parent ? ` of ${escapeHtml(parent.name)}` : " (original removed)"}</span>` : "",
    variations ? `<span class="status-chip chip-version">${variations} variation${variations === 1 ? "" : "s"}</span>` : "",
  ].join(" ");

  const sources = [];
  if (link) sources.push(`<a class="open-original-link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">🔗 Open original · ${escapeHtml(recipeSourceLabel(link.platform))}</a>`);
  if (r.source && r.source.text) sources.push(`<span class="source-chip">📋 Pasted text saved</span>`);
  if (r.source && r.source.image && DATA_URL_IMAGE.test(r.source.image)) {
    sources.push(`<span class="source-chip">🖼️ Screenshot saved</span><img class="my-recipe-thumb" src="${escapeHtml(r.source.image)}" alt="Saved screenshot of ${escapeHtml(r.name)}">`);
  }

  let macros = "";
  if (!isDraft && r.items.length) {
    const n = computeNutrition(servingItems(r));
    macros = `<div class="meal-macros">
        <span>${Math.round(n.cal)} kcal</span><span>P ${grams(n.protein)}</span><span>C ${grams(n.carbs)}</span><span>F ${grams(n.fat)}</span>
        <span>${money(n.cost)} / serving</span>${yieldN > 1 ? `<span>Makes ${yieldN} servings</span>` : ""}
      </div>`;
  }

  const id = escapeHtml(r.id);
  return `
    <div class="meal-card my-recipe-card" data-recipe-id="${id}">
      <div class="meal-head">
        <span class="meal-icon">${slotIcon(r.slot)}</span>
        <div class="meal-title">
          <div class="meal-slot">${escapeHtml(r.slot)}</div>
          <div class="meal-name">${escapeHtml(r.name)}</div>
        </div>
        <div class="meal-head-actions">
          <button type="button" class="favorite-btn ${favorite ? "active" : ""}" data-template-id="${id}" aria-label="${favorite ? "Remove from favorites" : "Favorite this recipe"}" aria-pressed="${favorite}" title="Favorite">${favorite ? "❤️" : "🤍"}</button>
        </div>
      </div>
      <div class="my-recipe-badges">${badges}</div>
      ${isDraft ? `<p class="recipe-missing">Missing: ${escapeHtml(formatMissingList(missing))}</p>` : ""}
      ${macros}
      ${sources.length ? `<div class="my-recipe-sources">${sources.join(" ")}</div>` : ""}
      ${isDraft ? "" : `<label class="my-recipe-autoplan"><input type="checkbox" class="my-recipe-autoplan-input" data-recipe-id="${id}" ${r.autoPlan !== false ? "checked" : ""}> 🔁 Include in automatic plans</label>`}
      <div class="my-recipe-actions">
        <button type="button" class="my-recipe-edit-btn recipe-book-view-btn" data-recipe-id="${id}">${isDraft ? "📝 Finish recipe" : "✏️ Edit"}</button>
        <button type="button" class="my-recipe-made-btn recipe-book-view-btn" data-recipe-id="${id}" aria-pressed="${!!r.made}">${r.made ? "↩️ Not made yet" : "✅ Mark as made"}</button>
        ${isDraft
          ? `<button type="button" class="my-recipe-add-btn recipe-book-add-btn" disabled title="Add to Plan unlocks once the ingredients, quantities and servings are confirmed">📌 Add to Plan</button>`
          : `<button type="button" class="my-recipe-add-btn recipe-book-add-btn" data-recipe-id="${id}">📌 Add to Plan</button>
             <button type="button" class="my-recipe-tweaks-btn recipe-book-view-btn" data-recipe-id="${id}">💡 Suggest Tweaks</button>
             <button type="button" class="my-recipe-view-btn recipe-book-view-btn" data-recipe-id="${id}">📖 View</button>`}
      </div>
    </div>`;
}

function renderMyRecipes() {
  const all = loadCustomRecipes();
  const byId = new Map(all.map(r => [r.id, r]));
  const filter = myRecipesFilterValue();
  const favorites = filter === "favorites" ? loadFavorites() : null;
  const shown = all.filter(r => {
    if (filter === "want") return !r.made;
    if (filter === "made") return !!r.made;
    if (filter === "favorites") return favorites.has(r.id);
    return true;
  }).reverse(); // newest saved first
  $("#myRecipesCount").textContent = all.length
    ? `${shown.length} of ${all.length} recipe${all.length === 1 ? "" : "s"}`
    : "";
  $("#myRecipesList").innerHTML = shown.length
    ? shown.map(r => renderMyRecipeCard(r, byId)).join("")
    : `<p class="history-empty">${all.length
        ? "Nothing here with that filter."
        : "Nothing saved yet. Tap ＋ Save a recipe to add a link, pasted text, a screenshot, or a recipe you type in."}</p>`;
  updateMyRecipesTabCount();
}

function updatePersonalRecipe(id, change) {
  const recipes = loadCustomRecipes();
  const idx = recipes.findIndex(r => r.id === id);
  if (idx < 0) return false;
  const next = { ...recipes[idx], ...change };
  Object.keys(next).forEach(k => { if (next[k] === undefined) delete next[k]; });
  recipes[idx] = orderedRecipeRecord(next);
  if (!saveCustomRecipes(recipes)) return false;
  syncCustomRecipesIntoTemplates();
  return true;
}

// ---------- Suggest Tweaks ----------

let tweaksRecipeId = null;
let tweaksResult = null;

function tweaksDiet() {
  const s = readSettings();
  return { vegetarian: s.vegetarianOnly, glutenFree: s.glutenFree, dairyFree: s.dairyFree };
}

function openTweaksDialog(recipeId) {
  const r = loadCustomRecipes().find(x => x.id === recipeId);
  if (!r || r.draft) return;
  tweaksRecipeId = recipeId;
  const diet = tweaksDiet();
  tweaksResult = suggestTweaks(r, { diet, pantry: loadPantry() });
  $("#tweaksRecipeName").textContent = r.name;
  const active = [diet.vegetarian && "vegetarian", diet.glutenFree && "gluten-free", diet.dairyFree && "dairy-free"].filter(Boolean);
  $("#tweaksContext").textContent = (active.length
    ? `Respecting your dietary filters: ${active.join(", ")}. `
    : "No dietary filters are on in your settings. ")
    + "Costs use BiteBudget's catalog prices (including any you've edited) and nutrition is per serving. Your original recipe is never changed.";
  document.querySelectorAll("#tweaksKinds .bubble").forEach(b => b.classList.toggle("selected", b.dataset.value === "lowerCost"));
  renderTweaks("lowerCost");
  $("#tweaksDialog").showModal();
}

function tweakCompareRow(label, a, b, fmt, goodWhenLower) {
  if (a === undefined || b === undefined) return "";
  const delta = b - a;
  const cls = Math.abs(delta) < 1e-9 ? "" : ((delta < 0) === goodWhenLower ? "tweak-better" : "tweak-worse");
  return `<tr><th>${label}</th><td>${fmt(a)}</td><td class="${cls}">${fmt(b)}</td></tr>`;
}

function renderTweaks(kind) {
  const group = tweaksResult && tweaksResult[kind];
  if (!group) return;
  const note = $("#tweaksNote");
  note.textContent = group.note || "";
  note.classList.toggle("hidden", !group.note);
  $("#tweaksList").innerHTML = group.suggestions.map((s, i) => {
    const rows = [
      tweakCompareRow("Cost per serving", s.before.cost, s.after.cost, money, true),
      kind === "usePantry" ? tweakCompareRow("Cost to buy per serving (after pantry)", s.before.buyCost, s.after.buyCost, money, true) : "",
      tweakCompareRow("Calories", s.before.cal, s.after.cal, v => `${Math.round(v)} kcal`, true),
      tweakCompareRow("Protein", s.before.protein, s.after.protein, grams, false),
      tweakCompareRow("Carbs", s.before.carbs, s.after.carbs, grams, true),
      tweakCompareRow("Fat", s.before.fat, s.after.fat, grams, true),
      tweakCompareRow("Fiber", s.before.fiber, s.after.fiber, grams, false),
    ].join("");
    return `
      <div class="tweak-card">
        <ul class="tweak-changes">${s.changes.map(ch => `<li>${escapeHtml(describeChange(ch))}</li>`).join("")}</ul>
        <table class="tweak-compare"><thead><tr><th></th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table>
        <button type="button" class="primary-btn tweak-save-btn" data-kind="${escapeHtml(kind)}" data-index="${i}">Save as new version</button>
      </div>`;
  }).join("");
}

// Saves an accepted suggestion as a NEW personal recipe linked to the one it
// came from. The original is never touched.
function saveTweakAsVersion(kind, index) {
  const group = tweaksResult && tweaksResult[kind];
  const s = group && group.suggestions[index];
  const orig = loadCustomRecipes().find(x => x.id === tweaksRecipeId);
  if (!s || !orig) return false;
  const summary = s.changes.map(describeChange).join("; ");
  const slug = TWEAK_KINDS[kind].slug;
  const version = orderedRecipeRecord({
    id: newRecipeId(), slot: orig.slot, name: `${orig.name} (${slug})`,
    yieldServings: templateYield(orig),
    items: s.items.map(i => ({ food: i.food, grams: i.grams })),
    instructions: [`Variation (${slug}): ${summary}.`, ...orig.instructions],
    autoPlan: false, createdAt: Date.now(), versionOf: orig.id,
    tweak: { kind, summary },
    ...(orig.source && (orig.source.url || orig.source.text)
      ? { source: { ...(orig.source.url ? { url: orig.source.url } : {}), ...(orig.source.text ? { text: orig.source.text } : {}) } } : {}),
  });
  const recipes = loadCustomRecipes();
  recipes.push(version);
  if (!saveCustomRecipes(recipes)) return false;
  syncCustomRecipesIntoTemplates();
  return version.id;
}

// ---------- Add to Plan ----------
let addToPlanTemplateId = null;

function mealPositionLabels(day) {
  const snackCount = day.meals.filter(m => m.slot === "snack").length;
  let snackN = 0;
  return day.meals.map(m => {
    const base = m.slot.charAt(0).toUpperCase() + m.slot.slice(1);
    return m.slot === "snack" && snackCount > 1 ? `${base} ${++snackN}` : base;
  });
}

function describeMealForReplace(m) {
  if (m.unmatched) return "an empty slot";
  if (m.custom) return `your logged meal "${m.name}"`;
  return `"${m.name}"`;
}

function readAddToPlanServings() {
  const s = Math.round(Number($("#addToPlanServings").value) || 1);
  return Math.min(PLACE_SERVINGS_MAX, Math.max(1, s));
}

function fillAddToPlanSlots() {
  const day = currentPlanResult.plan[Number($("#addToPlanDay").value)];
  const t = MEAL_TEMPLATES.find(x => x.id === addToPlanTemplateId);
  const labels = mealPositionLabels(day);
  $("#addToPlanSlot").innerHTML = day.meals
    .map((m, i) => `<option value="${i}">${escapeHtml(labels[i])}</option>`).join("");
  const match = t ? day.meals.findIndex(m => m.slot === t.slot) : -1;
  $("#addToPlanSlot").value = String(match >= 0 ? match : 0);
  updateAddToPlanPreview();
}

function updateAddToPlanPreview() {
  const t = MEAL_TEMPLATES.find(x => x.id === addToPlanTemplateId);
  if (!t || !currentPlanResult) return;
  const portions = readAddToPlanServings();
  const y = templateYield(t);
  const factor = portions / y;
  const n = computeNutrition(t.items.map(({ food, grams: g }) => ({ food, grams: g * factor })));
  const pct = Math.round(factor * 100);
  $("#addToPlanPreview").textContent =
    `${portions} of ${y} serving${y === 1 ? "" : "s"} = ${pct}% of the recipe · ${Math.round(n.cal / portions)} kcal per serving · about ${money(n.cost)} of ingredients`;
  const day = currentPlanResult.plan[Number($("#addToPlanDay").value)];
  const m = day && day.meals[Number($("#addToPlanSlot").value)];
  $("#addToPlanReplaces").textContent = m ? `Replaces ${describeMealForReplace(m)}.` : "";
}

function openAddToPlanDialog(templateId, preset) {
  const t = MEAL_TEMPLATES.find(x => x.id === templateId);
  if (!t) return;
  addToPlanTemplateId = templateId;
  $("#addToPlanRecipeName").textContent = t.name;
  const hasPlan = !!currentPlanResult;
  $("#addToPlanEmpty").classList.toggle("hidden", hasPlan);
  $("#addToPlanForm").classList.toggle("hidden", !hasPlan);
  if (hasPlan) {
    $("#addToPlanDay").innerHTML = currentPlanResult.plan
      .map((d, i) => `<option value="${i}">Day ${d.day}</option>`).join("");
    $("#addToPlanDay").value = String(Math.max(0, Math.min(currentPlanResult.plan.length - 1, activeDayNum - 1)));
    $("#addToPlanServings").value = Math.min(PLACE_SERVINGS_MAX, templateYield(t));
    fillAddToPlanSlots();
    // What can I make? hands over the slot and servings it evaluated, so
    // the recipe lands exactly where its numbers were calculated.
    if (preset) {
      if (preset.servings) $("#addToPlanServings").value = Math.min(PLACE_SERVINGS_MAX, Math.max(1, preset.servings));
      if (preset.target && currentPlanResult.plan[preset.target.dayIndex]) {
        $("#addToPlanDay").value = String(preset.target.dayIndex);
        fillAddToPlanSlots();
        $("#addToPlanSlot").value = String(preset.target.mealIndex);
        if (preset.servings) $("#addToPlanServings").value = Math.min(PLACE_SERVINGS_MAX, Math.max(1, preset.servings));
      }
      updateAddToPlanPreview();
    }
  }
  $("#addToPlanDialog").showModal();
}

function slotIcon(slot) {
  return { breakfast: "🌅", lunch: "🥗", dinner: "🍽️", snack: "🍎" }[slot] || "🍴";
}

function renderMealCard(meal, dayIndex, mealIndex) {
  if (meal.unmatched) {
    return `
      <div class="meal-card unmatched-meal-card">
        <div class="meal-head">
          <span class="meal-icon">⚠️</span>
          <div>
            <div class="meal-slot">${meal.slot}</div>
            <div class="meal-name">No matching recipe</div>
          </div>
        </div>
        <p class="unmatched-meal-note">${escapeHtml(meal.unmatchedReason || "No recipe in the library satisfies your current dietary restrictions for this meal.")}</p>
        <div class="meal-head-actions">
          <button type="button" class="meal-swap-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Try again" title="Try again — useful after adding a recipe or relaxing a restriction">🔁 Try again</button>
          <button type="button" class="custom-meal-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Log your own meal instead" title="Log your own meal instead">📝 Log your own</button>
        </div>
      </div>`;
  }

  if (meal.custom && meal.pending) {
    return `
      <div class="meal-card pending-meal-card">
        <div class="meal-head">
          <span class="meal-icon">${slotIcon(meal.slot)}</span>
          <div>
            <div class="meal-slot">${meal.slot}</div>
            <div class="meal-name">${escapeHtml(meal.name)}</div>
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
        <button type="button" class="favorite-btn ${favorite ? "active" : ""}" data-template-id="${escapeHtml(meal.id)}" aria-label="${favorite ? "Remove from favorites" : "Favorite this meal"}" aria-pressed="${favorite}" title="Favorite this meal">${favorite ? "❤️" : "🤍"}</button>
        <button type="button" class="dislike-btn ${disliked ? "active" : ""}" data-template-id="${escapeHtml(meal.id)}" aria-label="${disliked ? "Remove \"not for me\"" : "Not for me — don't suggest this again"}" aria-pressed="${disliked}" title="Not for me — don't suggest this again">👎</button>
        <button type="button" class="meal-swap-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Swap this meal" title="Swap this meal">🔀</button>
        <button type="button" class="custom-meal-btn" data-day-index="${dayIndex}" data-meal-index="${mealIndex}" aria-label="Log your own meal instead" title="Log your own meal instead">📝</button>`;

  return `
    <div class="meal-card ${meal.custom ? "custom-meal-card" : ""}">
      <div class="meal-head">
        <span class="meal-icon">${slotIcon(meal.slot)}</span>
        <div class="meal-title">
          <div class="meal-slot">${meal.slot}</div>
          <div class="meal-name">${escapeHtml(meal.name)}</div>
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
        ${meal.placed ? `<span class="user-recipe-badge" title="You're cooking ${meal.servings} serving${meal.servings === 1 ? "" : "s"}. Calories and macros here are for ONE serving (what one person eats); the cost is for everything you're cooking.">📌 ${meal.servings} serving${meal.servings === 1 ? "" : "s"} placed · kcal &amp; macros per serving · cost for all</span>` : ""}
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
  // Per serving, so a 4-serving chili reads as one portion — the same
  // numbers the planner works from. "Makes N" says how big the batch is.
  const n = computeNutrition(servingItems(t));
  const yieldN = templateYield(t);
  const favorite = isFavorite(t.id);
  const disliked = isDislikedRecipe(t.id);
  const time = formatTime(t.prepTime, t.cookTime);
  return `
    <div class="meal-card">
      <div class="meal-head">
        <span class="meal-icon">${slotIcon(t.slot)}</span>
        <div class="meal-title">
          <div class="meal-slot">${t.slot}${t.userRecipe ? ` · <span class="user-recipe-badge">✨ Yours</span>${t.autoPlan === false ? ` · <span title="The planner won't pick this on its own; Add to Plan still works">not auto-planned</span>` : ""}` : ""}</div>
          <div class="meal-name">${escapeHtml(t.name)}</div>
        </div>
        <div class="meal-head-actions">
          ${t.userRecipe ? `<button type="button" class="recipe-edit-btn" data-template-id="${escapeHtml(t.id)}" aria-label="Edit this recipe" title="Edit this recipe">✏️</button>` : ""}
          <button type="button" class="favorite-btn ${favorite ? "active" : ""}" data-template-id="${escapeHtml(t.id)}" aria-label="${favorite ? "Remove from favorites" : "Favorite this meal"}" aria-pressed="${favorite}" title="Favorite this meal">${favorite ? "❤️" : "🤍"}</button>
          <button type="button" class="dislike-btn ${disliked ? "active" : ""}" data-template-id="${escapeHtml(t.id)}" aria-label="${disliked ? "Remove \"not for me\"" : "Not for me — don't suggest this again"}" aria-pressed="${disliked}" title="Not for me — don't suggest this again">👎</button>
          <div class="meal-cost">${money(n.cost)}</div>
        </div>
      </div>
      <div class="meal-macros">
        <span>${Math.round(n.cal)} kcal</span>
        <span>P ${grams(n.protein)}</span>
        <span>C ${grams(n.carbs)}</span>
        <span>F ${grams(n.fat)}</span>
        ${yieldN > 1 ? `<span>Makes ${yieldN} servings</span>` : ""}
        ${time ? `<span>${time}</span>` : ""}
      </div>
      <div class="recipe-book-card-actions">
        <button type="button" class="recipe-book-view-btn" data-template-id="${escapeHtml(t.id)}">📖 View Recipe</button>
        <button type="button" class="recipe-book-add-btn" data-template-id="${escapeHtml(t.id)}">📌 Add to Plan</button>
      </div>
    </div>`;
}

function renderRecipeBook() {
  const search = $("#recipeSearch").value.trim().toLowerCase();
  const slot = document.querySelector("#recipeSlotFilter .bubble.selected")?.dataset.value || "all";
  const protein = document.querySelector("#recipeProteinFilter .bubble.selected")?.dataset.value || "all";
  const diet = { vegetarian: $("#recipeVegOnly").checked, glutenFree: $("#recipeGlutenFree").checked, dairyFree: $("#recipeDairyFree").checked };

  const favoritesOnly = $("#recipeFavoritesOnly").checked;
  const favoriteIds = favoritesOnly ? loadFavorites() : null;

  const matches = MEAL_TEMPLATES.filter(t => {
    if (slot !== "all" && t.slot !== slot) return false;
    if (protein !== "all" && !templateProteinFamilies(t).includes(protein)) return false;
    if (!matchesDiet(t.items, diet)) return false;
    if (favoritesOnly && !favoriteIds.has(t.id)) return false;
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
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Returns false when the browser refuses the write (storage full — a saved
// screenshot is the likely cause) so the caller can say so instead of
// silently losing the recipe.
function saveCustomRecipes(recipes) {
  try {
    localStorage.setItem(CUSTOM_RECIPES_KEY, JSON.stringify(recipes));
    return true;
  } catch (err) {
    console.error("BiteBudget: couldn't save recipes.", err);
    return false;
  }
}

function newRecipeId() {
  return `custom-recipe-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
  // "Want to make" drafts stay out of MEAL_TEMPLATES entirely: they may have no
  // ingredients or servings, so nothing that plans, prices or lists meals can
  // ever see them. Only complete recipes join the pool; whether the automatic
  // planner may PICK one is its Include-in-automatic-plans setting (isPlannable).
  loadCustomRecipes().filter(r => !r.draft).forEach(r => MEAL_TEMPLATES.push({ ...r, userRecipe: true }));
  updateMyRecipesTabCount();
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

function kitchenUnitSelectHTML(food, selectedKey) {
  return kitchenUnitOptions(food)
    .map(o => `<option value="${escapeHtml(o.key)}" ${o.key === selectedKey ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
}
function roundQty(x) { return Math.round(x * 100) / 100; }

// The row's exact gram amount lives in data-grams, so flipping the unit
// back and forth never drifts through display rounding.
function customRecipeIngredientRowHTML(food, grams) {
  const defaultFood = food || Object.keys(FOODS)[0];
  const g = grams != null ? grams : 100;
  const shown = g > 0 ? g : "";
  return `
    <div class="custom-recipe-ingredient-row" data-grams="${g}">
      <select class="custom-recipe-food-select" aria-label="Ingredient">${foodOptionsHTML(defaultFood)}</select>
      <input type="number" class="custom-recipe-grams-input" min="0" step="any" value="${shown}" aria-label="Amount">
      <select class="custom-recipe-unit-select" aria-label="Unit">${kitchenUnitSelectHTML(defaultFood, "g")}</select>
      <button type="button" class="custom-recipe-remove-ingredient" aria-label="Remove ingredient">✕</button>
    </div>`;
}

function rowUnitGrams(row) {
  const food = row.querySelector(".custom-recipe-food-select").value;
  const key = row.querySelector(".custom-recipe-unit-select").value;
  return (kitchenUnitOptions(food).find(o => o.key === key) || { grams: 1 }).grams;
}
// Typing an amount: recompute the row's grams from amount x unit.
function syncRowGramsFromQty(row) {
  const qty = Math.max(0, Number(row.querySelector(".custom-recipe-grams-input").value) || 0);
  row.dataset.grams = String(qty * rowUnitGrams(row));
}
// Changing the unit: same physical amount, shown in the new unit.
function showRowGramsInUnit(row) {
  row.querySelector(".custom-recipe-grams-input").value = roundQty(Number(row.dataset.grams) / rowUnitGrams(row));
}
// Changing the ingredient: unit choices belong to the food, so reset to
// grams (the amount itself is kept).
function resetRowUnits(row) {
  const food = row.querySelector(".custom-recipe-food-select").value;
  row.querySelector(".custom-recipe-unit-select").innerHTML = kitchenUnitSelectHTML(food, "g");
  showRowGramsInUnit(row);
}

function readCustomRecipeIngredients() {
  return [...document.querySelectorAll("#customRecipeIngredients .custom-recipe-ingredient-row")]
    .map(row => ({
      food: row.querySelector(".custom-recipe-food-select").value,
      grams: Math.max(0, Number(row.dataset.grams) || 0),
    }))
    .filter(({ grams }) => grams > 0);
}

// null when the field is blank — "servings not set yet" is a real state for a
// Want-to-make draft, and must never silently become 1.
function readCustomRecipeYield() {
  const raw = $("#customRecipeYield").value.trim();
  if (raw === "") return null;
  return Math.min(RECIPE_YIELD_MAX, Math.max(1, Math.round(Number(raw) || 1)));
}

function updateCustomRecipeNutritionPreview() {
  const items = readCustomRecipeIngredients();
  const n = items.length ? computeNutrition(items) : { cal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 };
  const y = readCustomRecipeYield();
  const line = (v, d) => `${Math.round(v.cal / d)} kcal · P ${grams(v.protein / d)} · C ${grams(v.carbs / d)} · F ${grams(v.fat / d)}`;
  $("#customRecipeNutritionPreview").textContent = y === null
    ? `Whole batch: ${line(n, 1)} · ${money(n.cost)} — enter how many servings it makes for per-serving numbers`
    : y > 1
      ? `Per serving: ${line(n, y)} · ${money(n.cost / y)} — whole batch ${money(n.cost)}`
      : `${line(n, 1)} · ${money(n.cost)}`;
}

let customRecipeEditingId = null;
// What the editor holds besides its visible inputs: the saved screenshot,
// the pasted-text lines that couldn't be matched, and the fields it must carry
// through untouched (made-date, creation time, which recipe this varies).
let customRecipeExtra = { image: null, unmatched: [], keep: {} };

function setCustomRecipeImage(dataUrl) {
  customRecipeExtra.image = dataUrl || null;
  const box = $("#customRecipeImagePreview");
  box.classList.toggle("hidden", !dataUrl);
  if (dataUrl && DATA_URL_IMAGE.test(dataUrl)) box.querySelector("img").src = dataUrl;
  else box.querySelector("img").removeAttribute("src");
}

function renderCustomRecipeUnmatched() {
  const lines = customRecipeExtra.unmatched;
  $("#customRecipeUnmatched").classList.toggle("hidden", !lines.length);
  $("#customRecipeUnmatchedList").innerHTML = lines.map(l => `<li>${escapeHtml(l)}</li>`).join("");
}

// Shows/hides "Open original" for whatever link is currently typed.
function refreshCustomRecipeLink() {
  const raw = $("#customRecipeSourceUrl").value;
  const link = raw.trim() ? parseRecipeLink(raw) : null;
  const a = $("#customRecipeOpenOriginal");
  a.classList.toggle("hidden", !link);
  if (link) a.setAttribute("href", link.href); else a.removeAttribute("href");
  const note = $("#customRecipeLinkNote");
  if (raw.trim() && !link) {
    note.textContent = "That doesn't look like a web link (it should start with http:// or https://).";
    note.classList.remove("hidden");
  } else if (link) {
    note.textContent = `${recipeSourceLabel(link.platform)} link saved as-is — BiteBudget can't read the page, so add the ingredients and amounts yourself.`;
    note.classList.remove("hidden");
  } else {
    note.classList.add("hidden");
  }
}

// `existing` is a saved personal recipe to edit (complete or a draft), or
// null for a new one.
function openCustomRecipeDialog(existing) {
  customRecipeEditingId = existing ? existing.id : null;
  const isDraft = !!(existing && existing.draft);
  $("#customRecipeTitle").textContent = existing ? (isDraft ? "📝 Finish Your Recipe" : "✏️ Edit Your Recipe") : "✨ Save a Recipe";
  $("#customRecipeDeleteBtn").classList.toggle("hidden", !existing);
  $("#customRecipeError").classList.add("hidden");
  $("#customRecipeParseNote").classList.add("hidden");
  $("#customRecipeName").value = existing ? existing.name : "";
  $("#customRecipeInstructions").value = existing ? existing.instructions.join("\n") : "";
  // A saved complete recipe with no stored yield is a legacy one-serving recipe.
  $("#customRecipeYield").value = existing
    ? (Number.isInteger(existing.yieldServings) ? existing.yieldServings : (isDraft ? "" : 1))
    : "";
  const src = (existing && existing.source) || {};
  $("#customRecipeSourceUrl").value = src.url || "";
  $("#customRecipeSourceText").value = src.text || "";
  $("#customRecipeSourceImage").value = "";
  setCustomRecipeImage(src.image || null);
  refreshCustomRecipeLink();
  customRecipeExtra.unmatched = existing && Array.isArray(existing.unmatched) ? [...existing.unmatched] : [];
  renderCustomRecipeUnmatched();
  customRecipeExtra.keep = {};
  if (existing) for (const k of ["madeAt", "createdAt", "versionOf", "tweak"]) if (existing[k] !== undefined) customRecipeExtra.keep[k] = existing[k];
  $("#customRecipeMade").checked = !!(existing && existing.made);
  // Recipes saved before this setting existed were always auto-planned, so
  // they open as "on"; everything new starts off.
  $("#customRecipeAutoPlan").checked = existing ? existing.autoPlan !== false && !isDraft : false;

  const slot = existing ? existing.slot : "breakfast";
  document.querySelectorAll("#customRecipeSlot .bubble").forEach(b => b.classList.toggle("selected", b.dataset.value === slot));
  document.querySelectorAll("#customRecipeSlot .bubble").forEach(updateBubbleAria);

  const rows = existing && existing.items.length ? existing.items : [{ food: null, grams: 0 }];
  $("#customRecipeIngredients").innerHTML = rows.map(i => customRecipeIngredientRowHTML(i.food, i.grams)).join("");
  updateCustomRecipeNutritionPreview();

  $("#customRecipeDialog").showModal();
}

// Shrinks a screenshot before it's stored (localStorage is small): longest
// side 1280px, re-encoded as JPEG. Rejects if the file isn't a readable image.
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("not an image"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("couldn't read the file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("couldn't decode the image"));
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
        <button type="button" class="my-meal-pick" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)} — ${Math.round(m.protein * 4 + m.carbs * 4 + m.fat * 9)} kcal</button>
        <button type="button" class="my-meal-remove" data-name="${escapeHtml(m.name)}" aria-label="Remove saved meal" title="Remove saved meal">✕</button>
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
  $("#recipeMacros").textContent = `${Math.round(n.cal)} kcal · P ${grams(n.protein)} · C ${grams(n.carbs)} · F ${grams(n.fat)}${time ? " · " + time : ""}${meal.yieldServings > 1 ? ` · per serving (recipe makes ${meal.yieldServings})` : ""}`;
  const favorite = isFavorite(meal.id);
  $("#recipeFavoriteBtn").textContent = favorite ? "❤️ Favorited" : "🤍 Favorite this recipe";
  $("#recipeFavoriteBtn").classList.toggle("active", favorite);
  const disliked = isDislikedRecipe(meal.id);
  $("#recipeDislikeBtn").textContent = disliked ? "👎 Not for me" : "👎 Not for me?";
  $("#recipeDislikeBtn").classList.toggle("active", disliked);
  $("#nutritionLabel").innerHTML = renderNutritionLabel(n);
  // meal.name/instructions can be user-authored (own recipe, or loaded
  // from an imported backup file) — escape before inserting as HTML so
  // saved text can never be interpreted as markup or run as script.
  $("#recipeIngredients").innerHTML = meal.items.map(i => `<li>${escapeHtml(FOODS[i.food].name)} — ${escapeHtml(formatServing(i.food, i.grams))}</li>`).join("");
  $("#recipeInstructions").innerHTML = meal.instructions.map(s => `<li>${escapeHtml(s)}</li>`).join("");
  $("#recipeModal").showModal();
}

function renderDayTab(day, dayIndex, dailyBudget, dailyCalories, minDailyCost, trackCalories = true) {
  const t = day.totals;
  const overBudget = t.cost > dailyBudget * 1.05;
  const budgetClass = overBudget ? "bad" : "good";
  const calDiff = t.cal - dailyCalories;
  const suggestion = overBudget && dailyBudget < minDailyCost
    ? `<div class="budget-suggestion">Try raising your budget to ~${money(minDailyCost)}/day, or loosening a dietary filter.</div>`
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

// Every edit that can change what needs buying (swap, prep-batch shuffle,
// logged meal, Add to Plan) goes through here so the shopping checkmarks
// stay honest: a food you'd already ticked off that now needs MORE than you
// bought is unticked again. Ticks survive when the quantity you'd buy is the
// same or smaller, and when a plan change doesn't touch that food at all.
function uncheckIncreasedShoppingItems(before, after) {
  const checked = loadCheckedShoppingItems();
  let changed = false;
  after.forEach(item => {
    if (!checked.has(item.food)) return;
    const was = before.get(item.food) || 0;
    const now = shoppingPurchaseGrams(item.food, item.grams);
    if (now > was + 1e-6) { checked.delete(item.food); changed = true; }
  });
  if (changed) saveCheckedShoppingItems(checked);
}

function commitPlanMutation(mutate) {
  const before = new Map(currentPlanResult.shoppingList.map(i => [i.food, shoppingPurchaseGrams(i.food, i.grams)]));
  mutate();
  uncheckIncreasedShoppingItems(before, currentPlanResult.shoppingList);
  updateLatestHistoryEntry(currentPlanResult.summary);
  localStorage.setItem(PLAN_KEY, JSON.stringify(currentPlanResult));
  renderPlan(currentPlanResult);
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
  // Projections only. Nothing here is saved, and nothing here touches the
  // shopping list, until the user confirms how much they actually have.
  $("#pantrySuggested").innerHTML = suggestedEntries.length ? `
    <p class="pantry-section-label">Might be left over from this week's shopping</p>
    <p class="wizard-hint">Estimates only — they don't exist until you've shopped. Enter what's actually in your kitchen now and confirm; until then they stay off your pantry and your shopping list.</p>
    <div class="pantry-suggested-list">
      ${suggestedEntries.map(([food, grams]) => {
        const units = kitchenUnitOptions(food);
        const su = SERVING_UNITS[food];
        const def = (su && units.find(u => u.key === su.unit)) || units[0];
        return `
        <div class="pantry-suggested-row" data-food="${escapeHtml(food)}" data-grams="${grams}" data-unit-grams="${def.grams}" data-exact-grams="${grams}">
          <span>${escapeHtml(FOODS[food].name)} — about ${escapeHtml(formatServing(food, grams))} projected</span>
          <input type="number" class="pantry-confirm-amount" min="0" step="any" value="${Math.round(grams / def.grams * 100) / 100}" aria-label="How much ${escapeHtml(FOODS[food].name)} you actually have">
          <select class="pantry-confirm-unit" aria-label="Unit">${units.map(u => `<option value="${u.key}" data-grams="${u.grams}"${u.key === def.key ? " selected" : ""}>${escapeHtml(u.label)}</option>`).join("")}</select>
          <button type="button" class="pantry-confirm-btn" data-food="${escapeHtml(food)}">Confirm on hand</button>
        </div>`;
      }).join("")}
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
        if (m.unmatched) {
          return `
            <div class="booklet-meal">
              <h3>${slotIcon(m.slot)} ${m.slot} — No matching recipe</h3>
              <p class="booklet-meal-macros">${escapeHtml(m.unmatchedReason || "No recipe satisfied your dietary restrictions for this meal.")}</p>
            </div>`;
        }
        if (m.custom && m.pending) {
          return `
            <div class="booklet-meal">
              <h3>${slotIcon(m.slot)} ${m.slot} — ${escapeHtml(m.name)}</h3>
              <p class="booklet-meal-macros">Left open — not yet logged.</p>
            </div>`;
        }
        if (m.custom) {
          return `
            <div class="booklet-meal">
              <h3>${slotIcon(m.slot)} ${m.slot} — ${escapeHtml(m.name)}</h3>
              <p class="booklet-meal-macros">${Math.round(m.nutrition.cal)} kcal · P ${grams(m.nutrition.protein)} · C ${grams(m.nutrition.carbs)} · F ${grams(m.nutrition.fat)} · ${money(m.nutrition.cost)}</p>
              <p class="booklet-meal-macros">Logged by you.</p>
            </div>`;
        }
        const time = formatTime(m.prepTime, m.cookTime);
        return `
        <div class="booklet-meal">
          <h3>${slotIcon(m.slot)} ${m.slot} — ${escapeHtml(m.name)}</h3>
          <p class="booklet-meal-macros">${Math.round(m.nutrition.cal)} kcal · P ${grams(m.nutrition.protein)} · C ${grams(m.nutrition.carbs)} · F ${grams(m.nutrition.fat)} · ${money(m.nutrition.cost)}${time ? " · " + time : ""}</p>
          <div class="booklet-meal-body">
            <div>
              <strong>Ingredients</strong>
              <ul>${m.items.map(i => `<li>${escapeHtml(FOODS[i.food].name)} — ${escapeHtml(formatServing(i.food, i.grams))}</li>`).join("")}</ul>
            </div>
            <div>
              <strong>Instructions</strong>
              <ol>${m.instructions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
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
          <div class="prep-batch-name">${escapeHtml(b.name)}</div>
        </div>
        <button type="button" class="prep-batch-shuffle-btn" data-batch-id="${escapeHtml(b.id)}" aria-label="Prep a different recipe instead" title="Prep a different recipe instead">🔀</button>
      </div>
      <div class="prep-batch-servings">🧺 ${prepBatchServingsLabel(b)} · ${money(b.cost)}</div>
      <ul class="prep-batch-items">${b.items.map(i => `<li>${escapeHtml(FOODS[i.food].name)} — ${escapeHtml(formatServing(i.food, i.grams))}</li>`).join("")}</ul>
      <details class="prep-batch-instructions">
        <summary>📋 How to make this batch</summary>
        <ol>${b.instructions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
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
      <h3>${slotIcon(b.slot)} ${b.slot} — ${escapeHtml(b.name)}</h3>
      <p class="booklet-meal-macros">${prepBatchServingsLabel(b)} · ${money(b.cost)} total</p>
      <div class="booklet-meal-body">
        <div>
          <strong>Total ingredients</strong>
          <ul>${b.items.map(i => `<li>${escapeHtml(FOODS[i.food].name)} — ${escapeHtml(formatServing(i.food, i.grams))}</li>`).join("")}</ul>
        </div>
        <div>
          <strong>Instructions</strong>
          <ol>${b.instructions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
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
      ${day.meals.map(m => {
        const label = m.unmatched ? "⚠️ None" : m.name;
        return `<button type="button" class="week-overview-cell ${m.unmatched ? "week-overview-cell-unmatched" : ""}" data-day="${day.day}" title="${escapeHtml(m.unmatched ? (m.unmatchedReason || "No matching recipe") : m.name)}">${escapeHtml(label)}</button>`;
      }).join("")}
    </div>`).join("");

  return `<div class="week-overview-grid" style="--week-cols: ${headers.length}">${headerRow}${rows}</div>`;
}

function renderPlan(result) {
  currentPlanResult = result;
  const { plan, shoppingList, summary } = result;
  const trackCalories = summary.trackCalories !== false;
  const servings = summary.servings || 1;
  const targets = macroTargetGrams(summary.dailyCalories, summary.macroSplit);
  const summaryDiet = { vegetarian: summary.vegetarianOnly, glutenFree: summary.glutenFree, dairyFree: summary.dairyFree };
  const minDailyCost = estimateMinDailyCost(summary.dailyCalories, summary.snacksPerDay, summaryDiet, trackCalories, servings);
  const totalOverBudget = summary.totalCost > summary.totalBudget * 1.02;
  const totalSuggestion = totalOverBudget && summary.dailyBudget < minDailyCost
    ? `<div class="budget-suggestion">${money(summary.totalCost - summary.totalBudget)} over — try raising your budget to ~${money(minDailyCost * summary.days)}, or loosening a dietary filter.</div>`
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

  // Import validation keeps bad values out of storage, but startup is the
  // one place a bad value would take down every later load — so restoring
  // saved settings/plan is guarded. On failure the stored value is left
  // alone (not deleted) and the app just starts as if there were none.
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      writeSettingsToForm(JSON.parse(saved));
    } catch (err) {
      console.error("BiteBudget: couldn't restore saved settings; using defaults.", err);
    }
  }

  applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", $("#budgetPeriod").value, Number($("#servings").value) || 1);
  syncSlider("#calories", "#caloriesSlider");
  syncSlider("#budgetAmount", "#budgetAmountSlider");
  $("#budgetPeriod").addEventListener("change", () => {
    applyBudgetSliderRange("#budgetAmountSlider", "#budgetAmount", $("#budgetPeriod").value, Number($("#servings").value) || 1);
  });

  const savedPlan = localStorage.getItem(PLAN_KEY);
  let restoredPlan = false;
  if (savedPlan) {
    try {
      renderPlan(recomputeAllCosts(JSON.parse(savedPlan), loadPantry()));
      restoredPlan = true;
    } catch (err) {
      console.error("BiteBudget: couldn't restore the saved plan; starting without it.", err);
      currentPlanResult = null;
    }
  }
  if (!restoredPlan) renderProgressStrip();
  activeSection = restoredPlan ? "week" : "settings";
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
  ["#recipeVegOnly", "#recipeGlutenFree", "#recipeDairyFree", "#recipeFavoritesOnly"].forEach(sel => $(sel).addEventListener("change", renderRecipeBook));
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
      if (t) openRecipeModal({ ...t, nutrition: computeNutrition(servingItems(t)), yieldServings: templateYield(t) });
      return;
    }
    const addBtn = e.target.closest(".recipe-book-add-btn");
    if (addBtn) openAddToPlanDialog(addBtn.dataset.templateId);
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
  $("#customRecipeIngredients").addEventListener("input", (e) => {
    const row = e.target.closest(".custom-recipe-ingredient-row");
    if (row && e.target.matches(".custom-recipe-grams-input")) syncRowGramsFromQty(row);
    updateCustomRecipeNutritionPreview();
  });
  $("#customRecipeIngredients").addEventListener("change", (e) => {
    const row = e.target.closest(".custom-recipe-ingredient-row");
    if (row && e.target.matches(".custom-recipe-unit-select")) showRowGramsInUnit(row);
    if (row && e.target.matches(".custom-recipe-food-select")) resetRowUnits(row);
    updateCustomRecipeNutritionPreview();
  });
  $("#customRecipeYield").addEventListener("input", updateCustomRecipeNutritionPreview);
  $("#customRecipeSourceUrl").addEventListener("input", refreshCustomRecipeLink);
  $("#customRecipeSourceImage").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      setCustomRecipeImage(await compressImageFile(file));
      $("#customRecipeError").classList.add("hidden");
    } catch {
      $("#customRecipeError").textContent = "Couldn't read that image. Try a PNG or JPEG screenshot.";
      $("#customRecipeError").classList.remove("hidden");
      e.target.value = "";
    }
  });
  $("#customRecipeImageRemove").addEventListener("click", () => {
    setCustomRecipeImage(null);
    $("#customRecipeSourceImage").value = "";
  });
  $("#customRecipeParseBtn").addEventListener("click", () => {
    const note = $("#customRecipeParseNote");
    const text = $("#customRecipeSourceText").value;
    const res = parseRecipeText(text);
    const filled = [];
    if (res.title && !$("#customRecipeName").value.trim()) { $("#customRecipeName").value = res.title; filled.push("title"); }
    if (res.yieldServings && readCustomRecipeYield() === null) { $("#customRecipeYield").value = res.yieldServings; filled.push(`servings (${res.yieldServings})`); }
    let kept = false;
    if (res.items.length) {
      if (readCustomRecipeIngredients().length === 0) {
        $("#customRecipeIngredients").innerHTML = res.items.map(i => customRecipeIngredientRowHTML(i.food, i.grams)).join("");
        filled.push(`${res.items.length} ingredient${res.items.length === 1 ? "" : "s"}`);
      } else kept = true;
    }
    if (res.instructions.length && !$("#customRecipeInstructions").value.trim()) {
      $("#customRecipeInstructions").value = res.instructions.join("\n");
      filled.push(`${res.instructions.length} step${res.instructions.length === 1 ? "" : "s"}`);
    }
    customRecipeExtra.unmatched = res.unmatched;
    renderCustomRecipeUnmatched();
    updateCustomRecipeNutritionPreview();
    note.textContent = filled.length || res.unmatched.length
      ? `${filled.length ? `Filled in: ${filled.join(", ")}. ` : ""}${res.unmatched.length ? `${res.unmatched.length} line${res.unmatched.length === 1 ? "" : "s"} couldn't be matched to a food with a known amount — listed below for you to add. ` : ""}${kept ? "Your existing ingredients were kept. " : ""}Check everything before saving — nothing is final until you tap Save Recipe.`
      : "Nothing in that text could be read reliably, so nothing was filled in. The text stays saved with the recipe for you to work from.";
    note.classList.remove("hidden");
  });

  $("#customRecipeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const mode = (e.submitter && e.submitter.dataset.mode) || "complete";
    const showError = (msg) => { $("#customRecipeError").textContent = msg; $("#customRecipeError").classList.remove("hidden"); };

    const items = readCustomRecipeIngredients();
    const yieldServings = readCustomRecipeYield();
    const urlRaw = $("#customRecipeSourceUrl").value.trim();
    const link = urlRaw ? parseRecipeLink(urlRaw) : null;
    if (urlRaw && !link) return showError("That link doesn't look right — it should be a web address like https://www.instagram.com/…");
    const text = $("#customRecipeSourceText").value.trim();
    const image = customRecipeExtra.image;
    const name = $("#customRecipeName").value.trim() || suggestRecipeTitle({ url: link && link.href, text, hasImage: !!image });
    if (!name) return showError("Add a title — or a link, pasted text or screenshot, and one will be filled in.");
    if (mode === "complete" && (!items.length || yieldServings === null)) {
      const need = [!items.length && "at least one ingredient with a quantity above 0", yieldServings === null && "how many servings it makes"].filter(Boolean);
      return showError(`To save a finished recipe, add ${need.join(" and ")}. Or tap “Save as Want to make” to keep it as it is.`);
    }

    const existing = customRecipeEditingId ? loadCustomRecipes().find(r => r.id === customRecipeEditingId) : null;
    const made = $("#customRecipeMade").checked;
    const source = {};
    if (link) source.url = link.href;
    if (text) source.text = text;
    if (image) source.image = image;
    const record = orderedRecipeRecord({
      id: customRecipeEditingId || newRecipeId(),
      slot: document.querySelector("#customRecipeSlot .bubble.selected")?.dataset.value || "breakfast",
      name,
      yieldServings: yieldServings === null ? undefined : yieldServings,
      items,
      instructions: $("#customRecipeInstructions").value.split("\n").map(s => s.trim()).filter(Boolean),
      draft: mode === "draft" ? true : undefined,
      autoPlan: $("#customRecipeAutoPlan").checked,
      made: made ? true : undefined,
      madeAt: made ? (customRecipeExtra.keep.madeAt || Date.now()) : undefined,
      createdAt: existing ? customRecipeExtra.keep.createdAt : Date.now(),
      versionOf: customRecipeExtra.keep.versionOf,
      tweak: customRecipeExtra.keep.tweak,
      source: Object.keys(source).length ? source : undefined,
      unmatched: mode === "draft" && customRecipeExtra.unmatched.length ? customRecipeExtra.unmatched : undefined,
    });

    const recipes = loadCustomRecipes();
    const idx = recipes.findIndex(r => r.id === record.id);
    if (idx >= 0) recipes[idx] = record; else recipes.push(record);
    if (!saveCustomRecipes(recipes)) {
      return showError("Couldn't save — the browser's storage is full. Remove a saved screenshot or export a backup, then try again.");
    }
    syncCustomRecipesIntoTemplates();

    $("#customRecipeDialog").close();
    renderRecipeBook();
    showRecipeBookTab("mine");
  });
  $("#customRecipeDeleteBtn").addEventListener("click", () => {
    if (!customRecipeEditingId) return;
    const name = $("#customRecipeName").value.trim() || "this recipe";
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    saveCustomRecipes(loadCustomRecipes().filter(r => r.id !== customRecipeEditingId));
    syncCustomRecipesIntoTemplates();
    $("#customRecipeDialog").close();
    renderRecipeBook();
    if (!$("#myRecipesView").classList.contains("hidden")) renderMyRecipes();
  });

  // ---- Add to Plan dialog
  $("#addToPlanCloseBtn").addEventListener("click", () => $("#addToPlanDialog").close());
  $("#addToPlanDialog").addEventListener("click", (e) => {
    if (e.target === $("#addToPlanDialog")) $("#addToPlanDialog").close();
  });
  $("#addToPlanDay").addEventListener("change", fillAddToPlanSlots);
  $("#addToPlanSlot").addEventListener("change", updateAddToPlanPreview);
  $("#addToPlanServings").addEventListener("input", updateAddToPlanPreview);
  $("#addToPlanForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = MEAL_TEMPLATES.find(x => x.id === addToPlanTemplateId);
    if (!t || !currentPlanResult) return;
    const dayIndex = Number($("#addToPlanDay").value);
    const mealIndex = Number($("#addToPlanSlot").value);
    commitPlanMutation(() => placeRecipeInPlan(currentPlanResult, dayIndex, mealIndex, t, readAddToPlanServings(), loadPantry()));
    $("#addToPlanDialog").close();
    showSection("week");
    activateDay(dayIndex + 1);
  });

  // ---- Recipe Book tabs + My Recipes view
  wireWhatCanIMake();
  $("#recipeBookTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".bubble");
    if (b) showRecipeBookTab(b.dataset.value);
  });
  wireBubbleGroup($("#myRecipesFilter"), "single");
  $("#myRecipesFilter").addEventListener("click", renderMyRecipes);
  $("#newPersonalRecipeBtn").addEventListener("click", () => openCustomRecipeDialog(null));
  $("#myRecipesList").addEventListener("click", (e) => {
    const favoriteBtn = e.target.closest(".favorite-btn");
    if (favoriteBtn) { toggleFavorite(favoriteBtn.dataset.templateId); return; }
    const btn = e.target.closest("button[data-recipe-id]");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.recipeId;
    const recipe = loadCustomRecipes().find(r => r.id === id);
    if (!recipe) return;
    if (btn.classList.contains("my-recipe-edit-btn")) openCustomRecipeDialog(recipe);
    else if (btn.classList.contains("my-recipe-made-btn")) {
      updatePersonalRecipe(id, recipe.made ? { made: undefined, madeAt: undefined } : { made: true, madeAt: Date.now() });
      renderMyRecipes();
    } else if (btn.classList.contains("my-recipe-add-btn")) openAddToPlanDialog(id);
    else if (btn.classList.contains("my-recipe-tweaks-btn")) openTweaksDialog(id);
    else if (btn.classList.contains("my-recipe-view-btn")) {
      const t = MEAL_TEMPLATES.find(x => x.id === id);
      if (t) openRecipeModal({ ...t, nutrition: computeNutrition(servingItems(t)), yieldServings: templateYield(t) });
    }
  });
  $("#myRecipesList").addEventListener("change", (e) => {
    const box = e.target.closest(".my-recipe-autoplan-input");
    if (box) updatePersonalRecipe(box.dataset.recipeId, { autoPlan: box.checked });
  });

  // ---- Suggest Tweaks
  $("#tweaksCloseBtn").addEventListener("click", () => $("#tweaksDialog").close());
  $("#tweaksDialog").addEventListener("click", (e) => {
    if (e.target === $("#tweaksDialog")) $("#tweaksDialog").close();
  });
  $("#tweaksKinds").addEventListener("click", (e) => {
    const b = e.target.closest(".bubble");
    if (!b) return;
    document.querySelectorAll("#tweaksKinds .bubble").forEach(x => x.classList.toggle("selected", x === b));
    renderTweaks(b.dataset.value);
  });
  $("#tweaksList").addEventListener("click", (e) => {
    const btn = e.target.closest(".tweak-save-btn");
    if (!btn) return;
    const id = saveTweakAsVersion(btn.dataset.kind, Number(btn.dataset.index));
    if (!id) {
      $("#tweaksNote").textContent = "Couldn't save the variation — the browser's storage may be full.";
      $("#tweaksNote").classList.remove("hidden");
      return;
    }
    $("#tweaksDialog").close();
    showRecipeBookTab("mine");
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
      commitPlanMutation(() => regenerateMeal(currentPlanResult, dayIndex, mealIndex, readSettings(), loadPreferences(), loadPantry()));
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
    commitPlanMutation(() => regeneratePrepBatch(currentPlanResult, shuffleBtn.dataset.batchId, readSettings(), loadPreferences(), loadPantry()));
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
    commitPlanMutation(() => applyCustomMeal(currentPlanResult, dayIndex, mealIndex, customMeal, readSettings(), loadPreferences(), rebalance, loadPantry()));
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

    const confirmBtn = e.target.closest(".pantry-confirm-btn");
    if (confirmBtn) {
      const row = confirmBtn.closest(".pantry-suggested-row");
      const amount = Number(row.querySelector(".pantry-confirm-amount").value);
      if (!(amount > 0)) return;
      const unitGrams = Number(row.querySelector(".pantry-confirm-unit").selectedOptions[0].dataset.grams) || 1;
      // The box shows a rounded figure (6 eggs = 10.58 oz); the grams behind
      // it are kept exactly, and used unless the user typed a new amount.
      const exact = Number(row.dataset.exactGrams);
      const grams = row.dataset.exactGrams !== undefined && row.dataset.exactGrams !== "" && Number.isFinite(exact) ? exact : amount * unitGrams;
      const pantry = loadPantry();
      pantry[confirmBtn.dataset.food] = (pantry[confirmBtn.dataset.food] || 0) + grams;
      savePantry(pantry);
      // Confirmed stock is real: the shopping list rebuilds around it.
      syncPlanWithPantry();
      renderPantryDialog();
      return;
    }

    const removeBtn = e.target.closest(".pantry-remove-btn");
    if (removeBtn) {
      const pantry = loadPantry();
      delete pantry[removeBtn.dataset.food];
      savePantry(pantry);
      syncPlanWithPantry();
      renderPantryDialog();
      return;
    }

    if (e.target.closest("#pantryClearBtn")) {
      if (!confirm("Clear your pantry? This removes everything you've added.")) return;
      savePantry({});
      syncPlanWithPantry();
      renderPantryDialog();
    }
  });
  $("#pantrySuggested").addEventListener("input", (e) => {
    const input = e.target.closest(".pantry-confirm-amount");
    if (input) delete input.closest(".pantry-suggested-row").dataset.exactGrams;
  });
  $("#pantrySuggested").addEventListener("change", (e) => {
    const sel = e.target.closest(".pantry-confirm-unit");
    if (!sel) return;
    // Re-express the amount in the new unit (same physical quantity), keeping
    // the exact grams separately so rounding in the display never reaches
    // what gets saved. Never snap back to the projected estimate.
    const row = sel.closest(".pantry-suggested-row");
    const input = row.querySelector(".pantry-confirm-amount");
    const newUnitGrams = Number(sel.selectedOptions[0].dataset.grams) || 1;
    const oldUnitGrams = Number(row.dataset.unitGrams) || newUnitGrams;
    if (input.value.trim() !== "" && Number.isFinite(Number(input.value))) {
      if (row.dataset.exactGrams === undefined) row.dataset.exactGrams = String(Number(input.value) * oldUnitGrams);
      input.value = Math.round(Number(row.dataset.exactGrams) / newUnitGrams * 100) / 100;
    }
    row.dataset.unitGrams = String(newUnitGrams);
  });
  $("#pantryItems").addEventListener("change", (e) => {
    const input = e.target.closest(".pantry-row-input");
    if (!input) return;
    const pantry = loadPantry();
    const grams = Math.max(0, Number(input.value) || 0);
    if (grams <= 0) delete pantry[input.dataset.food]; else pantry[input.dataset.food] = grams;
    savePantry(pantry);
    syncPlanWithPantry();
    renderPantryDialog();
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

  ["#calories", "#budgetPeriod", "#budgetAmount", "#snacks", "#vegetarian", "#glutenFree", "#dairyFree", "#servings", "#trackCalories"].forEach(sel => {
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
      if (!isPlainObject(parsed) || !isPlainObject(parsed.data)) throw new Error("Not a BiteBudget backup file.");

      // Only keys with a validator are ever considered — anything else in
      // the file is ignored outright. Each value is validated and rebuilt
      // (see IMPORT_VALIDATORS); a value that fails is skipped and the
      // current one for that key is left exactly as it was.
      const entries = Object.entries(parsed.data).filter(([k]) => hasOwn(IMPORT_VALIDATORS, k));
      if (entries.length === 0) throw new Error("Not a BiteBudget backup file.");

      const toWrite = {};
      const rejected = [];
      let dropped = 0;
      for (const [k, v] of entries) {
        const result = typeof v === "string" ? IMPORT_VALIDATORS[k](v) : null;
        if (!result) { rejected.push(IMPORT_LABELS[k]); continue; }
        toWrite[k] = result.value;
        dropped += result.dropped;
      }

      if (Object.keys(toWrite).length === 0) {
        alert("Nothing in that file could be imported — it doesn't look like a valid BiteBudget export.");
        return;
      }

      const notes = [];
      if (rejected.length) notes.push(`Couldn't import and left unchanged: ${rejected.join(", ")}.`);
      if (dropped) notes.push(`${dropped} invalid entr${dropped === 1 ? "y was" : "ies were"} skipped.`);
      const confirmMsg = "Import this backup? This replaces your current settings, preferences, favorites, and history."
        + (notes.length ? "\n\n" + notes.join("\n") : "");
      if (!confirm(confirmMsg)) return;

      Object.entries(toWrite).forEach(([k, v]) => localStorage.setItem(k, v));
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
