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
