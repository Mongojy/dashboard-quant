import { getStreams, getAsOfDate, tradeEventsToday } from "./data.js";
import { escapeHtml } from "./format.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderStream } from "./views/stream.js";

const sidebarEl = document.getElementById("sidebar");
const viewEl = document.getElementById("view");

const SIDEBAR_COLLAPSED_KEY = "qats_sidebar_collapsed";
const BITCOIN_STREAM_ID = "btc_hold_baseline";
const BITCOIN_GLYPH = "₿";

const MONITOR_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
`;

const PANEL_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
`;

let summary = null;

// Sequential #N badges for every stream except the bitcoin one, ordered by
// anchor_date ascending (tie-break strategy_id) and computed fresh from the
// streams list each render — no hardcoded id map.
function streamBadgeNumbers(streams) {
  const numbered = streams
    .filter((s) => s.strategy_id !== BITCOIN_STREAM_ID)
    .slice()
    .sort((a, b) => {
      const ad = a.anchor_date ?? "";
      const bd = b.anchor_date ?? "";
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.strategy_id < b.strategy_id ? -1 : a.strategy_id > b.strategy_id ? 1 : 0;
    });
  const badges = new Map();
  numbered.forEach((s, i) => badges.set(s.strategy_id, `#${i + 1}`));
  return badges;
}

function renderTodayBlock(streams) {
  const rows = streams
    .map((s) => ({ id: s.strategy_id, events: tradeEventsToday(s) }))
    .filter((row) => row.events.length > 0);

  const body = rows.length
    ? `<ul class="today-list">
        ${rows
          .map(
            (row) => `
          <li>
            <span class="today-list__stream">${escapeHtml(row.id)}</span>
            <span class="today-list__events">${escapeHtml(row.events.join(", "))}</span>
          </li>
        `,
          )
          .join("")}
      </ul>`
    : `<p class="empty-state">No opens today.</p>`;

  return `
    <div class="sidebar__today">
      <h4 class="sidebar__heading">Today's opens</h4>
      ${body}
    </div>
  `;
}

function navLink(href, label, badgeHtml) {
  return `
    <li>
      <a href="${href}" class="nav-link" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        <span class="nav-link__badge">${badgeHtml}</span>
        <span class="nav-link__label">${escapeHtml(label)}</span>
      </a>
    </li>
  `;
}

function collapseToggleLabel(collapsed) {
  return collapsed ? "Expand sidebar" : "Collapse sidebar";
}

function renderSidebar() {
  const streams = summary ? getStreams(summary) : [];
  const asOfDate = summary ? getAsOfDate(summary) : null;

  const badges = streamBadgeNumbers(streams);
  const links = streams
    .map((s) => {
      const badge = s.strategy_id === BITCOIN_STREAM_ID ? BITCOIN_GLYPH : (badges.get(s.strategy_id) ?? "—");
      return navLink(`#/stream/${encodeURIComponent(s.strategy_id)}`, s.strategy_id, escapeHtml(badge));
    })
    .join("");

  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  sidebarEl.classList.toggle("is-collapsed", collapsed);

  sidebarEl.innerHTML = `
    <div class="sidebar__scroll">
      ${asOfDate ? `<div class="sidebar__asof">${escapeHtml(asOfDate)}</div>` : ""}
      ${renderTodayBlock(streams)}
      <nav>
        <ul class="nav-list">
          ${navLink("#/", "Dashboard", MONITOR_ICON)}
          ${links}
        </ul>
      </nav>
    </div>
    <button type="button" class="sidebar__collapse-toggle" aria-expanded="${!collapsed}" aria-controls="sidebar" aria-label="${collapseToggleLabel(collapsed)}" title="${collapseToggleLabel(collapsed)}">
      ${PANEL_ICON}
    </button>
  `;

  const toggle = sidebarEl.querySelector(".sidebar__collapse-toggle");
  toggle.addEventListener("click", () => {
    const next = !sidebarEl.classList.contains("is-collapsed");
    sidebarEl.classList.toggle("is-collapsed", next);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    toggle.setAttribute("aria-expanded", String(!next));
    toggle.setAttribute("aria-label", collapseToggleLabel(next));
    toggle.title = collapseToggleLabel(next);
  });

  updateActiveNav();
}

function updateActiveNav() {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  sidebarEl.querySelectorAll(".nav-link").forEach((el) => {
    const href = el.getAttribute("href").replace(/^#/, "");
    el.classList.toggle("is-active", href === hash);
  });
}

function renderView() {
  if (!summary) return;

  const hash = window.location.hash.replace(/^#/, "") || "/";
  const streamMatch = hash.match(/^\/stream\/(.+)$/);

  viewEl.innerHTML = streamMatch ? renderStream(summary, decodeURIComponent(streamMatch[1])) : renderDashboard(summary);
}

function renderError(message) {
  viewEl.innerHTML = `<p class="error-state">Failed to load summary: ${escapeHtml(message)}</p>`;
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

window.addEventListener("hashchange", () => {
  renderView();
  updateActiveNav();
});
init();
