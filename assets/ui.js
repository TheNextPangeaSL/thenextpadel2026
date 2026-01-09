// assets/ui.js
export function setActiveView(hash) {
  const view = (hash || "#home").replace("#", "").split("?")[0];
  const ids = ["home", "calendar", "rounds", "standings", "rules"];
  for (const id of ids) {
    document.getElementById(`view-${id}`)?.classList.toggle("d-none", id !== view);
  }
  document.querySelectorAll(".nav-link").forEach(a => {
    const href = a.getAttribute("href");
    a.classList.toggle("active", href === `#${view}`);
  });
}

export function showAlert(type, message) {
  const alertBox = document.getElementById("alertBox");
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = message;
  alertBox.classList.remove("d-none");
}

export function clearAlert() {
  const alertBox = document.getElementById("alertBox");
  alertBox.classList.add("d-none");
}

export function fmtDateRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const opts = { year: "numeric", month: "short", day: "2-digit" };
  return `${s.toLocaleDateString("es-ES", opts)} → ${e.toLocaleDateString("es-ES", opts)}`;
}

export function openMatchModal(title, htmlBody) {
  document.getElementById("matchModalTitle").textContent = title;
  document.getElementById("matchModalBody").innerHTML = htmlBody;
  const modal = new bootstrap.Modal(document.getElementById("matchModal"));
  modal.show();
}

/* -----------------------------
   Standings table (igual que antes, con look algo mejor)
----------------------------- */
export function renderStandings(containerId, standings) {
  const el = document.getElementById(containerId);
  const rows = standings.map(r => `
    <tr class="${r.rank <= 4 ? "table-success" : ""}">
      <td class="fw-semibold">${r.rank}</td>
      <td>${escapeHtml(r.team_name)}</td>
      <td>${r.PJ}</td>
      <td>${r.PG}</td>
      <td>${r.PE}</td>
      <td>${r.PP}</td>
      <td>${r.sets_for}-${r.sets_against} <span class="text-body-secondary">(${signed(r.set_diff)})</span></td>
      <td>${r.games_for}-${r.games_against} <span class="text-body-secondary">(${signed(r.game_diff)})</span></td>
      <td class="fw-semibold">${r.points}</td>
    </tr>
  `).join("");

  el.innerHTML = `
    <table class="table table-sm align-middle">
      <thead class="table-light">
        <tr>
          <th>#</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th>
          <th>Sets</th><th>Juegos</th><th>Puntos</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* -----------------------------
   Jornadas: lista lateral bonita
----------------------------- */
export function renderRoundList(rounds, getRoundBadgeClass, getRoundSubtitle) {
  const el = document.getElementById("roundList");
  el.innerHTML = rounds.map(r => `
    <button class="list-group-item list-group-item-action d-flex justify-content-between align-items-start"
            data-round="${r.round}">
      <div>
        <div class="fw-semibold">${escapeHtml(r.round_name)}</div>
        <div class="small text-body-secondary">${escapeHtml(getRoundSubtitle(r))}</div>
      </div>
      <span class="badge ${getRoundBadgeClass(r)}">${r.stage === "playoff" ? "Playoff" : "Liga"}</span>
    </button>
  `).join("");
}

export function markRoundActive(round) {
  document.querySelectorAll("#roundList .list-group-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.round === String(round));
  });
}

/* -----------------------------
   Jornadas: detalle con cards “pro”
----------------------------- */
export function renderRoundDetail({
  roundObj,
  roundBadgeClass,
  dateRangeText,
  byeHtml,
  matchesHtml,
  isCurrent
}) {
  const title = document.getElementById("roundDetailTitle");
  const dates = document.getElementById("roundDetailDates");
  const badge = document.getElementById("roundDetailStage");
  const bye = document.getElementById("roundDetailBye");
  const matches = document.getElementById("roundDetailMatches");

  title.textContent = `${roundObj.round_name}${isCurrent ? " · (actual)" : ""}`;
  dates.textContent = dateRangeText;

  badge.classList.remove("d-none");
  badge.className = `badge ${roundBadgeClass}`;
  badge.textContent = roundObj.stage === "playoff" ? "Playoff" : "Liga";

  bye.innerHTML = byeHtml || "";
  matches.innerHTML = matchesHtml || "";
}

/* -----------------------------
   Calendario mensual global (enero–junio)
----------------------------- */
export function renderGlobalCalendar({
  containerId,
  months,
  roundsLegendHtml,
  monthCardsHtml
}) {
  const el = document.getElementById(containerId);
  el.innerHTML = `
    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <div class="me-2 text-body-secondary small">Leyenda:</div>
      ${roundsLegendHtml}
    </div>

    <div class="row g-3">
      ${monthCardsHtml}
    </div>
  `;
}

/* -----------------------------
   Helpers
----------------------------- */
export function getHashParams() {
  const hash = location.hash || "";
  const q = hash.includes("?") ? hash.split("?")[1] : "";
  const params = new URLSearchParams(q);
  return params;
}

export function setHashWithParams(view, paramsObj) {
  const params = new URLSearchParams(paramsObj || {});
  const qs = params.toString();
  location.hash = qs ? `#${view}?${qs}` : `#${view}`;
}

function signed(x) {
  return (x > 0 ? `+${x}` : `${x}`);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

