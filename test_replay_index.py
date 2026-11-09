"""replay_index (per-game byte-offset sidecar), the by-name game endpoints that use
it, the gzip handler, and list_games' n_events -- over both Flask apps."""
import gzip
import importlib
import json

import pytest

import replay_index as ri
from replay_engine import list_games, reduce_game


def _game(i, deck_a="elves", deck_b="boggles", n=6):
    events = [{"kind": "turn_start", "turn": k + 1, "turn_player_idx": k % 2} for k in range(n)]
    return {"game_index": i, "deck_a": deck_a, "deck_b": deck_b, "events": events}


def _doc(n_games=3, **kw):
    return {"meta": {"check": "x", "note": "café – non-ascii"}, "games": [_game(i, **kw) for i in range(n_games)]}


def _write(path, doc, **dump_kw):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, **dump_kw), encoding="utf-8")
    return path


@pytest.mark.parametrize("dump_kw", [
    {},                                              # what training writes (ASCII, ", " separators)
    {"ensure_ascii": False},                         # multi-byte chars: byte offsets != char offsets
    {"indent": 2},                                   # pretty-printed hand-made file
    {"separators": (",", ":")},
])
def test_index_offsets_recover_each_game_exactly(tmp_path, dump_kw):
    doc = _doc(5)
    doc["games"][2]["events"][0]["note"] = "déjà vu ☃"
    path = _write(tmp_path / "r.json", doc, **dump_kw)
    index = ri.build_index(path)
    assert [g["game_index"] for g in index["games"]] == [0, 1, 2, 3, 4]
    for entry, original in zip(index["games"], doc["games"]):
        assert ri.read_game(path, entry) == original
        assert entry["n_events"] == len(original["events"])
    assert index["meta"] == doc["meta"] and index["size"] == path.stat().st_size


def test_index_without_game_index_keys_or_without_games(tmp_path):
    doc = {"meta": {}, "games": [{"events": [1, 2]}, {"events": []}]}
    index = ri.build_index(_write(tmp_path / "a.json", doc))
    assert [g["game_index"] for g in index["games"]] == [0, 1] and [g["n_events"] for g in index["games"]] == [2, 0]
    assert ri.build_index(_write(tmp_path / "b.json", {"meta": {"a": 1}}))["games"] == []
    with pytest.raises(ValueError):
        ri.build_index(_write(tmp_path / "c.json", [1, 2, 3]))


def test_sidecar_is_valid_until_the_replay_changes_size(tmp_path):
    path = _write(tmp_path / "r.json", _doc(2))
    assert ri.load_index(path) is None
    ri.write_sidecar(path)
    assert ri.load_index(path) is not None
    _write(path, _doc(3))                                        # replay rewritten: sidecar now stale
    assert ri.load_index(path) is None
    ri.sidecar_path(path).write_text("not json")
    assert ri.load_index(path) is None


def test_get_index_builds_lazily_writes_the_sidecar_and_caches(tmp_path):
    ri._cache.clear()
    path = _write(tmp_path / "r.json", _doc(2))
    first = ri.get_index(path)
    assert ri.sidecar_path(path).exists() and ri.get_index(path) is first


def test_get_index_survives_a_read_only_filesystem(tmp_path, monkeypatch):
    ri._cache.clear()
    path = _write(tmp_path / "r.json", _doc(2))
    monkeypatch.setattr(ri, "write_sidecar", lambda p: (_ for _ in ()).throw(OSError("read-only")))
    assert len(ri.get_index(path)["games"]) == 2 and not ri.sidecar_path(path).exists()


def test_ensure_sidecars_builds_missing_skips_valid_and_drops_orphans(tmp_path):
    a = _write(tmp_path / "lg" / "a.json", _doc(1))
    b = _write(tmp_path / "b.json", _doc(1))
    _write(tmp_path / "bad.json", [1])                           # unparseable as a replay: skipped, not fatal
    ri.write_sidecar(b)
    (tmp_path / "gone.json.gameindex").write_text("{}")          # replay deleted, sidecar left behind
    assert ri.ensure_sidecars(tmp_path) == (1, 1)
    assert ri.sidecar_path(a).exists() and not (tmp_path / "gone.json.gameindex").exists()
    assert ri.ensure_sidecars(tmp_path) == (0, 0)


def test_list_games_accepts_a_precomputed_event_count():
    doc = _doc(2)
    light = ri.list_doc(ri.build_index(_write_tmp(doc)))
    assert list_games(light) == list_games(doc)


def _write_tmp(doc):
    import tempfile
    from pathlib import Path
    return _write(Path(tempfile.mkdtemp()) / "r.json", doc)


# ---- endpoints ----

@pytest.fixture(params=["app", "app_public"])
def app_module(request):
    return importlib.import_module(request.param)


@pytest.fixture
def client(tmp_path, monkeypatch, app_module):
    ri._cache.clear()
    monkeypatch.setattr(app_module, "REPLAY_LOGS_DIR", tmp_path)
    _write(tmp_path / "main-league" / "round_robin_review_100games.json", _doc(3))
    (tmp_path / "secret.txt").write_text("nope")
    with app_module.app.test_client() as c:
        yield c


NAME = "main-league/round_robin_review_100games.json"


def test_games_endpoint_matches_the_full_file_listing(client, tmp_path):
    doc = json.loads((tmp_path / NAME).read_text(encoding="utf-8"))
    assert client.get(f"/api/replay/runs/{NAME}/games").get_json() == list_games(doc)


def test_game_endpoint_matches_the_old_full_parse_reduction(client, tmp_path):
    doc = json.loads((tmp_path / NAME).read_text(encoding="utf-8"))
    for i in (0, 2):
        assert client.get(f"/api/replay/runs/{NAME}/games/{i}").get_json() == reduce_game(doc, i)


def test_endpoints_reject_unknown_traversal_and_non_replays(client):
    assert client.get("/api/replay/runs/nope.json/games").status_code == 404
    assert client.get("/api/replay/runs/../secret.txt/games").status_code == 404
    assert client.get("/api/replay/runs/secret.txt/games").status_code == 404
    assert client.get(f"/api/replay/runs/{NAME}/games/99").status_code == 400


def test_the_listing_does_not_show_sidecars(client):
    client.get(f"/api/replay/runs/{NAME}/games")                 # creates the sidecar
    assert [r["name"] for r in client.get("/api/replay/runs").get_json()] == [NAME]


def test_posting_a_light_or_single_game_doc_still_works(client, tmp_path):
    """The viewer's local-file path posts a light doc for the list and ONE game per click."""
    doc = json.loads((tmp_path / NAME).read_text(encoding="utf-8"))
    light = {"meta": doc["meta"], "games": [{"game_index": g["game_index"], "deck_a": g["deck_a"],
                                             "deck_b": g["deck_b"], "n_events": len(g["events"])} for g in doc["games"]]}
    assert client.post("/api/replay/games", json={"content": json.dumps(light)}).get_json() == list_games(doc)
    one = {"meta": doc["meta"], "games": [doc["games"][1]]}
    assert client.post("/api/replay/game", json={"content": json.dumps(one), "game_index": 1}).get_json() == \
        reduce_game(doc, 1)


# ---- gzip ----

def test_json_is_gzipped_only_when_asked_and_worth_it(client):
    url = f"/api/replay/runs/{NAME}/games/0"
    plain = client.get(url)
    assert plain.headers.get("Content-Encoding") is None
    zipped = client.get(url, headers={"Accept-Encoding": "gzip, deflate"})
    if len(plain.data) >= 1024:
        assert zipped.headers["Content-Encoding"] == "gzip" and "Accept-Encoding" in zipped.headers["Vary"]
        assert gzip.decompress(zipped.data) == plain.data
    else:  # tiny body: left alone
        assert zipped.headers.get("Content-Encoding") is None


def test_gzip_applies_to_large_json_and_skips_small_and_non_json(client, tmp_path):
    _write(tmp_path / "big.json", _doc(40, n=60))
    big = client.get("/api/replay/runs/big.json/games/0", headers={"Accept-Encoding": "gzip"})
    assert big.headers["Content-Encoding"] == "gzip"
    assert json.loads(gzip.decompress(big.data))["game_index"] == 0
    small = client.get("/api/replay/runs", headers={"Accept-Encoding": "gzip"})  # tiny listing
    assert small.headers.get("Content-Encoding") is None
    raw = client.get("/api/replay/runs/big.json/raw", headers={"Accept-Encoding": "gzip"})  # file response
    assert raw.headers.get("Content-Encoding") is None
