"""Local Flask app for the replay viewer: serves static/replay.html and an
API to browse logs/ and reduce a logged game's events into board-state
snapshots (replay_engine.py). Local-only: no auth, binds to localhost.
See app_public.py for the publicly-hostable subset.

Run: python app.py (paths are anchored to this file, not to cwd).
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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True)
