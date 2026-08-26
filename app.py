"""Local Flask app: "/" is a landing page (static/index.html) linking to the
two tools below. Local-only: no auth, binds to localhost. See app_public.py
for the publicly-hostable equivalent -- same routes, identical except for
which logs/ it can see (this machine's vs. whatever's committed).

- "/replay" -- the game-log replay viewer (static/replay.html) and an API to
  browse logs/ and reduce a logged game's events into board-state snapshots
  (replay_engine.py).
- "/stats" -- static/stats.html, a validation-metrics dashboard reading
  logs/validation/. That's a manually-refreshed COPY of the parent
  pauper_sim repo's checkpoints/<league>/ (metrics.jsonl, progress.json, and
  every checks/*.json -- never the multi-GB live/archive/mulligan .pt
  weights), made because checkpoints/ itself is gitignored at the pauper_sim
  root and this submodule has no other way to ship real data with itself.
  TODO(validation autologging): have src/validation/_common.py write here
  directly (or a sync step call it after each run) instead of this being a
  manual copy -- see logs/validation/README.md.

Run: python app.py (paths are anchored to this file, not to cwd).
"""
import json
import re
from collections import defaultdict
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from replay_engine import list_games, reduce_game

LOGS_DIR = Path(__file__).resolve().parent / "logs"
VALIDATION_DIR = LOGS_DIR / "validation"
CHECK_FILE_RE = re.compile(r"(.+)_(\d+)games\.json$")

app = Flask(__name__, static_folder="static", static_url_path="")


@app.get("/")
def home_page():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/replay")
def replay_page():
    return send_from_directory(app.static_folder, "replay.html")


@app.get("/stats")
def stats_page():
    return send_from_directory(app.static_folder, "stats.html")


@app.get("/api/replay/runs")
def replay_runs():
    """List every *.json file under logs/ (any depth), newest first, named by
    path relative to LOGS_DIR. Only stats each file, never opens it."""
    runs = []
    for event_path in LOGS_DIR.rglob("*.json"):
        stat = event_path.stat()
        name = event_path.relative_to(LOGS_DIR).as_posix()
        runs.append({"name": name, "mtime": stat.st_mtime, "size_kb": stat.st_size / 1024})
    runs.sort(key=lambda r: r["mtime"], reverse=True)
    return jsonify(runs)


@app.get("/api/replay/runs/<path:name>/raw")
def replay_run_raw(name):
    # Reject a ".." escape: resolve() collapses it, then check the result
    # is still inside LOGS_DIR.
    path = (LOGS_DIR / name).resolve()
    if LOGS_DIR.resolve() not in path.parents or not path.is_file():
        return jsonify({"error": "not found"}), 404
    return send_from_directory(path.parent, path.name)


@app.post("/api/replay/games")
def replay_games():
    """Body: {"content": <raw log JSON text>}. Returns the game index (label +
    event count per game) without reducing any board state."""
    body = request.get_json(force=True)
    try:
        doc = json.loads(body["content"])
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        return jsonify({"error": f"couldn't parse log file: {exc}"}), 400
    return jsonify(list_games(doc))


@app.post("/api/replay/game")
def replay_game():
    """Body: {"content": <same raw log JSON text>, "game_index": N}. Returns
    one board-state snapshot per event in that game."""
    body = request.get_json(force=True)
    try:
        doc = json.loads(body["content"])
        result = reduce_game(doc, int(body["game_index"]))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result)


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
    """Every logs/validation/<league>/ with a metrics.jsonl, newest-modified first."""
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
    leagues.sort(key=lambda l: l["mtime"], reverse=True)
    return jsonify(leagues)


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
    """Every checks/*.json under the league dir (league-level and per-deck),
    as {check, deck, cumulative_games, path} so the frontend can list
    available snapshots without guessing filenames."""
    league_dir = _league_dir(league)
    if league_dir is None:
        return jsonify({"error": "not found"}), 404
    checks = []
    for check_path in league_dir.rglob("*.json"):
        if check_path.parent.name != "checks":
            continue
        m = CHECK_FILE_RE.match(check_path.name)
        if not m:
            continue
        rel = check_path.relative_to(league_dir)
        deck = rel.parts[0] if len(rel.parts) > 2 else None
        checks.append({
            "check": m.group(1),
            "deck": deck,
            "cumulative_games": int(m.group(2)),
            "path": rel.as_posix(),
        })
    checks.sort(key=lambda c: c["cumulative_games"])
    return jsonify(checks)


@app.get("/api/stats/leagues/<league>/checks/<path:rel_path>")
def stats_check_detail(league, rel_path):
    """Raw contents of one checks/*.json file listed by stats_checks above."""
    league_dir = _league_dir(league)
    if league_dir is None:
        return jsonify({"error": "not found"}), 404
    path = (league_dir / rel_path).resolve()
    if league_dir not in path.parents or not path.is_file():
        return jsonify({"error": "not found"}), 404
    return send_from_directory(path.parent, path.name)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True)
