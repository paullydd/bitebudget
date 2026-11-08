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

const UNICODE_FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
  "⅙": 1 / 6, "⅚": 5 / 6, "⅐": 1 / 7, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };
const FRACTION_GLYPHS = Object.keys(UNICODE_FRACTIONS).join("");

// "1 1/2 cups x" -> {qty: 1.5, rest: "cups x"}; "2-3 x" -> {range: true};
// no leading number -> null.
function parseQuantityPrefix(str) {
  const s = String(str).replace(/[\u00a0\u202f\u2009]/g, " ").replace(/\u2044/g, "/").trim().replace(/^[-*•–]\s*/, "");
  if (/^\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d/i.test(s)) return { range: true };
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)(?!\d)\s*/);
  if (m && +m[3] > 0) return { qty: +m[1] + +m[2] / +m[3], rest: s.slice(m[0].length) };
  m = s.match(/^(\d+)\/(\d+)(?!\d)\s*/);
  if (m && +m[2] > 0) return { qty: +m[1] / +m[2], rest: s.slice(m[0].length) };
  m = s.match(new RegExp("^(\\d+(?:\\.\\d+)?)\\s*([" + FRACTION_GLYPHS + "])\\s*"));
  if (m) return { qty: +m[1] + UNICODE_FRACTIONS[m[2]], rest: s.slice(m[0].length) };
  m = s.match(new RegExp("^([" + FRACTION_GLYPHS + "])\\s*"));
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
  "ripe", "plain", "optional", "finely", "roughly", "thinly", "about", "of", "a", "the", "and", "or", "extra", "whole",
  "dry", "uncooked", "low", "sodium", "clove", "unsweetened"]);
// Short names people actually write for a catalog food.
const FOOD_ALIASES = { oat: "oats", "rolled oat": "oats", "old fashioned oat": "oats",
  "orzo pasta": "orzo", "bread crumb": "breadcrumbs", "chicken stock": "chicken_broth",
  "heavy whipping cream": "heavy_cream", "whipping cream": "heavy_cream", "half half": "light_cream",
  "canola oil": "vegetable_oil", "parmesan": "parmesan_cheese", "parsley": "parsley" };

const COOKED_WORDS = ["cooked", "leftover", "prepared", "steamed", "boiled"];
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
      // "(dry)" foods ("Orzo (dry)") are never what a "cooked orzo" line means.
      rejectsCooked: /\(dry\)/i.test(FOODS[food].name),
    }));
  }
  const words = normWords(String(phrase).split(",")[0]);
  const lineWords = normWords(phrase);
  const alias = FOOD_ALIASES[words.filter(w => !FOOD_DESCRIPTORS.has(w)).join(" ")];
  if (alias && !(/\(dry\)/i.test(FOODS[alias].name) && lineWords.some(w => COOKED_WORDS.includes(w)))) return { food: alias, words };
  let best = [];
  let bestLen = 0;
  for (const entry of foodWordIndex) {
    if (!containsSequence(words, entry.words)) continue;
    if (entry.needsCooked && !lineWords.some(w => ["cooked", "canned", "drained", "rinsed"].includes(w))) continue;
    if (entry.rejectsCooked && lineWords.some(w => COOKED_WORDS.includes(w))) continue;
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

// Packaged amounts that state their size: "1 (15 oz) can black beans",
// "2 cans (14 oz each) ...", "1 can (15 oz) ...". A can with NO stated size
// is not converted — a can's size isn't something to guess.
const CONTAINER_NOUN = "(?:cans?|jars?|packages?|pkgs?|bags?|boxes|box|cartons?|bottles?|packs?|tubs?)";
const CONTAINER_WORD = new RegExp("^" + CONTAINER_NOUN + "\\b\\s*(?:of\\s+)?", "i");
function matchContainerSize(q) {
  const size = "\\(?\\s*(\\d+(?:\\.\\d+)?)\\s*(oz|ounces?|g|grams?)\\b\\.?(?:\\s*each)?\\s*\\)?";
  let m = q.rest.match(new RegExp("^" + size + "\\s*" + CONTAINER_NOUN + "\\b\\s*(?:of\\s+)?", "i"))
       || q.rest.match(new RegExp("^" + CONTAINER_NOUN + "\\s*" + size + "\\s*(?:of\\s+)?", "i"));
  if (!m) return null;
  const n = Number(m[1]);
  const isOz = /^o/i.test(m[2]);
  return { grams: q.qty * n * (isOz ? GRAMS_PER_OZ : 1), rest: q.rest.slice(m[0].length) };
}

// An explicit weight written on the line ("(454 grams)", "(about 278 g)", ", 55 g")
// beats a cup/spoon conversion. If it contradicts the main amount by more than
// 2x it is ignored rather than trusted over the amount as written.
const WEIGHT_NOTE = /(?:\(\s*|,\s*)(?:about|approx\.?|approximately|around|roughly|~)?\s*(\d+(?:\.\d+)?)\s*(kilograms?|kg|grams?|g|ounces?|oz|pounds?|lbs?)\.?\s*(?:\)|$)/i;
function explicitWeightGrams(line) {
  const m = String(line).match(WEIGHT_NOTE);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const g = /^k/.test(u) ? n * 1000 : /^g/.test(u) ? n : /^o/.test(u) ? n * GRAMS_PER_OZ : n * 16 * GRAMS_PER_OZ;
  return Number.isFinite(g) && g > 0 ? g : null;
}

const UNIT_WORD = /^(kilograms?|kg|grams?|g|ounces?|oz|pounds?|lbs?|cups?|tablespoons?|tbsps?|teaspoons?|tsps?)\b\.?\s*(?:of\s+)?/i;

// One ingredient line -> {food, grams} when the food is in the catalog AND the
// quantity converts to grams unambiguously; otherwise null ("couldn't match").
// Cups/spoons only convert for foods the catalog has a volume for. A bare
// count ("2 eggs") only converts when the noun is that food's own unit.
function parseIngredientLine(line) {
  const r = readIngredientLine(line);
  return r && !r.conflict ? r : null;
}

// A line whose written weight and written amount do not describe the same
// quantity (more than ~1.67x apart, e.g. "1 pound ... (5 oz)") is a conflict:
// neither number is trusted over the other, so it goes to a person with both
// figures shown. Within that band the written weight wins (cups vary).
const WEIGHT_AGREE_MIN = 0.6, WEIGHT_AGREE_MAX = 1 / 0.6;
function readIngredientLine(line) {
  const q = parseQuantityPrefix(line);
  if (!q || q.range) return null;
  const box = matchContainerSize(q);
  const um = box ? null : q.rest.match(UNIT_WORD);
  let phrase = box ? box.rest : um ? q.rest.slice(um[0].length) : q.rest;
  if (um) phrase = phrase.replace(CONTAINER_WORD, ""); // "15 oz can black beans"
  const hit = matchCatalogFood(phrase);
  if (!hit) return null;
  let grams = null;
  if (box) {
    grams = box.grams;
  } else if (um) {
    grams = gramsForUnitWord(hit.food, um[1], q.qty);
  } else {
    const su = SERVING_UNITS[hit.food];
    if (su && containsSequence(hit.words, normWords(su.unit))) grams = q.qty * su.grams;
  }
  const ew = box ? null : explicitWeightGrams(line);
  if (ew && grams > 0) {
    const ratio = ew / grams;
    if (ratio < WEIGHT_AGREE_MIN || ratio > WEIGHT_AGREE_MAX) return { food: hit.food, conflict: { weight: ew, converted: grams } };
  }
  if (ew) return { food: hit.food, grams: ew, explicitWeight: true };
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
  // A range ("Serves 4-6", "10-12 servings", "4 to 6 servings") is a question
  // for the person, never a number we pick: it counts as ambiguous.
  const range = /\b(?:serves|servings?|makes|yields?)\b\s*[:\-]?\s*\d{1,3}\s*(?:-|–|—|to)\s*\d|\b\d{1,3}\s*(?:-|–|—|to)\s*\d{1,3}\s+servings?\b/i;
  if (range.test(text)) return null;
  const re = /(?:\b(?:serves|servings?|makes|yields?)\b\s*[:\-]?\s*(\d{1,3})(?!\d)|\b(\d{1,3})\s+servings?\b)/gi;
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

// ---------- Paste-first review (line by line) ----------
// parseRecipeText above keeps the "grouped by food" shape the editor's
// Fill-in button uses. The paste review needs every line on its own, so
// each one can be confirmed, corrected or kept as written.

// The unit words people write, mapped to a unit key (see reviewUnitOptions).
function unitKeyForWord(word) {
  const u = String(word).toLowerCase().replace(/\.$/, "");
  if (/^(g|grams?)$/.test(u)) return "g";
  if (/^(kg|kilograms?)$/.test(u)) return "kg";
  if (/^(oz|ounces?)$/.test(u)) return "oz";
  if (/^(lbs?|pounds?)$/.test(u)) return "lb";
  if (/^cups?$/.test(u)) return "cup";
  if (/^(tbsps?|tablespoons?)$/.test(u)) return "tbsp";
  if (/^(tsps?|teaspoons?)$/.test(u)) return "tsp";
  return null;
}

// Units an ingredient can be entered in: the editor's list plus pounds.
function reviewUnitOptions(food) {
  const opts = kitchenUnitOptions(food).slice();
  const oz = opts.findIndex(o => o.key === "oz");
  opts.splice(oz + 1, 0, { key: "lb", label: "lb", grams: 16 * GRAMS_PER_OZ });
  return opts;
}

// Exact grams for amount x unit of a food, or null if the food has no such unit.
function gramsForAmount(food, amount, unitKey) {
  if (!(amount > 0)) return null;
  if (unitKey === "kg") return amount * 1000;
  const opt = reviewUnitOptions(food).find(o => o.key === unitKey);
  return opt ? amount * opt.grams : null;
}

const SEASONING_FILLER = new Set(["ground", "dried", "fresh", "freshly", "kosher", "sea", "black", "white", "smoked", "crushed",
  "cracked", "and", "or", "to", "taste", "bay", "leaf", "leave", "italian", "extra", "pinch", "dash", "of", "a", "the", "optional", "more", "for", "serving", "chopped", "red", "powder", "flake", "seasoning", "spice", "blend", "rub", "mix"]);
const SPICE_CORE = new Set(["salt", "pepper", "cumin", "paprika", "oregano", "thyme", "rosemary", "sage", "cinnamon", "nutmeg",
  "cayenne", "turmeric", "coriander", "cardamom", "allspice", "chili", "chile", "chipotle", "garlic", "onion", "curry", "seasoning", "spice", "cajun", "taco", "ranch", "parsley", "cilantro", "basil", "dill", "msg"]);

// Salt, pepper and spices: the catalog doesn't track them, so they are never
// on the shopping list. Recognized only when the line really reads like a
// seasoning (a spoon/pinch/"to taste"/no amount) so "1 cup basil" or
// "1 red pepper" are NOT swept up.
function isSeasoningLine(rest, unitKey, hasQty) {
  const lower = String(rest).toLowerCase();
  const toTaste = /\bto taste\b/.test(lower);
  if (hasQty && !toTaste && !["tsp", "tbsp", "pinch", "dash"].includes(unitKey)) return false;
  const words = normWords(String(rest).split(",")[0]);
  if (!words.length) return false;
  const core = words.filter(w => SPICE_CORE.has(w));
  if (!core.length) return false;
  if (!words.every(w => SPICE_CORE.has(w) || SEASONING_FILLER.has(w))) return false;
  // Bare "pepper"/"garlic"/"onion"/"chili"/"basil" etc. is often a real
  // vegetable ("1 red pepper", "2 garlic") unless the line says powder,
  // flakes, ground, black/white, seasoning or "to taste".
  const marker = words.some(w => ["powder", "flake", "seasoning", "spice", "blend", "rub", "ground", "dried", "black", "white", "cracked", "salt", "cumin", "paprika", "cayenne", "oregano", "thyme", "msg", "cinnamon", "nutmeg", "turmeric", "coriander"].includes(w))
    || toTaste || ["tsp", "tbsp", "pinch", "dash"].includes(unitKey);
  if (core.every(w => ["pepper", "garlic", "onion", "chili", "chile", "chipotle", "basil", "parsley", "cilantro", "dill"].includes(w))
      && !words.some(w => ["powder", "flake", "seasoning", "spice", "blend", "rub", "ground", "dried", "black", "white", "cracked"].includes(w))
      && !toTaste && !["tsp", "tbsp", "pinch", "dash"].includes(unitKey)) return false;
  return marker;
}

// Up to three catalog foods that a loosely worded line could mean, as
// SUGGESTIONS for a person to confirm (never applied automatically): every
// meaningful word of the line appears in the food's name. "rice" suggests
// both White and Brown Rice; "beans" suggests nothing if several fit.
function suggestCatalogFoods(phrase) {
  const drop = new Set([...FOOD_DESCRIPTORS, "can", "jar", "package", "pkg", "bag", "box", "carton", "bottle", "pack", "tub", "clove", "slice", "piece", "stalk", "head", "bunch", "sprig", "leaf", "leave"]);
  const words = normWords(String(phrase).split(",")[0]).filter(w => !drop.has(w));
  if (!words.length) return [];
  const foods = Object.keys(FOODS);
  const saysCooked = normWords(String(phrase)).some(w => COOKED_WORDS.includes(w));
  const all = foods.filter(f => {
    if (saysCooked && /\(dry\)/i.test(FOODS[f].name)) return false; // dry orzo is not cooked orzo
    const fw = normWords(FOODS[f].name);
    return words.every(w => fw.includes(w));
  });
  if (all.length) {
    // Foods whose NAME ENDS with what was written come first ("rice" -> Brown/
    // White Rice before Rice Cakes); the rest only fill up to three.
    const last = words[words.length - 1];
    const head = all.filter(f => normWords(FOODS[f].name).slice(-1)[0] === last);
    return (head.length >= 2 ? head : [...head, ...all.filter(f => !head.includes(f))]).slice(0, 3);
  }
  // One distinctive word (e.g. "chopped spinach leaves"): only when exactly one food has it.
  const hits = new Set();
  for (const w of words) if (w.length >= 4) for (const f of foods) {
    if (saysCooked && /\(dry\)/i.test(FOODS[f].name)) continue;
    if (normWords(FOODS[f].name).includes(w)) hits.add(f);
  }
  return hits.size === 1 ? [...hits] : [];
}

// One ingredient line -> how the review shows it.
//   ready     {food, grams, amount, unitKey} - food AND quantity both certain
//   seasoning kept as written automatically (not tracked in the catalog)
//   review    needs a person: {reason, suggestions[], amount, unitKey}
// Nothing is guessed: an uncertain line is returned whole, with what WAS
// readable (the amount as written) so correcting it is one choice, not a retype.
function classifyIngredientLine(rawLine) {
  const original = String(rawLine).replace(/^\s*[-*•–·]\s*/, "").trim();
  const q = parseQuantityPrefix(original);
  const read = readIngredientLine(original);
  const parsed = read && !read.conflict ? read : null;
  const box = q && !q.range ? matchContainerSize(q) : null;
  const um = q && !q.range && !box ? q.rest.match(UNIT_WORD) : null;
  let unitKey = um ? unitKeyForWord(um[1]) : null;
  const rest = q && !q.range ? (box ? box.rest : um ? q.rest.slice(um[0].length).replace(CONTAINER_WORD, "") : q.rest) : original;
  const hasQty = !!q && !q.range;
  if (!parsed && isSeasoningLine(rest, /^(pinch|dash)\b/i.test(rest) ? "pinch" : unitKey, hasQty)) return { kind: "seasoning", original };
  if (parsed) {
    // Show it in the unit it was written in when the food has that unit.
    const su = SERVING_UNITS[parsed.food];
    let key = box || parsed.explicitWeight ? "g" : unitKey || (su ? su.unit : "g");
    if (!reviewUnitOptions(parsed.food).some(o => o.key === key) && key !== "kg") key = "g";
    return { kind: "ready", original, food: parsed.food, grams: parsed.grams, unitKey: key };
  }
  const row = { kind: "review", original, suggestions: suggestCatalogFoods(rest), amount: null, unitKey: null, reason: "" };
  if (!q) row.reason = "No amount written";
  else if (q.range) row.reason = "A range of amounts";
  else {
    row.amount = q.qty;
    if (box) { row.amount = box.grams; row.unitKey = "g"; }
    else if (unitKey) row.unitKey = unitKey;
    else row.unitKey = "count";
    if (/\bcans?\b|\bjars?\b|\bpackages?\b|\bbags?\b/i.test(rest) && !box && !um) row.reason = "Package size not stated";
    else if (!row.suggestions.length) row.reason = "Not in the food catalog";
    else if (row.unitKey && row.unitKey !== "count" && row.amount > 0 && !box) row.reason = row.suggestions.length > 1 ? "Which type? The amount is already filled in" : "Confirm the food. The amount is already filled in";
    else row.reason = "Couldn't confirm the food or its amount";
  }
  if (read && read.conflict) {
    row.suggestions = [read.food];
    row.reason = `The weight (${Math.round(read.conflict.weight)} g) and the amount (about ${Math.round(read.conflict.converted)} g) disagree. Choose which is right`;
  }
  if (q && !q.range && !row.suggestions.length) row.reason = row.reason || "Not in the food catalog";
  return row;
}

const COOKING_VERB = /\b(add|mix|stir|bake|cook|simmer|boil|heat|preheat|combine|whisk|serve|season|bring|reduce|pour|chop|slice|blend|brown|saut[eé]|fry|roast|grill|drain|top|place|cover|let|toss|fold|spread|garnish|set|remove|transfer|cut|dice|mince|rinse|stir-fry|microwave|refrigerate|chill)\b/i;
const SOCIAL_NOISE = /^(#|@)|\bfollow\b.*@|\b(save|share|comment|like)\b.*\b(this|for later|below)\b|^https?:\/\//i;

function guessMealSlot(title, text) {
  const t = `${title}`.toLowerCase();
  if (/\b(breakfast|pancakes?|waffles?|oatmeal|omelet+e?|scramble|smoothie|granola|french toast|overnight oats|frittata|muffins?)\b/.test(t)) return "breakfast";
  if (/\b(snack|bites?|dip|energy balls?|trail mix|popcorn)\b/.test(t)) return "snack";
  if (/\b(lunch|sandwich|wrap|salad|bowl)\b/.test(t)) return "lunch";
  return "dinner";
}

// Metadata lines ("Serves 4", "Prep time: 10 min", "Cook: 20 min", "Calories 300").
// A step that merely begins with the word ("Cook until golden", "Makes sure...") is NOT metadata.
const RECIPE_META_LINE = /^[^\p{L}\p{N}]*(?:(?:serves|servings?|makes|yields?)\s*[:\-–]?\s*\d|(?:prep|cook|total)\s*time\b|(?:prep|cook|total)\s*[:\-–]\s*\d|calories\b\s*[:\-–]?\s*\d|nutrition\b|per serving\b|(?:course|cuisine|category|author|diet|keywords?)\s*:)/iu;
const REVIEW_INGREDIENT_HEADER = /^(ingredients?|what you'?ll need|you'?ll need)(?:\s*\(.*\))?$/i;
const REVIEW_METHOD_HEADER = /^(instructions?|directions?|method|steps?|preparation|how to make it|how to)$/i;
function headingText(line) {
  return String(line).replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N})\]]+$/u, "").trim();
}

// Splits "2 eggs, 1 cup rice" or "2 eggs • 1 cup rice" into separate lines
// without breaking "black beans, drained" (a comma is a split only when a new
// amount follows it) or "1 lb chicken, 454 g" (a trailing weight is part of the line).
function splitIngredientLine(line) {
  const amount = "(?=(?!\\d+(?:\\.\\d+)?\\s*(?:kilograms?|kg|grams?|g|ounces?|oz|pounds?|lbs?)\\.?\\s*$)(?:\\d|[" + FRACTION_GLYPHS + "]))";
  return String(line).split(new RegExp("\\s*[•·|]\\s*|[,;]\\s+" + amount)).map(x => x.trim()).filter(Boolean);
}

// Method lines: "1. Brown the turkey", "Step 2: stir", "Bake at 350F for 20 minutes",
// "Then add the beans.", or any sentence of four or more words with a cooking verb.
const STEP_START = new RegExp("^(?:(?:then|next|finally|meanwhile|once done),?\\s+)?" + COOKING_VERB.source.replace(/^\\b/, ""), "i");
function isNumberedStep(line) {
  return /^(?:step\s*)?\d+\s*[.):]\s+\S/i.test(line) || /^\d️?⃣/u.test(line);
}
function looksLikeStep(line) {
  if (isNumberedStep(line)) return true;
  if (parseQuantityPrefix(line)) return false;
  if (STEP_START.test(line)) return true;
  return /[.!?]$/.test(line) && line.split(/\s+/).length >= 4 && COOKING_VERB.test(line);
}

// ---- Copied-page cleanup. The text a person copies from a recipe site carries
// page furniture: checkbox bullets, links, signup forms, ads, serving
// multipliers and unit switches. Normalizing happens here, on a COPY; the
// caller keeps the pasted text exactly as it was.
const PASTE_NOISE = [
  /^\d+x(?:\d+x)+$/i,                                                                      // "1x2x3x" serving multipliers
  /^(?:us customary|imperial|metric)(?:\s*[-–—|/]\s*(?:us customary|imperial|metric))+$/i, // unit switch
  /^(?:want to save this recipe\??|enter your email\b.*|name\s*\*?|email\s*\*?|save|subscribe|sign up|print(?: recipe)?|pin(?: recipe)?|jump to recipe|rate this recipe|leave a (?:comment|review)|advertisement|sponsored|ad)$/i,
];
const BULLET_LEAD = /^(?:[-–—*•·▪◦‣⁃●○■□☐☑☒✓✔▢]|\[[ xX✓]?\])\s*/u;

// Raw text -> [{text, bullet, blankAfter}] with noise dropped. `blankAfter` says
// a blank line followed, which is how an unbulleted group label is told apart.
function normalizePastedText(raw) {
  const out = [];
  let pendingBlank = false;
  for (const rawLine of String(raw || "").split(/\r?\n/)) {
    let t = rawLine.replace(/[     ]/g, " ").replace(/[​-‍﻿]/g, "").replace(/⁄/g, "/");
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    t = t.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s+/, "").replace(/\s+/g, " ").trim();
    let bullet = false;
    for (let m; (m = t.match(BULLET_LEAD)); ) { bullet = true; t = t.slice(m[0].length).trim(); }
    if (!t) { pendingBlank = true; continue; }
    if (PASTE_NOISE.some(re => re.test(t))) continue;
    if (out.length) out[out.length - 1].blankAfter = pendingBlank;
    pendingBlank = false;
    out.push({ text: t, bullet, blankAfter: false });
  }
  return out;
}

// Whole pasted recipe/caption -> everything the review screen shows.
// The original text is never altered or dropped (the caller stores it as-is);
// anything not recognized as an ingredient or step simply stays in it.
// Ingredient rows and steps carry the group ("Chicken Meatballs") they sat under.
function analyzeRecipeText(text) {
  const raw = String(text || "");
  const lines = normalizePastedText(raw);
  const out = { title: "", slot: "dinner", yieldServings: parseServings(lines.map(l => l.text).join("\n")), ingredients: [], instructions: [], steps: [], foundIngredientSection: false };
  if (!lines.length) return out;
  const anyBullet = lines.some(l => l.bullet);

  const first = lines[0];
  const firstHeading = headingText(first.text);
  if (!first.bullet && firstHeading && firstHeading.length <= 80 && !parseQuantityPrefix(firstHeading) && !REVIEW_INGREDIENT_HEADER.test(firstHeading)
      && !REVIEW_METHOD_HEADER.test(firstHeading) && !/[.?]$/.test(first.text) && !SOCIAL_NOISE.test(firstHeading)
      && !RECIPE_META_LINE.test(first.text) && !/\b(serves|servings?|makes|yields?)\b/i.test(firstHeading)) {
    out.title = firstHeading;
  }
  out.slot = guessMealSlot(out.title, raw);

  const headOf = (l) => headingText(headingText(l).split(/[:：]/)[0]);
  const hasHeaders = lines.some(l => REVIEW_INGREDIENT_HEADER.test(headOf(l.text)) || REVIEW_METHOD_HEADER.test(headOf(l.text)));
  let ingGroup = "", stepGroup = "";
  const addIngredientText = (chunk) => {
    for (const piece of splitIngredientLine(chunk)) {
      const row = classifyIngredientLine(piece);
      if (ingGroup) row.group = ingGroup;
      out.ingredients.push(row);
    }
  };
  const addStep = (line) => {
    const step = line.replace(/^(?:step\s*)?\d+\s*[.):]\s*/i, "").replace(/^\d️?⃣\s*/u, "").replace(/^[-*•]\s*/, "").trim();
    if (step) out.steps.push({ text: step, group: stepGroup });
  };
  // An unbulleted line standing over a bulleted list, a "For the sauce:" label,
  // or (in ingredients) a short label before an amount-led list.
  const isGroupLabel = (ln, i, mode) => {
    const t = ln.text;
    if (ln.bullet || parseQuantityPrefix(t) || t.split(/\s+/).length > 8) return false;
    if (/:$/.test(t)) return !/\d/.test(t);
    if (/[.!?]$/.test(t)) return false;
    const nx = lines[i + 1];
    if (!nx) return false;
    if (anyBullet && nx.bullet) return true;
    return mode === "ingredients" && ln.blankAfter && !!parseQuantityPrefix(nx.text);
  };
  const labelOf = (t) => headingText(t).replace(/[:：]\s*$/, "").trim();

  let mode = null;
  let sawIngredient = false;
  let inferredSteps = false;
  lines.forEach((ln, i) => {
    if (i === 0 && out.title) return;
    const line = ln.text;
    const headPart = headOf(line);
    const afterColon = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : "";
    if (REVIEW_INGREDIENT_HEADER.test(headPart)) {
      mode = "ingredients"; inferredSteps = false; ingGroup = ""; out.foundIngredientSection = true;
      if (afterColon) { addIngredientText(afterColon); sawIngredient = true; }
      return;
    }
    if (REVIEW_METHOD_HEADER.test(headPart)) {
      mode = "steps"; stepGroup = "";
      if (afterColon) addStep(afterColon);
      return;
    }
    if (SOCIAL_NOISE.test(line)) return;
    if (RECIPE_META_LINE.test(line)) return; // "Serves 4", "Prep time: 10 min" - not an ingredient
    if (hasHeaders && mode) {
      if (isGroupLabel(ln, i, mode)) { if (mode === "ingredients") ingGroup = labelOf(line); else stepGroup = labelOf(line); return; }
      if (mode === "ingredients") {
        // A numbered or imperative line in the ingredient list (no Directions
        // heading, or a step that follows the list) is a step, not an ingredient.
        if (looksLikeStep(line)) { addStep(line); inferredSteps = true; return; }
        // Once steps have started, a line with no amount ("Makes sure it's hot",
        // "Enjoy!") is a step too; an amount-led line is still an ingredient.
        if (inferredSteps && !parseQuantityPrefix(line)) { addStep(line); return; }
        addIngredientText(line); sawIngredient = true;
      } else {
        addStep(line);
      }
      return;
    }
    // No section headings (a caption): read by shape.
    if (isNumberedStep(line)) { addStep(line); return; }
    if (parseQuantityPrefix(line)) { addIngredientText(line); sawIngredient = true; return; }
    if (line.length <= 45 && !/[.!?]$/.test(line) && !STEP_START.test(line) && (suggestCatalogFoods(line).length || isSeasoningLine(line, null, false))) {
      addIngredientText(line); sawIngredient = true; return; // an ingredient written with no amount
    }
    if (looksLikeStep(line)) addStep(line);
  });

  // Steps as plain strings; the first step of each group is led by its group's
  // name so the groups survive into the saved recipe.
  let lastGroup = "";
  out.instructions = out.steps.map(st => {
    const lead = st.group && st.group !== lastGroup ? `${st.group}: ` : "";
    lastGroup = st.group;
    return lead + st.text;
  });
  return out;
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
  for (const key of ["draft", "autoPlan", "made", "madeAt", "createdAt", "versionOf", "tweak", "source", "unmatched", "reference"]) {
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
