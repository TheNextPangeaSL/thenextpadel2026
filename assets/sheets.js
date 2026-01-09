// assets/sheets.js
export const SHEET_ID = "1kMToTxPnOahAkYUJ2kguAxd0ChakGHDhr-EnMt0iSN4";

export const GIDS = {
  config: "2009863847",
  teams: "1306236857",
  matches: "1484818845",
  byes: "156181309",
  results: "166411685"
};

// CSV export (gviz) — requiere sheet publicado
export function sheetCsvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

export async function fetchCsv(gid) {
  const url = sheetCsvUrl(gid);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV fetch failed (${res.status}) for gid=${gid}`);
  const text = await res.text();
  return parseCsv(text);
}

// CSV parser simple (soporta comillas)
export function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      cur = "";
      // ignore empty trailing lines
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  if (row.some(cell => cell !== "")) rows.push(row);

  if (rows.length === 0) return [];

  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (r[idx] ?? "").trim());
    return obj;
  });
}

export async function loadAllSheets() {
  const [configRows, teams, matches, byes, results] = await Promise.all([
    fetchCsv(GIDS.config),
    fetchCsv(GIDS.teams),
    fetchCsv(GIDS.matches),
    fetchCsv(GIDS.byes),
    fetchCsv(GIDS.results),
  ]);

  const config = Object.fromEntries(configRows.map(r => [r.key, r.value]));
  return { config, teams, matches, byes, results };
}
