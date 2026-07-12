import { getStreams, forwardPnlPct, netPnlPctSeries } from "../data.js";
import { escapeHtml, fmtPct, fmtNum, fmtVote, fmtOrDash, splitOpenTs } from "../format.js";
import { netPnlChartSvg } from "../chart.js";

function renderPositionsTable(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return `<p class="empty-state">No open positions.</p>`;
  }

  const rows = positions
    .map((p) => {
      const opened = splitOpenTs(p.open_ts);
      return `
      <tr>
        <td>${escapeHtml(fmtOrDash(p.base_asset))}</td>
        <td>${escapeHtml(fmtOrDash(p.side))}</td>
        <td>${fmtVote(p.vote)}</td>
        <td>
          <div>${escapeHtml(opened.date)}</div>
          ${opened.time ? `<div class="cell-sub">${escapeHtml(opened.time)}</div>` : ""}
        </td>
        <td>${fmtOrDash(p.days_held)}</td>
        <td>${fmtNum(p.open_price, 4)}</td>
        <td>${fmtPct(p.size_pct)}</td>
        <td>${fmtPct(p.unreal_pnl_pct)}</td>
      </tr>
    `;
    })
    .join("");

  return `
    <table class="positions-table">
      <thead>
        <tr>
          <th>Asset</th><th>Side</th><th>Vote</th><th>Opened</th>
          <th>Days held</th><th>Open price</th><th>Size %</th><th>Unreal PnL %</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderVerdictProgress(vp) {
  if (!vp) return `<p class="empty-state">No verdict progress data.</p>`;
  return `
    <ul class="verdict-progress">
      <li>Daily closes: ${fmtOrDash(vp.daily_closes)} / ${fmtOrDash(vp.daily_closes_required)}</li>
      <li>Closed trades: ${fmtOrDash(vp.closed_trades)} / ${fmtOrDash(vp.closed_trades_required)}</li>
      <li>Verdict ready: ${vp.verdict_ready ? "yes" : "no"}</li>
    </ul>
  `;
}

export function renderStream(summary, streamId) {
  const stream = getStreams(summary).find((s) => s.strategy_id === streamId);
  if (!stream) {
    // streamId comes straight from the URL hash — escaping here is the XSS fix.
    return `<p class="empty-state">Unknown stream: ${escapeHtml(streamId)}</p>`;
  }

  return `
    <section class="stream-view">
      <header class="stream-view__header">
        <h2>${escapeHtml(stream.strategy_id)}</h2>
        <span>anchor ${escapeHtml(fmtOrDash(stream.anchor_date))}</span>
      </header>

      ${netPnlChartSvg(netPnlPctSeries(stream))}

      <div class="metric"><span class="metric__label">Net PnL</span><span class="metric__value">${fmtPct(forwardPnlPct(stream))}</span></div>

      <h3>Verdict progress</h3>
      ${renderVerdictProgress(stream.verdict_progress)}

      <h3>Open positions</h3>
      ${renderPositionsTable(stream.open_positions)}
    </section>
  `;
}
