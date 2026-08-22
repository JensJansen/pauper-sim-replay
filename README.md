# pauper-sim-replay

A game-log replay viewer: step through a logged Magic: the Gathering game's
board state one event at a time. Extracted from
[pauper_sim](https://github.com/JensJansen/pauper_sim), where it's attached
back as a git submodule at `src/webapp/` — training and the game engine
live there; this repo only reads already-written event-log JSON.

## Local use

```
pip install -r requirements-public.txt
python app.py          # http://127.0.0.1:5000 -- localhost only, no auth
```

Two ways to load a game log:
- **Open new file** — pick any `--log` event-log JSON file from disk.
- **Browse server logs** (both `app.py` and `app_public.py`) — lists every
  `*.json` file under this repo's own `logs/`, any depth. `logs/` is not
  gitignored — anything committed there is public on the hosted instance too
  (see "Hosting"). For a local, uncommitted log, point `run_league.py --log`
  at a path inside this submodule's checkout, e.g. from pauper_sim's `src/`:
  ```
  python run_league.py --matchup deck_a deck_b --log ../src/webapp/logs/<run-name>/event_log.json
  ```

## Tests

```
pip install -r requirements-dev.txt
pytest test_replay_engine.py
```

## Hosting

`render.yaml` deploys `app_public.py` as a free-tier Render web service.
Push to `main` and Render redeploys automatically. Anything committed under
`logs/` deploys with it and shows up in that instance's own "Browse server
logs" list — `app_public.py` only ever has filesystem access to files already
committed to this repo.

## Files

- `replay_engine.py` — folds a raw event-log JSON doc into board-state
  snapshots. Zero imports beyond the stdlib.
- `app.py` — local Flask entrypoint.
- `app_public.py` — deploy entrypoint. Same routes as `app.py`; only differs
  in which `logs/` it can see (this machine's vs. whatever's committed).
- `static/replay.html` — the whole frontend, no build step, shared unchanged
  by both entrypoints above.
