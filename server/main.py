from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import gspread


# ---------- Config ----------
ROOT = Path(__file__).resolve().parents[1]  # repo root
load_dotenv(ROOT / ".env")

SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "").strip()
GID_RESULTS = int(os.getenv("GID_RESULTS", "0").strip() or "0")
SA_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "secrets/service_account.json").strip()

if not SPREADSHEET_ID:
    raise RuntimeError("Missing SPREADSHEET_ID in .env")
if GID_RESULTS <= 0:
    raise RuntimeError("Missing/invalid GID_RESULTS in .env")

SA_PATH = (ROOT / SA_JSON).resolve()
if not SA_PATH.exists():
    raise RuntimeError(f"Service account json not found: {SA_PATH}")


# ---------- Google Sheets client ----------
_gc = gspread.service_account(filename=str(SA_PATH))
_sh = _gc.open_by_key(SPREADSHEET_ID)

# gspread supports get_worksheet_by_id in v6
_results_ws = _sh.get_worksheet_by_id(GID_RESULTS)
if _results_ws is None:
    raise RuntimeError(f"Worksheet with gid={GID_RESULTS} not found (results).")

# Cache match_id -> row index (1-based)
_match_row_cache: Dict[str, int] = {}
_cache_ts: float = 0.0
_CACHE_TTL = 30.0  # seconds


def _refresh_cache_if_needed(force: bool = False) -> None:
    global _cache_ts, _match_row_cache
    now = time.time()
    if (not force) and (now - _cache_ts) < _CACHE_TTL and _match_row_cache:
        return

    # Column A is match_id; first row is header
    col = _results_ws.col_values(1)  # includes header in row 1
    mapping: Dict[str, int] = {}
    for idx, val in enumerate(col, start=1):
        if idx == 1:
            continue
        v = (val or "").strip()
        if v:
            mapping[v] = idx
    _match_row_cache = mapping
    _cache_ts = now


def _ensure_header() -> None:
    # Ensure results sheet has the expected header
    header = _results_ws.row_values(1)
    expected = [
        "match_id",
        "status",
        "played_date",
        "s1_home_games",
        "s1_away_games",
        "s2_home_games",
        "s2_away_games",
        "s3_home_games",
        "s3_away_games",
        "notes",
    ]
    if [h.strip() for h in header] != expected:
        # If empty or different, overwrite first row
        _results_ws.update(range_name="A1:J1", values=[expected])


# ---------- API models ----------
class ResultPayload(BaseModel):
    status: str = Field(default="", description="scheduled|played|draw|wo_home|wo_away|postponed|...")
    played_date: str = Field(default="", description="YYYY-MM-DD optional")
    s1_home_games: Optional[int] = None
    s1_away_games: Optional[int] = None
    s2_home_games: Optional[int] = None
    s2_away_games: Optional[int] = None
    s3_home_games: Optional[int] = None
    s3_away_games: Optional[int] = None
    notes: str = Field(default="", description="free text")

    def normalize_for_write(self) -> Dict[str, str]:
        st = (self.status or "").strip().lower()

        # WO rule requested: (0,0) and 0 points both; we also blank all scores
        if st in ("wo_home", "wo_away"):
            return {
                "status": st,
                "played_date": self.played_date.strip(),
                "s1_home_games": "",
                "s1_away_games": "",
                "s2_home_games": "",
                "s2_away_games": "",
                "s3_home_games": "",
                "s3_away_games": "",
                "notes": (self.notes or "").strip(),
            }

        def n(x: Optional[int]) -> str:
            return "" if x is None else str(int(x))

        return {
            "status": st,
            "played_date": self.played_date.strip(),
            "s1_home_games": n(self.s1_home_games),
            "s1_away_games": n(self.s1_away_games),
            "s2_home_games": n(self.s2_home_games),
            "s2_away_games": n(self.s2_away_games),
            "s3_home_games": n(self.s3_home_games),
            "s3_away_games": n(self.s3_away_games),
            "notes": (self.notes or "").strip(),
        }


# ---------- FastAPI ----------
app = FastAPI(title="TNP Pádel 2026 Admin (local)")

# Serve static assets
app.mount("/assets", StaticFiles(directory=str(ROOT / "assets")), name="assets")


@app.get("/", response_class=HTMLResponse)
def index() -> Any:
    return FileResponse(str(ROOT / "index.html"))


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True}


@app.get("/api/admin/results/{match_id}")
def get_result(match_id: str) -> Dict[str, Any]:
    _ensure_header()
    _refresh_cache_if_needed()

    match_id = match_id.strip()
    row = _match_row_cache.get(match_id)
    if not row:
        return {"match_id": match_id, "exists": False}

    values = _results_ws.row_values(row)
    # Pad to 10 cols
    values += [""] * (10 - len(values))
    keys = ["match_id","status","played_date","s1_home_games","s1_away_games","s2_home_games","s2_away_games","s3_home_games","s3_away_games","notes"]
    return {"match_id": match_id, "exists": True, "row": row, "data": dict(zip(keys, values[:10]))}


@app.post("/api/admin/result/{match_id}")
def upsert_result(match_id: str, payload: ResultPayload) -> Dict[str, Any]:
    """
    Upsert by match_id in column A.
    If match_id exists, update that row.
    Else, append a new row.
    """
    _ensure_header()
    _refresh_cache_if_needed()

    match_id = match_id.strip()
    if not match_id:
        raise HTTPException(status_code=400, detail="match_id is required")

    data = payload.normalize_for_write()
    row_values = [
        match_id,
        data["status"],
        data["played_date"],
        data["s1_home_games"],
        data["s1_away_games"],
        data["s2_home_games"],
        data["s2_away_games"],
        data["s3_home_games"],
        data["s3_away_games"],
        data["notes"],
    ]

    row = _match_row_cache.get(match_id)
    if row:
        # Update A..J for that row
        _results_ws.update(range_name=f"A{row}:J{row}", values=[row_values])
        action = "updated"
    else:
        _results_ws.append_row(row_values, value_input_option="USER_ENTERED")
        action = "appended"
        _refresh_cache_if_needed(force=True)

    return {"ok": True, "match_id": match_id, "action": action, "row_values": row_values}

