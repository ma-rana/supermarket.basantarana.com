// fetch + formatting helpers
import { useEffect, useState } from "react";

export async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

export function useData(url) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    get(url).then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error: error.message, loading: false }));
    return () => { live = false; };
  }, [url]);
  return state;
}

export const money = (cents, dp) => {
  if (cents === null || cents === undefined) return "—";
  const d = dp ?? (Math.abs(cents) < 10000 ? 2 : 0);
  return (cents < 0 ? "-$" : "$") + (Math.abs(cents) / 100).toLocaleString("en-AU", { minimumFractionDigits: d, maximumFractionDigits: d });
};
export const num = (n, dp = 0) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const pct = (n) => (n === null || n === undefined ? "—" : `${Number(n).toFixed(1)}%`);
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
