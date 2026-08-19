# pauper-sim-replay

A game-log replay viewer: step through a logged Magic: the Gathering game's
board state one event at a time. Extracted from
[pauper_sim](https://github.com/JensJansen/pauper_sim), where it's attached
back as a git submodule at `src/webapp/` — training and the game engine
live there; this repo only ever reads already-written event-log JSON.

## Local use

```
pip install -r requirements-public.txt
python app.py          # http://127.0.0.1:5000 -- localhost only, no auth
```

Two ways to load a game log:
- **Open new file** — pick any `--log` event-log JSON file from disk.
- **Browse server logs** (both `app.py` and `app_public.py`) — lists every
  `*.json` file already sitting under this repo's own `logs/`, any depth,
  any filename — no naming or folder convention required, just drop a file
  there. An invalid one fails to load with a normal error, the same as
  picking a bad file by hand. `logs/` itself is NOT gitignored (a deliberate
  choice, 2026-08-19) — anything committed there is what shows up on the
  hosted instance too (see "Hosting" below), so only commit a log you're
  fine having public. For a purely local, uncommitted log, from pauper_sim's
  `src/`, point `run_league.py --log` at a path inside this submodule's
  checkout, e.g.:
  ```
  python run_league.py --matchup deck_a deck_b --log ../src/webapp/logs/<run-name>/event_log.json
  ```
  (the filename `event_log.json` there is just a convention, not a
  requirement — any name works), then `git add`/commit it if you want it to
  ride along to the hosted instance too.

## Tests

```
pip install -r requirements-dev.txt
pytest test_replay_engine.py
```

## Hosting

`render.yaml` deploys `app_public.py` as a free-tier Render web service.
Push to this repo's `main` and Render redeploys automatically. Anything
committed under `logs/` deploys with it and shows up in that instance's
own "Browse server logs" list — the only filesystem access `app_public.py`
has is to files that are already public in this repo, since a deploy
contains nothing beyond what's committed.

## Files

- `replay_engine.py` — folds a raw event-log JSON doc into board-state
  snapshots. Zero imports beyond the stdlib.
- `app.py` — local Flask entrypoint.
- `app_public.py` — deploy entrypoint. Same routes as `app.py`; the only
  difference is which `logs/` it can see (this machine's vs. whatever's
  committed to this repo).
- `static/replay.html` — the whole frontend, no build step, shared
  unchanged by both entrypoints above.
