"""gzip for JSON API responses and the frontend's text assets, stdlib only (the hosted deploy's requirements stay
`flask` + `gunicorn`; see requirements-public.txt).

One reduced game is ~0.7-2 MB of highly repetitive JSON that gzips ~50x, /api/stats metrics are multi-MB, and the
React bundle is ~800 KB of script, so compressing is the cheap win on a free host. Only plain responses of the types
below are touched: file responses (`direct_passthrough`) and anything already encoded are left alone, as are bodies
too small to be worth it. frontend.py returns assets as ordinary responses precisely so they land here.
"""
import gzip

from flask import request

MIN_BYTES = 1024
COMPRESSIBLE = {"application/json", "text/html", "text/css", "text/javascript", "application/javascript", "image/svg+xml"}
LEVEL = 5  # speed/size balance: ~15 ms for a 2 MB game


def init_gzip(app):
    @app.after_request
    def _gzip_json(response):
        if (response.status_code != 200 or response.direct_passthrough
                or response.mimetype not in COMPRESSIBLE
                or response.headers.get("Content-Encoding")
                or "gzip" not in request.headers.get("Accept-Encoding", "").lower()):
            return response
        data = response.get_data()
        if len(data) < MIN_BYTES:
            return response
        response.set_data(gzip.compress(data, LEVEL))
        response.headers["Content-Encoding"] = "gzip"
        response.headers.add("Vary", "Accept-Encoding")
        return response
    return app
