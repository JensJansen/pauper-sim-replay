"""Local Flask app: the React frontend (frontend/, built to frontend/dist -- see frontend.py) at "/", and the
JSON API it reads under /api. Local-only: no auth, binds to localhost. See app_public.py for the publicly-hostable
equivalent -- same routes, identical except for which logs/ it can see (this machine's vs. whatever's committed).

The frontend's pages are client-side routes (/, /replay, /stats/<tab>, /methodology); the API behind them:
- /api/replay/... -- browse logs/replays/ (event-log JSON written by training's round_robin_review check) and read
  one logged game at a time, reduced into per-event board-state snapshots (replay_listing.py / replay_engine.py /
  replay_index.py). Only already-written files under logs/replays/ are readable, never anything outside it.
- /api/stats/... -- reads logs/validation/: a COPY of the parent pauper_sim repo's checkpoints/<league>/
  (metrics.jsonl, progress.json, manifest.json, opponent_stats.json and every checks/*.jsonl -- never the multi-GB
  live/archive/mulligan .pt weights, and never a check's embedded "games" key either -- see validation/_common.py
  write_league_json's own docstring), kept current automatically: src/validation/_common.py and
  rl/league/league_runner.py (both in the parent repo) mirror every write here as they make it, best-effort,
  whenever this submodule is checked out -- see webapp_publish/mirror.py there and logs/validation/README.md here.
  Made because checkpoints/ itself is gitignored at the pauper_sim root and this submodule has no other way to
  ship real data with itself. /api/stats/compare serves the published head-to-head results in
  logs/validation/compare/.

Run: python app.py (paths are anchored to this file, not to cwd), after `npm ci && npm run build` in frontend/.
"""
import json
from collections import defaultdict
from pathlib import Path

from flask import Flask, jsonify

from compress import init_gzip
from frontend import init_frontend
from replay_listing import list_replay_runs, resolve_run, run_game, run_games
from stats_checks import CHECK_FILE_RE, iter_check_snapshots, list_compare, read_consolidated_record

WEBAPP_LOGS_DIR = Path(__file__).resolve().parent / "logs"
REPLAY_LOGS_DIR = WEBAPP_LOGS_DIR / "replays"
VALIDATION_DIR = WEBAPP_LOGS_DIR / "validation"

app = Flask(__name__, static_folder=None)  # the frontend is served by init_frontend, not Flask's static route
init_gzip(app)  # gzip JSON and text responses (stdlib) -- see compress.py
init_frontend(app)  # the built React app at "/" -- see frontend.py


@app.get("/api/replay/runs")
def replay_runs():
    """Every *.json under logs/replays/ (any depth) as {name, league, cumulative_games,
    mtime, size_kb}, grouped by league (by name) and newest game count first --
    see replay_listing.py. Scoped to replays/ specifically (not all of logs/) so a
    validation checks/*.json never shows up here as if it were a game log."""
    return jsonify(list_replay_runs(REPLAY_LOGS_DIR))


@app.get("/api/replay/runs/<path:name>/games")
def replay_run_games(name):
    """Game list for a server-side replay, from its index -- no file download/upload."""
    path = resolve_run(REPLAY_LOGS_DIR, name)
    if path is None:
        return jsonify({"error": "not found"}), 404
    try:
        return jsonify(run_games(path))
    except (ValueError, UnicodeDecodeError) as exc:
        return jsonify({"error": f"couldn't parse log file: {exc}"}), 400


@app.get("/api/replay/runs/<path:name>/games/<int:game_index>")
def replay_run_game(name, game_index):
    """One reduced game of a server-side replay, reading only that game's bytes."""
    path = resolve_run(REPLAY_LOGS_DIR, name)
    if path is None:
        return jsonify({"error": "not found"}), 404
    try:
        return jsonify(run_game(path, game_index))
    except (ValueError, UnicodeDecodeError) as exc:
        return jsonify({"error": str(exc)}), 400


def _league_dir(name):
    """logs/validation/<name>, resolved and checked against a ".." escape
    same as replay_run_raw above. None if it doesn't exist or escapes
    VALIDATION_DIR."""
    path = (VALIDATION_DIR / name).resolve()
    if VALIDATION_DIR.resolve() not in path.parents or not path.is_dir():
        return None
    return path


@app.get("/api/stats/leagues")
def stats_leagues():
    """Every logs/validation/<league>/ with a metrics.jsonl, most recently written first."""
    leagues = []
    if VALIDATION_DIR.is_dir():
        for league_dir in VALIDATION_DIR.iterdir():
            metrics_path = league_dir / "metrics.jsonl"
            if not metrics_path.is_file():
                continue
            progress_path = league_dir / "progress.json"
            progress = json.loads(progress_path.read_text()) if progress_path.is_file() else {}
            leagues.append({
                "name": league_dir.name,
                "mtime": metrics_path.stat().st_mtime,
                "cumulative_games_per_deck": progress.get("cumulative_games_per_deck"),
            })
    # No league is special: most recently written first (what the stats page opens on), ties by name
    leagues.sort(key=lambda l: (-l["mtime"], l["name"]))
    return jsonify(leagues)


@app.get("/api/stats/compare")
def stats_compare():
    """Published head-to-head results between training arms (logs/validation/compare/*.json -- see
    stats_checks.list_compare); [] when none have been published."""
    return jsonify(list_compare(VALIDATION_DIR))


@app.get("/api/stats/leagues/<league>/manifest")
def stats_manifest(league):
    """The run manifest (config, model architecture, code state, sessions -- rl/league/manifest.py in the parent
    repo), or null for a league with none (runs from before manifests existed)."""
    league_dir = _league_dir(league)
    if league_dir is None:
        return jsonify({"error": "not found"}), 404
    path = league_dir / "manifest.json"
    return jsonify(json.loads(path.read_text()) if path.is_file() else None)


@app.get("/api/stats/leagues/<league>/opponents")
def stats_opponents(league):
    """PFSP tallies, {training_deck: {"deck:<name>" | "snapshot:<name>:<id>": [wins, games]}} (rl/league/league.py
    in the parent repo; cumulative over the whole run), or null for a league with none."""
    league_dir = _league_dir(league)
    if league_dir is None:
        return jsonify({"error": "not found"}), 404
    path = league_dir / "opponent_stats.json"
    return jsonify(json.loads(path.read_text()) if path.is_file() else None)


@app.get("/api/stats/leagues/<league>/metrics")
def stats_metrics(league):
    """metrics.jsonl grouped by its `kind` field, each group sorted by
    cumulative_games. One compact record per PPO update / mulligan-net update
    / validation check result -- see src/validation/_common.py and
    rl/league/league_runner.py for what each `kind` contains."""
    league_dir = _league_dir(league)
    if league_dir is None:
        return jsonify({"error": "not found"}), 404
    grouped = defaultdict(list)
    metrics_path = league_dir / "metrics.jsonl"
    if metrics_path.is_file():
        with open(metrics_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                grouped[record.get("kind", "unknown")].append(record)
    for records in grouped.values():
        records.sort(key=lambda r: r.get("cumulative_games", 0))
    return jsonify(grouped)


@app.get("/api/stats/leagues/<league>/checks")
def stats_checks(league):
    """Every check snapshot under the league dir (league-level and
    per-deck), as {check, deck, cumulative_games, path} so the frontend
    can list available snapshots without guessing filenames."""
    league_dir = _league_dir(league)
    if league_dir is None:
        return jsonify({"error": "not found"}), 404
    checks = list(iter_check_snapshots(league_dir))
    checks.sort(key=lambda c: c["cumulative_games"])
    return jsonify(checks)


@app.get("/api/stats/leagues/<league>/checks/<path:rel_path>")
def stats_check_detail(league, rel_path):
    """Raw contents of one check snapshot, addressed by the virtual
    per-snapshot filename shape (checks/<check>_<N>games.json) -- what
    stats_checks above always emits as "path". Resolves it to the
    matching line in the sibling checks/<check>.jsonl."""
    league_dir = _league_dir(league)
    if league_dir is None:
        return jsonify({"error": "not found"}), 404
    path = (league_dir / rel_path).resolve()
    if league_dir not in path.parents:
        return jsonify({"error": "not found"}), 404

    m = CHECK_FILE_RE.match(path.name)
    if not m:
        return jsonify({"error": "not found"}), 404
    check, cumulative_games = m.group(1), int(m.group(2))
    record = read_consolidated_record(path.parent / f"{check}.jsonl", cumulative_games)
    if record is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(record)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True)
