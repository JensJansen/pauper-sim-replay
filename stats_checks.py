"""Shared check-snapshot read path for app.py and app_public.py -- pulled out
of both (which used to carry byte-identical copies) the same way both files
already share replay_engine.list_games/reduce_game instead of duplicating
that logic.

Reads logs/validation/<league>/[<deck>/]checks/<check>.jsonl (one growing
file per check, one line per cadence tick -- see webapp_mirror.mirror_json
in the parent repo) and exposes it through a virtual old-style per-snapshot
filename (checks/<check>_<N>games.json), the stable per-snapshot address
stats_checks/stats_check_detail expose to the frontend even though no such
file exists on disk.
"""
import json
import re

CHECK_FILE_RE = re.compile(r"(.+)_(\d+)games\.json$")  # virtual per-snapshot filename shape


def _parse_line(line):
    """The parsed record for one jsonl line, or None if the line is blank
    or fails to parse -- tolerates a truncated trailing line (an
    interrupted append) the same way on both the listing and detail
    paths, so a crash-truncated line is invisible to both instead of
    listed-then-404."""
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def iter_check_snapshots(league_dir):
    """Yields {check, deck, cumulative_games, path} for every check
    snapshot under league_dir -- one growing checks/<check>.jsonl per
    check (one line per cadence tick). "path" is a virtual old-style
    per-snapshot filename (checks/<check>_<N>games.json), a stable
    per-snapshot identifier read_consolidated_record resolves back to the
    matching .jsonl line -- kept as the API's addressing scheme even
    though no such file exists on disk."""
    for jsonl_path in league_dir.rglob("*.jsonl"):
        if jsonl_path.parent.name != "checks":
            continue
        check = jsonl_path.stem
        rel_dir = jsonl_path.parent.relative_to(league_dir)
        deck = rel_dir.parts[0] if len(rel_dir.parts) > 1 else None
        seen = set()
        with open(jsonl_path) as f:
            for line in f:
                record = _parse_line(line)
                cumulative_games = None if record is None else record.get("cumulative_games")
                # A re-run at the same cadence point (crash + resume) can
                # append a second line for the same N -- list it once;
                # read_consolidated_record's last-line-wins scan resolves
                # which write is authoritative when the detail is fetched.
                if cumulative_games is None or cumulative_games in seen:
                    continue
                seen.add(cumulative_games)
                path = (rel_dir / f"{check}_{cumulative_games}games.json").as_posix()
                yield {"check": check, "deck": deck, "cumulative_games": cumulative_games, "path": path}


def read_consolidated_record(jsonl_path, cumulative_games):
    """Last line in jsonl_path whose own "cumulative_games" field matches
    -- last, not first, so a cadence point replayed after a crash resolves
    to its freshest write. None if jsonl_path doesn't exist or no line
    matches. Tolerates a truncated trailing line (an interrupted append)
    by skipping any line that fails to parse."""
    if not jsonl_path.is_file():
        return None
    found = None
    with open(jsonl_path) as f:
        for line in f:
            record = _parse_line(line)
            if record is not None and record.get("cumulative_games") == cumulative_games:
                found = record
    return found
