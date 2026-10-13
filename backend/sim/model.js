// model settings. each run saves a copy, so edits here only affect new runs

const MODEL_VERSION = "1.0";

const CATEGORIES = {
  FRESH: "Fresh Produce & Bakery",
  DAIRY: "Dairy & Chilled",
  READY: "Ready-to-Eat Meals",
  DRINKS: "Drinks",
  SNACKS: "Snacks & Confectionery",
  PANTRY: "Grocery & Pantry",
  HOUSEHOLD: "Household Essentials",
  PERSONAL: "Personal Care & Convenience",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DEFAULT_CONFIG = {
  model_version: MODEL_VERSION,
  days: 60,
  start_weekday: 0, // Day 1 is a Monday
  opening_inventory_budget_cents: 4000000, // A$40,000
  opening_cash_cents: 1500000, // A$15,000
  store_hours: { open: 7, close: 22 }, // 7am-10pm, 15 trading hours

  customers: {
    // customers per day once the store is established (Mon..Sun)
    base_by_weekday: [560, 580, 600, 620, 650, 430, 380],
    // new store: starts at 80% traffic, full by day 21
    ramp: { start_factor: 0.8, full_by_day: 21 },
    // random day-to-day variation
    daily_noise_sd: 0.06,
    // arrivals per hour, 7am to 9pm
    hourly_weights: {
      weekday: [6, 10, 7, 4, 5, 9, 10, 6, 4, 5, 8, 10, 8, 5, 3],
      weekend: [2, 4, 5, 6, 8, 9, 9, 8, 7, 6, 6, 5, 4, 3, 2],
    },
  },

  // shopping missions: basket size + category mix
  missions: {
    BREAKFAST: { label: "Breakfast grab", lines: [1, 2], boost_tag: "breakfast", multi_unit_p: 0.05,
      categories: { FRESH: 0.3, DRINKS: 0.3, DAIRY: 0.25, READY: 0.15 } },
    LUNCH: { label: "Lunch meal", lines: [2, 3], boost_tag: "lunch", multi_unit_p: 0.05,
      categories: { READY: 0.55, DRINKS: 0.3, SNACKS: 0.15 } },
    SNACK: { label: "Snack & drink", lines: [1, 2], boost_tag: null, multi_unit_p: 0.08,
      categories: { DRINKS: 0.55, SNACKS: 0.45 } },
    TOP_UP: { label: "Top-up shop", lines: [3, 7], boost_tag: "dinner", multi_unit_p: 0.12,
      categories: { DAIRY: 0.3, FRESH: 0.22, PANTRY: 0.18, READY: 0.12, HOUSEHOLD: 0.04, DRINKS: 0.08, SNACKS: 0.06 } },
    STOCK_UP: { label: "Resident stock-up", lines: [7, 13], boost_tag: null, multi_unit_p: 0.25,
      categories: { PANTRY: 0.28, DAIRY: 0.2, FRESH: 0.17, HOUSEHOLD: 0.1, DRINKS: 0.11, PERSONAL: 0.06, SNACKS: 0.08 } },
    ESSENTIALS: { label: "Urgent essentials", lines: [1, 2], boost_tag: null, multi_unit_p: 0.05,
      categories: { PERSONAL: 0.5, HOUSEHOLD: 0.3, DRINKS: 0.2 } },
  },
  // tagged products are picked more often for that mission
  tag_boost: 3,

  // which missions happen at which time of day
  mission_mix: {
    weekday: [
      { from: 7, to: 10, mix: { BREAKFAST: 0.55, SNACK: 0.25, TOP_UP: 0.1, ESSENTIALS: 0.05, STOCK_UP: 0.05 } },
      { from: 10, to: 14, mix: { LUNCH: 0.55, SNACK: 0.25, TOP_UP: 0.1, ESSENTIALS: 0.05, BREAKFAST: 0.03, STOCK_UP: 0.02 } },
      { from: 14, to: 17, mix: { SNACK: 0.4, TOP_UP: 0.25, ESSENTIALS: 0.1, LUNCH: 0.15, STOCK_UP: 0.1 } },
      { from: 17, to: 20, mix: { TOP_UP: 0.45, SNACK: 0.15, STOCK_UP: 0.15, LUNCH: 0.15, ESSENTIALS: 0.1 } },
      { from: 20, to: 22, mix: { SNACK: 0.45, TOP_UP: 0.35, ESSENTIALS: 0.1, LUNCH: 0.1 } },
    ],
    weekend: [
      { from: 7, to: 11, mix: { BREAKFAST: 0.4, TOP_UP: 0.2, SNACK: 0.2, STOCK_UP: 0.15, ESSENTIALS: 0.05 } },
      { from: 11, to: 15, mix: { LUNCH: 0.35, SNACK: 0.2, STOCK_UP: 0.2, TOP_UP: 0.15, ESSENTIALS: 0.1 } },
      { from: 15, to: 19, mix: { TOP_UP: 0.3, STOCK_UP: 0.25, SNACK: 0.25, LUNCH: 0.1, ESSENTIALS: 0.1 } },
      { from: 19, to: 22, mix: { SNACK: 0.4, TOP_UP: 0.35, ESSENTIALS: 0.15, LUNCH: 0.1 } },
    ],
  },

  // chance a customer swaps to something else in the same category
  substitution_p: 0.5,

  // store brain rules, checked at close each day
  brain: {
    forecast_window_days: 7, // trailing average of units sold
    sold_out_uplift: 1.25, // sales are under-counted on sold-out days, so lift the forecast
    lead_time_days: 1, // orders placed at close arrive before opening next day
    policies: {
      DAILY_FRESH: { description: "Shelf life of 2 days or less: standing daily order for tomorrow's forecast + safety.",
        max_shelf_life: 2, target_days: 1.1, reorder_point_days: null },
      SHORT_LIFE: { description: "Perishable, 3-14 days shelf life: reorder at 1.5 days of cover, order up to 3 days (capped below shelf life).",
        max_shelf_life: 14, target_days: 3, reorder_point_days: 1.5 },
      LONG_LIFE: { description: "Perishable, more than 14 days shelf life: reorder at 3 days of cover, order up to 7 days.",
        max_shelf_life: null, target_days: 7, reorder_point_days: 3 },
      AMBIENT: { description: "Non-perishable: reorder at 3 days of cover, order up to 9 days.",
        max_shelf_life: null, target_days: 9, reorder_point_days: 3 },
    },
    slow_moving: { from_day: 7, cover_days_over: 30 }, // applies to LONG_LIFE and AMBIENT
    order_priority: ["SOLD_OUT", "LOW_STOCK", "DAILY_FRESH"], // order funded first when cash is short
  },

  // used by scripts/plan-opening-stock.js to set opening quantities
  opening_plan: {
    DAILY_FRESH: { days: 1 }, SHORT_LIFE: { days: 3 }, LONG_LIFE: { days: 7 },
    AMBIENT: { days: 10, min_display_units: 24 },
  },
};

function policyFor(product, brain) {
  if (!product.perishable) return "AMBIENT";
  const s = product.shelf_life_days;
  if (s <= brain.policies.DAILY_FRESH.max_shelf_life) return "DAILY_FRESH";
  if (s <= brain.policies.SHORT_LIFE.max_shelf_life) return "SHORT_LIFE";
  return "LONG_LIFE";
}

module.exports = { MODEL_VERSION, CATEGORIES, WEEKDAYS, DEFAULT_CONFIG, policyFor };
