// All values are per 100g (or 100ml for liquids) of the food as prepared.
// price is a rough US national-average grocery price in USD per 100g.
// These are editable — tune them to match your own local prices.
const FOODS = {
  oats:            { name: "Rolled Oats",        cal: 389, protein: 16.9, carbs: 66.3, fat: 6.9,  price: 0.35, veg: true },
  banana:          { name: "Banana",              cal: 89,  protein: 1.1,  carbs: 22.8, fat: 0.3,  price: 0.30, veg: true },
  almond_milk:     { name: "Almond Milk",         cal: 17,  protein: 0.6,  carbs: 0.6,  fat: 1.5,  price: 0.25, veg: true },
  egg:             { name: "Eggs",                cal: 155, protein: 13,   carbs: 1.1,  fat: 11,   price: 0.45, veg: true },
  greek_yogurt:    { name: "Greek Yogurt",        cal: 59,  protein: 10,   carbs: 3.6,  fat: 0.4,  price: 0.60, veg: true },
  chicken_breast:  { name: "Chicken Breast",      cal: 165, protein: 31,   carbs: 0,    fat: 3.6,  price: 0.90, veg: false },
  brown_rice:      { name: "Brown Rice (cooked)", cal: 123, protein: 2.6,  carbs: 25.6, fat: 1,    price: 0.20, veg: true },
  broccoli:        { name: "Broccoli",            cal: 34,  protein: 2.8,  carbs: 6.6,  fat: 0.4,  price: 0.35, veg: true },
  salmon:          { name: "Salmon",              cal: 208, protein: 20,   carbs: 0,    fat: 13,   price: 1.80, veg: false },
  sweet_potato:    { name: "Sweet Potato",        cal: 86,  protein: 1.6,  carbs: 20,   fat: 0.1,  price: 0.25, veg: true },
  black_beans:     { name: "Black Beans (cooked)",cal: 132, protein: 8.9,  carbs: 23.7, fat: 0.5,  price: 0.20, veg: true },
  spinach:         { name: "Spinach",             cal: 23,  protein: 2.9,  carbs: 3.6,  fat: 0.4,  price: 0.40, veg: true },
  olive_oil:       { name: "Olive Oil",           cal: 884, protein: 0,    carbs: 0,    fat: 100,  price: 1.20, veg: true },
  peanut_butter:   { name: "Peanut Butter",       cal: 588, protein: 25,   carbs: 20,   fat: 50,   price: 0.70, veg: true },
  whole_wheat_bread:{name: "Whole Wheat Bread",   cal: 247, protein: 13,   carbs: 41,   fat: 3.4,  price: 0.35, veg: true },
  avocado:         { name: "Avocado",             cal: 160, protein: 2,    carbs: 8.5,  fat: 14.7, price: 0.90, veg: true },
  almonds:         { name: "Almonds",             cal: 579, protein: 21,   carbs: 22,   fat: 50,   price: 1.50, veg: true },
  apple:           { name: "Apple",               cal: 52,  protein: 0.3,  carbs: 13.8, fat: 0.2,  price: 0.30, veg: true },
  carrots:         { name: "Carrots",             cal: 41,  protein: 0.9,  carbs: 9.6,  fat: 0.2,  price: 0.20, veg: true },
  hummus:          { name: "Hummus",              cal: 166, protein: 8,    carbs: 14,   fat: 10,   price: 0.80, veg: true },
  cottage_cheese:  { name: "Cottage Cheese",      cal: 98,  protein: 11,   carbs: 3.4,  fat: 4.3,  price: 0.55, veg: true },
  quinoa:          { name: "Quinoa (cooked)",     cal: 120, protein: 4.4,  carbs: 21.3, fat: 1.9,  price: 0.45, veg: true },
  turkey_breast:   { name: "Turkey Breast",       cal: 135, protein: 30,   carbs: 0,    fat: 1,    price: 1.10, veg: false },
  tofu:            { name: "Tofu",                cal: 76,  protein: 8,    carbs: 1.9,  fat: 4.8,  price: 0.40, veg: true },
  lentils:         { name: "Lentils (cooked)",    cal: 116, protein: 9,    carbs: 20,   fat: 0.4,  price: 0.20, veg: true },
  bell_pepper:     { name: "Bell Pepper",         cal: 31,  protein: 1,    carbs: 6,    fat: 0.3,  price: 0.45, veg: true },
  cheddar_cheese:  { name: "Cheddar Cheese",      cal: 403, protein: 25,   carbs: 1.3,  fat: 33,   price: 1.20, veg: true },
  pasta:           { name: "Pasta (cooked)",      cal: 131, protein: 5,    carbs: 25,   fat: 1.1,  price: 0.15, veg: true },
  ground_beef:     { name: "Lean Ground Beef",    cal: 176, protein: 20,   carbs: 0,    fat: 10,   price: 1.10, veg: false },
  blueberries:     { name: "Blueberries",         cal: 57,  protein: 0.7,  carbs: 14.5, fat: 0.3,  price: 1.00, veg: true },
  granola:         { name: "Granola",             cal: 471, protein: 10,   carbs: 64,   fat: 20,   price: 0.90, veg: true },
  trail_mix:       { name: "Trail Mix",           cal: 462, protein: 14,   carbs: 44,   fat: 29,   price: 1.30, veg: true },
  orange:          { name: "Orange",              cal: 47,  protein: 0.9,  carbs: 11.8, fat: 0.1,  price: 0.30, veg: true },
};

// Compute nutrition + cost for a list of { food, grams } scaled from per-100g values.
function computeNutrition(items) {
  return items.reduce((acc, { food, grams }) => {
    const f = FOODS[food];
    const factor = grams / 100;
    acc.cal += f.cal * factor;
    acc.protein += f.protein * factor;
    acc.carbs += f.carbs * factor;
    acc.fat += f.fat * factor;
    acc.cost += f.price * factor;
    return acc;
  }, { cal: 0, protein: 0, carbs: 0, fat: 0, cost: 0 });
}

function isVegetarian(items) {
  return items.every(({ food }) => FOODS[food].veg);
}
