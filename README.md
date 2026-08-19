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
- **Browse server logs** (`app.py` only, not `app_public.py`) — lists every
  `logs/<run>/event_log.json` already sitting in this repo's own `logs/`
  (gitignored). From pauper_sim's `src/`, point `run_league.py --log` at a
  path inside this submodule's checkout, e.g.:
  ```
  python run_league.py --matchup deck_a deck_b --log ../src/webapp/logs/<run-name>/event_log.json
  ```

## Hosting

`render.yaml` deploys `app_public.py` (the file-picker-only subset — no
server-side log browsing, no filesystem access of its own) as a free-tier
Render web service. Push to this repo's `main` and Render redeploys.

## Files

- `replay_engine.py` — folds a raw event-log JSON doc into board-state
  snapshots. Zero imports beyond the stdlib.
- `app.py` — local Flask entrypoint: the full viewer, including the
  server-side log browser.
- `app_public.py` — deploy entrypoint: the viewer minus the log browser.
- `static/replay.html` — the whole frontend, no build step.
