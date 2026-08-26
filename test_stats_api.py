"""Self-check for the /api/stats/* routes in app.py: metrics.jsonl grouping,
checks/*.jsonl discovery (league-level vs per-deck) via the virtual
per-snapshot path, and the path-traversal guard shared with replay_run_raw."""
import json

import pytest

import app as app_module


def _write_jsonl(path, *records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


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
    _write_jsonl(league_dir / "checks" / "primary_vs_primary_round_robin.jsonl",
                {"cumulative_games": 50})
    _write_jsonl(league_dir / "elves" / "checks" / "vs_history.jsonl",
                {"deck": "elves", "cumulative_games": 50})
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
    assert path == "elves/checks/vs_history_50games.json"  # virtual path -- no such file exists on disk
    detail = client.get(f"/api/stats/leagues/test-league/checks/{path}").get_json()
    assert detail == {"deck": "elves", "cumulative_games": 50}


def test_unknown_league_is_404(client):
    assert client.get("/api/stats/leagues/does-not-exist/metrics").status_code == 404


def test_check_detail_rejects_path_escape(client):
    resp = client.get("/api/stats/leagues/test-league/checks/..%2f..%2fsecrets.json")
    assert resp.status_code == 404


def test_check_detail_404_for_a_cumulative_games_with_no_matching_line(client):
    resp = client.get("/api/stats/leagues/test-league/checks/elves/checks/vs_history_99999games.json")
    assert resp.status_code == 404


def test_check_detail_returns_the_last_line_on_a_replayed_cadence_point(tmp_path, monkeypatch):
    """A crash-and-resume can re-run the same cadence point, appending a
    second line for the same cumulative_games -- the freshest write (the
    last line) must win."""
    monkeypatch.setattr(app_module, "VALIDATION_DIR", tmp_path)
    league_dir = tmp_path / "replay-league"
    league_dir.mkdir()
    (league_dir / "metrics.jsonl").write_text("")
    _write_jsonl(league_dir / "checks" / "vs_history.jsonl",
                {"cumulative_games": 50, "attempt": "first"},
                {"cumulative_games": 50, "attempt": "second"})

    with app_module.app.test_client() as c:
        detail = c.get("/api/stats/leagues/replay-league/checks/checks/vs_history_50games.json").get_json()
        assert detail["attempt"] == "second"

        # The listing must not show the same cumulative_games twice.
        checks = c.get("/api/stats/leagues/replay-league/checks").get_json()
        assert len([x for x in checks if x["check"] == "vs_history"]) == 1


def test_check_detail_skips_a_malformed_trailing_line(tmp_path, monkeypatch):
    """An interrupted append (process killed mid-write) can leave a
    truncated last line -- the reader must skip it, not 500, and still
    return the last VALID matching record."""
    monkeypatch.setattr(app_module, "VALIDATION_DIR", tmp_path)
    league_dir = tmp_path / "truncated-league"
    league_dir.mkdir()
    (league_dir / "metrics.jsonl").write_text("")
    jsonl_path = league_dir / "checks" / "vs_history.jsonl"
    jsonl_path.parent.mkdir(parents=True)
    with open(jsonl_path, "w") as f:
        f.write(json.dumps({"cumulative_games": 50, "attempt": "good"}) + "\n")
        f.write('{"cumulative_games": 100, "attemp')  # truncated, no trailing newline

    with app_module.app.test_client() as c:
        detail = c.get("/api/stats/leagues/truncated-league/checks/checks/vs_history_50games.json").get_json()
        assert detail == {"cumulative_games": 50, "attempt": "good"}
