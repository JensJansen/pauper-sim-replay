"""Public-hostable subset of app.py: same routes (landing page, "/replay",
"/stats", "/methodology" and their APIs), identical except for which logs/
it can see (this already-public repo's own committed logs/, vs. whatever's
on the local machine running app.py). Deploy entrypoint for Render/Fly/etc:
gunicorn app_public:app (render.yaml).
"""
import json
from collections import defaultdict
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from replay_engine import list_games, reduce_game
from compress import init_gzip
from replay_listing import list_replay_runs, resolve_run, run_game, run_games
from stats_checks import CHECK_FILE_RE, iter_check_snapshots, read_consolidated_record

WEBAPP_LOGS_DIR = Path(__file__).resolve().parent / "logs"
REPLAY_LOGS_DIR = WEBAPP_LOGS_DIR / "replays"
VALIDATION_DIR = WEBAPP_LOGS_DIR / "validation"

app = Flask(__name__, static_folder="static", static_url_path="")
init_gzip(app)  # gzip JSON responses (stdlib) -- see compress.py


@app.get("/")
def home_page():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/replay")
def replay_page():
    return send_from_directory(app.static_folder, "replay.html")


@app.get("/stats")
def stats_page():
    return send_from_directory(app.static_folder, "stats.html")


@app.get("/methodology")
def methodology_page():
    return send_from_directory(app.static_folder, "methodology.html")


@app.get("/api/replay/runs")
def replay_runs():
    """Every *.json under logs/replays/ (any depth) as {name, league, cumulative_games,
    mtime, size_kb}, grouped by league (by name) and newest game count first --
    see replay_listing.py. Scoped to replays/ specifically (not all of logs/) so a
    validation checks/*.json never shows up here as if it were a game log."""
    return jsonify(list_replay_runs(REPLAY_LOGS_DIR))


@app.get("/api/replay/runs/<path:name>/raw")
def replay_run_raw(name):
    path = (REPLAY_LOGS_DIR / name).resolve()
    if REPLAY_LOGS_DIR.resolve() not in path.parents or not path.is_file():
        return jsonify({"error": "not found"}), 404
    return send_from_directory(path.parent, path.name)


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


@app.post("/api/replay/games")
def replay_games():
    body = request.get_json(force=True)
    try:
        doc = json.loads(body["content"])
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        return jsonify({"error": f"couldn't parse log file: {exc}"}), 400
    return jsonify(list_games(doc))


@app.post("/api/replay/game")
def replay_game():
    body = request.get_json(force=True)
    try:
        doc = json.loads(body["content"])
        result = reduce_game(doc, int(body["game_index"]))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result)


def _league_dir(name):
    path = (VALIDATION_DIR / name).resolve()
    if VALIDATION_DIR.resolve() not in path.parents or not path.is_dir():
        return None
    return path


@app.get("/api/stats/leagues")
def stats_leagues():
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
    # No league is special: most recently written first (what /stats opens on), ties by name
    leagues.sort(key=lambda l: (-l["mtime"], l["name"]))
    return jsonify(leagues)


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
