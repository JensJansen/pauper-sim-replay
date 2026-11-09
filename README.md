# pauper-sim-replay

Two tools behind a landing page (`/`): a game-log replay viewer (`/replay`)
that steps through a logged Magic: the Gathering game's board state one
event at a time, and a validation-stats dashboard (`/stats`) for the metrics
`run_training_pipeline.py` exports during training. Extracted from
[pauper_sim](https://github.com/JensJansen/pauper_sim), where it's attached
back as a git submodule at `src/webapp/` — training and the game engine live
there; this repo only reads already-written data, split into two independent
sibling directories under `logs/` — `logs/replays/` (event-log JSON for
replay) and `logs/validation/` (a copied-in slice of `checkpoints/` for
stats — see "Validation Stats" below) — each tool reads only its own, so a
validation check file can never show up in the replay browser or vice versa.

`app.py` (local) and `app_public.py` (hosted, see "Hosting") serve identical
routes — both read the same `logs/`, so both show the same thing.

## Local use

```
pip install -r requirements-public.txt
python app.py          # http://127.0.0.1:5000 -- localhost only, no auth
```

Opens on a landing page linking to both tools below.

### Game Replay (`/replay`)

How a log reaches the page: **Browse server logs** lists games from the server's
index and fetches one game at a time; **Open new file** parses the picked file in
the browser and sends only the light game list, then the single clicked game. The
whole file is never uploaded or downloaded.

Two ways to load a game log:
- **Open new file** — pick any `--log`-shaped event-log JSON file from disk.
  This isn't limited to files under this repo: `validation/round_robin_primary.py`
  in the parent pauper_sim repo embeds a `"games"` key directly into its own
  aggregate output (`checkpoints/<league>/checks/primary_vs_primary_round_robin_<N>games.json`),
  so that exact file opens here too, no separate replay file, no server
  wiring needed — see the parent repo's README, "Validation checks".
- **Browse server logs** (both `app.py` and `app_public.py`) — lists every
  `*.json` file under this repo's own `logs/replays/`, any depth. `logs/` is
  not gitignored — anything committed there is public on the hosted instance
  too (see "Hosting"). For a local, uncommitted log, point `run_league.py
  --log` at a path inside this submodule's checkout, e.g. from pauper_sim's
  `src/`:
  ```
  python run_league.py --matchup deck_a deck_b --log ../src/webapp/logs/replays/<run-name>/event_log.json
  ```

### Validation Stats (`/stats`)

Reads `logs/validation/<league>/` — win rates, PPO training diagnostics,
mulligan-net behavior, and round-robin/vs-history matchup data written by
`src/validation/` in the parent pauper_sim repo. That directory is a copy of
pauper_sim's own (gitignored) `checkpoints/<league>/`, kept current
**automatically**: the parent repo's `src/webapp_mirror.py` mirrors every
write here as it happens, whenever this submodule is checked out — see
`logs/validation/README.md`. During a
training run the parent repo's `webapp_sync.py` also commits and pushes this data
to `main` automatically after every validation tick (see "Automatic publishing"
in its README) -- each league keeps its newest 10 sets of check results and
review replays, plus its full `metrics.jsonl`/`progress.json`.

The league selector at the top of `/stats` lists every league with data and opens
on `main-league`; `/stats?league=<name>` links straight to another one. Works identically on `app.py` and `app_public.py` since the
data travels with the repo.

## Tests

```
pip install -r requirements-dev.txt
pytest test_replay_engine.py test_stats_api.py
```

## Hosting

`render.yaml` deploys `app_public.py` as a free-tier Render web service.
Push to `main` and Render redeploys automatically. Anything committed under
`logs/` (replay logs under `logs/replays/`, validation data under
`logs/validation/`) deploys with it and is public — `app_public.py` only
ever has filesystem access to files already committed to this repo.

## Files

- `replay_engine.py` — folds a raw event-log JSON doc into board-state
  snapshots. Zero imports beyond the stdlib.
- `app.py` — local Flask entrypoint: `/` landing page, `/replay`, `/stats`
  and their APIs.
- `app_public.py` — deploy entrypoint. Identical routes to `app.py`; only
  differs in which `logs/` it can see (this machine's vs. whatever's
  committed).
- `static/index.html` — the `/` landing page.
- `static/replay.html` — the `/replay` frontend, no build step.
- `static/stats.html` — the `/stats` frontend, no build step.
- `replay_index.py` — the per-game byte-offset index (`<replay>.json.gameindex`
  sidecar). `GET /api/replay/runs/<name>/games` and `.../games/<index>` use it to
  list a replay's games and reduce ONE game by reading only that game's bytes
  (~200 KB, ~6 MB of memory, tens of ms) instead of parsing the whole ~30 MB file
  (~400 ms, ~145 MB) per click. Training-side `webapp_sync` builds the sidecars
  before committing; a replay without a valid one (hand-made, or changed size) is
  indexed lazily on first use. Stdlib only; also a script (`python replay_index.py
  <file|dir>`).
- `compress.py` — gzips JSON API responses (stdlib `gzip`, no dependency): a reduced
  game is ~2 MB and ~50 KB gzipped.
- `replay_listing.py` — the shared `/api/replay/runs` listing (grouped by league,
  ordered by game count -- file mtime is the checkout time on a deployed copy).
- `stats_checks.py` — shared check-snapshot read path plus `DEFAULT_LEAGUE` /
  league ordering for `/api/stats/leagues`.
- `logs/replays/` — game-log JSON for `/replay`: training's per-tick review replays
  live under `logs/replays/<league>/` (newest 10 per league, auto-committed);
  hand-made files can sit alongside at the top level.
- `logs/validation/` — committed copy of validation data; see its own
  README.md.
