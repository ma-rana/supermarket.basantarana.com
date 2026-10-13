import { Link } from "react-router-dom";

export const Kpi = ({ label, value, sub }) => (
  <div className="kpi"><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>
);
export const Badge = ({ kind, children }) => <span className={`badge b-${kind}`}>{children ?? kind}</span>;
export const Loading = ({ state }) => state.error ? <div className="wrap"><div className="callout warn">Error: {state.error}</div></div> : <div className="loading">Loading…</div>;
export const ProductLink = ({ runId, id, name }) => <Link to={`/runs/${runId}/products/${id}`}>{name || id}</Link>;
export const DayLink = ({ runId, day, children }) => <Link to={`/runs/${runId}/days/${day}`}>{children ?? `Day ${day}`}</Link>;
export const CAT = { FRESH: "Fresh Produce & Bakery", DAIRY: "Dairy & Chilled", READY: "Ready-to-Eat Meals", DRINKS: "Drinks",
  SNACKS: "Snacks & Confectionery", PANTRY: "Grocery & Pantry", HOUSEHOLD: "Household Essentials", PERSONAL: "Personal Care & Convenience" };
export const EVENT_LABEL = { SOLD_OUT: "Sold out", LOW_STOCK: "Low stock", EXPIRY_WARNING: "Expiry warning", EXPIRY_WRITE_OFF: "Expiry write-off",
  SLOW_MOVING: "Slow-moving flagged", SLOW_MOVING_CLEARED: "Slow-moving cleared", CASH_CONSTRAINED: "Cash-constrained order",
  REPLENISHMENT: "Replenishment placed", FINAL_DAY: "Final-day review" };
