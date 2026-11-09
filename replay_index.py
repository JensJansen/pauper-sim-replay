"""Per-replay game index: lets the server read ONE game out of a ~30 MB replay
file without parsing the whole thing.

A replay (`{"meta": {...}, "games": [{game}, ...]}`) is one big JSON document.
Parsing it per click costs ~400 ms and ~145 MB of Python objects; one game is
~200 KB. The index records each game's byte range plus what the game list needs
(game_index, deck_a, deck_b, event count), so listing games reads nothing from the
replay and opening one game reads just its bytes.

The index lives next to the replay as `<file>.gameindex` (JSON; a suffix that
`*.json` globs and the replay browser never list). It is built by the parent
repo's webapp_sync before each commit -- so it ships with the replay -- and lazily
here for any replay that lacks a valid one (hand-made files). It is stale, hence
rebuilt, when the replay's size no longer matches the recorded size.

Stdlib only and import-free of the rest of this repo: the parent repo loads this
file by path (importlib) to build indexes. Also a script:
    python replay_index.py <replay.json | directory> ...   # (re)builds sidecars
"""
import json
import os
import sys
import threading
from collections import OrderedDict
from pathlib import Path

SIDECAR_SUFFIX = ".gameindex"
INDEX_VERSION = 1
_WS = " \t\r\n"
_CACHE_MAX = 64
_cache = OrderedDict()          # (path, size) -> index
_build_lock = threading.Lock()  # one lazy build at a time: a build briefly holds the whole parsed file


def sidecar_path(path):
    return Path(str(path) + SIDECAR_SUFFIX)


def _skip_ws(text, i):
    while i < len(text) and text[i] in _WS:
        i += 1
    return i


def build_index(path):
    """Parses the replay once, walking the top-level object so each game's byte
    range is captured as it is decoded. Returns the index dict."""
    raw = Path(path).read_bytes()
    text = raw.decode("utf-8")
    ascii_only = len(text) == len(raw)
    decoder = json.JSONDecoder()
    state = {"c": 0, "b": 0}  # last char offset and its byte offset (offsets only increase)

    def to_byte(char_offset):
        if ascii_only:
            return char_offset
        state["b"] += len(text[state["c"]:char_offset].encode("utf-8"))
        state["c"] = char_offset
        return state["b"]

    i = _skip_ws(text, 0)
    if text[i:i + 1] != "{":
        raise ValueError("replay is not a JSON object")
    i += 1
    meta, games = None, []
    while True:
        i = _skip_ws(text, i)
        if text[i] == "}":
            break
        if text[i] == ",":
            i = _skip_ws(text, i + 1)
        key, i = decoder.raw_decode(text, i)
        i = _skip_ws(text, i)
        if text[i] != ":":
            raise ValueError("malformed replay JSON")
        i = _skip_ws(text, i + 1)
        if key == "games" and text[i] == "[":
            i += 1
            while True:
                i = _skip_ws(text, i)
                if text[i] == "]":
                    i += 1
                    break
                if text[i] == ",":
                    i = _skip_ws(text, i + 1)
                start = i
                game, i = decoder.raw_decode(text, i)
                games.append({
                    "game_index": game.get("game_index", len(games)),
                    "deck_a": game.get("deck_a"), "deck_b": game.get("deck_b"),
                    "n_events": len(game.get("events") or []),
                    "start": to_byte(start), "end": to_byte(i),
                })
        else:
            value, i = decoder.raw_decode(text, i)
            if key == "meta":
                meta = value
    return {"version": INDEX_VERSION, "size": len(raw), "meta": meta or {}, "games": games}


def write_sidecar(path):
    """Builds and atomically writes the sidecar. Returns the index."""
    index = build_index(path)
    target = sidecar_path(path)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, target)
    return index


def load_index(path):
    """The sidecar's index if it exists, parses and matches the replay's current
    size; else None."""
    try:
        index = json.loads(sidecar_path(path).read_text(encoding="utf-8"))
        if index.get("version") == INDEX_VERSION and index.get("size") == os.path.getsize(path):
            return index
    except (OSError, ValueError, AttributeError):
        pass
    return None


def get_index(path):
    """Index for a replay: memory cache -> sidecar -> lazy build (written back
    to a sidecar when the filesystem allows, else just cached)."""
    path = str(path)
    try:
        size = os.path.getsize(path)
    except OSError:
        raise FileNotFoundError(path)
    key = (path, size)
    hit = _cache.get(key)
    if hit is not None:
        _cache.move_to_end(key)
        return hit
    with _build_lock:
        index = load_index(path)
        if index is None:
            try:
                index = write_sidecar(path)
            except OSError:  # read-only/ephemeral filesystem: cache the in-memory build only
                index = build_index(path)
        _cache[key] = index
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return index


def read_game(path, entry):
    """The game dict for one index entry, read straight from its byte range."""
    with open(path, "rb") as f:
        f.seek(entry["start"])
        game = json.loads(f.read(entry["end"] - entry["start"]))
    game.setdefault("game_index", entry["game_index"])
    return game


def list_doc(index):
    """A light doc for replay_engine.list_games: games without their events (just
    the counts)."""
    return {"meta": index["meta"], "games": [
        {"game_index": g["game_index"], "deck_a": g["deck_a"], "deck_b": g["deck_b"], "n_events": g["n_events"]}
        for g in index["games"]]}


def ensure_sidecars(replays_dir):
    """Builds or refreshes the sidecar of every *.json under replays_dir that lacks
    a valid one, and deletes sidecars whose replay is gone. Returns
    (built, orphans_removed). A replay that fails to parse is skipped."""
    replays_dir = Path(replays_dir)
    built = orphans = 0
    if not replays_dir.is_dir():
        return built, orphans
    for replay in sorted(replays_dir.rglob("*.json")):
        if load_index(replay) is None:
            try:
                write_sidecar(replay)
                built += 1
            except (OSError, ValueError, UnicodeDecodeError, IndexError):
                continue
    for sidecar in replays_dir.rglob("*" + SIDECAR_SUFFIX):
        if not Path(str(sidecar)[:-len(SIDECAR_SUFFIX)]).is_file():
            sidecar.unlink()
            orphans += 1
    return built, orphans


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        p = Path(arg)
        if p.is_dir():
            print(f"{arg}: built {ensure_sidecars(p)[0]} sidecar(s)")
        else:
            idx = write_sidecar(p)
            print(f"{arg}: {len(idx['games'])} games indexed")
