# pauper-sim-replay

A React web app (`frontend/`) and the small Flask API behind it, for looking at a Magic: the Gathering RL training
run: a game-log replay viewer (`/replay`) that steps through a logged game's board state one event at a time, a
validation-stats dashboard (`/stats/<tab>`) for the metrics `run_training_pipeline.py` exports during training, and
a training-methodology explainer (`/methodology`). Extracted from
[pauper_sim](https://github.com/JensJansen/pauper_sim), where it's attached
back as a git submodule at `src/webapp/` — training and the game engine live
there; this repo only reads already-written data, split into two independent
sibling directories under `logs/` — `logs/replays/` (event-log JSON for
replay) and `logs/validation/` (a copied-in slice of `checkpoints/` for
stats — see "Stats" below) — each part reads only its own, so a
validation check file can never show up in the replay browser or vice versa.

`app.py` (local) and `app_public.py` (hosted, see "Hosting") serve identical
routes — both read the same `logs/`, so both show the same thing.

## Local use

```
pip install -r requirements-public.txt
cd frontend && npm ci && npm run build && cd ..
python app.py          # http://127.0.0.1:5000 -- localhost only, no auth
```

Flask serves the built app from `frontend/dist/` at the site root. Every path that isn't an `/api` route or a built
file falls back to `index.html`, so client-side routes (`/stats/compare`, `/methodology#metrics`, …) survive a
refresh and a pasted link; see `frontend.py`. If the frontend hasn't been built, the pages say how to build it.

For frontend work, run `python app.py` and, in `frontend/`, `npm run dev` (hot reload at the URL Vite prints, with
`/api` proxied to Flask on :5000).

## Pages

### Home (`/`)
Three cards linking to the pages below.

### Game Replay (`/replay`)
A drawer holds an expanding tree: league → replay file → game. Open as many leagues and files as you like; the tree
keeps its state while the drawer closes and resets when you leave the page. Picking a game shows both players'
hands, three battlefield rows each (creatures, other permanents, lands) mirrored around the shared stack, attachments
tucked behind their host, graveyard/exile piles with a hover flyout, the agent's decision weights in the center strip,
and a one-row bar with the turn/phase pills and the transport: step, phase and turn arrows (also ←/→, Shift+←/→,
Alt+←/→), a scrubber, and an event-number box. Every card enlarges on hover.

How a game reaches the page: the file list comes from `GET /api/replay/runs`, a file's game list from the server's
per-game index, and one game at a time is read and reduced server-side
(`GET /api/replay/runs/<name>/games[/<i>]`) — the whole file is never sent. It lists every `*.json` file under
this repo's own `logs/replays/`, any depth. `logs/` is not gitignored — anything committed there is public on the
hosted instance too (see "Hosting"). For a local, uncommitted log, point `run_league.py --log` at a path inside this
submodule's checkout, e.g. from pauper_sim's `src/`:
```
python run_league.py --matchup deck_a deck_b --log ../src/webapp/logs/replays/<run-name>/event_log.json
```

### Stats (`/stats/<tab>`)
Reads `logs/validation/<league>/` — win rates, PPO training diagnostics, mulligan-net behavior, and
round-robin/history matchup data written by `src/validation/` in the parent pauper_sim repo. That directory is a copy
of pauper_sim's own (gitignored) `checkpoints/<league>/`, kept current **automatically**: the parent repo's
`src/webapp_publish/mirror.py` mirrors every write here as it happens, whenever this submodule is checked out — see
`logs/validation/README.md`. During a training run the parent repo's `webapp_publish/sync.py` also commits and
pushes this data to `main` automatically after every validation tick (see "Automatic publishing" in its README) --
each league keeps its newest 10 sets of check results and review replays, plus its full `metrics.jsonl`/`progress.json`.

Tabs are grouped by the question they answer: **Summary** (is anything wrong right now?), **Progress** (is it still
learning?), **Strength** (how strong are the decks and how do they match up?), **Training** (is training
mechanically healthy, and what did it train against?), **Behavior** (mulligan decisions, mana burn), and **Compare**
(runs side by side at matched ages, published head-to-head results with their noise floor, and a config diff).

The league picker lists every league with data, most recently written first, and opens on the first one (no league is
special); `?league=<name>` links straight to another and is kept as you move between tabs, and Compare keeps its
selection in `?leagues=a,b,c`. Training-league twins (`<league>-training`) are frozen benchmark opponents, not runs,
and are left out of the picker. Glossary terms and "How is this measured?" links go to `/methodology#<id>`, which
scrolls to and opens the target section.

### Methodology (`/methodology`)
A static explainer of the training methodology (league structure, model architecture, reward, PPO, mulligan net,
validation, config and the experiment program). It reads nothing from `logs/`.

## Tests

```
pip install -r requirements-dev.txt
pytest                               # the Flask API, the frontend server, the replay reducer and index
cd frontend && node --test "src/**/*.test.mjs"   # the pure navigation / series helpers
```

## Hosting

`render.yaml` deploys `app_public.py` as a free-tier Render web service: its build command installs the Python
requirements and builds the frontend (`npm ci && npm run build`), then gunicorn serves it.
Push to `main` and Render redeploys automatically. Anything committed under
`logs/` (replay logs under `logs/replays/`, validation data under
`logs/validation/`) deploys with it and is public — `app_public.py` only
ever has filesystem access to files already committed to this repo.

## Files

- `frontend/` — the React app (Vite + React Router + Recharts). Source in `frontend/src/`: `pages/` (home, replay,
  stats shell, methodology), `stats/` (one file per stats tab), `components/` (replay board, charts, shared UI),
  `lib/` (API client, navigation and series helpers, palette). Build output goes to `frontend/dist/` (gitignored).
- `frontend.py` — serves `frontend/dist/` from the site root for both Flask apps (SPA fallback, real 404s for missing
  files and unknown `/api` paths, long-lived caching for hashed assets).
- `app.py` — local Flask entrypoint: the frontend at `/` and the `/api` routes.
- `app_public.py` — deploy entrypoint. Identical routes to `app.py`; only
  differs in which `logs/` it can see (this machine's vs. whatever's
  committed).
- `replay_engine.py` — folds a raw event-log JSON doc into board-state
  snapshots. Zero imports beyond the stdlib.
- `replay_index.py` — the per-game byte-offset index (`<replay>.json.gameindex`
  sidecar). `GET /api/replay/runs/<name>/games` and `.../games/<index>` use it to
  list a replay's games and reduce ONE game by reading only that game's bytes
  (~200 KB, ~6 MB of memory, tens of ms) instead of parsing the whole ~30 MB file
  (~400 ms, ~145 MB) per click. Training-side `webapp_publish/sync.py` builds the sidecars
  before committing; a replay without a valid one (hand-made, or changed size) is
  indexed lazily on first use. Stdlib only; also a script (`python replay_index.py
  <file|dir>`).
- `compress.py` — gzips JSON API responses and the frontend's text assets (stdlib `gzip`, no dependency): a reduced
  game is ~2 MB and ~50 KB gzipped, the app bundle ~800 KB and ~240 KB.
- `replay_listing.py` — the shared `/api/replay/runs` listing (grouped by league,
  ordered by game count -- file mtime is the checkout time on a deployed copy).
- `stats_checks.py` — shared check-snapshot read path, the published head-to-head listing for
  `/api/stats/compare`, plus `league_sort_key` (replay grouping by league name).
- `logs/replays/` — game-log JSON for `/replay`: training's per-tick review replays
  live under `logs/replays/<league>/` (newest 10 per league, auto-committed);
  hand-made files can sit alongside at the top level.
- `logs/validation/` — committed copy of validation data (and published head-to-head results in `compare/`); see its
  own README.md.
