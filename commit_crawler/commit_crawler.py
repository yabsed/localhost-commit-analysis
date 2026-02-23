#!/usr/bin/env python3
"""
Create git-log text files for repositories listed in input.txt.

Remote GitHub repositories are supported directly.
Each output file is saved in commit_crawler as <repo_name>.txt by default.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

COMMIT_HEADER_RE_BYTES = re.compile(br"^commit [0-9a-f]{40}\r?\n?$")
CLONE_PROGRESS_RE = re.compile(
    r"(Receiving objects|Resolving deltas|Compressing objects):\s+(\d{1,3})%"
)
GENERIC_PERCENT_RE = re.compile(r"(\d{1,3})%")
CLONE_PHASE_RANGES: dict[str, tuple[float, float]] = {
    "starting": (0.00, 0.10),
    "compressing_objects": (0.10, 0.30),
    "receiving_objects": (0.30, 0.90),
    "resolving_deltas": (0.90, 1.00),
    "done": (1.00, 1.00),
}


class ProgressReporter:
    def __init__(self) -> None:
        self._isatty = sys.stdout.isatty()
        self._last_non_tty_state: dict[tuple[int, str], tuple[int, str]] = {}

    @staticmethod
    def _bar(percent: float, width: int = 24) -> str:
        clamped = max(0.0, min(percent, 1.0))
        filled = int(clamped * width)
        return f"[{'#' * filled}{'-' * (width - filled)}] {clamped * 100:6.2f}%"

    def update(
        self,
        repo_index: int,
        repo_total: int,
        repo_label: str,
        step: str,
        percent: float,
        detail: str = "",
    ) -> None:
        bar = self._bar(percent)
        line = f"[{repo_index}/{repo_total}] {repo_label} | {step:<7} {bar}"
        if detail:
            line = f"{line} | {detail}"

        if self._isatty:
            print(f"\r{line[:200]:<200}", end="", flush=True)
            return

        percent_bucket = int(max(0.0, min(percent, 1.0)) * 100) // 5
        key = (repo_index, step)
        state = (percent_bucket, detail)

        if self._last_non_tty_state.get(key) == state and detail != "done":
            return

        print(line)
        self._last_non_tty_state[key] = state

    def finish(self) -> None:
        if self._isatty:
            print()


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Generate git-log text files from repositories listed in input.txt."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help=(
            "Path to the input file. If omitted, use ./input.txt first, "
            "then commit_crawler/input.txt."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=script_dir,
        help="Directory where output text files are written (default: commit_crawler).",
    )
    parser.add_argument(
        "--max-count",
        type=int,
        default=None,
        help="Optional commit limit per repository (default: no limit).",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Optional JSON path to write generated file list and failures.",
    )
    return parser.parse_args()


def load_repo_specs(path: Path) -> list[str]:
    if not path.exists():
        raise SystemExit(f"Input file not found: {path}")

    repo_specs: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        repo_specs.append(text)

    if not repo_specs:
        raise SystemExit(f"No repository entries found in {path}")

    return repo_specs


def write_manifest(
    manifest_path: Path,
    input_path: Path,
    output_dir: Path,
    generated_files: list[Path],
    failures: list[str],
) -> None:
    payload = {
        "input_file": str(input_path),
        "output_dir": str(output_dir),
        "generated_files": [str(path) for path in generated_files],
        "failures": failures,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clone_phase_ratio(phase: str, phase_percent: float) -> float:
    start, end = CLONE_PHASE_RANGES.get(phase, (0.0, 1.0))
    clamped = max(0.0, min(phase_percent, 1.0))
    return start + ((end - start) * clamped)


def is_remote_repo_spec(repo_spec: str) -> bool:
    prefixes = ("http://", "https://", "ssh://", "git://", "git@")
    if repo_spec.startswith(prefixes):
        return True
    return bool(re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo_spec))


def normalize_remote_spec(repo_spec: str) -> str:
    if re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo_spec):
        return f"https://github.com/{repo_spec}.git"
    return repo_spec


def remote_repo_name(repo_spec: str) -> str:
    source = repo_spec.strip().rstrip("/")

    if source.startswith("git@") and ":" in source:
        path_part = source.split(":", 1)[1]
    else:
        parsed = urlparse(source)
        path_part = parsed.path if parsed.path else source

    name = Path(path_part).name
    if name.endswith(".git"):
        name = name[:-4]
    return name or "repo"


def is_git_repo(path: Path) -> bool:
    if not path.exists() or not path.is_dir():
        return False

    result = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def _candidate_paths(repo_spec: str, input_path: Path) -> list[Path]:
    raw = Path(repo_spec).expanduser()
    if raw.is_absolute():
        return [raw]

    cwd = Path.cwd().resolve()
    input_parent = input_path.resolve().parent

    candidates = [
        (cwd / raw).resolve(),
        (input_parent / raw).resolve(),
        (cwd.parent / raw).resolve(),
        (input_parent.parent / raw).resolve(),
    ]

    deduped: list[Path] = []
    seen: set[Path] = set()
    for path in candidates:
        if path not in seen:
            deduped.append(path)
            seen.add(path)
    return deduped


def resolve_repo_path(repo_spec: str, input_path: Path) -> Path | None:
    for candidate in _candidate_paths(repo_spec, input_path):
        if is_git_repo(candidate):
            return candidate
    return None


def sanitize_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return cleaned or "repo"


def choose_output_name(base_name: str, used: set[str]) -> str:
    stem = sanitize_name(base_name)
    candidate = f"{stem}.txt"

    index = 2
    while candidate in used:
        candidate = f"{stem}_{index}.txt"
        index += 1

    used.add(candidate)
    return candidate


def count_commits(repo_path: Path) -> int | None:
    result = subprocess.run(
        ["git", "-C", str(repo_path), "rev-list", "--count", "HEAD"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None

    text = result.stdout.strip()
    if not text:
        return 0

    try:
        return int(text)
    except ValueError:
        return None


def write_git_log(
    repo_path: Path,
    output_path: Path,
    max_count: int | None,
    progress: ProgressReporter,
    repo_index: int,
    repo_total: int,
    repo_label: str,
) -> None:
    total_commits = count_commits(repo_path)
    if total_commits is not None and max_count is not None:
        total_commits = min(total_commits, max_count)

    cmd = ["git", "-C", str(repo_path), "log", "-p", "--no-color"]
    if max_count is not None:
        cmd.append(f"--max-count={max_count}")

    progress.update(
        repo_index,
        repo_total,
        repo_label,
        "export",
        0.0,
        "collecting commits",
    )

    commit_count = 0
    last_tick = 0.0

    with output_path.open("wb") as outfile:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert process.stdout is not None
        assert process.stderr is not None

        for raw_line in process.stdout:
            outfile.write(raw_line)

            if COMMIT_HEADER_RE_BYTES.match(raw_line):
                commit_count += 1

                if total_commits and total_commits > 0:
                    ratio = min(commit_count / total_commits, 1.0)
                    detail = f"{commit_count}/{total_commits} commits"
                else:
                    ratio = 0.0
                    detail = f"{commit_count} commits"

                now = time.monotonic()
                if now - last_tick >= 0.10:
                    progress.update(
                        repo_index,
                        repo_total,
                        repo_label,
                        "export",
                        ratio,
                        detail,
                    )
                    last_tick = now

        stderr_bytes = process.stderr.read()
        return_code = process.wait()

    if total_commits and total_commits > 0:
        ratio = min(commit_count / total_commits, 1.0)
        detail = f"{commit_count}/{total_commits} commits"
    else:
        ratio = 1.0
        detail = f"{commit_count} commits"

    progress.update(
        repo_index,
        repo_total,
        repo_label,
        "export",
        ratio,
        detail,
    )
    progress.finish()

    if return_code != 0:
        error_text = stderr_bytes.decode("utf-8", errors="replace").strip()
        raise RuntimeError(error_text or "git log failed")


def clone_remote_repo(
    remote_url: str,
    clone_dir: Path,
    progress: ProgressReporter,
    repo_index: int,
    repo_total: int,
    repo_label: str,
) -> Path:
    repo_path = clone_dir / "repo.git"
    progress.update(repo_index, repo_total, repo_label, "clone", 0.0, "starting")

    process = subprocess.Popen(
        ["git", "clone", "--progress", "--bare", remote_url, str(repo_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert process.stderr is not None

    progress_percent = 0.0
    progress_label = "starting"
    errors: list[str] = []

    for raw_line in process.stderr:
        line = raw_line.strip()
        if not line:
            continue
        errors.append(line)

        match = CLONE_PROGRESS_RE.search(line)
        if match:
            phase = match.group(1).lower().replace(" ", "_")
            value = min(int(match.group(2)), 100)
            progress_label = phase
            progress_percent = clone_phase_ratio(progress_label, value / 100.0)
            progress.update(
                repo_index,
                repo_total,
                repo_label,
                "clone",
                progress_percent,
                progress_label,
            )
            continue

        match = GENERIC_PERCENT_RE.search(line)
        if match:
            value = min(int(match.group(1)), 100)
            progress_percent = clone_phase_ratio(progress_label, value / 100.0)
            progress.update(
                repo_index,
                repo_total,
                repo_label,
                "clone",
                progress_percent,
                progress_label,
            )

    return_code = process.wait()
    progress.update(repo_index, repo_total, repo_label, "clone", 1.0, "done")
    progress.finish()

    if return_code != 0:
        error_text = "\n".join(errors[-3:]).strip()
        raise RuntimeError(error_text or "git clone failed")
    return repo_path


def main() -> None:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent

    if args.input is None:
        cwd_input = Path.cwd() / "input.txt"
        input_path = cwd_input if cwd_input.exists() else (script_dir / "input.txt")
    else:
        input_path = args.input

    input_path = input_path.resolve()
    output_dir = args.output_dir.resolve()

    repo_specs = load_repo_specs(input_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    generated_files: list[Path] = []
    used_names: set[str] = set()
    progress = ProgressReporter()

    print(f"Input file: {input_path}")
    print(f"Output dir: {output_dir}")
    print(f"Repositories: {len(repo_specs)}")

    for repo_index, repo_spec in enumerate(repo_specs, start=1):
        if is_remote_repo_spec(repo_spec):
            remote_url = normalize_remote_spec(repo_spec)
            repo_label = remote_repo_name(repo_spec)
            output_name = choose_output_name(repo_label, used_names)
            output_path = output_dir / output_name

            try:
                with tempfile.TemporaryDirectory(prefix="commit_crawler_") as temp_dir:
                    repo_path = clone_remote_repo(
                        remote_url,
                        Path(temp_dir),
                        progress,
                        repo_index,
                        len(repo_specs),
                        repo_label,
                    )
                    write_git_log(
                        repo_path,
                        output_path,
                        args.max_count,
                        progress,
                        repo_index,
                        len(repo_specs),
                        repo_label,
                    )
            except RuntimeError as error:
                failures.append(f"{repo_spec}: {error}")
                progress.finish()
                print(f"[FAIL] {repo_spec} -> {error}", file=sys.stderr)
                continue

            generated_files.append(output_path)
            print(f"[OK] {repo_spec} -> {output_path}")
            continue

        repo_path = resolve_repo_path(repo_spec, input_path)
        if repo_path is None:
            failures.append(
                f"{repo_spec}: repository not found (local) and not a valid remote spec"
            )
            progress.finish()
            print(
                f"[FAIL] {repo_spec} -> repository not found",
                file=sys.stderr,
            )
            continue

        repo_label = repo_path.name or repo_spec
        output_name = choose_output_name(repo_label, used_names)
        output_path = output_dir / output_name

        try:
            write_git_log(
                repo_path,
                output_path,
                args.max_count,
                progress,
                repo_index,
                len(repo_specs),
                repo_label,
            )
        except RuntimeError as error:
            failures.append(f"{repo_spec}: {error}")
            progress.finish()
            print(f"[FAIL] {repo_spec} -> {error}", file=sys.stderr)
            continue

        generated_files.append(output_path)
        print(f"[OK] {repo_spec} -> {output_path}")

    if args.manifest is not None:
        write_manifest(
            args.manifest.resolve(),
            input_path,
            output_dir,
            generated_files,
            failures,
        )

    if failures:
        print("\nFailed repositories:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        raise SystemExit(1)

    print("\nAll repositories processed successfully.")


if __name__ == "__main__":
    main()
