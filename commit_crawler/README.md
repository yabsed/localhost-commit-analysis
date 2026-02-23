# commit_crawler

Generate git logs from repositories in `input.txt` and build `merged_git_logs.json`.

## Final boss (recommended)

1. Edit `commit_crawler/input.txt` and add repositories, one per line.
2. Recommended input format: GitHub remote URLs.
3. Run:

```bash
python3 commit_crawler.py
```

This runs the full pipeline:

- crawl: `input.txt -> commit_crawler/repo/<owner>/<repo>.txt` (remote 기준)
- crawl(local): `input.txt -> commit_crawler/repo/_local/<repo>.txt`
- merge: `*.txt -> commit_crawler/merged_git_logs.json`

If a target `.txt` already exists, crawler reuses it and skips clone/log fetch.
Use `--force` to refresh.
By default, crawler prunes stale `.txt` files in `commit_crawler/repo` that are
not referenced by current `input.txt` to prevent unbounded file growth.

## Input formats

- `https://github.com/owner/repo.git`
- `https://github.com/owner/repo`
- `owner/repo` (auto-converted to GitHub URL)
- local path (supported for compatibility)

## Pipeline options

- `--input <path>`: custom repo input path (default: `commit_crawler/input.txt`)
- `--output-dir <path>`: log txt output directory (default: `commit_crawler/repo`)
- `--output-json <path>`: merged JSON output path (default: `commit_crawler/merged_git_logs.json`)
- `--max-count <n>`: limit commits per repository for test runs
- `--encoding <name>`: merge encoding (default: `utf-8`)
- `--force`: existing `.txt` 무시하고 다시 크롤링
- `--no-prune`: stale `.txt` 자동 정리 비활성화

## Worker scripts

- `commit_crawler/commit_crawler.py`: crawler worker (`input.txt -> *.txt`)
- `commit_crawler/merge_git_logs_to_json.py`: merge worker (`*.txt -> merged_git_logs.json`)

Merged JSON schema is the same as existing `merged_git_logs.json`.

## Git tracking

`commit_crawler/.gitignore` ignores generated `*.txt` files and `__pycache__/`.
