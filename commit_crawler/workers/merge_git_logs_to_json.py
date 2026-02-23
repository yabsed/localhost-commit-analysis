#!/usr/bin/env python3
"""
Merge multiple git-log text files into a single time-ordered JSON file
without losing source text content.

Each JSON entry contains the full original commit block (`raw_text`), and each
source file stores `prefix_text` for any content before the first commit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

COMMIT_START_RE = re.compile(r"^commit (?P<hash>[0-9a-f]{40})\n", re.MULTILINE)
CUTOFF_LOCAL_TZ = timezone(timedelta(hours=9))
CUTOFF_DATETIME_LOCAL = datetime(2026, 2, 22, 9, 0, 0, tzinfo=CUTOFF_LOCAL_TZ)
CUTOFF_DATETIME_UTC = CUTOFF_DATETIME_LOCAL.astimezone(timezone.utc)
CUTOFF_TIMESTAMP_UNIX = CUTOFF_DATETIME_UTC.timestamp()


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent
    parser = argparse.ArgumentParser(
        description="Merge git log text files into one chronological JSON file."
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="Input git-log text files (example: mobile.txt pc.txt server.txt)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=project_dir / "merged_git_logs.json",
        help="Output JSON path (default: commit_crawler/merged_git_logs.json)",
    )
    parser.add_argument(
        "--encoding",
        default="utf-8",
        help="Text encoding of input files (default: utf-8)",
    )
    parser.add_argument(
        "--source-name-map",
        type=Path,
        default=None,
        help="Optional JSON map file: {\"/abs/path/to/log.txt\": \"source_name\"}.",
    )
    parser.add_argument(
        "--disable-cutoff-filter",
        action="store_true",
        help="Disable date cutoff filtering and keep all commits regardless of timestamp.",
    )
    return parser.parse_args()


def parse_date_to_utc(date_str: str) -> tuple[str | None, float | None]:
    try:
        dt = parsedate_to_datetime(date_str.strip())
    except (TypeError, ValueError):
        return None, None

    if dt is None:
        return None, None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    dt_utc = dt.astimezone(timezone.utc)
    iso_utc = dt_utc.isoformat().replace("+00:00", "Z")
    return iso_utc, dt_utc.timestamp()


def extract_metadata_from_block(raw_text: str) -> dict[str, Any]:
    lines = raw_text.splitlines()
    commit_hash = None
    author = None
    date_original = None

    if lines and lines[0].startswith("commit "):
        commit_hash = lines[0].split(" ", 1)[1].strip()

    for line in lines[1:]:
        if line.startswith("Author: "):
            author = line[len("Author: ") :].strip()
        elif line.startswith("Date:"):
            date_original = line[len("Date:") :].strip()
            break

    timestamp_utc = None
    timestamp_unix = None
    if date_original:
        timestamp_utc, timestamp_unix = parse_date_to_utc(date_original)

    return {
        "commit_hash": commit_hash,
        "author": author,
        "date_original": date_original,
        "timestamp_utc": timestamp_utc,
        "timestamp_unix": timestamp_unix,
    }


def split_log_text(full_text: str) -> tuple[str, list[str]]:
    starts = list(COMMIT_START_RE.finditer(full_text))
    if not starts:
        return full_text, []

    prefix_text = full_text[: starts[0].start()]
    blocks: list[str] = []
    for i, match in enumerate(starts):
        begin = match.start()
        end = starts[i + 1].start() if i + 1 < len(starts) else len(full_text)
        blocks.append(full_text[begin:end])
    return prefix_text, blocks


def sha256_text(text: str, encoding: str) -> str:
    return hashlib.sha256(text.encode(encoding)).hexdigest()


def is_after_cutoff(timestamp_unix: float | None) -> bool:
    return timestamp_unix is not None and timestamp_unix > CUTOFF_TIMESTAMP_UNIX


def load_source_name_map(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    if not path.exists():
        raise SystemExit(f"Source name map not found: {path}")

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"Invalid source name map format: {path} (expected JSON object)")

    source_name_map: dict[str, str] = {}
    for key, value in payload.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        source_name = value.strip()
        if not source_name:
            continue
        raw_path = Path(key)
        source_name_map[str(raw_path)] = source_name
        source_name_map[str(raw_path.resolve())] = source_name
    return source_name_map


def resolve_source_name(path: Path, source_name_map: dict[str, str]) -> str:
    return source_name_map.get(str(path)) or source_name_map.get(str(path.resolve())) or path.stem


def build_merged_json(
    paths: list[Path],
    encoding: str,
    source_name_map: dict[str, str],
    apply_cutoff_filter: bool = True,
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    dropped_after_cutoff_total = 0

    for source_order, path in enumerate(paths):
        source_name = resolve_source_name(path, source_name_map)
        text = path.read_text(encoding=encoding)
        prefix_text, blocks = split_log_text(text)
        dropped_after_cutoff = 0
        included_commit_count = 0

        source_entry: dict[str, Any] = {
            "source_file": str(path),
            "source_name": source_name,
            "source_order": source_order,
            "encoding": encoding,
            "sha256": sha256_text(text, encoding),
            "size_bytes": len(text.encode(encoding)),
            "prefix_text": prefix_text,
            "prefix_sha256": sha256_text(prefix_text, encoding),
            "commit_count": len(blocks),
        }

        for source_commit_index, raw_text in enumerate(blocks):
            parsed = extract_metadata_from_block(raw_text)
            if apply_cutoff_filter and is_after_cutoff(parsed["timestamp_unix"]):
                dropped_after_cutoff += 1
                continue

            entries.append(
                {
                    "source_file": str(path),
                    "source_name": source_name,
                    "source_order": source_order,
                    "source_commit_index": source_commit_index,
                    "commit_hash": parsed["commit_hash"],
                    "author": parsed["author"],
                    "date_original": parsed["date_original"],
                    "timestamp_utc": parsed["timestamp_utc"],
                    "timestamp_unix": parsed["timestamp_unix"],
                    "raw_sha256": sha256_text(raw_text, encoding),
                    "raw_text": raw_text,
                }
            )
            included_commit_count += 1

        reconstructed = prefix_text + "".join(blocks)
        source_entry["lossless_check_passed"] = reconstructed == text
        source_entry["included_commit_count"] = included_commit_count
        source_entry["filtered_out_after_cutoff_count"] = dropped_after_cutoff
        sources.append(source_entry)
        dropped_after_cutoff_total += dropped_after_cutoff

    entries_sorted = sorted(
        entries,
        key=lambda item: (
            item["timestamp_unix"] is None,
            item["timestamp_unix"] if item["timestamp_unix"] is not None else float("inf"),
            item["source_order"],
            item["source_commit_index"],
        ),
    )

    for index, item in enumerate(entries_sorted):
        item["merged_index"] = index

    return {
        "schema_version": 1,
        "created_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sort_order": "timestamp_utc_ascending",
        "note": (
            "Each entry keeps the full commit block in raw_text. "
            + (
                "Commit blocks after 2026-02-22T09:00:00+09:00 are discarded."
                if apply_cutoff_filter
                else "Date cutoff filter is disabled."
            )
        ),
        "filters": {
            "cutoff_filter_enabled": apply_cutoff_filter,
            "drop_after_local": CUTOFF_DATETIME_LOCAL.isoformat(),
            "drop_after_utc": CUTOFF_DATETIME_UTC.isoformat().replace("+00:00", "Z"),
            "dropped_entry_count": dropped_after_cutoff_total,
        },
        "source_files": sources,
        "entries": entries_sorted,
    }


def main() -> None:
    args = parse_args()
    paths = [Path(p) for p in args.inputs]

    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        raise SystemExit(f"Input file not found: {', '.join(missing)}")

    source_name_map = load_source_name_map(args.source_name_map)
    merged = build_merged_json(
        paths,
        args.encoding,
        source_name_map,
        apply_cutoff_filter=not args.disable_cutoff_filter,
    )
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")

    total_entries = len(merged["entries"])
    print(f"Wrote {total_entries} merged entries to {output_path}")
    for source in merged["source_files"]:
        status = "OK" if source["lossless_check_passed"] else "FAILED"
        print(
            f"- {source['source_name']} ({source['source_file']}): commits={source['commit_count']}, "
            f"included={source['included_commit_count']}, "
            f"filtered_after_cutoff={source['filtered_out_after_cutoff_count']}, "
            f"lossless_check={status}"
        )
    if merged["filters"]["cutoff_filter_enabled"]:
        print(
            "Cutoff filter: "
            f"drop commits after {merged['filters']['drop_after_local']} "
            f"({merged['filters']['drop_after_utc']}), "
            f"dropped={merged['filters']['dropped_entry_count']}"
        )
    else:
        print("Cutoff filter disabled: no commits were dropped by timestamp")


if __name__ == "__main__":
    main()
