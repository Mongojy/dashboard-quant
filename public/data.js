// Single place that knows dashboard_summary.json's shape. Every view module
// consumes the derived helpers below instead of reading summary.streams[]
// fields directly, so a future sanitized-public data source only needs a
// replacement for this one file.

// nominal paper allocation; schema_v2 has no baseline field
const BASELINE_EQUITY = 10_000;

export function getStreams(summary) {
  return Array.isArray(summary?.streams) ? summary.streams : [];
}

export function getAsOfDate(summary) {
  return summary?.as_of_date ?? null;
}

export function equityPct(stream) {
  const equity = stream?.equity;
  if (typeof equity !== "number") return null;
  return (equity / BASELINE_EQUITY) * 100;
}

// net_pnl_pct is already present in the source JSON (verified against
// equity_series[0]); reused as-is for both "Forward PnL %" (dashboard) and
// "net_pnl" (strategy view) — same field, different labels per view.
export function forwardPnlPct(stream) {
  const value = stream?.net_pnl_pct;
  return typeof value === "number" ? value : null;
}

// Gross/net exposure aren't precomputed in the source JSON — derived from
// each open position's size_pct, signed by side for net.
export function exposureSummary(stream) {
  const positions = Array.isArray(stream?.open_positions) ? stream.open_positions : [];
  let gross = 0;
  let net = 0;
  for (const pos of positions) {
    const size = typeof pos.size_pct === "number" ? pos.size_pct : 0;
    gross += Math.abs(size);
    net += pos.side === "short" ? -size : size;
  }
  return { count: positions.length, grossPct: gross, netPct: net };
}

// The source JSON has no trade-event/close feed — only currently-open
// positions. The only event derivable is "opened today" (days_held === 0).
// Closes are not representable from this data and are never shown.
export function tradeEventsToday(stream) {
  const positions = Array.isArray(stream?.open_positions) ? stream.open_positions : [];
  return positions.filter((pos) => pos.days_held === 0).map((pos) => `${pos.base_asset} open`);
}

export function activeFlags(stream) {
  const flags = stream?.flags ?? {};
  return Object.entries(flags).filter(([, active]) => active === true).map(([name]) => name);
}
