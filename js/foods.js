// All values are per 100g (or 100ml for liquids) of the food as prepared.
// price is a rough US national-average grocery price in USD per 100g.
// These are editable — tune them to match your own local prices.
// There's no separate `cal` field: calories are always derived from
// protein/carbs/fat (4/4/9 cal per gram, see computeNutrition below) so
// they can never drift out of sync with the macros the app also shows.
// proteinFamily tags the food's protein category (only set on foods that
// serve as a meal's primary protein source) — used to bias meal selection
// toward a person's stated taste preferences.
// category groups foods by grocery-store section for the shopping list.
const FOODS = {
  oats:            { name: "Rolled Oats",        protein: 16.9, carbs: 66.3, fat: 6.9,  price: 0.35, veg: true, category: "Pantry & Grains" },
  banana:          { name: "Banana",              protein: 1.1,  carbs: 22.8, fat: 0.3,  price: 0.30, veg: true, category: "Produce" },
  almond_milk:     { name: "Almond Milk",         protein: 0.6,  carbs: 0.6,  fat: 1.5,  price: 0.25, veg: true, category: "Dairy" },
  egg:             { name: "Eggs",                protein: 13,   carbs: 1.1,  fat: 11,   price: 0.45, veg: true, category: "Protein", proteinFamily: "egg" },
  greek_yogurt:    { name: "Greek Yogurt",        protein: 10,   carbs: 3.6,  fat: 0.4,  price: 0.60, veg: true, category: "Dairy", proteinFamily: "dairy" },
  chicken_breast:  { name: "Chicken Breast",      protein: 31,   carbs: 0,    fat: 3.6,  price: 0.90, veg: false, category: "Protein", proteinFamily: "poultry" },
  brown_rice:      { name: "Brown Rice (cooked)", protein: 2.6,  carbs: 25.6, fat: 1,    price: 0.20, veg: true, category: "Pantry & Grains" },
  broccoli:        { name: "Broccoli",            protein: 2.8,  carbs: 6.6,  fat: 0.4,  price: 0.35, veg: true, category: "Produce" },
  salmon:          { name: "Salmon",              protein: 20,   carbs: 0,    fat: 13,   price: 1.80, veg: false, category: "Protein", proteinFamily: "fish" },
  sweet_potato:    { name: "Sweet Potato",        protein: 1.6,  carbs: 20,   fat: 0.1,  price: 0.25, veg: true, category: "Produce" },
  black_beans:     { name: "Black Beans (cooked)",protein: 8.9,  carbs: 23.7, fat: 0.5,  price: 0.20, veg: true, category: "Protein", proteinFamily: "plant" },
  spinach:         { name: "Spinach",             protein: 2.9,  carbs: 3.6,  fat: 0.4,  price: 0.40, veg: true, category: "Produce" },
  olive_oil:       { name: "Olive Oil",           protein: 0,    carbs: 0,    fat: 100,  price: 1.20, veg: true, category: "Pantry & Grains" },
  peanut_butter:   { name: "Peanut Butter",       protein: 25,   carbs: 20,   fat: 50,   price: 0.70, veg: true, category: "Pantry & Grains" },
  whole_wheat_bread:{name: "Whole Wheat Bread",   protein: 13,   carbs: 41,   fat: 3.4,  price: 0.35, veg: true, category: "Pantry & Grains" },
  avocado:         { name: "Avocado",             protein: 2,    carbs: 8.5,  fat: 14.7, price: 0.90, veg: true, category: "Produce" },
  almonds:         { name: "Almonds",             protein: 21,   carbs: 22,   fat: 50,   price: 1.50, veg: true, category: "Pantry & Grains" },
  apple:           { name: "Apple",               protein: 0.3,  carbs: 13.8, fat: 0.2,  price: 0.30, veg: true, category: "Produce" },
  carrots:         { name: "Carrots",             protein: 0.9,  carbs: 9.6,  fat: 0.2,  price: 0.20, veg: true, category: "Produce" },
  hummus:          { name: "Hummus",              protein: 8,    carbs: 14,   fat: 10,   price: 0.80, veg: true, category: "Pantry & Grains", proteinFamily: "plant" },
  cottage_cheese:  { name: "Cottage Cheese",      protein: 11,   carbs: 3.4,  fat: 4.3,  price: 0.55, veg: true, category: "Dairy", proteinFamily: "dairy" },
  quinoa:          { name: "Quinoa (cooked)",     protein: 4.4,  carbs: 21.3, fat: 1.9,  price: 0.45, veg: true, category: "Pantry & Grains" },
  turkey_breast:   { name: "Turkey Breast",       protein: 30,   carbs: 0,    fat: 1,    price: 1.10, veg: false, category: "Protein", proteinFamily: "poultry" },
  tofu:            { name: "Tofu",                protein: 8,    carbs: 1.9,  fat: 4.8,  price: 0.40, veg: true, category: "Protein", proteinFamily: "plant" },
  lentils:         { name: "Lentils (cooked)",    protein: 9,    carbs: 20,   fat: 0.4,  price: 0.20, veg: true, category: "Protein", proteinFamily: "plant" },
  bell_pepper:     { name: "Bell Pepper",         protein: 1,    carbs: 6,    fat: 0.3,  price: 0.45, veg: true, category: "Produce" },
  cheddar_cheese:  { name: "Cheddar Cheese",      protein: 25,   carbs: 1.3,  fat: 33,   price: 1.20, veg: true, category: "Dairy", proteinFamily: "dairy" },
  pasta:           { name: "Pasta (cooked)",      protein: 5,    carbs: 25,   fat: 1.1,  price: 0.15, veg: true, category: "Pantry & Grains" },
  ground_beef:     { name: "Lean Ground Beef",    protein: 20,   carbs: 0,    fat: 10,   price: 1.10, veg: false, category: "Protein", proteinFamily: "red_meat" },
  blueberries:     { name: "Blueberries",         protein: 0.7,  carbs: 14.5, fat: 0.3,  price: 1.00, veg: true, category: "Produce" },
  granola:         { name: "Granola",             protein: 10,   carbs: 64,   fat: 20,   price: 0.90, veg: true, category: "Pantry & Grains" },
  trail_mix:       { name: "Trail Mix",           protein: 14,   carbs: 44,   fat: 29,   price: 1.30, veg: true, category: "Pantry & Grains" },
  orange:          { name: "Orange",              protein: 0.9,  carbs: 11.8, fat: 0.1,  price: 0.30, veg: true, category: "Produce" },
  bacon:           { name: "Bacon",               protein: 37,   carbs: 1.4,  fat: 42,   price: 1.30, veg: false, category: "Protein", proteinFamily: "red_meat" },
  breakfast_sausage:{name: "Turkey Breakfast Sausage", protein: 14, carbs: 2, fat: 27, price: 1.10, veg: false, category: "Protein", proteinFamily: "poultry" },
  tortilla:        { name: "Flour Tortilla",      protein: 8,    carbs: 48,   fat: 7,    price: 0.30, veg: true, category: "Pantry & Grains" },
  tuna:            { name: "Canned Tuna",         protein: 26,   carbs: 0,    fat: 1,    price: 0.60, veg: false, category: "Protein", proteinFamily: "fish" },
  edamame:         { name: "Edamame",             protein: 11,   carbs: 10,   fat: 5,    price: 0.50, veg: true, category: "Protein", proteinFamily: "plant" },
  protein_powder:  { name: "Protein Powder",      protein: 80,   carbs: 8,    fat: 5,    price: 3.50, veg: true, category: "Pantry & Grains", proteinFamily: "dairy" },
  protein_bar:     { name: "Protein Bar",         protein: 33,   carbs: 24,   fat: 13,   price: 3.50, veg: true, category: "Pantry & Grains" },
  caesar_dressing: { name: "Caesar Dressing",     protein: 2,    carbs: 3,    fat: 48,   price: 1.30, veg: true, category: "Pantry & Grains" },
  parmesan_cheese: { name: "Parmesan Cheese",     protein: 38,   carbs: 4,    fat: 29,   price: 1.90, veg: true, category: "Dairy", proteinFamily: "dairy" },
  soy_sauce:       { name: "Soy Sauce",           protein: 8,    carbs: 8,    fat: 0,    price: 0.55, veg: true, category: "Pantry & Grains" },
  egg_whites:      { name: "Egg Whites",          protein: 11,   carbs: 0.7,  fat: 0.2,  price: 1.00, veg: true, category: "Protein", proteinFamily: "egg" },
  canadian_bacon:  { name: "Canadian Bacon",      protein: 22,   carbs: 1,    fat: 4,    price: 1.20, veg: false, category: "Protein", proteinFamily: "red_meat" },
  onion:           { name: "Onion",               protein: 1.1,  carbs: 9,    fat: 0.1,  price: 0.15, veg: true, category: "Produce" },
  low_fat_cheddar: { name: "Low-Fat Cheddar",     protein: 28,   carbs: 2,    fat: 15,   price: 1.30, veg: true, category: "Dairy", proteinFamily: "dairy" },
  potato:          { name: "Potato",              protein: 2,    carbs: 17,   fat: 0.1,  price: 0.20, veg: true, category: "Produce" },
  salsa:           { name: "Salsa",               protein: 1.5,  carbs: 6,    fat: 0.2,  price: 0.60, veg: true, category: "Pantry & Grains" },
  ground_turkey:   { name: "Ground Turkey",       protein: 19,   carbs: 0,    fat: 10,   price: 0.90, veg: false, category: "Protein", proteinFamily: "poultry" },
  lettuce:         { name: "Lettuce",             protein: 1.4,  carbs: 2.9,  fat: 0.2,  price: 0.30, veg: true, category: "Produce" },
  cucumber:        { name: "Cucumber",            protein: 0.7,  carbs: 3.6,  fat: 0.1,  price: 0.30, veg: true, category: "Produce" },
  sriracha_mayo:   { name: "Sriracha Mayo (Light)", protein: 1,  carbs: 6,    fat: 30,   price: 1.00, veg: true, category: "Pantry & Grains" },
  lemon:           { name: "Lemon",               protein: 1.1,  carbs: 9,    fat: 0.3,  price: 0.55, veg: true, category: "Produce" },
  green_beans:     { name: "Green Beans",         protein: 1.8,  carbs: 7,    fat: 0.2,  price: 0.45, veg: true, category: "Produce" },
  rice_cakes:      { name: "Rice Cakes",          protein: 8,    carbs: 81,   fat: 3,    price: 0.70, veg: true, category: "Pantry & Grains" },
  popcorn:         { name: "Popcorn (air-popped)", protein: 13,  carbs: 78,   fat: 4,    price: 0.40, veg: true, category: "Pantry & Grains" },
  pb_powder:       { name: "Powdered Peanut Butter", protein: 42, carbs: 33, fat: 12,   price: 1.80, veg: true, category: "Pantry & Grains" },
  mixed_veggies:   { name: "Mixed Frozen Vegetables", protein: 2.5, carbs: 13, fat: 0.5, price: 0.35, veg: true, category: "Produce" },
  sweet_chili_sauce:{ name: "Sweet Chili Sauce",  protein: 0.5,  carbs: 40,   fat: 0.2,  price: 0.90, veg: true, category: "Pantry & Grains" },
  honey:           { name: "Honey",               protein: 0.3,  carbs: 82,   fat: 0,    price: 0.60, veg: true, category: "Pantry & Grains" },
  sesame_seeds:    { name: "Sesame Seeds",        protein: 18,   carbs: 23,   fat: 50,   price: 1.80, veg: true, category: "Pantry & Grains" },
  cauliflower:     { name: "Cauliflower",         protein: 1.9,  carbs: 5,    fat: 0.3,  price: 0.35, veg: true, category: "Produce" },
  white_rice:      { name: "White Rice (cooked)", protein: 2.7,  carbs: 28,   fat: 0.3,  price: 0.15, veg: true, category: "Pantry & Grains" },
  corn_flakes:     { name: "Corn Flakes Cereal",  protein: 7,    carbs: 84,   fat: 0.4,  price: 0.40, veg: true, category: "Pantry & Grains" },
  bbq_sauce:       { name: "BBQ Sauce",           protein: 0.5,  carbs: 30,   fat: 0.3,  price: 0.70, veg: true, category: "Pantry & Grains" },
  diced_tomatoes:  { name: "Diced Tomatoes",      protein: 1,    carbs: 4,    fat: 0.2,  price: 0.35, veg: true, category: "Pantry & Grains" },
  mozzarella_cheese:{ name: "Mozzarella Cheese",  protein: 22,   carbs: 2.2,  fat: 22,   price: 1.10, veg: true, category: "Dairy", proteinFamily: "dairy" },
  mexican_cheese_blend:{ name: "Mexican Cheese Blend", protein: 24, carbs: 2, fat: 30,   price: 1.20, veg: true, category: "Dairy", proteinFamily: "dairy" },
  cream_cheese:    { name: "Cream Cheese",        protein: 6,    carbs: 4,    fat: 34,   price: 1.00, veg: true, category: "Dairy" },
  vanilla_yogurt:  { name: "Vanilla Yogurt (Lowfat)", protein: 4, carbs: 17,  fat: 1.5,  price: 0.55, veg: true, category: "Dairy", proteinFamily: "dairy" },
  cheesecake_pudding_mix:{ name: "Sugar-Free Cheesecake Pudding Mix", protein: 0, carbs: 88, fat: 0, price: 2.50, veg: true, category: "Pantry & Grains" },
  oreo_crumbs:     { name: "Chocolate Sandwich Cookies", protein: 5, carbs: 70, fat: 20, price: 2.20, veg: true, category: "Pantry & Grains" },
  flour:           { name: "All-Purpose Flour",   protein: 10,   carbs: 76,   fat: 1,    price: 0.15, veg: true, category: "Pantry & Grains" },
  cherry_tomatoes: { name: "Cherry Tomatoes",     protein: 0.9,  carbs: 3.9,  fat: 0.2,  price: 0.60, veg: true, category: "Produce" },
  chia_seeds:      { name: "Chia Seeds",          protein: 17,   carbs: 42,   fat: 31,   price: 1.50, veg: true, category: "Pantry & Grains" },
};

// Compute nutrition + cost for a list of { food, grams } scaled from per-100g values.
// Calories are always derived from macros (protein 4 cal/g, carbs 4 cal/g, fat 9 cal/g)
// rather than stored separately, so the displayed calories and macros can never drift
// apart the way they do on real nutrition labels (fiber, rounding, etc).
function computeNutrition(items) {
  const totals = items.reduce((acc, { food, grams }) => {
    const f = FOODS[food];
    const factor = grams / 100;
    acc.protein += f.protein * factor;
    acc.carbs += f.carbs * factor;
    acc.fat += f.fat * factor;
    acc.cost += f.price * factor;
    return acc;
  }, { protein: 0, carbs: 0, fat: 0, cost: 0 });
  totals.cal = totals.protein * 4 + totals.carbs * 4 + totals.fat * 9;
  return totals;
}

function isVegetarian(items) {
  return items.every(({ food }) => FOODS[food].veg);
}

// Maps each food to a kitchen-friendly serving unit (grams per 1 unit) so
// recipe ingredient lists can read "6 oz chicken breast" / "1 cup rice" /
// "2 eggs" instead of a raw gram figure. `round` sets the nearest fraction
// step (0.25 for pourable/scoopable units, 0.5 for whole items and meat
// portions where quarter-units don't make kitchen sense).
const SERVING_UNITS = {
  oats:             { unit: "cup",  grams: 81 },
  banana:           { unit: "banana", grams: 118, round: 0.5 },
  almond_milk:      { unit: "cup",  grams: 240 },
  egg:              { unit: "egg",  grams: 50,  round: 0.5 },
  greek_yogurt:     { unit: "cup",  grams: 245 },
  chicken_breast:   { unit: "oz",   grams: 28.35, round: 0.5, noPlural: true },
  brown_rice:       { unit: "cup",  grams: 195 },
  broccoli:         { unit: "cup",  grams: 91 },
  salmon:           { unit: "oz",   grams: 28.35, round: 0.5, noPlural: true },
  sweet_potato:     { unit: "sweet potato", grams: 130, round: 0.5 },
  black_beans:      { unit: "cup",  grams: 172 },
  spinach:          { unit: "cup",  grams: 30 },
  olive_oil:        { unit: "tbsp", grams: 14, noPlural: true },
  peanut_butter:    { unit: "tbsp", grams: 16, noPlural: true },
  whole_wheat_bread:{ unit: "slice", grams: 28, round: 0.5 },
  avocado:          { unit: "avocado", grams: 150, round: 0.5 },
  almonds:          { unit: "cup",  grams: 143 },
  apple:            { unit: "apple", grams: 182, round: 0.5 },
  carrots:          { unit: "cup",  grams: 128 },
  hummus:           { unit: "tbsp", grams: 15, noPlural: true },
  cottage_cheese:   { unit: "cup",  grams: 226 },
  quinoa:           { unit: "cup",  grams: 185 },
  turkey_breast:    { unit: "oz",   grams: 28.35, round: 0.5, noPlural: true },
  tofu:             { unit: "cup",  grams: 124 },
  lentils:          { unit: "cup",  grams: 198 },
  bell_pepper:      { unit: "bell pepper", grams: 119, round: 0.5 },
  cheddar_cheese:   { unit: "oz",   grams: 28.35, round: 0.5, noPlural: true },
  pasta:            { unit: "cup",  grams: 140 },
  ground_beef:      { unit: "oz",   grams: 28.35, round: 0.5, noPlural: true },
  blueberries:      { unit: "cup",  grams: 148 },
  granola:          { unit: "cup",  grams: 122 },
  trail_mix:        { unit: "cup",  grams: 150 },
  orange:           { unit: "orange", grams: 131, round: 0.5 },
  bacon:            { unit: "slice", grams: 8, round: 0.5 },
  breakfast_sausage:{ unit: "link", grams: 28, round: 0.5 },
  tortilla:         { unit: "tortilla", grams: 45, round: 0.5 },
  tuna:             { unit: "can",  grams: 142, round: 0.5 },
  edamame:          { unit: "cup",  grams: 155 },
  protein_powder:   { unit: "scoop", grams: 30, round: 0.5 },
  protein_bar:      { unit: "bar",  grams: 60, round: 0.5 },
  caesar_dressing:  { unit: "tbsp", grams: 15, noPlural: true },
  parmesan_cheese:  { unit: "tbsp", grams: 5,  noPlural: true },
  soy_sauce:        { unit: "tbsp", grams: 18, noPlural: true },
  egg_whites:       { unit: "egg white", grams: 33, round: 0.5 },
  canadian_bacon:   { unit: "slice", grams: 28, round: 0.5 },
  onion:            { unit: "cup",  grams: 160 },
  low_fat_cheddar:  { unit: "oz",   grams: 28.35, round: 0.5, noPlural: true },
  potato:           { unit: "potato", grams: 170, round: 0.5 },
  salsa:            { unit: "tbsp", grams: 17, noPlural: true },
  ground_turkey:    { unit: "oz",   grams: 28.35, round: 0.5, noPlural: true },
  lettuce:          { unit: "cup",  grams: 47 },
  cucumber:         { unit: "cup",  grams: 119 },
  sriracha_mayo:    { unit: "tbsp", grams: 14, noPlural: true },
  lemon:            { unit: "lemon", grams: 58, round: 0.5 },
  green_beans:      { unit: "cup",  grams: 100 },
  rice_cakes:       { unit: "rice cake", grams: 9, round: 0.5 },
  popcorn:          { unit: "cup",  grams: 8 },
  pb_powder:        { unit: "tbsp", grams: 12, noPlural: true },
  mixed_veggies:    { unit: "cup",  grams: 130 },
  sweet_chili_sauce:{ unit: "tbsp", grams: 18, noPlural: true },
  honey:            { unit: "tbsp", grams: 21, noPlural: true },
  sesame_seeds:     { unit: "tbsp", grams: 9,  noPlural: true },
  cauliflower:      { unit: "cup",  grams: 107 },
  white_rice:       { unit: "cup",  grams: 158 },
  corn_flakes:      { unit: "cup",  grams: 28 },
  bbq_sauce:        { unit: "tbsp", grams: 17, noPlural: true },
  diced_tomatoes:   { unit: "cup",  grams: 120 },
  mozzarella_cheese:{ unit: "oz",   grams: 28.35, round: 0.5, noPlural: true },
  mexican_cheese_blend: { unit: "oz", grams: 28.35, round: 0.5, noPlural: true },
  cream_cheese:     { unit: "tbsp", grams: 15, noPlural: true },
  vanilla_yogurt:   { unit: "cup",  grams: 245 },
  cheesecake_pudding_mix: { unit: "tbsp", grams: 8, noPlural: true },
  oreo_crumbs:      { unit: "cookie", grams: 11, round: 0.5 },
  flour:            { unit: "tbsp", grams: 8,  noPlural: true },
  cherry_tomatoes:  { unit: "cup",  grams: 149 },
  chia_seeds:       { unit: "tbsp", grams: 12, noPlural: true },
};

// Renders a fraction as a whole number plus a unicode glyph (1¼, ½, 2¾, ...)
// so ingredient amounts read like a real recipe card instead of a decimal.
function formatQty(x) {
  const glyphs = { 0: "", 0.25: "¼", 0.5: "½", 0.75: "¾" };
  const whole = Math.floor(x + 1e-9);
  const frac = Math.round((x - whole) * 4) / 4;
  const w = frac >= 1 ? whole + 1 : whole;
  const glyph = glyphs[frac >= 1 ? 0 : frac] ?? "";
  if (w === 0) return glyph || "0";
  return `${w}${glyph}`;
}

// Converts a food + gram amount into a kitchen-friendly serving string
// ("6 oz", "1 cup", "1½ tortillas"), falling back to grams for anything
// not in SERVING_UNITS (mainly spices/seasonings, which aren't tracked as
// foods at all and never reach this function).
function formatServing(food, grams) {
  const su = SERVING_UNITS[food];
  if (!su) return `${Math.round(grams)}g`;
  const step = su.round || 0.25;
  const qty = grams / su.grams;
  const rounded = Math.round(qty / step) * step;
  if (rounded <= 0) return `${Math.round(grams)}g`;
  const unit = rounded > 1 && !su.noPlural ? `${su.unit}s` : su.unit;
  return `${formatQty(rounded)} ${unit}`;
}
