"""replay_listing + the league ordering shared by /api/replay/runs and
/api/stats/leagues, over both Flask apps (app.py local, app_public.py hosted)."""
import importlib
import json
import os

import pytest

from replay_listing import list_replay_runs


def _touch(path, mtime=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}")
    if mtime is not None:
        os.utime(path, (mtime, mtime))


def test_orders_by_game_count_not_mtime_with_leagues_by_name(tmp_path):
    # mtimes deliberately inverted vs game count (a git checkout stamps every file alike)
    _touch(tmp_path / "zz-league" / "round_robin_review_5000games.json", mtime=900)
    _touch(tmp_path / "main-league" / "round_robin_review_9000games.json", mtime=100)
    _touch(tmp_path / "main-league" / "round_robin_review_10000games.json", mtime=50)
    _touch(tmp_path / "main-league" / "round_robin_review_2000games.json", mtime=800)
    _touch(tmp_path / "cross_league_50k.json", mtime=1000)
    _touch(tmp_path / "aa-league" / "round_robin_review_1000games.json", mtime=1)

    runs = list_replay_runs(tmp_path)

    assert [r["name"] for r in runs] == [
        "aa-league/round_robin_review_1000games.json",        # leagues by name, no league is special
        "main-league/round_robin_review_10000games.json",     # 10000 > 9000 numerically, not as text
        "main-league/round_robin_review_9000games.json",
        "main-league/round_robin_review_2000games.json",
        "zz-league/round_robin_review_5000games.json",
        "cross_league_50k.json",                                # no league folder: last
    ]
    assert runs[1]["league"] == "main-league" and runs[1]["cumulative_games"] == 10000
    assert runs[-1]["league"] is None and runs[-1]["cumulative_games"] is None


def test_empty_or_missing_dir_lists_nothing(tmp_path):
    assert list_replay_runs(tmp_path) == []
    assert list_replay_runs(tmp_path / "absent") == []


@pytest.fixture(params=["app", "app_public"])
def app_module(request):
    return importlib.import_module(request.param)


def test_both_apps_serve_the_grouped_listing(tmp_path, monkeypatch, app_module):
    _touch(tmp_path / "other" / "round_robin_review_100games.json")
    _touch(tmp_path / "main-league" / "round_robin_review_50games.json")
    monkeypatch.setattr(app_module, "REPLAY_LOGS_DIR", tmp_path)
    runs = app_module.app.test_client().get("/api/replay/runs").get_json()
    assert [r["league"] for r in runs] == ["main-league", "other"]


def test_both_apps_list_leagues_most_recently_written_first(tmp_path, monkeypatch, app_module):
    monkeypatch.setattr(app_module, "VALIDATION_DIR", tmp_path)
    for name, mtime in (("old-league", 100), ("zz-newest", 900), ("main-league", 1)):
        d = tmp_path / name
        d.mkdir()
        (d / "metrics.jsonl").write_text(json.dumps({"kind": "ppo", "cumulative_games": 1}) + "\n")
        os.utime(d / "metrics.jsonl", (mtime, mtime))
        (d / "progress.json").write_text(json.dumps({"cumulative_games_per_deck": 1234}))
    leagues = app_module.app.test_client().get("/api/stats/leagues").get_json()
    assert [l["name"] for l in leagues] == ["zz-newest", "old-league", "main-league"]  # no league is special
    assert leagues[2]["cumulative_games_per_deck"] == 1234
