// assets/standings.js
function toInt(x) {
  const n = parseInt(String(x || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function buildTeamMap(teams) {
  const map = new Map();
  for (const t of teams) map.set(t.team_id, t);
  return map;
}

export function computeMatchOutcome(match, resultRow, config) {
  // Returns { status, homeSets, awaySets, homeGames, awayGames, winner: "home"/"away"/null, isDraw, isPlayed }
  const status = (resultRow?.status || "").toLowerCase();

  const s1h = toInt(resultRow?.s1_home_games), s1a = toInt(resultRow?.s1_away_games);
  const s2h = toInt(resultRow?.s2_home_games), s2a = toInt(resultRow?.s2_away_games);
  const s3h = toInt(resultRow?.s3_home_games), s3a = toInt(resultRow?.s3_away_games);

  const sets = [
    [s1h, s1a],
    [s2h, s2a],
    [s3h, s3a],
  ].filter(([h,a]) => h !== null && a !== null);

  const hasScore = sets.length >= 1;
  const isDraw = status === "draw";
  const isWOHome = status === "wo_home";
  const isWOAway = status === "wo_away";

  if (isDraw) {
    // contamos lo que haya informado para desempates (si hay parcial)
    const { homeSets, awaySets, homeGames, awayGames } = countSetsGames(sets);
    return { status, homeSets, awaySets, homeGames, awayGames, winner: null, isDraw: true, isPlayed: true };
  }

  if (isWOHome || isWOAway) {
    // WO: (0,0) para ambos (según tu regla)
    return { status, homeSets: 0, awaySets: 0, homeGames: 0, awayGames: 0, winner: null, isDraw: false, isPlayed: true };
  }

  // Played: explicit played status OR any score present
  const isPlayed = status === "played" || hasScore;

  if (!isPlayed) {
    return { status: status || "scheduled", homeSets: 0, awaySets: 0, homeGames: 0, awayGames: 0, winner: null, isDraw: false, isPlayed: false };
  }

  const { homeSets, awaySets, homeGames, awayGames } = countSetsGames(sets);
  let winner = null;
  if (homeSets > awaySets) winner = "home";
  else if (awaySets > homeSets) winner = "away";
  else winner = null;

  return { status: status || "played", homeSets, awaySets, homeGames, awayGames, winner, isDraw: false, isPlayed: true };
}

function countSetsGames(sets) {
  let homeSets = 0, awaySets = 0, homeGames = 0, awayGames = 0;
  for (const [h, a] of sets) {
    homeGames += h; awayGames += a;
    if (h > a) homeSets++;
    else if (a > h) awaySets++;
  }
  return { homeSets, awaySets, homeGames, awayGames };
}

export function computeStandings({ config, teams, matches, results }) {
  const ptsWin = parseInt(config.points_win ?? "3", 10);
  const ptsDraw = parseInt(config.points_draw ?? "2", 10);
  const ptsLoss = parseInt(config.points_loss ?? "1", 10);
  const ptsUnplayed = parseInt(config.points_unplayed ?? "0", 10);

  const byMatchId = new Map(results.map(r => [r.match_id, r]));

  // stats table
  const table = new Map();
  for (const t of teams) {
    table.set(t.team_id, {
      team_id: t.team_id,
      team_name: t.team_name,
      PJ: 0, PG: 0, PE: 0, PP: 0,
      sets_for: 0, sets_against: 0,
      games_for: 0, games_against: 0,
      points: 0,
    });
  }
  const row = (id) => table.get(id);

  // for head-to-head: store outcomes between pairs
  // key = "A|B" with A < B, value = { A_wins, B_wins, draws }
  const h2h = new Map();
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  function addH2H(homeId, awayId, winner, isDraw) {
    const key = pairKey(homeId, awayId);
    if (!h2h.has(key)) h2h.set(key, { a: key.split("|")[0], b: key.split("|")[1], a_wins: 0, b_wins: 0, draws: 0 });
    const rec = h2h.get(key);

    if (isDraw || !winner) {
      rec.draws += 1;
      return;
    }
    // translate winner "home"/"away" into ids then into a/b
    const winId = (winner === "home") ? homeId : awayId;
    if (winId === rec.a) rec.a_wins += 1;
    else rec.b_wins += 1;
  }

  for (const m of matches) {
    if (!m.home_team_id || !m.away_team_id) continue; // playoffs placeholders no cuentan en liga

    const r = byMatchId.get(m.match_id);
    const outcome = computeMatchOutcome(m, r, config);

    const home = row(m.home_team_id);
    const away = row(m.away_team_id);
    if (!home || !away) continue;

    if (!outcome.isPlayed) continue;

    // WO cuenta como jugado pero 0 puntos ambos (según tu regla)
    const st = (outcome.status || "").toLowerCase();

    home.PJ++; away.PJ++;

    // sets/juegos: para WO quedan 0,0 (no afecta)
    home.sets_for += outcome.homeSets;
    home.sets_against += outcome.awaySets;
    away.sets_for += outcome.awaySets;
    away.sets_against += outcome.homeSets;

    home.games_for += outcome.homeGames;
    home.games_against += outcome.awayGames;
    away.games_for += outcome.awayGames;
    away.games_against += outcome.homeGames;

    // status-driven draw
    if (outcome.isDraw) {
      home.PE++; away.PE++;
      home.points += ptsDraw;
      away.points += ptsDraw;
      addH2H(m.home_team_id, m.away_team_id, null, true);
      continue;
    }

    if (st === "wo_home" || st === "wo_away") {
      // WO: 0 puntos ambos + nadie gana/pierde
      home.points += ptsUnplayed;
      away.points += ptsUnplayed;
      // no PG/PP/PE changes (si prefieres que cuente como PP, dímelo y lo cambiamos)
      addH2H(m.home_team_id, m.away_team_id, null, false);
      continue;
    }

    // normal played (or has score)
    if (outcome.winner === "home") {
      home.PG++; away.PP++;
      home.points += ptsWin;
      away.points += ptsLoss;
      addH2H(m.home_team_id, m.away_team_id, "home", false);
    } else if (outcome.winner === "away") {
      away.PG++; home.PP++;
      away.points += ptsWin;
      home.points += ptsLoss;
      addH2H(m.home_team_id, m.away_team_id, "away", false);
    } else {
      // equal sets but not draw -> treat as draw
      home.PE++; away.PE++;
      home.points += ptsDraw;
      away.points += ptsDraw;
      addH2H(m.home_team_id, m.away_team_id, null, true);
    }
  }

  let arr = Array.from(table.values()).map(r => ({
    ...r,
    set_diff: r.sets_for - r.sets_against,
    game_diff: r.games_for - r.games_against,
  }));

  // base sort keys (without head-to-head)
  arr.sort((a, b) =>
    (b.points - a.points) ||
    (b.PG - a.PG) ||
    (b.set_diff - a.set_diff) ||
    (b.game_diff - a.game_diff) ||
    a.team_name.localeCompare(b.team_name, "es")
  );

  // apply head-to-head ONLY for ties after the main criteria, and only for pairs
  arr = applyHeadToHeadForPairTies(arr, h2h);

  // rank
  arr.forEach((r, i) => r.rank = i + 1);
  return arr;
}

function applyHeadToHeadForPairTies(sortedArr, h2h) {
  // find groups tied on points/wins/set_diff/game_diff
  const keyOf = (r) => `${r.points}|${r.PG}|${r.set_diff}|${r.game_diff}`;

  const out = [...sortedArr];
  let i = 0;
  while (i < out.length) {
    let j = i + 1;
    while (j < out.length && keyOf(out[j]) === keyOf(out[i])) j++;

    const group = out.slice(i, j);
    if (group.length === 2) {
      const a = group[0], b = group[1];
      const key = (a.team_id < b.team_id) ? `${a.team_id}|${b.team_id}` : `${b.team_id}|${a.team_id}`;
      const rec = h2h.get(key);

      if (rec) {
        // if someone has more h2h wins, put them first
        const aWins = (a.team_id === rec.a) ? rec.a_wins : rec.b_wins;
        const bWins = (b.team_id === rec.a) ? rec.a_wins : rec.b_wins;

        if (aWins !== bWins) {
          const ordered = (aWins > bWins) ? [a, b] : [b, a];
          out.splice(i, 2, ...ordered);
        }
      }
    }
    i = j;
  }
  return out;
}
