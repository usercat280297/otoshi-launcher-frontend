#!/usr/bin/env python3
"""
Hugging Face high-throughput downloader.

Highlights:
- Folder-level download via snapshot_download (fast + resume + multi-worker).
- File-level fallback with parallel workers.
- Retry/backoff with optional auto-wait on 429 responses.
- Optional checksum verification from manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Iterable, Optional

from huggingface_hub import HfApi, hf_hub_download, snapshot_download

try:
    import rarfile
except Exception:
    rarfile = None

DEFAULT_REPO_ID = os.getenv("HF_REPO_ID", "MangaVNteam/Assassin-Creed-Odyssey-Crack")
DEFAULT_REPO_TYPE = os.getenv("HF_REPO_TYPE", "dataset")
DEFAULT_REVISION = os.getenv("HF_REVISION", "main")


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line or line.strip().startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"')
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception:
        return


def load_env() -> None:
    candidates = [
        Path(".env"),
        Path("..") / ".env",
        Path("..") / ".." / ".env",
    ]
    for candidate in candidates:
        load_env_file(candidate)


def get_token() -> Optional[str]:
    return os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN")


def normalize_path(value: str) -> str:
    return value.replace("\\", "/").lstrip("/")


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def find_manifest(path: Path) -> Optional[Path]:
    if path.is_file() and path.name.startswith("manifest"):
        return path
    if path.is_dir():
        manifests = sorted(path.glob("manifest*.json"))
        return manifests[0] if manifests else None
    return None


def parse_rate_limit_wait_seconds(message: str) -> int:
    msg = (message or "").lower()
    wait_seconds = 15
    hour_match = re.search(r"about\s+(\d+)\s*hour", msg)
    if hour_match:
        wait_seconds = max(wait_seconds, int(hour_match.group(1)) * 3600)
    minute_match = re.search(r"about\s+(\d+)\s*minute", msg)
    if minute_match:
        wait_seconds = max(wait_seconds, int(minute_match.group(1)) * 60)
    second_match = re.search(r"about\s+(\d+)\s*second", msg)
    if second_match:
        wait_seconds = max(wait_seconds, int(second_match.group(1)))
    retry_after = re.search(r"retry-after[:= ]+(\d+)", msg)
    if retry_after:
        wait_seconds = max(wait_seconds, int(retry_after.group(1)))
    return wait_seconds + 2


def is_rate_limited(message: str) -> bool:
    msg = (message or "").lower()
    return "429" in msg or "rate limit" in msg or "too many requests" in msg


def sleep_with_status(total_seconds: int) -> None:
    remaining = int(max(0, total_seconds))
    while remaining > 0:
        step = min(30, remaining)
        time.sleep(step)
        remaining -= step
        if remaining > 0:
            print(f"   waiting... {remaining}s remaining")


def iter_repo_files(
    api: HfApi,
    repo_id: str,
    repo_type: str,
    revision: str,
    token: str,
    hf_folder: str,
) -> list[tuple[str, Optional[int]]]:
    files: list[tuple[str, Optional[int]]] = []
    try:
        tree = api.list_repo_tree(
            repo_id=repo_id,
            repo_type=repo_type,
            revision=revision,
            token=token,
            path_in_repo=hf_folder,
            recursive=True,
        )
        for item in tree:
            if getattr(item, "type", "") == "file":
                files.append((item.path, getattr(item, "size", None)))
    except Exception:
        return []
    return files


def extract_archives(paths: Iterable[Path], output_dir: Path) -> None:
    for archive in paths:
        try:
            if archive.suffix.lower() == ".zip":
                import zipfile

                with zipfile.ZipFile(archive, "r") as zf:
                    zf.extractall(output_dir)
            elif archive.suffix.lower() == ".rar":
                if rarfile is None:
                    print(f"rarfile not installed, skipping {archive.name}")
                    continue
                with rarfile.RarFile(archive, "r") as rf:
                    rf.extractall(output_dir)
        except Exception as exc:
            print(f"Failed to extract {archive.name}: {exc}")


def snapshot_fetch(
    repo_id: str,
    repo_type: str,
    revision: str,
    token: str,
    files: list[tuple[str, Optional[int]]],
    output_dir: Path,
    workers: int,
    retries: int,
    wait_on_rate_limit: bool,
    rate_limit_max_wait: int,
) -> Optional[list[Path]]:
    allow_patterns = [filename for filename, _ in files]
    if not allow_patterns:
        return []

    attempt = 1
    while attempt <= retries:
        try:
            snapshot_download(
                repo_id=repo_id,
                repo_type=repo_type,
                revision=revision,
                token=token,
                allow_patterns=allow_patterns,
                local_dir=str(output_dir),
                local_dir_use_symlinks=False,
                resume_download=True,
                max_workers=max(1, workers),
            )
            downloaded: list[Path] = []
            for filename, _ in files:
                local_path = output_dir / normalize_path(filename)
                if local_path.exists():
                    downloaded.append(local_path)
            return downloaded
        except Exception as exc:
            message = str(exc)
            if is_rate_limited(message):
                if not wait_on_rate_limit:
                    raise
                wait_seconds = parse_rate_limit_wait_seconds(message)
                if wait_seconds > rate_limit_max_wait:
                    raise RuntimeError(
                        f"Rate-limit wait {wait_seconds}s exceeds max {rate_limit_max_wait}s"
                    ) from exc
                print(f"Snapshot download rate-limited. Waiting {wait_seconds}s...")
                sleep_with_status(wait_seconds)
                continue
            if attempt >= retries:
                raise
            delay = min(2 ** attempt, 20)
            print(f"Snapshot retry {attempt}/{retries - 1} in {delay}s: {exc}")
            time.sleep(delay)
            attempt += 1
    return None


def file_fetch(
    repo_id: str,
    repo_type: str,
    revision: str,
    token: str,
    files: list[tuple[str, Optional[int]]],
    output_dir: Path,
    workers: int,
    retries: int,
    wait_on_rate_limit: bool,
    rate_limit_max_wait: int,
) -> list[Path]:
    def download_one(entry: tuple[str, Optional[int]]) -> Path:
        filename, _size = entry
        attempt = 1
        while attempt <= retries:
            try:
                local_path = hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    repo_type=repo_type,
                    revision=revision,
                    token=token,
                    local_dir=str(output_dir),
                    local_dir_use_symlinks=False,
                    resume_download=True,
                )
                return Path(local_path)
            except Exception as exc:
                message = str(exc)
                if is_rate_limited(message):
                    if not wait_on_rate_limit:
                        raise
                    wait_seconds = parse_rate_limit_wait_seconds(message)
                    if wait_seconds > rate_limit_max_wait:
                        raise RuntimeError(
                            f"Rate-limit wait {wait_seconds}s exceeds max {rate_limit_max_wait}s for {filename}"
                        ) from exc
                    print(f"Rate-limited while downloading {Path(filename).name}. Waiting {wait_seconds}s...")
                    sleep_with_status(wait_seconds)
                    continue
                if attempt >= retries:
                    raise
                delay = min(2 ** attempt, 20)
                time.sleep(delay)
                attempt += 1
        raise RuntimeError(f"Failed to download {filename}")

    downloaded: list[Path] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(download_one, entry): entry for entry in files}
        total = len(futures)
        completed = 0
        for future in as_completed(futures):
            completed += 1
            entry = futures[future]
            try:
                path = future.result()
                downloaded.append(path)
                print(f"[{completed}/{total}] Downloaded {Path(entry[0]).name}")
            except Exception as exc:
                print(f"[{completed}/{total}] Failed {Path(entry[0]).name}: {exc}")
    return downloaded


def main() -> int:
    load_env()

    parser = argparse.ArgumentParser(description="Download HF chunk artifacts")
    parser.add_argument("--manifest", help="Manifest file or folder containing manifest")
    parser.add_argument("--repo-id", default=DEFAULT_REPO_ID, help="HF repo id")
    parser.add_argument("--repo-type", default=DEFAULT_REPO_TYPE, help="dataset | model | space")
    parser.add_argument("--revision", default=DEFAULT_REVISION, help="HF revision (default: main)")
    parser.add_argument("--hf-folder", help="Folder in HF repo to download")
    parser.add_argument("--output", default="./downloads", help="Output directory")
    parser.add_argument("--workers", type=int, default=12, help="Parallel download workers")
    parser.add_argument("--strategy", choices=["auto", "snapshot", "files"], default="auto", help="Download strategy")
    parser.add_argument("--retries", type=int, default=4, help="Retry attempts")
    parser.add_argument("--wait-on-rate-limit", action="store_true", default=True, help="Wait and auto-resume on 429")
    parser.add_argument("--no-wait-on-rate-limit", action="store_false", dest="wait_on_rate_limit", help="Fail fast on 429")
    parser.add_argument("--rate-limit-max-wait", type=int, default=3900, help="Max auto-wait seconds on 429")
    parser.add_argument("--verify", action="store_true", help="Verify sha256 against manifest")
    parser.add_argument("--extract", action="store_true", help="Extract zip/rar archives after download")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of files")
    args = parser.parse_args()

    token = get_token()
    if not token:
        print("Missing HUGGINGFACE_TOKEN / HF_TOKEN")
        return 1

    manifest_path = None
    manifest = None
    if args.manifest:
        manifest_path = find_manifest(Path(args.manifest))
    if manifest_path:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = None

    repo_id = manifest.get("hf_repo_id") if manifest else args.repo_id
    repo_type = manifest.get("hf_repo_type") if manifest else args.repo_type
    revision = manifest.get("hf_revision") if manifest else args.revision
    hf_folder = manifest.get("hf_folder") if manifest else args.hf_folder

    if not hf_folder:
        print("Missing --hf-folder (or hf_folder in manifest)")
        return 1

    hf_folder = normalize_path(hf_folder)
    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    files: list[tuple[str, Optional[int]]] = []
    manifest_chunks = []

    if manifest:
        for chunk in manifest.get("chunks", []):
            path = chunk.get("path") or chunk.get("filename")
            if not path:
                continue
            manifest_chunks.append(chunk)
            files.append((normalize_path(f"{hf_folder}/{path}"), chunk.get("size")))
    else:
        api = HfApi()
        files = iter_repo_files(api, repo_id, repo_type, revision, token, hf_folder)

    if args.limit and len(files) > args.limit:
        files = files[: args.limit]

    if not files:
        print("No files to download")
        return 1

    retries = max(1, int(args.retries))
    max_wait = max(60, int(args.rate_limit_max_wait))
    workers = max(1, int(args.workers))
    downloaded: list[Path] = []

    start = time.time()
    if args.strategy in ("auto", "snapshot"):
        try:
            print(f"Using snapshot strategy (files={len(files)}, workers={workers})...")
            snapshot_result = snapshot_fetch(
                repo_id=repo_id,
                repo_type=repo_type,
                revision=revision,
                token=token,
                files=files,
                output_dir=output_dir,
                workers=workers,
                retries=retries,
                wait_on_rate_limit=args.wait_on_rate_limit,
                rate_limit_max_wait=max_wait,
            )
            if snapshot_result is not None:
                downloaded = snapshot_result
            elif args.strategy == "snapshot":
                print("Snapshot strategy failed.")
                return 2
        except Exception as exc:
            if args.strategy == "snapshot":
                print(f"Snapshot strategy failed: {exc}")
                return 2
            print(f"Snapshot strategy failed, fallback to file mode: {exc}")

    if not downloaded:
        print(f"Using file strategy (files={len(files)}, workers={workers})...")
        downloaded = file_fetch(
            repo_id=repo_id,
            repo_type=repo_type,
            revision=revision,
            token=token,
            files=files,
            output_dir=output_dir,
            workers=workers,
            retries=retries,
            wait_on_rate_limit=args.wait_on_rate_limit,
            rate_limit_max_wait=max_wait,
        )

    if args.verify and manifest_chunks:
        print("Verifying checksums...")
        for chunk in manifest_chunks:
            path = chunk.get("path") or chunk.get("filename")
            if not path:
                continue
            expected = chunk.get("hash")
            if not expected:
                continue
            local_path = output_dir / normalize_path(f"{hf_folder}/{path}")
            if not local_path.exists():
                print(f"Missing {local_path}")
                continue
            actual = sha256_file(local_path)
            if actual.lower() != str(expected).lower():
                print(f"Hash mismatch for {local_path.name}")

    if args.extract:
        extract_archives(downloaded, output_dir)

    elapsed = time.time() - start
    success = len([item for item in downloaded if item.exists()])
    print(f"Done in {elapsed:.1f}s | files ready: {success}/{len(files)}")
    return 0 if success > 0 else 2


if __name__ == "__main__":
    sys.exit(main())

