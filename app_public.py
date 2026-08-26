"""Public-hostable subset of app.py: same routes (landing page, "/replay",
"/stats" and their APIs), identical except for which logs/ it can see (this
already-public repo's own committed logs/, vs. whatever's on the local
machine running app.py). Deploy entrypoint for Render/Fly/etc:
gunicorn app_public:app (render.yaml).
"""
import json
import re
from collections import defaultdict
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from replay_engine import list_games, reduce_game

WEBAPP_LOGS_DIR = Path(__file__).resolve().parent / "logs"
REPLAY_LOGS_DIR = WEBAPP_LOGS_DIR / "replays"
VALIDATION_DIR = WEBAPP_LOGS_DIR / "validation"
CHECK_FILE_RE = re.compile(r"(.+)_(\d+)games\.json$")  # virtual per-snapshot filename shape (see _iter_check_snapshots)
CUMULATIVE_GAMES_RE = re.compile(r'"cumulative_games":\s*(-?\d+)')  # cheap prefilter for jsonl listing

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
    runs = []
    for event_path in REPLAY_LOGS_DIR.rglob("*.json"):
        stat = event_path.stat()
        name = event_path.relative_to(REPLAY_LOGS_DIR).as_posix()
        runs.append({"name": name, "mtime": stat.st_mtime, "size_kb": stat.st_size / 1024})
    runs.sort(key=lambda r: r["mtime"], reverse=True)
    return jsonify(runs)


@app.get("/api/replay/runs/<path:name>/raw")
def replay_run_raw(name):
    path = (REPLAY_LOGS_DIR / name).resolve()
    if REPLAY_LOGS_DIR.resolve() not in path.parents or not path.is_file():
        return jsonify({"error": "not found"}), 404
    return send_from_directory(path.parent, path.name)


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
    leagues.sort(key=lambda l: l["mtime"], reverse=True)
    return jsonify(leagues)


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


def _iter_check_snapshots(league_dir):
    """Yields {check, deck, cumulative_games, path} for every check
    snapshot under league_dir -- one growing checks/<check>.jsonl per
    check (one line per cadence tick, see webapp_mirror.mirror_json).
    "path" is a virtual old-style per-snapshot filename
    (checks/<check>_<N>games.json), a stable per-snapshot identifier
    stats_check_detail resolves back to the matching .jsonl line -- kept
    as the API's addressing scheme even though no such file exists on
    disk."""
    for jsonl_path in league_dir.rglob("*.jsonl"):
        if jsonl_path.parent.name != "checks":
            continue
        check = jsonl_path.stem
        rel_dir = jsonl_path.parent.relative_to(league_dir)
        deck = rel_dir.parts[0] if len(rel_dir.parts) > 1 else None
        seen = set()
        with open(jsonl_path) as f:
            for line in f:
                m = CUMULATIVE_GAMES_RE.search(line)
                # A re-run at the same cadence point (crash + resume) can
                # append a second line for the same N -- list it once;
                # stats_check_detail's last-line-wins scan resolves which
                # write is authoritative when the detail is fetched.
                if not m or m.group(1) in seen:
                    continue
                seen.add(m.group(1))
                path = (rel_dir / f"{check}_{m.group(1)}games.json").as_posix()
                yield {"check": check, "deck": deck, "cumulative_games": int(m.group(1)), "path": path}


def _read_consolidated_record(jsonl_path, cumulative_games):
    """Last line in jsonl_path whose own "cumulative_games" field matches
    -- last, not first, so a cadence point replayed after a crash resolves
    to its freshest write. None if jsonl_path doesn't exist or no line
    matches. Tolerates a truncated trailing line (an interrupted append)
    by skipping any line that fails to parse."""
    if not jsonl_path.is_file():
        return None
    found = None
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("cumulative_games") == cumulative_games:
                found = record
    return found


@app.get("/api/stats/leagues/<league>/checks")
def stats_checks(league):
    """Every check snapshot under the league dir (league-level and
    per-deck), as {check, deck, cumulative_games, path} so the frontend
    can list available snapshots without guessing filenames."""
    league_dir = _league_dir(league)
    if league_dir is None:
        return jsonify({"error": "not found"}), 404
    checks = list(_iter_check_snapshots(league_dir))
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
    record = _read_consolidated_record(path.parent / f"{check}.jsonl", cumulative_games)
    if record is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(record)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True)
