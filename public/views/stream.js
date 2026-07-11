import { getStreams, forwardPnlPct } from "../data.js";
import { fmtPct, fmtNum, fmtVote, fmtOrDash } from "../format.js";
import { equitySparklineSvg } from "../chart.js";

function renderPositionsTable(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return `<p class="empty-state">No open positions.</p>`;
  }

  const rows = positions
    .map(
      (p) => `
      <tr>
        <td>${fmtOrDash(p.base_asset)}</td>
        <td>${fmtOrDash(p.side)}</td>
        <td>${fmtOrDash(p.leg)}</td>
        <td>${fmtVote(p.vote)}</td>
        <td>${fmtOrDash(p.open_ts)}</td>
        <td>${fmtOrDash(p.days_held)}</td>
        <td>${fmtNum(p.open_price, 4)}</td>
        <td>${fmtPct(p.size_pct)}</td>
        <td>${fmtPct(p.unreal_pnl_pct)}</td>
      </tr>
    `,
    )
    .join("");

  return `
    <table class="positions-table">
      <thead>
        <tr>
          <th>Asset</th><th>Side</th><th>Leg</th><th>Vote</th><th>Opened</th>
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
    return `<p class="empty-state">Unknown stream: ${streamId}</p>`;
  }

  return `
    <section class="stream-view">
      <header class="stream-view__header">
        <h2>${stream.strategy_id}</h2>
        <span>anchor ${fmtOrDash(stream.anchor_date)}</span>
      </header>

      ${equitySparklineSvg(stream.equity_series)}

      <div class="metric"><span class="metric__label">Net PnL</span><span class="metric__value">${fmtPct(forwardPnlPct(stream))}</span></div>

      <h3>Verdict progress</h3>
      ${renderVerdictProgress(stream.verdict_progress)}

      <h3>Open positions</h3>
      ${renderPositionsTable(stream.open_positions)}
    </section>
  `;
}
