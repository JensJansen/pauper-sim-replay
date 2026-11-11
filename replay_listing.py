"""Shared replay-run listing for app.py and app_public.py (same reason
stats_checks.py is shared: the two entrypoints carry identical routes).

Lists every *.json under logs/replays/ (any depth) as
{name, league, cumulative_games, mtime, size_kb}:
  - league: the first folder of the path (training writes
    `<league>/round_robin_review_<N>games.json`), None for a top-level file.
  - cumulative_games: N parsed from a `..._<N>games.json` filename, else None.
Ordering is by N, NOT file mtime -- a git checkout (e.g. Render's deploy) stamps
every file with the checkout time, so mtime can't say which replay is newest.
Leagues come in stats_checks.league_sort_key order (by name), newest N
first within a league; files with no league go last, newest mtime first.
Only stats each file, never opens it.
"""
import re

import replay_index
from replay_engine import list_games, reduce_game
from stats_checks import league_sort_key

_GAMES_RE = re.compile(r"(\d+)games\.json$")


def list_replay_runs(replay_logs_dir):
    runs = []
    for path in replay_logs_dir.rglob("*.json"):
        stat = path.stat()
        rel = path.relative_to(replay_logs_dir)
        m = _GAMES_RE.search(path.name)
        runs.append({"name": rel.as_posix(), "league": rel.parts[0] if len(rel.parts) > 1 else None,
                     "cumulative_games": int(m.group(1)) if m else None,
                     "mtime": stat.st_mtime, "size_kb": stat.st_size / 1024})

    def key(run):
        if run["league"] is None:
            return (1, (), 0, -run["mtime"])
        return (0, league_sort_key(run["league"]), 0, -(run["cumulative_games"] if run["cumulative_games"] is not None else -1))
    runs.sort(key=key)
    return runs


def resolve_run(replay_logs_dir, name):
    """The replay file for a `name` as listed by list_replay_runs, or None if it
    escapes replay_logs_dir, isn't a file, or isn't a .json."""
    path = (replay_logs_dir / name).resolve()
    if replay_logs_dir.resolve() not in path.parents or not path.is_file() or path.suffix != ".json":
        return None
    return path


def run_games(path):
    """list_games for a replay on disk, from its index alone -- reads no game data."""
    return list_games(replay_index.list_doc(replay_index.get_index(path)))


def run_game(path, game_index):
    """The reduced steps for one game of a replay on disk, reading only that
    game's bytes. ValueError if the game isn't in the replay."""
    index = replay_index.get_index(path)
    entry = next((g for g in index["games"] if g["game_index"] == game_index), None)
    if entry is None:
        raise ValueError(f"game index {game_index} not found in this log")
    return reduce_game({"games": [replay_index.read_game(path, entry)]}, game_index)
