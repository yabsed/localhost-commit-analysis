#!/usr/bin/env python3
"""
Pipeline boss for commit_crawler.

Runs:
1) commit_crawler/commit_crawler.py  (input.txt -> *.txt git logs)
2) commit_crawler/merge_git_logs_to_json.py  (*.txt -> merged_git_logs.json)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    root_dir = Path(__file__).resolve().parent
    default_dir = root_dir / "commit_crawler"

    parser = argparse.ArgumentParser(
        description="Run full commit_crawler pipeline: input.txt to merged JSON."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=default_dir / "input.txt",
        help="Repository list input path (default: commit_crawler/input.txt)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_dir,
        help="Directory to write git-log text files (default: commit_crawler)",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=default_dir / "merged_git_logs.json",
        help="Merged JSON output path (default: commit_crawler/merged_git_logs.json)",
    )
    parser.add_argument(
        "--max-count",
        type=int,
        default=None,
        help="Optional commit limit per repository for crawling.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-crawl repositories even if output txt files already exist.",
    )
    parser.add_argument(
        "--encoding",
        default="utf-8",
        help="Encoding for merge stage (default: utf-8).",
    )
    return parser.parse_args()


def run_step(cmd: list[str], step_name: str) -> None:
    print(f"\n[PIPELINE] {step_name}", flush=True)
    completed = subprocess.run(cmd, check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def main() -> None:
    args = parse_args()
    root_dir = Path(__file__).resolve().parent
    crawler_script = root_dir / "commit_crawler" / "commit_crawler.py"
    merge_script = root_dir / "commit_crawler" / "merge_git_logs_to_json.py"

    if not crawler_script.exists():
        raise SystemExit(f"Missing crawler script: {crawler_script}")
    if not merge_script.exists():
        raise SystemExit(f"Missing merge script: {merge_script}")

    input_path = args.input.resolve()
    output_dir = args.output_dir.resolve()
    output_json = args.output_json.resolve()

    with tempfile.TemporaryDirectory(prefix="commit_crawler_pipeline_") as temp_dir:
        manifest_path = Path(temp_dir) / "crawl_manifest.json"

        crawl_cmd = [
            sys.executable,
            str(crawler_script),
            "--input",
            str(input_path),
            "--output-dir",
            str(output_dir),
            "--manifest",
            str(manifest_path),
        ]
        if args.max_count is not None:
            crawl_cmd.extend(["--max-count", str(args.max_count)])
        if args.force:
            crawl_cmd.append("--force")

        run_step(crawl_cmd, "Crawl git logs")

        if not manifest_path.exists():
            raise SystemExit(f"Manifest not generated: {manifest_path}")

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        generated_files = [Path(item) for item in manifest.get("generated_files", [])]
        if not generated_files:
            raise SystemExit("No git-log text files were generated.")

        merge_cmd = [
            sys.executable,
            str(merge_script),
            *[str(path) for path in generated_files],
            "--output",
            str(output_json),
            "--encoding",
            args.encoding,
        ]
        run_step(merge_cmd, "Merge logs to JSON")

    print("\nPipeline completed.")
    print(f"- input: {input_path}")
    print(f"- log outputs dir: {output_dir}")
    print(f"- merged json: {output_json}")


if __name__ == "__main__":
    main()
