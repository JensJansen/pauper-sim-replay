"""Public-hostable subset of app.py: the /replay log viewer.

app.py itself has no training-launch surface either (training runs are
launched from the pauper_sim repo directly, this repo's own submodule
parent -- CLI or the `/train` skill, never through this app). This file
now also serves app.py's server-side log browser (/api/replay/runs*,
LOGS_DIR-backed) -- the "local machine's own files" privacy concern that
used to rule it out here doesn't apply to a deployed instance: LOGS_DIR
only ever holds whatever got committed to THIS repo, and this repo is
already public, so listing it exposes nothing that isn't already visible
on GitHub. Hosting it needs only requirements-public.txt. See app.py's
module docstring for the full local tool and its own /api/replay/runs*
docstrings (identical here). Deploy entrypoint for Render/Fly/etc:
gunicorn app_public:app (see render.yaml).
"""
import json
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from replay_engine import list_games, reduce_game

LOGS_DIR = Path(__file__).resolve().parent / "logs"

app = Flask(__name__, static_folder="static", static_url_path="")


@app.get("/")
def replay_page():
    return send_from_directory(app.static_folder, "replay.html")


@app.get("/api/replay/runs")
def replay_runs():
    runs = []
    for event_path in LOGS_DIR.rglob("*.json"):
        stat = event_path.stat()
        name = event_path.relative_to(LOGS_DIR).as_posix()
        runs.append({"name": name, "mtime": stat.st_mtime, "size_kb": stat.st_size / 1024})
    runs.sort(key=lambda r: r["mtime"], reverse=True)
    return jsonify(runs)


@app.get("/api/replay/runs/<path:name>/raw")
def replay_run_raw(name):
    path = (LOGS_DIR / name).resolve()
    if LOGS_DIR.resolve() not in path.parents or not path.is_file():
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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True)
