"""Serves the built React app (frontend/dist) from the site root -- shared by app.py and app_public.py, which carry
the same routes (the same way they share compress.py and stats_checks.py).

Every path that isn't an /api route or a real file in dist falls back to index.html, so client-side routes
(/replay, /stats/compare, /methodology#metrics ...) survive a refresh and a pasted link. A missing *file* (a path
whose last segment has an extension) is a real 404, not the app shell, and an unknown /api path is a JSON 404.

Files are read and returned as ordinary responses (not file passthrough) so compress.py can gzip the ~800 KB script.
Vite names everything under assets/ with a content hash, so those are cached forever; index.html is never cached,
so a deploy takes effect on the next load.
"""
from pathlib import Path

from flask import Response, jsonify

DIST_DIR = Path(__file__).resolve().parent / "frontend" / "dist"

# Explicit: mimetypes.guess_type reads the Windows registry, which can call a .js file text/plain.
_TYPES = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp",
    ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain",
}
_NOT_BUILT = "The frontend isn't built. Run `npm ci && npm run build` in frontend/ (Render does this on deploy)."


def init_frontend(app, dist_dir=DIST_DIR):
    dist = Path(dist_dir).resolve()

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def frontend(path):
        if path == "api" or path.startswith("api/"):
            return jsonify({"error": "not found"}), 404
        target = (dist / path).resolve() if path else None
        if target is not None and dist in target.parents and target.is_file():
            resp = Response(target.read_bytes(), mimetype=_TYPES.get(target.suffix.lower(), "application/octet-stream"))
            if path.startswith("assets/"):
                resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp
        if "." in path.rsplit("/", 1)[-1]:
            return jsonify({"error": "not found"}), 404
        index = dist / "index.html"
        if not index.is_file():
            return Response(_NOT_BUILT, status=503, mimetype="text/plain")
        resp = Response(index.read_bytes(), mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    return app
