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
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

COMMIT_START_RE = re.compile(r"^commit (?P<hash>[0-9a-f]{40})\n", re.MULTILINE)


def parse_args() -> argparse.Namespace:
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
        default="merged_git_logs.json",
        help="Output JSON path (default: merged_git_logs.json)",
    )
    parser.add_argument(
        "--encoding",
        default="utf-8",
        help="Text encoding of input files (default: utf-8)",
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


def build_merged_json(paths: list[Path], encoding: str) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []

    for source_order, path in enumerate(paths):
        text = path.read_text(encoding=encoding)
        prefix_text, blocks = split_log_text(text)

        source_entry: dict[str, Any] = {
            "source_file": str(path),
            "source_order": source_order,
            "encoding": encoding,
            "sha256": sha256_text(text, encoding),
            "size_bytes": len(text.encode(encoding)),
            "prefix_text": prefix_text,
            "prefix_sha256": sha256_text(prefix_text, encoding),
            "commit_count": len(blocks),
        }
        sources.append(source_entry)

        for source_commit_index, raw_text in enumerate(blocks):
            parsed = extract_metadata_from_block(raw_text)
            entries.append(
                {
                    "source_file": str(path),
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

        reconstructed = prefix_text + "".join(blocks)
        source_entry["lossless_check_passed"] = reconstructed == text

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
            "No source text is dropped during conversion."
        ),
        "source_files": sources,
        "entries": entries_sorted,
    }


def main() -> None:
    args = parse_args()
    paths = [Path(p) for p in args.inputs]

    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        raise SystemExit(f"Input file not found: {', '.join(missing)}")

    merged = build_merged_json(paths, args.encoding)
    output_path = Path(args.output)
    output_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")

    total_entries = len(merged["entries"])
    print(f"Wrote {total_entries} merged entries to {output_path}")
    for source in merged["source_files"]:
        status = "OK" if source["lossless_check_passed"] else "FAILED"
        print(
            f"- {source['source_file']}: commits={source['commit_count']}, "
            f"lossless_check={status}"
        )


if __name__ == "__main__":
    main()
