// Tiny inline-SVG line chart. No dependency, no canvas — just a <polyline>
// scaled to fit a viewBox.

export function equitySparklineSvg(equitySeries, { width = 560, height = 120, padding = 8 } = {}) {
  const points = Array.isArray(equitySeries) ? equitySeries : [];
  if (points.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" class="equity-chart equity-chart--empty"></svg>`;
  }

  const values = points.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = padding + i * step;
    const y = padding + innerH - ((p.equity - min) / span) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" class="equity-chart" preserveAspectRatio="none">
      <polyline points="${coords.join(" ")}" fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  `;
}
