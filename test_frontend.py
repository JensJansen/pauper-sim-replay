"""frontend.py: the built React app served from the site root by both Flask apps -- the SPA fallback, real 404s,
cache headers, gzip of text assets, and that nothing outside dist can be read."""
import gzip
import importlib

import pytest
from flask import Flask

from compress import init_gzip
from frontend import init_frontend

INDEX = "<!doctype html><title>Pauper Sim</title><div id=root></div>" + " " * 2000
JS = "console.log('x');" + "// pad\n" * 400


@pytest.fixture
def client(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / "assets" / "index-abc123.js").write_text(JS)
    (tmp_path / "secret.txt").write_text("outside dist")
    app = Flask(__name__, static_folder=None)
    init_gzip(app)
    init_frontend(app, dist)

    @app.get("/api/thing")
    def thing():  # a real API route must win over the catch-all
        return {"ok": True}

    with app.test_client() as c:
        yield c


def test_client_routes_get_the_app_shell(client):
    for path in ("/", "/replay", "/stats/compare", "/stats", "/methodology"):
        r = client.get(path)
        assert r.status_code == 200 and r.mimetype == "text/html" and b"Pauper Sim" in r.data, path
        assert r.headers["Cache-Control"] == "no-cache"        # a deploy must take effect on the next load


def test_real_files_are_served_with_the_right_type_and_cached_forever_under_assets(client):
    r = client.get("/assets/index-abc123.js")
    assert r.status_code == 200 and r.mimetype == "text/javascript"
    assert "immutable" in r.headers["Cache-Control"]


def test_a_missing_file_is_a_404_not_the_app_shell_and_so_is_an_unknown_api_path(client):
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/favicon.ico").status_code == 404
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.get_json() == {"error": "not found"}
    assert client.get("/api/thing").get_json() == {"ok": True}  # real API routes still win


def test_nothing_outside_dist_is_readable(client):
    for path in ("/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt"):
        r = client.get(path)
        assert b"outside dist" not in r.data, path


def test_text_assets_are_gzipped_when_asked_and_not_otherwise(client):
    plain = client.get("/assets/index-abc123.js")
    assert plain.headers.get("Content-Encoding") is None
    zipped = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip"})
    assert zipped.headers["Content-Encoding"] == "gzip"
    assert gzip.decompress(zipped.data) == plain.data
    html = client.get("/replay", headers={"Accept-Encoding": "gzip"})
    assert html.headers["Content-Encoding"] == "gzip" and gzip.decompress(html.data).startswith(b"<!doctype html>")


def test_an_unbuilt_frontend_says_how_to_build_it(tmp_path):
    app = Flask(__name__, static_folder=None)
    init_frontend(app, tmp_path / "nothing")
    r = app.test_client().get("/stats")
    assert r.status_code == 503 and b"npm run build" in r.data


@pytest.mark.parametrize("name", ["app", "app_public"])
def test_both_entrypoints_serve_the_frontend_and_keep_their_api(name):
    module = importlib.import_module(name)
    c = module.app.test_client()
    assert c.get("/replay").status_code in (200, 503)           # 503 only when frontend/dist isn't built
    assert c.get("/api/replay/runs").status_code == 200
    assert c.get("/api/nope").status_code == 404
    # the old display's routes are gone
    assert c.post("/api/replay/games", json={}).status_code in (404, 405)
    assert c.get("/api/replay/runs/x.json/raw").status_code == 404
