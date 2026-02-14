#!/usr/bin/env python3
"""
Hugging Face chunk uploader.
- Loads token from HUGGINGFACE_TOKEN or HF_TOKEN (.env supported).
- Uploads a folder (chunks + manifest) while preserving structure.
- Updates manifest with HF metadata and chunk URLs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import quote

from huggingface_hub import HfApi, login, whoami

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


def find_manifest(folder: Path) -> Optional[Path]:
    manifests = sorted(folder.glob("manifest*.json"))
    return manifests[0] if manifests else None


def default_hf_folder(folder: Path, manifest: Optional[dict]) -> str:
    if manifest:
        game_id = manifest.get("game_id") or manifest.get("slug")
        version = manifest.get("version")
        if game_id and version:
            return normalize_path(f"games/{game_id}/{version}")
    return normalize_path(folder.name)


def build_base_url(repo_id: str, repo_type: str, revision: str) -> str:
    if repo_type == "model":
        return f"https://huggingface.co/{repo_id}/resolve/{revision}"
    if repo_type == "space":
        return f"https://huggingface.co/spaces/{repo_id}/resolve/{revision}"
    return f"https://huggingface.co/datasets/{repo_id}/resolve/{revision}"


def update_manifest(
    manifest_path: Path,
    manifest: dict,
    repo_id: str,
    repo_type: str,
    revision: str,
    hf_folder: str,
) -> None:
    base_url = build_base_url(repo_id, repo_type, revision)
    manifest["hf_repo_id"] = repo_id
    manifest["hf_repo"] = repo_id
    manifest["hf_repo_type"] = repo_type
    manifest["hf_revision"] = revision
    manifest["hf_folder"] = hf_folder
    manifest["hf_game_path"] = hf_folder
    manifest["hf_base_url"] = base_url
    manifest["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")

    for chunk in manifest.get("chunks", []):
        chunk_path = chunk.get("path") or chunk.get("filename")
        if not chunk_path:
            continue
        chunk["path"] = normalize_path(chunk_path)
        full_path = normalize_path(f"{hf_folder}/{chunk['path']}")
        chunk["url"] = f"{base_url.rstrip('/')}/{quote(full_path)}"

    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")


def iter_files(folder: Path) -> Iterable[Path]:
    for item in sorted(folder.rglob("*")):
        if item.is_file():
            yield item


def list_repo_files(api: HfApi, repo_id: str, repo_type: str, revision: str, token: str) -> set[str]:
    try:
        files = api.list_repo_files(
            repo_id=repo_id,
            repo_type=repo_type,
            revision=revision,
            token=token,
        )
        return set(files)
    except Exception:
        return set()


def upload_file(api: HfApi, repo_id: str, repo_type: str, revision: str, token: str, path: Path, repo_path: str) -> None:
    api.upload_file(
        path_or_fileobj=str(path),
        path_in_repo=repo_path,
        repo_id=repo_id,
        repo_type=repo_type,
        revision=revision,
        token=token,
        create_pr=False,
        commit_message=f"Upload {path.name}",
    )


def is_commit_rate_limited(message: str) -> bool:
    msg = (message or "").lower()
    return "too many requests" in msg and "rate limit for repository commits" in msg


def parse_rate_limit_wait_seconds(message: str) -> int:
    msg = (message or "").lower()
    wait_seconds = 3600
    hour_match = re.search(r"about\s+(\d+)\s*hour", msg)
    if hour_match:
        wait_seconds = max(wait_seconds, int(hour_match.group(1)) * 3600)
    minute_match = re.search(r"about\s+(\d+)\s*minute", msg)
    if minute_match:
        wait_seconds = max(wait_seconds, int(minute_match.group(1)) * 60)
    second_match = re.search(r"about\s+(\d+)\s*second", msg)
    if second_match:
        wait_seconds = max(wait_seconds, int(second_match.group(1)))
    return max(30, wait_seconds + 5)


def wait_with_status(total_seconds: int, interval_seconds: int = 30) -> None:
    remaining = max(0, int(total_seconds))
    while remaining > 0:
        step = min(interval_seconds, remaining)
        time.sleep(step)
        remaining -= step
        if remaining > 0:
            print(f"   waiting... {remaining}s remaining")


def upload_folder_once(
    api: HfApi,
    repo_id: str,
    repo_type: str,
    revision: str,
    token: str,
    folder: Path,
    hf_folder: str,
) -> None:
    api.upload_folder(
        folder_path=str(folder),
        path_in_repo=hf_folder,
        repo_id=repo_id,
        repo_type=repo_type,
        revision=revision,
        token=token,
        create_pr=False,
        commit_message=f"Upload folder {folder.name}",
    )


def commit_batch_upload(
    api: HfApi,
    jobs: list[tuple[Path, str]],
    repo_id: str,
    repo_type: str,
    revision: str,
    token: str,
    batch_size: int,
    retries: int,
    wait_on_rate_limit: bool,
    rate_limit_max_wait: int,
) -> tuple[int, int]:
    try:
        from huggingface_hub import CommitOperationAdd
    except Exception as exc:
        raise RuntimeError(f"CommitOperationAdd unavailable: {exc}") from exc

    failures = 0
    uploaded = 0
    batch_size = max(1, batch_size)
    batches = [jobs[i:i + batch_size] for i in range(0, len(jobs), batch_size)]

    for idx, batch in enumerate(batches, start=1):
        attempt = 1
        while attempt <= retries:
            try:
                operations = [
                    CommitOperationAdd(path_in_repo=repo_path, path_or_fileobj=str(file_path))
                    for file_path, repo_path in batch
                ]
                api.create_commit(
                    repo_id=repo_id,
                    repo_type=repo_type,
                    revision=revision,
                    operations=operations,
                    token=token,
                    create_pr=False,
                    commit_message=f"Upload batch {idx}/{len(batches)} ({len(batch)} files)",
                )
                uploaded += len(batch)
                print(f"[{idx}/{len(batches)}] Uploaded batch of {len(batch)} file(s)")
                break
            except Exception as exc:
                message = str(exc)
                if is_commit_rate_limited(message):
                    if not wait_on_rate_limit:
                        print(f"[{idx}/{len(batches)}] Rate limit hit, stopping: {exc}")
                        failures += len(batch)
                        break
                    wait_seconds = parse_rate_limit_wait_seconds(message)
                    if wait_seconds > rate_limit_max_wait:
                        print(
                            f"[{idx}/{len(batches)}] Rate limit wait {wait_seconds}s > max {rate_limit_max_wait}s, stopping."
                        )
                        failures += len(batch)
                        break
                    print(
                        f"[{idx}/{len(batches)}] Rate limit hit. Auto-wait {wait_seconds}s then retry batch..."
                    )
                    wait_with_status(wait_seconds)
                    continue
                if attempt >= retries:
                    print(f"[{idx}/{len(batches)}] Failed batch after {retries} attempt(s): {exc}")
                    failures += len(batch)
                    break
                delay = 2 * attempt
                print(f"[{idx}/{len(batches)}] Retry {attempt}/{retries - 1} in {delay}s: {exc}")
                time.sleep(delay)
                attempt += 1

    return uploaded, failures


def main() -> int:
    load_env()

    parser = argparse.ArgumentParser(description="Upload chunk folders to Hugging Face")
    parser.add_argument("--folder", required=True, help="Local folder containing chunks and manifest")
    parser.add_argument("--hf-folder", help="Target folder in HF repo (default: derived from manifest)")
    parser.add_argument("--repo-id", default=DEFAULT_REPO_ID, help="HF repo id")
    parser.add_argument("--repo-type", default=DEFAULT_REPO_TYPE, help="dataset | model | space")
    parser.add_argument("--revision", default=DEFAULT_REVISION, help="HF revision (default: main)")
    parser.add_argument("--workers", type=int, default=4, help="Parallel uploads")
    parser.add_argument("--strategy", choices=["auto", "folder", "batch", "file"], default="auto", help="Upload strategy")
    parser.add_argument("--batch-size", type=int, default=32, help="Files per commit when using batch strategy")
    parser.add_argument("--retries", type=int, default=4, help="Retry attempts")
    parser.add_argument("--wait-on-rate-limit", action="store_true", default=True, help="Wait and continue on 429 commit limit")
    parser.add_argument("--no-wait-on-rate-limit", action="store_false", dest="wait_on_rate_limit", help="Fail fast on 429 commit limit")
    parser.add_argument("--rate-limit-max-wait", type=int, default=3900, help="Max auto-wait seconds on 429 (default: 3900)")
    parser.add_argument("--dry-run", action="store_true", help="Print planned uploads only")
    parser.add_argument("--skip-manifest-update", action="store_true", help="Skip manifest update")
    args = parser.parse_args()

    folder = Path(args.folder).resolve()
    if not folder.exists() or not folder.is_dir():
        print(f"Folder not found: {folder}")
        return 1

    token = get_token()
    if not token:
        print("Missing HUGGINGFACE_TOKEN / HF_TOKEN")
        return 1

    api = HfApi()
    try:
        login(token=token)
        profile = whoami()
        print(f"Authenticated as: {profile.get('name')}")
    except Exception as exc:
        print(f"Auth failed: {exc}")
        return 1

    manifest_path = find_manifest(folder)
    manifest = None
    if manifest_path:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = None

    hf_folder = normalize_path(args.hf_folder or default_hf_folder(folder, manifest))

    if manifest and not args.skip_manifest_update:
        update_manifest(manifest_path, manifest, args.repo_id, args.repo_type, args.revision, hf_folder)
        print(f"Manifest updated: {manifest_path}")

    existing = list_repo_files(api, args.repo_id, args.repo_type, args.revision, token)
    upload_jobs: list[tuple[Path, str]] = []
    for file_path in iter_files(folder):
        rel_path = normalize_path(str(file_path.relative_to(folder)))
        repo_path = normalize_path(f"{hf_folder}/{rel_path}")
        if repo_path in existing:
            continue
        upload_jobs.append((file_path, repo_path))

    print(f"Files to upload: {len(upload_jobs)}")
    if args.dry_run:
        for file_path, repo_path in upload_jobs[:20]:
            print(f"- {file_path.name} -> {repo_path}")
        return 0

    if not upload_jobs:
        print("Nothing to upload")
        return 0

    if args.strategy in ("auto", "folder"):
        try:
            print("Trying upload_folder strategy...")
            upload_folder_once(
                api=api,
                repo_id=args.repo_id,
                repo_type=args.repo_type,
                revision=args.revision,
                token=token,
                folder=folder,
                hf_folder=hf_folder,
            )
            print("upload_folder complete")
            return 0
        except Exception as exc:
            if args.strategy == "folder":
                print(f"upload_folder failed: {exc}")
                return 2
            print(f"upload_folder failed, fallback to batch/file mode: {exc}")

    if args.strategy in ("auto", "batch"):
        uploaded, failures = commit_batch_upload(
            api=api,
            jobs=upload_jobs,
            repo_id=args.repo_id,
            repo_type=args.repo_type,
            revision=args.revision,
            token=token,
            batch_size=args.batch_size,
            retries=max(1, args.retries),
            wait_on_rate_limit=args.wait_on_rate_limit,
            rate_limit_max_wait=max(60, args.rate_limit_max_wait),
        )
        print(f"Batch upload result: uploaded={uploaded}, failures={failures}")
        if failures:
            return 2
        return 0

    from concurrent.futures import ThreadPoolExecutor, as_completed

    failures = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        def worker(job: tuple[Path, str]) -> str:
            file_path, repo_path = job
            for attempt in range(1, max(2, args.retries) + 1):
                try:
                    upload_file(api, args.repo_id, args.repo_type, args.revision, token, file_path, repo_path)
                    return repo_path
                except Exception as exc:
                    message = str(exc)
                    if is_commit_rate_limited(message):
                        if not args.wait_on_rate_limit:
                            raise exc
                        wait_seconds = parse_rate_limit_wait_seconds(message)
                        if wait_seconds > max(60, args.rate_limit_max_wait):
                            raise RuntimeError(
                                f"Rate limit wait {wait_seconds}s > max {args.rate_limit_max_wait}s"
                            ) from exc
                        print(f"Rate limit hit for {file_path.name}, waiting {wait_seconds}s...")
                        wait_with_status(wait_seconds)
                        continue
                    if attempt >= max(2, args.retries):
                        raise exc
                    time.sleep(2 * attempt)
            return repo_path

        futures = {executor.submit(worker, job): job for job in upload_jobs}
        total = len(futures)
        completed = 0
        for future in as_completed(futures):
            completed += 1
            job = futures[future]
            try:
                future.result()
                print(f"[{completed}/{total}] Uploaded {job[0].name}")
            except Exception as exc:
                failures += 1
                print(f"[{completed}/{total}] Failed {job[0].name}: {exc}")

    if failures:
        print(f"Upload finished with {failures} failures")
        return 2

    print("Upload complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
