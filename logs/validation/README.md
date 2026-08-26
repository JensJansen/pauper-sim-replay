# logs/validation/

A **manually-refreshed copy** of the parent pauper_sim repo's
`checkpoints/<league>/` validation output, committed here so `/stats` has
real data to show even when this submodule is checked out on its own
(`checkpoints/` itself is gitignored at the pauper_sim root). Per league:
`metrics.jsonl`, `progress.json`, `checks/*.json`, and `<deck>/checks/*.json`
-- never the `live.pt` / `archive/*.pt` / `mulligan.pt` model weights, which
are multi-GB and not needed by the stats page.

## Refreshing

From the pauper_sim repo root:

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

Then commit the result the normal way (`git add`, `git commit`) inside this
submodule.

This is a stopgap. The intended fix is for `src/validation/_common.py` (or a
sync step run after each training pipeline pass) to write here directly, so
`/stats` stays current without a manual step -- tracked but not yet done.
