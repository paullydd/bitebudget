// Personal-cookbook logic that doesn't touch the DOM: reading pasted recipe
// text into an editable draft, working out what a draft is still missing,
// recognising source links, and catalog-based "Suggest Tweaks". Everything
// here runs locally on the food catalog (foods.js) — no network, no AI
// service, no OCR. Anything it can't read it leaves blank rather than guess.

// ---------- Source links ----------

// Returns {href, host, platform} for an http(s) link, else null. `platform`
// is "instagram", "pinterest" or "web". A bare "instagram.com/p/abc" gets
// https:// added. javascript:, data:, file: and anything else is rejected, so
// a stored link can never be anything but a normal web address.
function parseRecipeLink(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(s)) return null;
    s = "https://" + s;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || !u.hostname.includes(".")) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  let platform = "web";
  if (host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am") platform = "instagram";
  else if (/(^|\.)pinterest\.[a-z.]+$/.test(host) || host === "pin.it") platform = "pinterest";
  return { href: u.href, host, platform };
}

function recipeSourceLabel(platform) {
  return { instagram: "Instagram", pinterest: "Pinterest", web: "Link" }[platform] || "Link";
}

// A title for a recipe saved with no name typed: from the pasted text's first
// line if there is one, else from where the link points, else the screenshot.
function suggestRecipeTitle({ url, text, hasImage }) {
  const first = String(text || "").split(/\r?\n/).map(l => l.trim()).find(Boolean);
  if (first && first.length <= 80 && !parseQuantityPrefix(first)) return first.replace(/^[#*_\s]+|[*_\s:]+$/g, "");
  const link = parseRecipeLink(url);
  if (link) return link.platform === "web" ? `Recipe from ${link.host}` : `${recipeSourceLabel(link.platform)} recipe`;
  if (hasImage) return "Screenshot recipe";
  return "";
}

// ---------- Pasted-text parsing ----------

const UNICODE_FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

// "1 1/2 cups x" -> {qty: 1.5, rest: "cups x"}; "2-3 x" -> {range: true};
// no leading number -> null.
function parseQuantityPrefix(str) {
  const s = String(str).trim().replace(/^[-*•–]\s*/, "");
  if (/^\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d/i.test(s)) return { range: true };
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)(?!\d)\s*/);
  if (m && +m[3] > 0) return { qty: +m[1] + +m[2] / +m[3], rest: s.slice(m[0].length) };
  m = s.match(/^(\d+)\/(\d+)(?!\d)\s*/);
  if (m && +m[2] > 0) return { qty: +m[1] / +m[2], rest: s.slice(m[0].length) };
  m = s.match(/^(\d+(?:\.\d+)?)\s*([½¼¾⅓⅔⅛])\s*/);
  if (m) return { qty: +m[1] + UNICODE_FRACTIONS[m[2]], rest: s.slice(m[0].length) };
  m = s.match(/^([½¼¾⅓⅔⅛])\s*/);
  if (m) return { qty: UNICODE_FRACTIONS[m[1]], rest: s.slice(m[0].length) };
  m = s.match(/^(\d+(?:\.\d+)?)(?![\d/])\s*/);
  if (m) return { qty: +m[1], rest: s.slice(m[0].length) };
  return null;
}

function singularWord(w) {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("oes") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("ss")) return w;
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  return w;
}
function normWords(s) {
  return String(s).toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter(Boolean).map(singularWord);
}
function containsSequence(hay, needle) {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

// Words that may sit around a food name without changing what it is. Any
// OTHER extra word ("onion POWDER", "apple CIDER vinegar", "almond FLOUR",
// "egg NOODLES") means the line is a different ingredient, so it isn't matched.
const FOOD_DESCRIPTORS = new Set(["canned", "diced", "chopped", "sliced", "minced", "shredded", "grated", "fresh", "frozen",
  "cooked", "raw", "large", "medium", "small", "boneless", "skinless", "lean", "drained", "rinsed", "peeled", "cubed",
  "ripe", "plain", "optional", "finely", "roughly", "thinly", "about", "of", "a", "the", "and", "or", "extra", "whole"]);
// Short names people actually write for a catalog food.
const FOOD_ALIASES = { oat: "oats", "rolled oat": "oats", "old fashioned oat": "oats" };

let foodWordIndex = null;
// The catalog food named in an ingredient phrase, or null. The LONGEST food
// name found wins ("low fat cheddar" over "cheddar"); two different foods
// tying for longest is ambiguous, so it matches nothing rather than guess.
// Catalog foods listed as "(cooked)" only match when the line says it's
// cooked, canned, drained or rinsed (anywhere in the line, e.g. "black beans,
// drained") — a cup of dry rice is not a cup of cooked rice.
function matchCatalogFood(phrase) {
  if (!foodWordIndex) {
    foodWordIndex = Object.keys(FOODS).map(food => ({
      food, words: normWords(FOODS[food].name), needsCooked: /\(cooked\)/i.test(FOODS[food].name),
    }));
  }
  const words = normWords(String(phrase).split(",")[0]);
  const lineWords = normWords(phrase);
  const alias = FOOD_ALIASES[words.filter(w => !FOOD_DESCRIPTORS.has(w)).join(" ")];
  if (alias) return { food: alias, words };
  let best = [];
  let bestLen = 0;
  for (const entry of foodWordIndex) {
    if (!containsSequence(words, entry.words)) continue;
    if (entry.needsCooked && !lineWords.some(w => ["cooked", "canned", "drained", "rinsed"].includes(w))) continue;
    if (entry.words.length > bestLen) { best = [entry]; bestLen = entry.words.length; }
    else if (entry.words.length === bestLen) best.push(entry);
  }
  if (best.length !== 1) return null;
  const entry = best[0];
  const leftover = words.filter(w => !entry.words.includes(w));
  if (!leftover.every(w => FOOD_DESCRIPTORS.has(w))) return null;
  return { food: entry.food, words };
}

function gramsForUnitWord(food, unitWord, qty) {
  const u = unitWord.toLowerCase().replace(/\.$/, "");
  if (/^(g|grams?)$/.test(u)) return qty;
  if (/^(kg|kilograms?)$/.test(u)) return qty * 1000;
  if (/^(lbs?|pounds?)$/.test(u)) return qty * 16 * GRAMS_PER_OZ;
  const key = /^(oz|ounces?)$/.test(u) ? "oz" : /^cups?$/.test(u) ? "cup"
    : /^(tbsps?|tablespoons?)$/.test(u) ? "tbsp" : "tsp";
  const opt = kitchenUnitOptions(food).find(o => o.key === key);
  return opt ? qty * opt.grams : null;
}

const UNIT_WORD = /^(kilograms?|kg|grams?|g|ounces?|oz|pounds?|lbs?|cups?|tablespoons?|tbsps?|teaspoons?|tsps?)\b\.?\s*(?:of\s+)?/i;

// One ingredient line -> {food, grams} when the food is in the catalog AND the
// quantity converts to grams unambiguously; otherwise null ("couldn't match").
// Cups/spoons only convert for foods the catalog has a volume for. A bare
// count ("2 eggs") only converts when the noun is that food's own unit.
function parseIngredientLine(line) {
  const q = parseQuantityPrefix(line);
  if (!q || q.range) return null;
  const um = q.rest.match(UNIT_WORD);
  const phrase = um ? q.rest.slice(um[0].length) : q.rest;
  const hit = matchCatalogFood(phrase);
  if (!hit) return null;
  let grams = null;
  if (um) {
    grams = gramsForUnitWord(hit.food, um[1], q.qty);
  } else {
    const su = SERVING_UNITS[hit.food];
    if (su && containsSequence(hit.words, normWords(su.unit))) grams = q.qty * su.grams;
  }
  if (grams === null || !Number.isFinite(grams) || grams <= 0) return null;
  return { food: hit.food, grams };
}

function cleanHeading(line) {
  return line.replace(/^[#*_\s]+|[*_:\s]+$/g, "").trim();
}
const INGREDIENT_HEADER = /^(ingredients?|what you'?ll need|you'?ll need)$/i;
const METHOD_HEADER = /^(instructions?|directions?|method|steps?|preparation|how to make it)$/i;

function parseServings(text) {
  const found = new Set();
  const re = /(?:\b(?:serves|servings?|makes|yields?)\b\s*[:\-]?\s*(\d{1,3})(?!\s*(?:-|–|to)\s*\d)|\b(\d{1,3})\s+servings?\b)/gi;
  let m;
  while ((m = re.exec(text))) found.add(Number(m[1] || m[2]));
  const vals = [...found].filter(n => n >= 1 && n <= 100);
  return vals.length === 1 && found.size === 1 ? vals[0] : null;
}

// Reads pasted recipe text into {title, yieldServings, items, instructions,
// unmatched, ingredientLines}. Reliable fields only: a title only when the
// first line plainly is one, servings only when stated once and unambiguously,
// an ingredient only when both the food and a convertible quantity are
// certain. Every other ingredient line comes back in `unmatched` for the
// person to resolve; nothing is invented.
function parseRecipeText(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result = { title: "", yieldServings: parseServings(String(text || "")), items: [], instructions: [], unmatched: [], ingredientLines: 0 };
  if (!lines.length) return result;

  const first = cleanHeading(lines[0]);
  if (first && first.length <= 80 && !parseQuantityPrefix(first) && !INGREDIENT_HEADER.test(first)
      && !METHOD_HEADER.test(first) && !/[.!?]$/.test(first) && !/\b(serves|servings?|makes|yields?)\b/i.test(first)) {
    result.title = first;
  }

  const byFood = new Map();
  const addIngredient = (line) => {
    result.ingredientLines++;
    const parsed = parseIngredientLine(line);
    if (parsed) byFood.set(parsed.food, (byFood.get(parsed.food) || 0) + parsed.grams);
    else result.unmatched.push(line.replace(/^[-*•–]\s*/, ""));
  };
  const addStep = (line) => {
    const step = line.replace(/^(?:step\s*)?\d+\s*[.):]\s*/i, "").trim();
    if (step) result.instructions.push(step);
  };

  const hasHeaders = lines.some(l => INGREDIENT_HEADER.test(cleanHeading(l)) || METHOD_HEADER.test(cleanHeading(l)));
  let mode = null;
  lines.forEach((line, i) => {
    const heading = cleanHeading(line);
    if (INGREDIENT_HEADER.test(heading)) { mode = "ingredients"; return; }
    if (METHOD_HEADER.test(heading)) { mode = "steps"; return; }
    if (i === 0 && result.title) return;
    if (hasHeaders) {
      if (mode === "ingredients") {
        if (/:$/.test(line) && !/\d/.test(line)) return; // a sub-heading like "For the sauce:"
        addIngredient(line);
      } else if (mode === "steps") {
        addStep(line);
      }
    } else if (/^\d+\s*[.)]\s+\S/.test(line)) {
      addStep(line); // "1. Preheat..." — a numbered step, not a quantity
    } else if (parseQuantityPrefix(line)) {
      addIngredient(line);
    }
  });

  result.items = [...byFood].map(([food, grams]) => ({ food, grams: Math.round(grams * 100) / 100 }));
  return result;
}

// ---------- What a recipe still needs ----------

const DATA_URL_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

// Plain-language list of what stops a recipe from being planned. Empty means
// ready. Drafts that already have everything still list the last step: the
// person confirming it.
function recipeMissing(r) {
  const missing = [];
  const items = Array.isArray(r.items) ? r.items.filter(i => i && i.grams > 0) : [];
  if (!items.length) missing.push("ingredient quantities");
  const unmatched = Array.isArray(r.unmatched) ? r.unmatched.length : 0;
  if (unmatched) missing.push(`${unmatched} ingredient line${unmatched === 1 ? "" : "s"} to add by hand`);
  if (!Number.isInteger(r.yieldServings) || r.yieldServings < 1) missing.push("servings");
  if (!missing.length && r.draft) missing.push("your confirmation — open it and tap Save recipe");
  return missing;
}

// Key order every writer and the backup validator share, so a recipe round
// trips through export/import byte-for-byte. Legacy records have none of the
// later fields and are left exactly as they were.
function orderedRecipeRecord(r) {
  const out = { id: r.id, slot: r.slot, name: r.name };
  if (r.yieldServings !== undefined) out.yieldServings = r.yieldServings;
  out.items = r.items;
  out.instructions = r.instructions;
  for (const key of ["draft", "autoPlan", "made", "madeAt", "createdAt", "versionOf", "tweak", "source", "unmatched"]) {
    if (r[key] !== undefined) out[key] = r[key];
  }
  return out;
}

// ---------- Suggest Tweaks ----------

function foodCal100(f) { return f.protein * 4 + f.carbs * 4 + f.fat * 9; }

// How different two foods' macro makeup is (0 identical .. 2 opposite):
// compares each food's share of calories from protein/carbs/fat.
function macroShareDistance(a, b) {
  const ca = foodCal100(a), cb = foodCal100(b);
  if (ca <= 0 || cb <= 0) return 2;
  const sa = [a.protein * 4 / ca, a.carbs * 4 / ca, a.fat * 9 / ca];
  const sb = [b.protein * 4 / cb, b.carbs * 4 / cb, b.fat * 9 / cb];
  return Math.abs(sa[0] - sb[0]) + Math.abs(sa[1] - sb[1]) + Math.abs(sa[2] - sb[2]);
}

// Beef and poultry stand in for each other; fish, plant proteins, egg and
// dairy each only swap within their own kind.
const TWEAK_PROTEIN_GROUP = { red_meat: "meat", poultry: "meat", fish: "fish", plant: "plant", egg: "egg", dairy: "dairy" };

// A like-for-like substitute: same grocery section, both a main protein or
// both not, and a similar macro makeup. Deliberately conservative — it won't
// offer tofu for chicken breast.
function tweakCompatible(oldFood, newFood) {
  if (oldFood === newFood) return false;
  const a = FOODS[oldFood], b = FOODS[newFood];
  if ((a.category || "") !== (b.category || "")) return false;
  if (!!a.proteinFamily !== !!b.proteinFamily) return false;
  // Sold and measured the same way: a pound of steak and a pound of ground
  // beef are both "oz" foods; slices of bacon are not a stand-in for either.
  const ua = SERVING_UNITS[oldFood], ub = SERVING_UNITS[newFood];
  if (!ua || !ub || ua.unit !== ub.unit) return false;
  if (a.proteinFamily && TWEAK_PROTEIN_GROUP[a.proteinFamily] !== TWEAK_PROTEIN_GROUP[b.proteinFamily]) return false;
  return macroShareDistance(a, b) <= 0.5;
}

function tweakRound(g) {
  const r = g >= 25 ? Math.round(g / 5) * 5 : Math.round(g);
  return Math.max(1, r);
}

// Grams of newFood that carry the same calories as `grams` of oldFood
// (equal weight for near-zero-calorie foods), kept within half to double.
function equalCalorieGrams(oldFood, newFood, grams) {
  const ca = foodCal100(FOODS[oldFood]), cb = foodCal100(FOODS[newFood]);
  const scale = ca >= 40 && cb >= 40 ? ca / cb : 1;
  return tweakRound(grams * Math.min(2, Math.max(0.5, scale)));
}

function perServing(items, yieldN, pantry) {
  const n = computeNutrition(items);
  const out = { cost: n.cost / yieldN, cal: n.cal / yieldN, protein: n.protein / yieldN, carbs: n.carbs / yieldN, fat: n.fat / yieldN };
  if (pantry) {
    let buy = 0;
    items.forEach(({ food, grams }) => { buy += FOODS[food].price * Math.max(0, grams - (pantry[food] || 0)) / 100; });
    out.buyCost = buy / yieldN;
  }
  const fiber = items.every(i => typeof FOODS[i.food].fiber === "number")
    ? items.reduce((s, i) => s + FOODS[i.food].fiber * i.grams / 100, 0) / yieldN : null;
  if (fiber !== null) out.fiber = fiber;
  return out;
}

function swapItems(items, idx, newFood, newGrams) {
  const out = items.map(i => ({ ...i }));
  const existing = out.findIndex((i, j) => j !== idx && i.food === newFood);
  if (existing >= 0) { out[existing].grams += newGrams; out.splice(idx, 1); }
  else out[idx] = { food: newFood, grams: newGrams };
  return out;
}

function amountText(food, grams) {
  return `${Math.round(grams)} g ${FOODS[food].name} (≈ ${formatServing(food, grams)})`;
}

function describeChange(c) {
  return c.type === "swap"
    ? `Replace ${amountText(c.fromFood, c.fromGrams)} with ${amountText(c.toFood, c.toGrams)}`
    : `Increase ${FOODS[c.food].name} from ${Math.round(c.fromGrams)} g to ${Math.round(c.toGrams)} g (≈ ${formatServing(c.food, c.toGrams)})`;
}

const TWEAK_KINDS = {
  lowerCost: { label: "Lower cost", slug: "lower cost" },
  usePantry: { label: "Use what I have", slug: "uses my pantry" },
  moreProtein: { label: "More protein", slug: "more protein" },
  moreFiber: { label: "More fiber", slug: "more fiber" },
};

// Catalog-only suggestions for one complete recipe. ctx: { diet, pantry }.
// Every substitute must itself satisfy the active diet filters, and the
// recipe passed in is never modified. Returns, per kind,
// { label, available, note, suggestions: [{ kind, changes, items, before,
// after, summary }] }; before/after are per serving.
function suggestTweaks(recipe, ctx = {}) {
  const diet = ctx.diet || null;
  const pantry = ctx.pantry || {};
  const y = Number.isInteger(recipe.yieldServings) && recipe.yieldServings >= 1 ? recipe.yieldServings : 1;
  const items = recipe.items.map(i => ({ food: i.food, grams: i.grams }));
  const before = perServing(items, y, pantry);
  const dietOk = (food) => matchesDiet([{ food, grams: 1 }], diet);
  const foods = Object.keys(FOODS);
  const out = {};

  const finish = (kind, candidates, emptyNote) => {
    const picked = [];
    const usedIdx = new Set();
    candidates.sort((a, b) => b.metric - a.metric);
    for (const c of candidates) {
      if (usedIdx.has(c.idx)) continue;
      usedIdx.add(c.idx);
      picked.push(c);
      if (picked.length === 3) break;
    }
    const suggestions = picked.map(c => ({
      kind, changes: c.changes, items: c.items, before, after: perServing(c.items, y, pantry),
      summary: c.changes.map(describeChange).join("; "),
    }));
    out[kind] = { label: TWEAK_KINDS[kind].label, available: true, suggestions,
      note: suggestions.length ? "" : emptyNote };
  };

  // Swap candidates shared by cost / pantry / protein / fiber.
  const swapCandidates = (accept) => {
    const found = [];
    items.forEach((item, idx) => {
      foods.forEach(newFood => {
        if (!dietOk(newFood) || !tweakCompatible(item.food, newFood)) return;
        const toGrams = equalCalorieGrams(item.food, newFood, item.grams);
        // A swap should be about the same amount of food ("ground turkey for
        // ground beef"), not 70 slices of bacon for a pound of beef.
        if (toGrams / item.grams < 0.7 || toGrams / item.grams > 1.4) return;
        const nextItems = swapItems(items, idx, newFood, toGrams);
        const after = perServing(nextItems, y, pantry);
        const metric = accept({ item, idx, newFood, toGrams, after });
        if (metric === null || metric === undefined) return;
        found.push({ idx, metric, items: nextItems,
          changes: [{ type: "swap", fromFood: item.food, fromGrams: item.grams, toFood: newFood, toGrams }] });
      });
    });
    return found;
  };
  const calClose = (after, tol) => before.cal > 0 && Math.abs(after.cal - before.cal) / before.cal <= tol;

  // Lower cost
  finish("lowerCost", swapCandidates(({ after }) => {
    const saving = before.cost - after.cost;
    return saving * y >= 0.05 && after.protein >= before.protein * 0.9 && calClose(after, 0.08) ? saving : null;
  }), "No cheaper like-for-like swap found in the catalog for this recipe.");

  // Use what I have
  const pantryHas = Object.values(pantry).some(g => g > 0);
  if (!pantryHas) {
    out.usePantry = { label: TWEAK_KINDS.usePantry.label, available: false, suggestions: [],
      note: "Your pantry is empty. Add what you have in Pantry and this will look for swaps that use it." };
  } else {
    finish("usePantry", swapCandidates(({ item, newFood, toGrams, after }) => {
      if ((pantry[newFood] || 0) < toGrams) return null;          // pantry must cover the swap
      if ((pantry[item.food] || 0) >= item.grams) return null;    // original is already covered
      const saving = before.buyCost - after.buyCost;
      return saving * y >= 0.05 && after.protein >= before.protein * 0.85 && calClose(after, 0.08) ? saving : null;
    }), "Nothing in your pantry works as a like-for-like swap here.");
  }

  // More protein: a higher-protein swap at the same calories, or more of the main protein.
  const proteinSwaps = swapCandidates(({ item, newFood, after }) => {
    const a = FOODS[item.food], b = FOODS[newFood];
    const gain = after.protein - before.protein;
    return b.protein / foodCal100(b) >= 1.2 * (a.protein / foodCal100(a)) && gain >= 3 && calClose(after, 0.1) ? gain : null;
  });
  const boosts = [];
  items.forEach((item, idx) => {
    if (!FOODS[item.food].proteinFamily) return;
    const toGrams = tweakRound(item.grams * 1.25);
    const nextItems = items.map(i => ({ ...i }));
    nextItems[idx].grams = toGrams;
    const after = perServing(nextItems, y, pantry);
    const gain = after.protein - before.protein;
    if (gain >= 3 && before.cal > 0 && (after.cal - before.cal) / before.cal <= 0.2) {
      boosts.push({ idx, metric: gain * 0.9, items: nextItems,
        changes: [{ type: "increase", food: item.food, fromGrams: item.grams, toGrams }] });
    }
  });
  finish("moreProtein", [...proteinSwaps, ...boosts], "No clear protein boost found in the catalog for this recipe.");

  // More fiber: only where the catalog actually records fiber for the foods compared.
  const catalogHasFiber = foods.some(f => typeof FOODS[f].fiber === "number");
  if (!catalogHasFiber || before.fiber === undefined) {
    out.moreFiber = { label: TWEAK_KINDS.moreFiber.label, available: false, suggestions: [],
      note: "The food catalog doesn't record fiber yet, so there's nothing reliable to compare." };
  } else {
    finish("moreFiber", swapCandidates(({ newFood, after }) => {
      if (typeof FOODS[newFood].fiber !== "number") return null;
      const gain = after.fiber - before.fiber;
      return gain >= 1.5 && calClose(after, 0.1) ? gain : null;
    }), "No clear fiber boost found in the catalog for this recipe.");
  }
  return out;
}
