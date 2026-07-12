// Tiny inline-SVG line chart. No dependency, no canvas — just <line>/<circle>
// elements scaled to fit a viewBox, with x/y axes and sign-colored segments.

const PAD = { top: 10, right: 12, bottom: 22, left: 40 };
const MAX_X_TICKS = 5;

function bucket(value) {
  return value >= 0 ? "pos" : "neg";
}

// Evenly-spaced indices into [0, n), always including 0 and n-1.
function pickTickIndices(n, maxTicks) {
  if (n <= 1) return [0];
  if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (maxTicks - 1);
  const indices = new Set();
  for (let i = 0; i < maxTicks; i++) indices.add(Math.round(i * step));
  return [...indices].sort((a, b) => a - b);
}

function xTickLabel(date) {
  return typeof date === "string" ? date.slice(5) : String(date);
}

export function netPnlChartSvg(points, { width = 560, height = 160 } = {}) {
  const series = Array.isArray(points) ? points : [];
  if (series.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" class="pnl-chart pnl-chart--empty"></svg>`;
  }

  const values = series.map((p) => p.pct);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;

  const xAt = (i) => PAD.left + i * step;
  const yAt = (v) => PAD.top + innerH - ((v - min) / span) * innerH;
  const yZero = yAt(0);

  const coords = series.map((p, i) => ({ x: xAt(i), y: yAt(p.pct), v: p.pct }));

  // y-axis ticks: min/0/max, deduped, and dropped if within ~5% of the
  // 0-gridline in pixel space (avoids label collision with "0%").
  const collisionPx = innerH * 0.05;
  const yTickValues = [...new Set([min, 0, max])].filter(
    (v) => v === 0 || Math.abs(yAt(v) - yZero) >= collisionPx,
  );
  const yTicks = yTickValues
    .map(
      (v) => `
      <line x1="${PAD.left - 4}" y1="${yAt(v).toFixed(2)}" x2="${PAD.left}" y2="${yAt(v).toFixed(2)}" class="pnl-chart__tick" />
      <text x="${(PAD.left - 8).toFixed(2)}" y="${yAt(v).toFixed(2)}" class="pnl-chart__tick-label" text-anchor="end" dominant-baseline="middle">${fmtPctLabel(v)}</text>
    `,
    )
    .join("");

  const xTickIndices = pickTickIndices(series.length, MAX_X_TICKS);
  const xTicks = xTickIndices
    .map((i) => {
      const x = xAt(i).toFixed(2);
      const y = (PAD.top + innerH).toFixed(2);
      return `
      <line x1="${x}" y1="${y}" x2="${x}" y2="${(PAD.top + innerH + 4).toFixed(2)}" class="pnl-chart__tick" />
      <text x="${x}" y="${(PAD.top + innerH + 15).toFixed(2)}" class="pnl-chart__tick-label" text-anchor="middle">${xTickLabel(series[i].date)}</text>
    `;
    })
    .join("");

  const axes = `
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${(PAD.top + innerH).toFixed(2)}" class="pnl-chart__axis" />
    <line x1="${PAD.left}" y1="${(PAD.top + innerH).toFixed(2)}" x2="${(PAD.left + innerW).toFixed(2)}" y2="${(PAD.top + innerH).toFixed(2)}" class="pnl-chart__axis" />
    <line x1="${PAD.left}" y1="${yZero.toFixed(2)}" x2="${(PAD.left + innerW).toFixed(2)}" y2="${yZero.toFixed(2)}" class="pnl-chart__zero-line" />
  `;

  let plot;
  if (coords.length === 1) {
    const p = coords[0];
    plot = `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" class="pnl-chart__point pnl-chart__point--${bucket(p.v)}" />`;
  } else {
    const segments = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const bucketA = bucket(a.v);
      const bucketB = bucket(b.v);
      if (bucketA === bucketB) {
        segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: bucketA });
      } else {
        const t = a.v / (a.v - b.v);
        const crossX = a.x + (b.x - a.x) * t;
        segments.push({ x1: a.x, y1: a.y, x2: crossX, y2: yZero, color: bucketA });
        segments.push({ x1: crossX, y1: yZero, x2: b.x, y2: b.y, color: bucketB });
      }
    }
    plot = segments
      .map(
        (s) =>
          `<line x1="${s.x1.toFixed(2)}" y1="${s.y1.toFixed(2)}" x2="${s.x2.toFixed(2)}" y2="${s.y2.toFixed(2)}" class="pnl-chart__segment pnl-chart__segment--${s.color}" />`,
      )
      .join("");
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" class="pnl-chart">
      ${axes}
      ${yTicks}
      ${xTicks}
      ${plot}
    </svg>
  `;
}

function fmtPctLabel(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
