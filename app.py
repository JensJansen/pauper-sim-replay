"""Local web UI for this repo's game-review tooling: the replay viewer
(/, static/replay.html) -- pick a --log event-log JSON file from disk, or
browse whatever *.json files are already sitting under logs/ (any depth,
/api/replay/runs, local-only), and step through a logged game's board
state. The backend parses the raw log directly (replay_engine.py) -- no
intermediate replay file format, and no required filename or folder
convention: any JSON file under logs/ is a candidate, valid or not --
an invalid one just fails to load with a normal error, same as a bad file
picked by hand.

Local single-user tool: no auth, binds to localhost only. See README's
"Game replay viewer" section. Training runs are launched from the
pauper_sim repo (this repo is attached there as a git submodule at
src/webapp/) -- point run_league.py's --log at a path inside THIS repo's
own logs/ (e.g. --log ../../src/webapp/logs/<run>/event_log.json from
pauper_sim's src/) so a run lands somewhere this app can find it. This app
has no training-launch surface of its own; see app_public.py for the
publicly-hostable subset of this same viewer.

Run: python app.py   (from this directory -- paths are anchored to this
file, not to cwd).
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
    """Server-side log browser -- local-only (app_public.py has no equivalent,
    see its own docstring). Every *.json file under logs/ at any depth,
    newest first, named by its path relative to LOGS_DIR -- no fixed
    filename or folder convention required, just however a --log PATH (or
    a hand-copied file) ended up there. Cheap even for many/large files:
    only stats each one, never opens it -- an invalid log is caught later,
    when actually opened, the same way a bad file picked by hand already
    is."""
    runs = []
    for event_path in LOGS_DIR.rglob("*.json"):
        stat = event_path.stat()
        name = event_path.relative_to(LOGS_DIR).as_posix()
        runs.append({"name": name, "mtime": stat.st_mtime, "size_kb": stat.st_size / 1024})
    runs.sort(key=lambda r: r["mtime"], reverse=True)
    return jsonify(runs)


@app.get("/api/replay/runs/<path:name>/raw")
def replay_run_raw(name):
    # <path:name> allows "/" (any nesting depth) so a ".." segment must be
    # rejected explicitly here -- resolve() collapses it, then confirm the
    # result actually landed inside LOGS_DIR rather than escaping it.
    path = (LOGS_DIR / name).resolve()
    if LOGS_DIR.resolve() not in path.parents or not path.is_file():
        return jsonify({"error": "not found"}), 404
    return send_from_directory(path.parent, path.name)


@app.post("/api/replay/games")
def replay_games():
    """Body: {"content": <raw log JSON text, read client-side from a user-picked
    file>}. Returns the game index for that file (label + event count per
    game) without reducing any board state -- cheap even for a multi-
    thousand-game round-robin --eval log."""
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
