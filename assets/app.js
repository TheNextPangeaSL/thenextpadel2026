// assets/app.js
import { loadAllSheets } from "./sheets.js";
import { computeStandings, buildTeamMap, computeMatchOutcome } from "./standings.js";
import {
  setActiveView, showAlert, clearAlert, fmtDateRange,
  renderStandings, renderRoundList, markRoundActive, renderRoundDetail,
  openMatchModal, renderGlobalCalendar, getHashParams, setHashWithParams
} from "./ui.js";

let state = {
  config: null,
  teams: [],
  matches: [],
  byes: [],
  results: [],
  standings: [],
  teamMap: null,
};

function normalizeRounds(matches) {
  const byRound = new Map();
  for (const m of matches) {
    const key = String(m.round || "");
    if (!key) continue;
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(m);
  }

  const rounds = Array.from(byRound.entries())
    .map(([round, ms]) => {
      const first = ms[0];
      return {
        round: Number(round),
        stage: first.stage,
        round_name: first.round_name,
        start_date: first.start_date,
        end_date: first.end_date,
        dateRange: fmtDateRange(first.start_date, first.end_date),
        matches: ms
      };
    })
    .sort((a, b) => a.round - b.round);

  return rounds;
}

function getRoundBye(roundNum) {
  const r = state.byes.find(x => String(x.round) === String(roundNum));
  if (!r) return null;
  const team = state.teamMap.get(r.team_id);
  return team ? team.team_name : r.team_id;
}

function matchTitle(m) {
  // Para playoffs: si vienen home_slot/away_slot, lo resolvemos visualmente
  const home = state.teamMap.get(m.home_team_id)?.team_name || resolveSlotName(m.home_slot) || "TBD";
  const away = state.teamMap.get(m.away_team_id)?.team_name || resolveSlotName(m.away_slot) || "TBD";
  return `${home} vs ${away}`;
}

function resolveSlotName(slot) {
  if (!slot) return null;

  // Rankings: R1..R4
  if (/^R[1-4]$/.test(slot)) {
    const idx = parseInt(slot.slice(1), 10) - 1;
    const t = state.standings[idx];
    return t ? `${t.team_name} (R${idx+1})` : slot;
  }

  // Winners: W_SF1 / W_SF2
  if (slot === "W_SF1") return "Ganador SF1";
  if (slot === "W_SF2") return "Ganador SF2";
  return slot;
}

function buildResultMap() {
  return new Map(state.results.map(r => [r.match_id, r]));
}

function scoreLine(resultRow) {
  if (!resultRow) return "";
  const st = (resultRow.status || "").toLowerCase();
  if (st === "draw") return "Empate (por status)";
  if (st === "wo_home") return "W.O. (home)";
  if (st === "wo_away") return "W.O. (away)";

  const parts = [];
  const s1 = [resultRow.s1_home_games, resultRow.s1_away_games].filter(Boolean).length === 2 ? `${resultRow.s1_home_games}-${resultRow.s1_away_games}` : null;
  const s2 = [resultRow.s2_home_games, resultRow.s2_away_games].filter(Boolean).length === 2 ? `${resultRow.s2_home_games}-${resultRow.s2_away_games}` : null;
  const s3 = [resultRow.s3_home_games, resultRow.s3_away_games].filter(Boolean).length === 2 ? `${resultRow.s3_home_games}-${resultRow.s3_away_games}` : null;
  if (s1) parts.push(s1);
  if (s2) parts.push(s2);
  if (s3) parts.push(s3);

  return parts.length ? parts.join(", ") : "";
}

/* -----------------------------
   Paleta de colores por jornada (Bootstrap badges)
----------------------------- */
function roundBadgeClass(roundObj) {
  // Liga: variar colores; Playoff: warning
  if (roundObj.stage === "playoff") return "text-bg-warning";
  const n = ((roundObj.round - 1) % 6);
  return ["text-bg-primary", "text-bg-success", "text-bg-info", "text-bg-secondary", "text-bg-dark", "text-bg-danger"][n];
}

function roundPillClass(roundObj) {
  // Para colorear días del “calendario global”
  if (roundObj.stage === "playoff") return "bg-warning-subtle border-warning";
  const n = ((roundObj.round - 1) % 6);
  return ["bg-primary-subtle border-primary", "bg-success-subtle border-success", "bg-info-subtle border-info", "bg-secondary-subtle border-secondary", "bg-dark-subtle border-dark", "bg-danger-subtle border-danger"][n];
}

function roundLabel(roundObj) {
  // J1..J9, SF, F
  const name = (roundObj.round_name || "").toUpperCase();
  if (name.includes("SF")) return "SF";
  if (name === "F" || name.includes("FINAL")) return "F";
  // asume J01/J1/J09...
  const m = name.match(/J\s*0*([0-9]+)/);
  if (m) return `J${m[1]}`;
  // fallback:
  return roundObj.round_name;
}

/* -----------------------------
   Jornadas: render detallado (bonito)
----------------------------- */
function buildMatchCardHtml(m, r, outcome, roundObj) {
  const title = matchTitle(m);
  const sc = scoreLine(r);
  const status = (r?.status || "").toLowerCase();

  // Estado visual
  let badge = { cls: "text-bg-light", text: "Pendiente" };
  if (status === "draw") badge = { cls: "text-bg-secondary", text: "Empate" };
  else if (status === "wo_home" || status === "wo_away") badge = { cls: "text-bg-dark", text: "W.O." };
  else if (status === "played" || sc) badge = { cls: "text-bg-success", text: "Jugado" };

  // Línea extra (sets/juegos) si hay outcome
  let meta = "";
  if (outcome?.isPlayed) {
    meta = `
      <div class="small text-body-secondary">
        Sets: <b>${outcome.homeSets}</b>–<b>${outcome.awaySets}</b> ·
        Juegos: <b>${outcome.homeGames}</b>–<b>${outcome.awayGames}</b>
      </div>
    `;
  }

  const scoreBig = sc ? `<div class="fs-6 fw-semibold">${sc}</div>` : `<div class="text-body-secondary">—</div>`;

  return `
    <button class="btn text-start w-100 p-0 border-0 bg-transparent" data-match-id="${m.match_id}">
      <div class="card border-0 shadow-sm mb-2">
        <div class="card-body d-flex justify-content-between align-items-start gap-3">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 mb-1">
              <span class="badge ${roundObj.stage === "playoff" ? "text-bg-warning" : "text-bg-primary"}">${roundLabel(roundObj)}</span>
              <span class="badge ${badge.cls}">${badge.text}</span>
            </div>
            <div class="fw-semibold">${title}</div>
            ${meta}
          </div>
          <div class="text-end" style="min-width: 140px;">
            ${scoreBig}
            <div class="small text-body-secondary">${m.round_name}</div>
          </div>
        </div>
      </div>
    </button>
  `;
}

function renderRound(roundObj, rounds) {
  const resMap = buildResultMap();
  const now = new Date();
  const s = new Date(roundObj.start_date);
  const e = new Date(roundObj.end_date);
  e.setHours(23,59,59,999);
  const isCurrent = now >= s && now <= e;

  const byeTeam = getRoundBye(roundObj.round);

  const byeHtml = byeTeam
    ? `<div class="alert alert-info py-2 mb-2"><b>Descansa:</b> ${byeTeam}</div>`
    : "";

  const matchesHtml = roundObj.matches.map(m => {
    const r = resMap.get(m.match_id);
    const outcome = (m.home_team_id && m.away_team_id)
      ? computeMatchOutcome(m, r, state.config)
      : null;
    return buildMatchCardHtml(m, r, outcome, roundObj);
  }).join("");

  renderRoundDetail({
    roundObj,
    roundBadgeClass: roundBadgeClass(roundObj),
    dateRangeText: roundObj.dateRange,
    byeHtml,
    matchesHtml,
    isCurrent
  });

  // click handlers (abrir modal)
  document.querySelectorAll("#roundDetailMatches [data-match-id]").forEach(btn => {
    btn.addEventListener("click", () => openMatch(btn.dataset.matchId, roundObj));
  });
}

function openMatch(matchId, roundObjHint) {
  const m = state.matches.find(x => x.match_id === matchId);
  const r = buildResultMap().get(matchId);

  const title = matchTitle(m);
  const sc = scoreLine(r) || "Sin resultado";
  const status = (r?.status || "scheduled").toLowerCase();

  const outcome = (m.home_team_id && m.away_team_id)
    ? computeMatchOutcome(m, r, state.config)
    : null;

  const roundObj = roundObjHint || null;

  const extra = outcome ? `
    <hr/>
    <div class="row g-2">
      <div class="col-6"><div class="small text-body-secondary">Sets</div><div class="fw-semibold">${outcome.homeSets} - ${outcome.awaySets}</div></div>
      <div class="col-6"><div class="small text-body-secondary">Juegos</div><div class="fw-semibold">${outcome.homeGames} - ${outcome.awayGames}</div></div>
    </div>
  ` : "";

  openMatchModal(title, `
    <div class="d-flex justify-content-between align-items-start">
      <div>
        <div class="text-body-secondary small">ID: <code>${matchId}</code></div>
        <div class="mt-2"><b>Resultado:</b> ${sc}</div>
        <div class="mt-1"><b>Status:</b> <code>${status}</code></div>
      </div>
      <div class="text-end">
        <div class="small text-body-secondary">${m.round_name}</div>
        <div class="small text-body-secondary">${fmtDateRange(m.start_date, m.end_date)}</div>
      </div>
    </div>
    ${extra}
  `);
}

/* -----------------------------
   Calendario global: meses con colores por jornada
----------------------------- */
function monthStart(year, monthIndex) {
  return new Date(year, monthIndex, 1);
}
function monthEnd(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}
function ymd(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
}
function isBetween(date, start, end) {
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function buildRoundByDateIndex(rounds) {
  // Map yyy-mm-dd -> roundObj (si cae dentro del rango de la jornada)
  // (es eficiente: solo 6 meses * ~31 días)
  const map = new Map();
  for (const r of rounds) {
    const s = new Date(r.start_date);
    const e = new Date(r.end_date);
    e.setHours(23,59,59,999);

    const cur = new Date(s);
    while (cur <= e) {
      map.set(ymd(cur), r);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

function renderCalendarJanToJun(rounds) {
  const containerId = "calendar"; // reutilizamos tu div existente
  const year = 2026;

  // elegimos meses enero..junio
  const months = [0,1,2,3,4,5];

  const roundByDate = buildRoundByDateIndex(rounds);

  // Leyenda de jornadas (J1..)
  const legend = rounds
    .filter(r => new Date(r.start_date).getFullYear() === 2026) // todo está en 2026
    .map(r => `
      <button class="btn btn-sm border ${roundPillClass(r)}"
              data-jump-round="${r.round}"
              title="${r.round_name} · ${r.dateRange}">
        <span class="fw-semibold">${roundLabel(r)}</span>
      </button>
    `).join("");

  const dow = ["L","M","X","J","V","S","D"];

  const monthCardsHtml = months.map(mi => {
    const ms = monthStart(year, mi);
    const me = monthEnd(year, mi);

    // Queremos semanas empezando en Lunes.
    const first = new Date(ms);
    const day = (first.getDay() + 6) % 7; // 0=Mon ... 6=Sun
    first.setDate(first.getDate() - day);

    const last = new Date(me);
    const lastDay = (last.getDay() + 6) % 7;
    last.setDate(last.getDate() + (6 - lastDay));

    // construir celdas (semanas)
    const cells = [];
    const cur = new Date(first);
    while (cur <= last) {
      const inMonth = cur.getMonth() === mi;
      const key = ymd(cur);
      const r = roundByDate.get(key);

      const cellCls = [
        "cal-cell",
        inMonth ? "" : "text-body-tertiary",
        r ? "cal-round" : "",
        r ? roundPillClass(r) : "",
      ].join(" ").trim();

      const label = r ? roundLabel(r) : "";
      const tag = r ? `<div class="cal-tag">${label}</div>` : "";

      cells.push(`
        <div class="${cellCls}"
             ${r ? `data-jump-round="${r.round}"` : ""}>
          <div class="cal-day">${cur.getDate()}</div>
          ${tag}
        </div>
      `);

      cur.setDate(cur.getDate() + 1);
    }

    const monthName = ms.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

    return `
      <div class="col-12 col-md-6 col-lg-4">
        <div class="card shadow-sm border-0">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="fw-semibold text-capitalize">${monthName}</div>
              <div class="small text-body-secondary">Jornadas</div>
            </div>

            <div class="cal-grid">
              ${dow.map(d => `<div class="cal-dow">${d}</div>`).join("")}
              ${cells.join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  renderGlobalCalendar({
    containerId,
    months,
    roundsLegendHtml: legend,
    monthCardsHtml
  });

  // clicks en celdas / leyenda → ir a jornada
  document.querySelectorAll(`[data-jump-round]`).forEach(el => {
    el.addEventListener("click", () => {
      const round = el.getAttribute("data-jump-round");
      setHashWithParams("rounds", { round });
    });
  });
}

/* -----------------------------
   Home (lo justo; mantiene tu idea)
----------------------------- */
function renderHome(rounds) {
  const today = new Date();
  const homeMeta = document.getElementById("homeRoundMeta");
  const badge = document.getElementById("homeRoundBadge");
  const homeMatches = document.getElementById("homeRoundMatches");
  const top4 = document.getElementById("homeTop4");
  const upcoming = document.getElementById("homeUpcoming");

  const cur = rounds.find(r => {
    const s = new Date(r.start_date);
    const e = new Date(r.end_date);
    e.setHours(23,59,59,999);
    return today >= s && today <= e;
  }) || rounds[0];

  if (cur) {
    homeMeta.textContent = `${cur.round_name} · ${cur.dateRange}`;
    badge.textContent = cur.stage === "playoff" ? "Playoff" : "Liga";
    badge.className = `badge ${roundBadgeClass(cur)}`;
    badge.classList.remove("d-none");

    const resMap = buildResultMap();

    homeMatches.innerHTML = `
      <div class="mt-2">
        ${cur.matches.map(m => {
          const r = resMap.get(m.match_id);
          const out = (m.home_team_id && m.away_team_id) ? computeMatchOutcome(m, r, state.config) : null;
          return buildMatchCardHtml(m, r, out, cur);
        }).join("")}
      </div>
      <div class="text-body-secondary small mt-2">
        Descansa: <b>${getRoundBye(cur.round) || "—"}</b>
      </div>
    `;

    homeMatches.querySelectorAll("[data-match-id]").forEach(btn => {
      btn.addEventListener("click", () => openMatch(btn.dataset.matchId, cur));
    });
  }

  const top = state.standings.slice(0, 4);
  top4.innerHTML = `
    <table class="table table-sm mb-0">
      <thead class="table-light"><tr><th>#</th><th>Equipo</th><th>Puntos</th></tr></thead>
      <tbody>
        ${top.map(r => `<tr><td class="fw-semibold">${r.rank}</td><td>${r.team_name}</td><td class="fw-semibold">${r.points}</td></tr>`).join("")}
      </tbody>
    </table>
  `;

  // Próximos: primer puñado pendientes
  const resMap = buildResultMap();
  const pending = state.matches
    .filter(m => m.stage === "regular")
    .map(m => ({ m, r: resMap.get(m.match_id) }))
    .filter(x => {
      const st = (x.r?.status || "").toLowerCase();
      const hasScore = !!scoreLine(x.r);
      return !(st === "played" || st === "draw" || st.startsWith("wo_") || hasScore);
    })
    .slice(0, 6);

  upcoming.innerHTML = pending.length ? `
    <ul class="mb-0">
      ${pending.map(x => `<li>${x.m.round_name}: ${matchTitle(x.m)}</li>`).join("")}
    </ul>
  ` : `<div class="text-body-secondary">No hay partidos pendientes.</div>`;
}

/* -----------------------------
   Render principal + routing
----------------------------- */
function hookRounds(rounds) {
  renderRoundList(
    rounds,
    (r) => roundBadgeClass(r),
    (r) => r.dateRange
  );

  document.getElementById("roundList").querySelectorAll("[data-round]").forEach(btn => {
    btn.addEventListener("click", () => {
      const round = btn.dataset.round;
      setHashWithParams("rounds", { round });
    });
  });
}

function selectRoundFromHash(rounds) {
  const params = getHashParams();
  const r = params.get("round");
  const roundNum = r ? Number(r) : null;

  if (roundNum) {
    const ro = rounds.find(x => x.round === roundNum);
    if (ro) {
      markRoundActive(ro.round);
      renderRound(ro, rounds);
      return;
    }
  }

  // fallback: primera jornada
  if (rounds.length) {
    markRoundActive(rounds[0].round);
    renderRound(rounds[0], rounds);
  }
}

async function refresh() {
  clearAlert();
  try {
    const data = await loadAllSheets();
    state.config = data.config;
    state.teams = data.teams;
    state.matches = data.matches;
    state.byes = data.byes;
    state.results = data.results;

    state.teamMap = buildTeamMap(state.teams);
    state.standings = computeStandings(data);

    const rounds = normalizeRounds(state.matches);

    // Standings
    renderStandings("standingsTable", state.standings);

    // Home
    renderHome(rounds);

    // Jornadas
    hookRounds(rounds);

    // Calendario global enero–junio
    renderCalendarJanToJun(rounds);

    // Si estamos en rounds, aplica selección por hash
    if ((location.hash || "").startsWith("#rounds")) {
      selectRoundFromHash(rounds);
    } else {
      // deja una selección por defecto en el panel de jornadas para cuando entres
      selectRoundFromHash(rounds);
    }

    document.getElementById("lastUpdated").textContent =
      `Actualizado: ${new Date().toLocaleString("es-ES")}`;
  } catch (err) {
    console.error(err);
    showAlert("danger", `No se pudo cargar el Google Sheet. Revisa que esté “Publicado en la web”. Detalle: ${err.message}`);
  }
}

function onHashChange() {
  setActiveView(location.hash || "#home");
  // si saltas a rounds?round=X, renderiza esa jornada sin recargar datos
  // (si no hay datos aún, refresh() ya se encarga)
  if ((location.hash || "").startsWith("#rounds") && state.matches.length) {
    const rounds = normalizeRounds(state.matches);
    selectRoundFromHash(rounds);
  }
}

window.addEventListener("hashchange", onHashChange);

document.getElementById("btnRefresh").addEventListener("click", refresh);

// boot
onHashChange();
refresh();

