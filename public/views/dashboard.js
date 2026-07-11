import { getStreams, getAsOfDate, equityPct, forwardPnlPct, exposureSummary, tradeEventsToday, activeFlags } from "../data.js";
import { escapeHtml, fmtPct, fmtLevelPct, forwardDay } from "../format.js";

function badge(flag) {
  const safe = escapeHtml(flag);
  return `<span class="badge badge--${safe}">${safe.replace("_", " ")}</span>`;
}

function renderCard(stream, asOfDate) {
  const day = forwardDay(stream.anchor_date, asOfDate);
  const exposure = exposureSummary(stream);
  const events = tradeEventsToday(stream);
  const flags = activeFlags(stream);

  return `
    <article class="card" data-stream-id="${escapeHtml(stream.strategy_id)}">
      <header class="card__header">
        <h3><a href="#/stream/${encodeURIComponent(stream.strategy_id)}">${escapeHtml(stream.strategy_id)}</a></h3>
        <span class="card__asof">${escapeHtml(asOfDate ?? "—")}${day !== null ? ` &middot; day ${day} since ${escapeHtml(stream.anchor_date)}` : ""}</span>
      </header>
      <div class="card__metrics">
        <div class="metric"><span class="metric__label">Equity</span><span class="metric__value">${fmtLevelPct(equityPct(stream))}</span></div>
        <div class="metric"><span class="metric__label">Forward PnL</span><span class="metric__value">${fmtPct(forwardPnlPct(stream))}</span></div>
      </div>
      <div class="card__positions">
        ${exposure.count} open &middot; gross ${fmtLevelPct(exposure.grossPct)} &middot; net ${fmtPct(exposure.netPct)}
      </div>
      ${events.length ? `<div class="card__events">${escapeHtml(events.join(", "))}</div>` : ""}
      ${flags.length ? `<div class="card__flags">${flags.map(badge).join("")}</div>` : ""}
    </article>
  `;
}

export function renderDashboard(summary) {
  const streams = getStreams(summary);
  const asOfDate = getAsOfDate(summary);

  if (streams.length === 0) {
    return `<p class="empty-state">No streams in summary.</p>`;
  }

  return `<div class="card-grid">${streams.map((s) => renderCard(s, asOfDate)).join("")}</div>`;
}
