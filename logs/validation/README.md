# logs/validation/

A copy of the parent pauper_sim repo's `checkpoints/<league>/` validation
output, committed here so `/stats` has real data to show even when this
submodule is checked out on its own (`checkpoints/` itself is gitignored at
the pauper_sim root). Per league: `metrics.jsonl`, `progress.json`,
`checks/*.jsonl`, and `<deck>/checks/*.jsonl` -- never the `live.pt` /
`archive/*.pt` / `mulligan.pt` model weights, which are multi-GB and not
needed by the stats page.

Note the `checks/` shape here is NOT a copy of `checkpoints/<league>/checks/`'s
own layout: the parent repo's canonical copy still writes one
`<check>_<N>games.json` file per cadence tick, forever (unbounded, but it's
gitignored local disk, not a git-size concern). The mirror consolidates
every check's history into one growing `checks/<check>.jsonl` instead -- one
compact line per cadence tick, self-describing via its own
`"cumulative_games"` field -- since a new small file per tick, forever,
committed to a public repo, doesn't scale the way an append-only file does.
See `src/webapp_mirror.py`'s `mirror_json`/`_consolidated_check_path` in the
parent repo for the write side, and `app.py`'s `stats_checks`/
`stats_check_detail` here for how a per-snapshot request resolves to one
line in the consolidated file. The old one-file-per-snapshot shape is no
longer understood on the read side -- every league here has been migrated.

## Kept current automatically

`src/validation/_common.py` and `rl/league/league_runner.py` (both in the
parent pauper_sim repo) write here directly as a side effect of every write
they make to `checkpoints/<league>/` -- see `src/webapp_mirror.py` there.
Each mirror write is best-effort: it silently no-ops if this submodule isn't
checked out (`webapp_mirror.webapp_ready()`), or for anything that isn't a
real league under `checkpoints/` (a benchmark harness's throwaway dir, a
test's `tmp_path`). It never raises -- a webapp mirroring hiccup must never
take training down with it.

Nothing to run by hand going forward: train normally, then `git add` /
`git commit` inside this submodule (and update the pinned commit in the
parent repo) whenever you want `/stats` on `main` to reflect the latest run.

## One-time bootstrap (already done, kept here for reference)

The first population of this directory, before the automatic mirroring
above existed, was a manual copy from the pauper_sim repo root:

```python
import shutil
from pathlib import Path

SRC = Path("checkpoints")
DST = Path("src/webapp/logs/validation")

for league_dir in SRC.iterdir():
    if not league_dir.is_dir() or not (league_dir / "metrics.jsonl").is_file():
        continue
    dst_league = DST / league_dir.name
    dst_league.mkdir(parents=True, exist_ok=True)
    for fname in ("metrics.jsonl", "progress.json"):
        if (league_dir / fname).is_file():
            shutil.copy2(league_dir / fname, dst_league / fname)
    for checks_dir in league_dir.rglob("checks"):
        rel = checks_dir.relative_to(league_dir)
        dst_checks = dst_league / rel
        dst_checks.mkdir(parents=True, exist_ok=True)
        for f in checks_dir.glob("*.json"):
            shutil.copy2(f, dst_checks / f.name)
```

Only still useful for a from-scratch bootstrap of a league that trained
entirely before the automatic mirroring existed, or for backfilling a gap
left by the submodule being uninitialized for a stretch of training.

Note this script predates the consolidated `checks/<check>.jsonl` format
above -- run as written today, it reproduces the old one-file-per-cadence-
tick shape, which `app.py` no longer reads. Don't run it as-is; either
adapt it to append each check's payload as one line to
`checks/<check>.jsonl` directly, or just retrain -- the automatic mirroring
already writes in the consolidated shape.
