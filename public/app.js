import { getStreams } from "./data.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderStream } from "./views/stream.js";

const sidebarEl = document.getElementById("sidebar");
const viewEl = document.getElementById("view");

let summary = null;

function renderSidebar() {
  const streams = summary ? getStreams(summary) : [];
  const links = streams
    .map((s) => `<li><a href="#/stream/${encodeURIComponent(s.strategy_id)}">${s.strategy_id}</a></li>`)
    .join("");

  sidebarEl.innerHTML = `
    <nav>
      <ul>
        <li><a href="#/">Dashboard</a></li>
        ${links}
      </ul>
    </nav>
  `;
}

function renderView() {
  if (!summary) return;

  const hash = window.location.hash.replace(/^#/, "") || "/";
  const streamMatch = hash.match(/^\/stream\/(.+)$/);

  viewEl.innerHTML = streamMatch ? renderStream(summary, decodeURIComponent(streamMatch[1])) : renderDashboard(summary);
}

function renderError(message) {
  viewEl.innerHTML = `<p class="error-state">Failed to load summary: ${message}</p>`;
}

async function init() {
  try {
    const res = await fetch("/api/summary");
    if (!res.ok) {
      renderError(`HTTP ${res.status}`);
      return;
    }
    summary = await res.json();
    if (summary.schema_version !== 2) {
      console.warn(`Unexpected schema_version: ${summary.schema_version}`);
    }
    renderSidebar();
    renderView();
  } catch (err) {
    renderError(err.message);
  }
}

window.addEventListener("hashchange", renderView);
init();
