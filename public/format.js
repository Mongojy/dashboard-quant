// Shared formatting helpers. Every function tolerates null/undefined and
// renders "—" instead of throwing or printing "NaN"/"null".

// For signed deltas (PnL, net exposure) where +/- carries meaning.
export function fmtPct(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

// For magnitudes/levels (equity level, gross exposure) where a "+" prefix
// would misleadingly imply a change relative to zero.
export function fmtLevelPct(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

export function fmtNum(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(decimals);
}

export function fmtVote(value) {
  return value === null || value === undefined ? "—" : String(value);
}

export function fmtOrDash(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

// Whole days between two ISO date strings (YYYY-MM-DD), ignoring time-of-day.
function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

// "Forward day N" is 1-indexed: the anchor date itself is day 1.
export function forwardDay(anchorDate, asOfDate) {
  if (!anchorDate || !asOfDate) return null;
  return daysBetween(anchorDate, asOfDate) + 1;
}
