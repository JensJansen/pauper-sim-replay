"""Self-check for the /api/stats/* routes in app.py: metrics.jsonl grouping,
checks/*.json discovery (league-level vs per-deck), and the path-traversal
guard shared with replay_run_raw."""
import json

import pytest

import app as app_module


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "VALIDATION_DIR", tmp_path)
    league_dir = tmp_path / "test-league"
    league_dir.mkdir()
    (league_dir / "metrics.jsonl").write_text("\n".join(json.dumps(r) for r in [
        {"kind": "ppo", "deck": "elves", "cumulative_games": 100, "entropy": 0.5},
        {"kind": "ppo", "deck": "elves", "cumulative_games": 50, "entropy": 0.6},
        {"kind": "primary_vs_primary_round_robin", "deck": "elves", "cumulative_games": 50, "win_rate": 0.4},
    ]) + "\n")
    (league_dir / "checks").mkdir()
    (league_dir / "checks" / "primary_vs_primary_round_robin_50games.json").write_text('{"cumulative_games": 50}')
    deck_checks = league_dir / "elves" / "checks"
    deck_checks.mkdir(parents=True)
    (deck_checks / "vs_history_50games.json").write_text('{"deck": "elves"}')
    with app_module.app.test_client() as c:
        yield c


def test_leagues_lists_dirs_with_metrics_jsonl(client):
    resp = client.get("/api/stats/leagues")
    assert resp.status_code == 200
    names = [l["name"] for l in resp.get_json()]
    assert names == ["test-league"]


def test_metrics_grouped_by_kind_and_sorted_by_cumulative_games(client):
    grouped = client.get("/api/stats/leagues/test-league/metrics").get_json()
    assert [r["cumulative_games"] for r in grouped["ppo"]] == [50, 100]
    assert len(grouped["primary_vs_primary_round_robin"]) == 1


def test_checks_distinguishes_league_level_from_per_deck(client):
    checks = client.get("/api/stats/leagues/test-league/checks").get_json()
    by_check = {c["check"]: c for c in checks}
    assert by_check["primary_vs_primary_round_robin"]["deck"] is None
    assert by_check["vs_history"]["deck"] == "elves"
    assert by_check["vs_history"]["cumulative_games"] == 50


def test_check_detail_serves_the_file(client):
    checks = client.get("/api/stats/leagues/test-league/checks").get_json()
    path = next(c["path"] for c in checks if c["check"] == "vs_history")
    detail = client.get(f"/api/stats/leagues/test-league/checks/{path}").get_json()
    assert detail == {"deck": "elves"}


def test_unknown_league_is_404(client):
    assert client.get("/api/stats/leagues/does-not-exist/metrics").status_code == 404


def test_check_detail_rejects_path_escape(client):
    resp = client.get("/api/stats/leagues/test-league/checks/..%2f..%2fsecrets.json")
    assert resp.status_code == 404
