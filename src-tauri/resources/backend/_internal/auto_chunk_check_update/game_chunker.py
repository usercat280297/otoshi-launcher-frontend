#!/usr/bin/env python3
"""
Game Chunker - Chia game thÃ nh chunks vá»›i compression
Há»— trá»£ nhiá»u compression levels vÃ  chunk sizes
"""

import os
import shutil
import zipfile
import hashlib
import json
import time
from pathlib import Path
from typing import List, Dict
import argparse
import sys
import re
import threading
from queue import Queue, Empty
from urllib.parse import quote
from urllib.request import urlopen
from urllib.error import URLError, HTTPError


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
    script_dir = Path(__file__).resolve().parent
    candidates = [
        Path(".env"),
        Path("..") / ".env",
        Path("..") / ".." / ".env",
        Path("backend") / ".env",
        script_dir / ".env",
        script_dir.parent / ".env",
        script_dir.parent.parent / ".env",
    ]
    for candidate in candidates:
        load_env_file(candidate)


def get_token() -> str:
    return os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN") or ""


def normalize_path(value: str) -> str:
    return value.replace("\\", "/").lstrip("/")


def parse_bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def normalize_app_id(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    if not cleaned:
        return None
    digits = re.sub(r"[^0-9]", "", cleaned)
    return digits or None


def build_base_url(repo_id: str, repo_type: str, revision: str) -> str:
    if repo_type == "model":
        return f"https://huggingface.co/{repo_id}/resolve/{revision}"
    if repo_type == "space":
        return f"https://huggingface.co/spaces/{repo_id}/resolve/{revision}"
    return f"https://huggingface.co/datasets/{repo_id}/resolve/{revision}"


def _normalize_folder_name(value: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', (value or '').lower())


DEFAULT_VERSION = "v1.0"
DEFAULT_NEWS_API_BASE = os.getenv("NEWS_API_BASE") or os.getenv("VITE_API_URL") or "http://127.0.0.1:8000"
DEFAULT_VERSION_REGEX = r"\bv?\d+(?:\.\d+){1,4}[a-z]?\b"

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def _build_news_bases(api_base: str) -> List[str]:
    bases: List[str] = []

    def _add(value: str) -> None:
        if not value:
            return
        cleaned = value.strip().rstrip("/")
        if cleaned:
            bases.append(cleaned)

    _add(api_base)
    _add(os.getenv("NEWS_API_BASE") or os.getenv("VITE_API_URL"))

    backend_port = os.getenv("BACKEND_PORT")
    if backend_port and backend_port.isdigit():
        _add(f"http://127.0.0.1:{backend_port}")
        _add(f"http://localhost:{backend_port}")

    # Fallbacks similar to frontend dev defaults
    _add("http://127.0.0.1:8000")
    _add("http://localhost:8000")
    _add("http://127.0.0.1:8001")
    _add("http://localhost:8001")

    seen = set()
    unique: List[str] = []
    for base in bases:
        if base in seen:
            continue
        seen.add(base)
        unique.append(base)
    return unique


def _request_json(url: str, timeout: int = 10):
    try:
        with urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8")), ""
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return None, str(exc)



def _fetch_steam_news_items(app_id: str, verbose: bool = False) -> List[Dict]:
    """Fallback: fetch directly from Steam Web API"""
    url = (
        "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?"
        f"appid={app_id}&count=50&maxlength=0&format=json"
    )
    payload, err = _request_json(url, timeout=15)
    if payload is None:
        if verbose:
            print(f"??  Steam API failed: {err}")
        return []
    appnews = payload.get("appnews") if isinstance(payload, dict) else None
    items = appnews.get("newsitems") if isinstance(appnews, dict) else None
    if isinstance(items, list) and items:
        if verbose:
            print(f"? Steam API ok: {len(items)} items")
        return items
    if verbose:
        print("??  Steam API returned no news items")
    return []

def _extract_news_items(payload) -> List[Dict]:
    if not isinstance(payload, dict):
        return []
    items = payload.get("items")
    if isinstance(items, list):
        return items
    news = payload.get("news")
    if isinstance(news, dict):
        items = news.get("items")
        if isinstance(items, list):
            return items
    return []


def _fetch_news_items(app_id: str, api_base: str, verbose: bool = False) -> List[Dict]:
    bases = _build_news_bases(api_base)
    if not bases:
        return _fetch_steam_news_items(app_id, verbose=verbose)

    last_error = ""
    for base in bases:
        # Try news endpoint first
        url = f"{base}/steam/games/{app_id}/news?all=true"
        payload, err = _request_json(url)
        if payload is None:
            last_error = err
            if verbose:
                print(f"Ã¢Å¡Â Ã¯Â¸Â  News API failed: {url} ({err})")
        else:
            items = _extract_news_items(payload)
            if items:
                if verbose:
                    print(f"Ã¢Å“â€¦ News API ok: {url} ({len(items)} items)")
                return items
            if verbose:
                print(f"Ã¢Å¡Â Ã¯Â¸Â  News API empty: {url}")

        # Fallback to extended endpoint (matches UI)
        url_ext = f"{base}/steam/games/{app_id}/extended?news_all=true"
        payload, err = _request_json(url_ext)
        if payload is None:
            last_error = err
            if verbose:
                print(f"Ã¢Å¡Â Ã¯Â¸Â  Extended API failed: {url_ext} ({err})")
            continue
        items = _extract_news_items(payload)
        if items:
            if verbose:
                print(f"Ã¢Å“â€¦ Extended API ok: {url_ext} ({len(items)} items)")
            return items
        if verbose:
            print(f"Ã¢Å¡Â Ã¯Â¸Â  Extended API empty: {url_ext}")

    if verbose and last_error:
        print(f"Ã¢Å¡Â Ã¯Â¸Â  No news items fetched. Last error: {last_error}")
    return _fetch_steam_news_items(app_id, verbose=verbose)


def _extract_version_from_text(text: str, patterns: List[str]) -> str:
    if not text:
        return ""
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        raw = (match.group(1) if match.lastindex else match.group(0)).strip()
        if not raw:
            continue
        if raw.lower().startswith("v"):
            return "v" + raw[1:]
        return "v" + raw
    return ""


def _iter_text_candidates(item: Dict) -> List[str]:
    candidates: List[str] = []
    if not isinstance(item, dict):
        return candidates
    title = str(item.get("title") or "")
    contents = str(item.get("contents") or "")
    if title:
        candidates.append(title)
    if contents:
        candidates.append(contents)
    structured = item.get("structured_content")
    if structured:
        try:
            candidates.append(json.dumps(structured, ensure_ascii=False))
        except Exception:
            candidates.append(str(structured))
    patch_notes = item.get("patch_notes")
    if isinstance(patch_notes, list):
        for pn in patch_notes:
            if not isinstance(pn, dict):
                continue
            pn_title = str(pn.get("title") or "")
            pn_content = str(pn.get("content") or "")
            if pn_title:
                candidates.append(pn_title)
            if pn_content:
                candidates.append(pn_content)
    return candidates


def detect_version_from_news(app_id: str, api_base: str, pattern: str, verbose: bool = False) -> str:
    items = _fetch_news_items(app_id, api_base, verbose=verbose)
    if not items:
        return ""
    items_sorted = sorted(items, key=lambda i: i.get("date", 0) if isinstance(i, dict) else 0, reverse=True)

    patterns: List[str] = []
    if pattern:
        patterns.append(pattern)
    if DEFAULT_VERSION_REGEX not in patterns:
        patterns.append(DEFAULT_VERSION_REGEX)
    patterns.append(r"(?i)\b(?:version|ver|v)\s*[:\.-]?\s*(\d+(?:\.\d+){1,4}[a-z]?)\b")

    # Prefer title matches first
    for item in items_sorted:
        title = str(item.get("title") or "") if isinstance(item, dict) else ""
        version = _extract_version_from_text(title, patterns)
        if version:
            return version

    # Then scan other fields
    for item in items_sorted:
        for text in _iter_text_candidates(item if isinstance(item, dict) else {}):
            version = _extract_version_from_text(text, patterns)
            if version:
                return version
    return ""


# ============================================================================
# ðŸ†• DYNAMIC CHUNK MANAGER - Quáº£n lÃ½ chunks Ä‘á»™ng
# ============================================================================

class DiskSpaceMonitor:
    """Monitor disk space trÃªn drive (máº·c Ä‘á»‹nh E:)"""
    
    @staticmethod
    def get_disk_space(drive: str = "E:") -> tuple:
        """Tráº£ vá» (free_gb, total_gb)"""
        try:
            import shutil
            stats = shutil.disk_usage(drive)
            return stats.free / (1024**3), stats.total / (1024**3)
        except Exception as e:
            print(f"âš ï¸  KhÃ´ng thá»ƒ check disk space: {e}")
            return 0, 0
    
    @staticmethod
    def check_available_space(drive: str = "E:", required_gb: float = 1) -> bool:
        """Check xem cÃ³ Ä‘á»§ space khÃ´ng"""
        free_gb, _ = DiskSpaceMonitor.get_disk_space(drive)
        return free_gb >= required_gb
    
    @staticmethod
    def suggest_chunk_count(available_gb: float, min_chunks: int = 20, max_chunks: int = 24) -> int:
        """Suggest sá»‘ chunks dá»±a trÃªn disk space"""
        if available_gb < 5:
            return min_chunks  # Tá»‘i thiá»ƒu
        elif available_gb > 30:
            return max_chunks  # Tá»‘i Ä‘a
        else:
            # Linear interpolation
            ratio = (available_gb - 5) / (30 - 5)
            return int(min_chunks + ratio * (max_chunks - min_chunks))


class DynamicChunkManager:
    """Quáº£n lÃ½ chunks Ä‘á»™ng - liÃªn tá»¥c táº¡o chunks má»›i khi chunks cÅ© bá»‹ xÃ³a"""
    
    def __init__(self, output_dir: Path, target_count: int = 24, min_chunks: int = 20):
        self.output_dir = Path(output_dir)
        self.target_count = target_count
        self.min_chunks = min_chunks
        self.created_chunks = []
        self.monitor = DiskSpaceMonitor()
    
    def get_active_chunks(self) -> List[Path]:
        """Láº¥y danh sÃ¡ch chunks hiá»‡n táº¡i trong folder"""
        return sorted(self.output_dir.glob("chunk_*.zip"))
    
    def get_chunk_count(self) -> int:
        """Láº¥y sá»‘ lÆ°á»£ng chunks hiá»‡n táº¡i"""
        return len(self.get_active_chunks())
    
    def should_create_new_chunk(self) -> bool:
        """Kiá»ƒm tra xem cÃ³ nÃªn táº¡o chunk má»›i khÃ´ng"""
        current = self.get_chunk_count()
        free_gb, _ = self.monitor.get_disk_space()
        
        if current < self.min_chunks:
            print(f"âš ï¸  Chunks ({current}) < minimum ({self.min_chunks}), táº¡o thÃªm")
            return True
        
        if current < self.target_count and free_gb > 5:
            return True
        
        return False
    
    def report_status(self):
        """In tráº¡ng thÃ¡i chunks hiá»‡n táº¡i"""
        current = self.get_chunk_count()
        free_gb, total_gb = self.monitor.get_disk_space()
        chunks = self.get_active_chunks()
        total_size = sum(c.stat().st_size for c in chunks) / (1024**3)
        
        print(f"\nðŸ“Š DYNAMIC CHUNK STATUS:")
        print(f"   - Active: {current}/{self.target_count} chunks")
        print(f"   - Size: {total_size:.2f} GB")
        print(f"   - Disk E: {free_gb:.2f} GB free / {total_gb:.2f} GB total")
        print(f"   - Status: {'âœ… OK' if current >= self.min_chunks else 'âš ï¸  LOW'}")


class MaxSpeedUploader:
    """Uploader tá»‘i Æ°u cho speed - 16 workers, connection pooling, retry logic"""
    
    def __init__(self, token: str, repo_id: str, repo_type: str = "dataset", 
                 revision: str = "main", workers: int = 16):
        self.token = token
        self.repo_id = repo_id
        self.repo_type = repo_type
        self.revision = revision
        self.workers = min(workers, 16)  # Max 16 workers
        self._api = None
        self.stats = {
            'uploaded': 0,
            'failed': 0,
            'total_bytes': 0,
            'start_time': None
        }
    
    def get_api(self):
        """Lazy load API"""
        if self._api is None:
            from huggingface_hub import HfApi
            self._api = HfApi()
        return self._api
    
    def upload_chunk_fast(self, local_path: Path, repo_path: str, retries: int = 3) -> bool:
        """Upload chunk vá»›i retry logic"""
        api = self.get_api()
        
        for attempt in range(1, retries + 1):
            try:
                api.upload_file(
                    path_or_fileobj=str(local_path),
                    path_in_repo=repo_path,
                    repo_id=self.repo_id,
                    repo_type=self.repo_type,
                    revision=self.revision,
                    token=self.token,
                    create_pr=False,
                    commit_message=f"Upload {local_path.name}",
                )
                self.stats['uploaded'] += 1
                self.stats['total_bytes'] += local_path.stat().st_size
                return True
            except Exception as e:
                if attempt >= retries:
                    print(f"âŒ Upload failed after {retries} retries: {local_path.name}: {e}")
                    self.stats['failed'] += 1
                    return False
                wait_time = 2 ** attempt
                print(f"â³ Retry {attempt}/{retries} for {local_path.name} (wait {wait_time}s)...")
                time.sleep(wait_time)
        
        return False
    
    def report_speed(self):
        """Report upload speed"""
        if not self.stats['start_time']:
            return
        
        elapsed = time.time() - self.stats['start_time']
        speed_mbps = (self.stats['total_bytes'] / (1024**2)) / elapsed if elapsed > 0 else 0
        total_uploaded = self.stats['uploaded'] + self.stats['failed']
        
        print(f"\nâš¡ UPLOAD SPEED REPORT:")
        print(f"   - Uploaded: {self.stats['uploaded']}/{total_uploaded} chunks")
        print(f"   - Size: {self.stats['total_bytes'] / (1024**3):.2f} GB")
        print(f"   - Speed: {speed_mbps:.2f} MB/s")
        print(f"   - Failed: {self.stats['failed']}")
        print(f"   - Time: {elapsed/60:.1f} minutes")


class GameChunker:
    """
    Advanced game chunker vá»›i compression options
    """
    
    # Compression levels
    COMPRESSION_LEVELS = {
        0: {"name": "Store (KhÃ´ng nÃ©n)", "level": zipfile.ZIP_STORED, "speed": "âš¡ Ráº¥t nhanh", "ratio": "1:1"},
        1: {"name": "Deflate Fast", "level": zipfile.ZIP_DEFLATED, "speed": "ðŸš€ Nhanh", "ratio": "~1.2:1"},
        2: {"name": "Deflate Normal", "level": zipfile.ZIP_DEFLATED, "speed": "â±ï¸  Vá»«a", "ratio": "~1.5:1"},
        3: {"name": "Deflate Max", "level": zipfile.ZIP_DEFLATED, "speed": "ðŸ¢ Cháº­m", "ratio": "~2:1"},
        4: {"name": "BZIP2", "level": zipfile.ZIP_BZIP2, "speed": "ðŸŒ Ráº¥t cháº­m", "ratio": "~2.5:1"},
        5: {"name": "LZMA (Máº¡nh nháº¥t)", "level": zipfile.ZIP_LZMA, "speed": "ðŸ¢ðŸ¢ Cá»±c cháº­m", "ratio": "~3:1"},
        98: {"name": "HYBRID (ThÃ´ng minh - Fast)", "level": None, "speed": "ðŸŽ¯ Smart Fast", "ratio": "TÃ¹y file"},
        99: {"name": "HYBRID (ThÃ´ng minh - Max)", "level": None, "speed": "ðŸ¤– Smart Max", "ratio": "TÃ¹y file"},
        100: {"name": "AUTO (Tá»± Ä‘á»™ng nháº­n diá»‡n)", "level": None, "speed": "ðŸ¤– Smart", "ratio": "TÃ¹y game"},
    }
    
    # Chunk size presets
    CHUNK_PRESETS = {
        1: {"name": "25 MB", "size": 25},
        2: {"name": "50 MB - Recommended", "size": 50},
        3: {"name": "100 MB", "size": 100},
        4: {"name": "200 MB", "size": 200},
        5: {"name": "500 MB", "size": 500},
        6: {"name": "1 GB", "size": 1024},
        7: {"name": "AUTO (Tá»± Ä‘á»™ng dá»±a trÃªn dung lÆ°á»£ng)", "size": -1},
        8: {"name": "Custom (Tá»± nháº­p)", "size": None},
    }
    
    @staticmethod
    def calculate_chunk_count(total_size_gb: float, chunk_size_mb: int) -> int:
        """TÃ­nh sá»‘ chunks dá»±a trÃªn dung lÆ°á»£ng thá»±c táº¿"""
        if chunk_size_mb <= 0:
            return 0
        total_size_mb = total_size_gb * 1024
        return max(1, int((total_size_mb + chunk_size_mb - 1) / chunk_size_mb))

    @staticmethod
    def sanitize_filename(name: str) -> str:
        """Loáº¡i bá» kÃ½ tá»± khÃ´ng há»£p lá»‡ cho filenames trÃªn Windows vÃ  trim trailing dots/spaces."""
        if not isinstance(name, str):
            name = str(name)
        # Replace invalid characters: <>:"/\|?*
        safe = re.sub(r'[<>:\\"/\\|?*]', '_', name)
        # Trim trailing spaces and dots (invalid on Windows)
        safe = safe.rstrip(' .')
        return safe
    
    @staticmethod
    def scan_folder_size(folder_path: str) -> tuple:
        """Scan folder Ä‘á»ƒ láº¥y tá»•ng size mÃ  khÃ´ng cáº§n init GameChunker"""
        total_size = 0
        file_count = 0
        
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                filepath = Path(root) / file
                try:
                    total_size += filepath.stat().st_size
                    file_count += 1
                except:
                    pass
        
        return total_size, file_count
    
    @staticmethod
    def is_compressible_file(filepath: Path) -> bool:
        """
        Kiá»ƒm tra file cÃ³ nÃªn nÃ©n khÃ´ng
        """
        ext = filepath.suffix.lower()
        
        # Files Ä‘Ã£ nÃ©n - KHÃ”NG nÃªn nÃ©n thÃªm
        compressed_exts = {
            '.pak', '.zip', '.rar', '.7z', '.cab',  # Archives
            '.mp4', '.webm', '.avi', '.mkv',  # Videos
            '.jpg', '.jpeg', '.png', '.webp',  # Images
            '.mp3', '.ogg', '.wem', '.fsb',  # Audio compressed
            '.dll', '.exe', '.so',  # Binaries (thÆ°á»ng Ä‘Ã£ optimize)
        }
        
        # Files nÃªn nÃ©n
        compressible_exts = {
            '.txt', '.xml', '.json', '.ini', '.cfg', '.log',
            '.lua', '.py', '.js', '.css', '.html',
            '.csv', '.md', '.yaml', '.yml',
            '.wav', '.flac',  # Audio uncompressed
        }
        
        if ext in compressed_exts:
            return False
        elif ext in compressible_exts:
            return True
        else:
            # Unknown - máº·c Ä‘á»‹nh khÃ´ng nÃ©n (an toÃ n)
            return False
    
    @staticmethod
    def detect_file_types(game_folder: Path) -> Dict:
        """
        PhÃ¢n tÃ­ch loáº¡i files trong game Ä‘á»ƒ xÃ¡c Ä‘á»‹nh compression strategy
        """
        print(f"\nðŸ” Äang phÃ¢n tÃ­ch loáº¡i files...")
        
        file_types = {
            'compressed': [],  # Files Ä‘Ã£ nÃ©n: .pak, .zip, .rar, .7z, .mp4, .jpg
            'compressible': [],  # Files cÃ³ thá»ƒ nÃ©n: .txt, .xml, .json, .ini, .log
            'executable': [],  # Files thá»±c thi: .exe, .dll, .so
            'audio': [],  # Audio: .mp3, .ogg, .wav, .wem
            'other': []
        }
        
        compressed_exts = {'.pak', '.zip', '.rar', '.7z', '.cab', '.mp4', '.webm', '.jpg', '.jpeg', '.png', '.bik'}
        compressible_exts = {'.txt', '.xml', '.json', '.ini', '.cfg', '.log', '.lua', '.css', '.html', '.js'}
        executable_exts = {'.exe', '.dll', '.so', '.dylib'}
        audio_exts = {'.mp3', '.ogg', '.wav', '.wem', '.fsb'}
        
        total_size = 0
        for root, dirs, files in os.walk(game_folder):
            for file in files:
                filepath = Path(root) / file
                ext = filepath.suffix.lower()
                size = filepath.stat().st_size
                total_size += size
                
                if ext in compressed_exts:
                    file_types['compressed'].append((filepath, size))
                elif ext in compressible_exts:
                    file_types['compressible'].append((filepath, size))
                elif ext in executable_exts:
                    file_types['executable'].append((filepath, size))
                elif ext in audio_exts:
                    file_types['audio'].append((filepath, size))
                else:
                    file_types['other'].append((filepath, size))
        
        # TÃ­nh pháº§n trÄƒm
        stats = {
            'total_size': total_size,
            'compressed_ratio': sum(s for _, s in file_types['compressed']) / total_size * 100,
            'compressible_ratio': sum(s for _, s in file_types['compressible']) / total_size * 100,
            'executable_ratio': sum(s for _, s in file_types['executable']) / total_size * 100,
            'audio_ratio': sum(s for _, s in file_types['audio']) / total_size * 100,
        }
        
        print(f"ðŸ“Š PhÃ¢n tÃ­ch:")
        print(f"   - Tá»•ng dung lÆ°á»£ng: {total_size / (1024**3):.2f} GB")
        print(f"   - Files Ä‘Ã£ nÃ©n (.pak, .mp4, .jpg...): {stats['compressed_ratio']:.1f}%")
        print(f"   - Files cÃ³ thá»ƒ nÃ©n (.txt, .xml...): {stats['compressible_ratio']:.1f}%")
        print(f"   - Executables (.exe, .dll...): {stats['executable_ratio']:.1f}%")
        print(f"   - Audio (.mp3, .ogg...): {stats['audio_ratio']:.1f}%")
        
        return stats
    
    @staticmethod
    def auto_detect_compression(stats: Dict) -> int:
        """
        Tá»± Ä‘á»™ng chá»n compression level dá»±a trÃªn file types
        """
        total_gb = stats['total_size'] / (1024**3)
        compressed_ratio = stats['compressed_ratio']
        compressible_ratio = stats['compressible_ratio']
        
        print(f"\nðŸ¤– AUTO DETECTION:")
        
        # Logic quyáº¿t Ä‘á»‹nh
        if compressed_ratio > 80:
            # Game chá»§ yáº¿u lÃ  files Ä‘Ã£ nÃ©n â†’ khÃ´ng cáº§n nÃ©n máº¡nh
            level = 0  # Store
            reason = "Game chá»§ yáº¿u lÃ  .pak/.mp4 (Ä‘Ã£ nÃ©n) â†’ KhÃ´ng nÃ©n (nhanh nháº¥t)"
        
        elif compressed_ratio > 60:
            # KhÃ¡ nhiá»u files Ä‘Ã£ nÃ©n
            level = 1  # Deflate Fast
            reason = "Nhiá»u files Ä‘Ã£ nÃ©n â†’ Deflate Fast (cÃ¢n báº±ng)"
        
        elif compressible_ratio > 30:
            # Nhiá»u files cÃ³ thá»ƒ nÃ©n tá»‘t
            if total_gb < 10:
                level = 5  # LZMA - game nhá», nÃ©n máº¡nh OK
                reason = "Game nhá» + nhiá»u files nÃ©n Ä‘Æ°á»£c â†’ LZMA (máº¡nh nháº¥t)"
            elif total_gb < 30:
                level = 3  # Deflate Max
                reason = "Game vá»«a + nhiá»u files nÃ©n Ä‘Æ°á»£c â†’ Deflate Max"
            else:
                level = 2  # Deflate Normal
                reason = "Game lá»›n + nhiá»u files nÃ©n Ä‘Æ°á»£c â†’ Deflate Normal"
        
        else:
            # Trung bÃ¬nh
            if total_gb < 20:
                level = 3  # Deflate Max
                reason = "Game nhá»/vá»«a â†’ Deflate Max"
            else:
                level = 1  # Deflate Fast
                reason = "Game lá»›n â†’ Deflate Fast (nhanh)"
        
        print(f"   âœ… Chá»n: Level {level} - {GameChunker.COMPRESSION_LEVELS[level]['name']}")
        print(f"   ðŸ’¡ LÃ½ do: {reason}")
        
        return level
    
    @staticmethod
    def auto_detect_chunk_size(total_size: int) -> int:
        """
        Tá»± Ä‘á»™ng chá»n chunk size dá»±a trÃªn tá»•ng dung lÆ°á»£ng
        """
        total_gb = total_size / (1024**3)
        
        print(f"\nðŸ¤– AUTO CHUNK SIZE:")
        
        if total_gb < 5:
            # Game nhá» â†’ chunks nhá» OK
            chunk_mb = 25
            reason = "Game < 5GB â†’ Chunks 25MB (dá»… quáº£n lÃ½)"
        
        elif total_gb < 20:
            # Game vá»«a â†’ 50MB sweet spot
            chunk_mb = 50
            reason = "Game 5-20GB â†’ Chunks 50MB (recommended)"
        
        elif total_gb < 50:
            # Game lá»›n â†’ 100MB
            chunk_mb = 100
            reason = "Game 20-50GB â†’ Chunks 100MB (cÃ¢n báº±ng)"
        
        elif total_gb < 100:
            # Game ráº¥t lá»›n â†’ 200MB
            chunk_mb = 200
            reason = "Game 50-100GB â†’ Chunks 200MB (Ã­t files hÆ¡n)"
        
        else:
            # Game cá»±c lá»›n â†’ 500MB
            chunk_mb = 500
            reason = "Game > 100GB â†’ Chunks 500MB (giáº£m sá»‘ lÆ°á»£ng files)"
        
        estimated_chunks = int(total_gb * 1024 / chunk_mb)
        
        print(f"   âœ… Chá»n: {chunk_mb} MB")
        print(f"   ðŸ’¡ LÃ½ do: {reason}")
        print(f"   ðŸ“Š Æ¯á»›c tÃ­nh: ~{estimated_chunks} chunks")
        
        return chunk_mb
    
    def __init__(self, game_folder: str, output_dir: str, chunk_size_mb: int,
                 compression_level: int, version: str = DEFAULT_VERSION, steam_app_id: str = None, auto_mode: bool = False,
                 split_large_files: bool = True, rollup_archive: str = None,
                 delete_after_rollup: bool = False, hf_upload: bool = False,
                 hf_folder: str = None, hf_repo_id: str = None, hf_repo_type: str = None,
                 hf_revision: str = None, hf_delete: bool = False,
                 hf_manifest_root: str = None, hf_manifest_latest: bool = False,
                 hf_root: str = None, hf_channel: str = None, hf_version_folder: str = None, hf_game_folder: str = None,
                 hf_upload_workers: int = 1, hf_upload_queue: int = 1, hf_batch_size: int = 0, hf_max_inflight: int = 0,
                 hf_commit_batch_size: int = 16,
                 max_chunks: int = 0, partial_scan: bool = False):
        self.game_folder = Path(game_folder)
        self.output_dir = Path(output_dir)
        self.version = version
        self.steam_app_id = normalize_app_id(steam_app_id)
        self.auto_mode = auto_mode
        self.split_large_files = split_large_files  # NEW: Option to split large files
        self.rollup_archive = None
        self.delete_after_rollup = bool(delete_after_rollup)
        self.hf_upload = bool(hf_upload)
        self.hf_folder = None
        self.hf_repo_id = None
        self.hf_repo_type = None
        self.hf_revision = None
        self.hf_base_url = None
        self.hf_token = ""
        self.hf_delete = bool(hf_delete)
        self._hf_api = None
        self._hf_repo_files = None
        self.hf_manifest_root = None
        self.hf_manifest_latest = bool(hf_manifest_latest)
        self.hf_root = None
        self.hf_channel = None
        self.hf_version_folder = None
        self.hf_game_folder = None
        self.hf_upload_workers = max(1, int(hf_upload_workers or 1))
        self.hf_upload_queue = max(1, int(hf_upload_queue or 1))
        self.hf_batch_size = max(0, int(hf_batch_size or 0))
        self.hf_max_inflight = max(0, int(hf_max_inflight or 0))
        self.hf_commit_batch_size = max(1, int(hf_commit_batch_size or os.getenv("HF_COMMIT_BATCH_SIZE") or 16))
        if self.hf_batch_size and self.hf_upload_queue < self.hf_batch_size:
            self.hf_upload_queue = self.hf_batch_size
        if self.hf_max_inflight and self.hf_upload_queue < self.hf_max_inflight:
            self.hf_upload_queue = self.hf_max_inflight
        if self.hf_upload_queue < self.hf_commit_batch_size:
            self.hf_upload_queue = self.hf_commit_batch_size
        self.max_chunks = int(max_chunks or 0)
        self.partial_scan = bool(partial_scan)
        self._upload_queue: Queue | None = None
        self._upload_threads: list[threading.Thread] = []
        self._upload_errors: list[str] = []
        self._upload_lock = threading.Lock()
        self._upload_jobs: dict[str, Path] = {}
        self._uploaded_repo_paths: set[str] = set()
        try:
            self.hf_upload_retries = max(1, int(os.getenv("HF_UPLOAD_RETRIES") or 5))
        except Exception:
            self.hf_upload_retries = 5
        try:
            self.hf_retry_base_delay = max(0.2, float(os.getenv("HF_UPLOAD_RETRY_BASE_DELAY") or 1.5))
        except Exception:
            self.hf_retry_base_delay = 1.5
        try:
            self.hf_retry_max_delay = max(self.hf_retry_base_delay, float(os.getenv("HF_UPLOAD_RETRY_MAX_DELAY") or 12))
        except Exception:
            self.hf_retry_max_delay = 12.0
        try:
            self.hf_finalize_rounds = max(1, int(os.getenv("HF_UPLOAD_FINALIZE_ROUNDS") or 6))
        except Exception:
            self.hf_finalize_rounds = 6
        self.hf_wait_on_rate_limit = parse_bool_env("HF_WAIT_ON_RATE_LIMIT", True)
        try:
            self.hf_rate_limit_max_wait_seconds = max(
                60, int(os.getenv("HF_RATE_LIMIT_MAX_WAIT_SECONDS") or 3900)
            )
        except Exception:
            self.hf_rate_limit_max_wait_seconds = 3900
        try:
            self.hf_rate_limit_status_interval = max(
                5, int(os.getenv("HF_RATE_LIMIT_STATUS_INTERVAL_SECONDS") or 30)
            )
        except Exception:
            self.hf_rate_limit_status_interval = 30
        try:
            self.hf_target_commits_per_hour = max(
                1, int(os.getenv("HF_TARGET_COMMITS_PER_HOUR") or 96)
            )
        except Exception:
            self.hf_target_commits_per_hour = 96
        self._hf_rate_limit_wait_events = 0
        
        if not self.game_folder.exists():
            raise ValueError(f"Game folder khÃ´ng tá»“n táº¡i: {self.game_folder}")
        
        # AUTO MODE
        if auto_mode or compression_level == 100 or chunk_size_mb == -1:
            print("\n" + "=" * 80)
            print("ðŸ¤– AUTO MODE - Tá»° Äá»˜NG NHáº¬N DIá»†N")
            print("=" * 80)
            
            # PhÃ¢n tÃ­ch files
            stats = self.detect_file_types(self.game_folder)
            
            # Auto detect compression náº¿u cáº§n
            if compression_level == 100:
                compression_level = self.auto_detect_compression(stats)
            
            # Auto detect chunk size náº¿u cáº§n
            if chunk_size_mb == -1:
                chunk_size_mb = self.auto_detect_chunk_size(stats['total_size'])
            
            print("=" * 80)
            input("\nâ¸ï¸  Nháº¥n Enter Ä‘á»ƒ tiáº¿p tá»¥c vá»›i settings nÃ y (hoáº·c Ctrl+C Ä‘á»ƒ há»§y)...")
        
        self.chunk_size = chunk_size_mb * 1024 * 1024  # Convert to bytes
        self.compression_level = compression_level

        # Auto max inflight chunks based on free disk space (when enabled)
        if self.hf_upload and self.hf_delete and self.hf_max_inflight <= 0:
            try:
                reserve_gb = float(os.getenv("HF_RESERVE_GB") or 5)
            except Exception:
                reserve_gb = 5
            auto_inflight, free_gb = self._auto_max_inflight(self.output_dir, self.chunk_size, reserve_gb)
            if auto_inflight > 0:
                self.hf_max_inflight = auto_inflight
                if self.hf_upload_queue < self.hf_max_inflight:
                    self.hf_upload_queue = self.hf_max_inflight
                print(f"?? Auto max inflight: {self.hf_max_inflight} (free {free_gb:.1f} GB, reserve {reserve_gb} GB)")
        
        # HYBRID MODE
        if compression_level == 98 or compression_level == 99:
            self.is_hybrid_mode = True
            self.hybrid_fast = (compression_level == 98)  # 98 = fast, 99 = max
            self.compression_type = None  # Will be determined per file
            print(f"\nðŸŽ¯ HYBRID MODE: {'Fast' if self.hybrid_fast else 'Max'}")
            print("   - Files Ä‘Ã£ nÃ©n (.pak, .dll, .exe): Store (khÃ´ng nÃ©n)")
            print(f"   - Files chÆ°a nÃ©n (.txt, .xml): {'Deflate Fast' if self.hybrid_fast else 'LZMA'}")
        else:
            self.is_hybrid_mode = False
            # Get compression type
            comp_info = self.COMPRESSION_LEVELS[compression_level]
            self.compression_type = comp_info["level"]
        
        self.output_dir.mkdir(parents=True, exist_ok=True)

        if rollup_archive:
            rollup_path = Path(rollup_archive)
            if not rollup_path.is_absolute():
                rollup_path = self.output_dir / rollup_path
            if rollup_path.suffix.lower() != ".zip":
                raise ValueError("Rollup archive must be a .zip file")
            rollup_path.parent.mkdir(parents=True, exist_ok=True)
            self.rollup_archive = rollup_path
        elif self.delete_after_rollup:
            raise ValueError("delete_after_rollup requires rollup_archive")

        if self.hf_upload and self.delete_after_rollup:
            raise ValueError("delete_after_rollup cannot be used with hf_upload; use --hf-delete instead")

        if self.hf_upload:
            load_env()
            token = get_token()
            if not token:
                raise ValueError("Missing HUGGINGFACE_TOKEN / HF_TOKEN for hf_upload")
            self.hf_token = token
            self.hf_repo_id = hf_repo_id or os.getenv("HF_REPO_ID") or os.getenv("HUGGINGFACE_REPO_ID") or ""
            self.hf_repo_id = re.sub(r"/+", "/", self.hf_repo_id.strip()).strip("/")
            self.hf_repo_type = hf_repo_type or os.getenv("HF_REPO_TYPE") or "dataset"
            self.hf_revision = hf_revision or os.getenv("HF_REVISION") or "main"
            if not self.hf_repo_id:
                raise ValueError("Missing HF_REPO_ID for hf_upload")

            self.hf_root = (hf_root or self.game_folder.name).strip()
            self.hf_channel = (hf_channel or "game").strip().lower()
            self.hf_version_folder = (hf_version_folder or f"{self.hf_root} {self.version}").strip()
            self.hf_game_folder = (hf_game_folder or self.game_folder.name).strip()
            if not hf_folder:
                self.hf_root = self._hf_resolve_root(self.hf_root)

            if hf_folder:
                self.hf_folder = normalize_path(hf_folder)
            else:
                # Default structure:
                # <root>/<channel_folder>/<version_folder>
                if self.hf_channel == "game":
                    channel_folder = self.hf_game_folder
                else:
                    channel_folder = self.hf_channel
                channel_folder = self._hf_resolve_child(self.hf_root, channel_folder)
                self.hf_folder = normalize_path(f"{self.hf_root}/{channel_folder}/{self.hf_version_folder}")
            self.hf_base_url = build_base_url(self.hf_repo_id, self.hf_repo_type, self.hf_revision)

            if hf_manifest_root:
                self.hf_manifest_root = normalize_path(hf_manifest_root)
            else:
                self.hf_manifest_root = normalize_path(self.hf_root)
    
    def calculate_hash(self, filepath: Path) -> str:
        """TÃ­nh SHA256 hash cá»§a file"""
        sha256 = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for block in iter(lambda: f.read(65536), b''):
                sha256.update(block)
        return sha256.hexdigest()
    
    def get_all_files(self) -> List[Dict]:
        """Thu tháº­p táº¥t cáº£ files trong game folder"""
        print(f"\nðŸ“‚ Äang quÃ©t folder: {self.game_folder}")

        all_files = []
        total_size = 0
        scan_limit = None
        if self.partial_scan and self.max_chunks > 0:
            scan_limit = self.chunk_size * self.max_chunks

        for root, dirs, files in os.walk(self.game_folder):
            for file in sorted(files):
                filepath = Path(root) / file
                filesize = filepath.stat().st_size
                
                all_files.append({
                    'path': filepath,
                    'size': filesize,
                    'relative': filepath.relative_to(self.game_folder)
                })

                total_size += filesize
                if scan_limit and total_size >= scan_limit:
                    print("âš ï¸  Partial scan enabled: stopping early after reaching limit.")
                    return all_files, total_size

        print(f"âœ… TÃ¬m tháº¥y {len(all_files)} files")
        print(f"ðŸ“Š Tá»•ng dung lÆ°á»£ng: {total_size / (1024**3):.2f} GB")

        return all_files, total_size
    
    def split_large_file(self, file_info: Dict) -> List[Dict]:
        """
        Chia file lá»›n thÃ nh nhiá»u pháº§n nhá»
        """
        filepath = file_info['path']
        filesize = file_info['size']
        relative = file_info['relative']
        
        # Sá»‘ pháº§n cáº§n chia
        num_parts = (filesize + self.chunk_size - 1) // self.chunk_size
        
        print(f"   ðŸ”ª Chia file lá»›n: {relative}")
        print(f"      Size: {filesize / (1024**2):.2f} MB â†’ {num_parts} parts")
        
        parts = []
        offset = 0
        
        for i in range(num_parts):
            part_size = min(self.chunk_size, filesize - offset)
            
            parts.append({
                'path': filepath,
                'size': part_size,
                'relative': relative,
                'is_split': True,
                'part_index': i,
                'total_parts': num_parts,
                'offset': offset
            })
            
            offset += part_size
        
        return parts
    
    def create_chunks_list(self, all_files: List[Dict]) -> List[List[Dict]]:
        """Chia files thÃ nh chunks vá»›i há»— trá»£ split large files"""
        print(f"\nðŸ“¦ Äang chia thÃ nh chunks (má»—i chunk ~{self.chunk_size / (1024**2):.0f} MB)...")
        
        if self.split_large_files:
            print(f"   âœ‚ï¸  Split large files: ENABLED (files > {self.chunk_size / (1024**2):.0f}MB sáº½ bá»‹ chia nhá»)")
        else:
            print(f"   âœ‚ï¸  Split large files: DISABLED")
        
        chunks = []
        current_chunk = []
        current_size = 0
        
        for file_info in all_files:
            file_size = file_info['size']
            
            # Náº¿u file lá»›n hÆ¡n chunk_size
            if file_size > self.chunk_size:
                
                if self.split_large_files:
                    # CHIA FILE THÃ€NH NHIá»€U PARTS
                    # Flush current chunk trÆ°á»›c
                    if current_chunk:
                        chunks.append(current_chunk)
                        current_chunk = []
                        current_size = 0
                    
                    # Split file
                    parts = self.split_large_file(file_info)
                    
                    # Má»—i part thÃ nh 1 chunk riÃªng
                    for part in parts:
                        chunks.append([part])
                
                else:
                    # KhÃ´ng split â†’ chunk riÃªng (cÃ¡ch cÅ©)
                    if current_chunk:
                        chunks.append(current_chunk)
                        current_chunk = []
                        current_size = 0
                    
                    chunks.append([file_info])
                    print(f"âš ï¸  File lá»›n (khÃ´ng split): {file_info['relative']} ({file_size / (1024**2):.2f} MB)")
            
            else:
                # File nhá» hÆ¡n chunk_size â†’ gá»™p vÃ o chunk
                if current_size + file_size > self.chunk_size:
                    chunks.append(current_chunk)
                    current_chunk = [file_info]
                    current_size = file_size
                else:
                    current_chunk.append(file_info)
                    current_size += file_size
        
        # Chunk cuá»‘i cÃ¹ng
        if current_chunk:
            chunks.append(current_chunk)
        
        print(f"âœ… Chia thÃ nh {len(chunks)} chunks")
        
        return chunks
    
    def create_chunk_archive(self, chunk_files: List[Dict], chunk_id: int) -> Dict:
        """Táº¡o file ZIP cho 1 chunk"""
        chunk_filename = f"chunk_{chunk_id:04d}.zip"
        chunk_path = self.output_dir / chunk_filename
        
        # Check if this chunk contains split file parts
        has_splits = any(f.get('is_split', False) for f in chunk_files)
        
        # Táº¡o ZIP vá»›i compression level Ä‘Æ°á»£c chá»n
        if self.compression_type == zipfile.ZIP_DEFLATED:
            if self.compression_level == 1:
                comp_level = 1  # Fast
            elif self.compression_level == 2:
                comp_level = 6  # Normal
            else:  # level 3
                comp_level = 9  # Max
            
            with zipfile.ZipFile(chunk_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=comp_level) as zf:
                for file_info in chunk_files:
                    if file_info.get('is_split', False):
                        # File Ä‘Ã£ split â†’ chá»‰ Ä‘á»c pháº§n cáº§n thiáº¿t
                        self._write_split_file_to_zip(zf, file_info)
                    else:
                        # File bÃ¬nh thÆ°á»ng
                        zf.write(file_info['path'], file_info['relative'])
        
        elif self.compression_type == zipfile.ZIP_BZIP2:
            with zipfile.ZipFile(chunk_path, 'w', zipfile.ZIP_BZIP2, compresslevel=9) as zf:
                for file_info in chunk_files:
                    if file_info.get('is_split', False):
                        self._write_split_file_to_zip(zf, file_info)
                    else:
                        zf.write(file_info['path'], file_info['relative'])
        
        elif self.compression_type == zipfile.ZIP_LZMA:
            with zipfile.ZipFile(chunk_path, 'w', zipfile.ZIP_LZMA) as zf:
                for file_info in chunk_files:
                    if file_info.get('is_split', False):
                        self._write_split_file_to_zip(zf, file_info)
                    else:
                        zf.write(file_info['path'], file_info['relative'])
        
        else:  # ZIP_STORED
            with zipfile.ZipFile(chunk_path, 'w', zipfile.ZIP_STORED) as zf:
                for file_info in chunk_files:
                    if file_info.get('is_split', False):
                        self._write_split_file_to_zip(zf, file_info)
                    else:
                        zf.write(file_info['path'], file_info['relative'])
        
        # TÃ­nh hash cá»§a chunk
        chunk_hash = self.calculate_hash(chunk_path)
        chunk_size = chunk_path.stat().st_size
        
        # Metadata
        chunk_info = {
            'id': chunk_id,
            'filename': chunk_filename,
            'path': chunk_filename,
            'hash': chunk_hash,
            'size': chunk_size,
            'compressed_size': chunk_size,
            'original_size': sum(f['size'] for f in chunk_files),
            'file_count': len(chunk_files)
        }
        
        # LÆ°u thÃ´ng tin files (bao gá»“m split info náº¿u cÃ³)
        if has_splits:
            chunk_info['files'] = []
            for f in chunk_files:
                if f.get('is_split', False):
                    chunk_info['files'].append({
                        'path': str(f['relative']),
                        'is_split': True,
                        'part_index': f['part_index'],
                        'total_parts': f['total_parts'],
                        'offset': f['offset'],
                        'size': f['size']
                    })
                else:
                    chunk_info['files'].append(str(f['relative']))
        else:
            chunk_info['files'] = [str(f['relative']) for f in chunk_files]
        
        return chunk_info
    
    def _write_split_file_to_zip(self, zipfile_obj, file_info: Dict):
        """
        Viáº¿t 1 pháº§n cá»§a file Ä‘Ã£ split vÃ o ZIP
        """
        # Äá»c chá»‰ pháº§n cáº§n thiáº¿t
        with open(file_info['path'], 'rb') as f:
            f.seek(file_info['offset'])
            data = f.read(file_info['size'])
        
        # Táº¡o tÃªn file trong ZIP vá»›i part index
        relative = file_info['relative']
        if file_info['total_parts'] > 1:
            # ThÃªm .part000, .part001, ...
            arcname = f"{relative}.part{file_info['part_index']:03d}"
        else:
            arcname = str(relative)
        
        # Viáº¿t vÃ o ZIP
        zipfile_obj.writestr(arcname, data)

    def _append_to_rollup(self, file_path: Path):
        """Append a file to rollup archive using ZIP_STORED (no re-compress)."""
        if not self.rollup_archive:
            return
        mode = 'a' if self.rollup_archive.exists() else 'w'
        with zipfile.ZipFile(self.rollup_archive, mode, zipfile.ZIP_STORED) as zf:
            zf.write(file_path, file_path.name)

    def _append_manifest_to_rollup(self, manifest_path: Path):
        """Append manifest to rollup archive if enabled."""
        if not self.rollup_archive:
            return
        mode = 'a' if self.rollup_archive.exists() else 'w'
        with zipfile.ZipFile(self.rollup_archive, mode, zipfile.ZIP_STORED) as zf:
            zf.write(manifest_path, manifest_path.name)

    @staticmethod
    def _safe_delete(path: Path, retries: int = 5, delay_s: float = 0.2) -> bool:
        """Best-effort delete with retries (Windows AV/file locks)."""
        if not path.exists():
            return True
        for _ in range(max(1, retries)):
            try:
                path.unlink()
                return True
            except Exception:
                time.sleep(delay_s)
        return not path.exists()

    def _hf_resolve_root(self, desired_root: str) -> str:
        try:
            files = self._hf_list_repo_files()
            top_level = set()
            for f in files:
                if '/' in f:
                    top_level.add(f.split('/', 1)[0])
            if not top_level:
                return desired_root
            desired_norm = _normalize_folder_name(desired_root)
            for name in sorted(top_level):
                if _normalize_folder_name(name) == desired_norm:
                    if name != desired_root:
                        print(f"Using existing HF root folder: {name}")
                    return name
        except Exception as exc:
            print(f"Warning: Failed to inspect HF repo folders: {exc}")
        return desired_root

    def _hf_list_repo_files(self):
        if self._hf_repo_files is not None:
            return self._hf_repo_files
        api = self._hf_get_api()
        self._hf_repo_files = api.list_repo_files(
            repo_id=self.hf_repo_id,
            repo_type=self.hf_repo_type,
            revision=self.hf_revision,
            token=self.hf_token,
        )
        return self._hf_repo_files

    def _hf_resolve_child(self, parent: str, desired_child: str) -> str:
        try:
            files = self._hf_list_repo_files()
            desired_norm = _normalize_folder_name(desired_child)
            children = set()
            prefix = parent.rstrip("/") + "/"
            for f in files:
                if f.startswith(prefix):
                    rest = f[len(prefix):]
                    if "/" in rest:
                        children.add(rest.split("/", 1)[0])
            for name in sorted(children):
                if _normalize_folder_name(name) == desired_norm:
                    if name != desired_child:
                        print(f"? Using existing HF child folder: {name}")
                    return name
        except Exception as exc:
            print(f"Warning: Failed to inspect HF child folders: {exc}")
        return desired_child

    def _hf_get_api(self):
        if self._hf_api is None:
            try:
                from huggingface_hub import HfApi
            except Exception as exc:
                raise RuntimeError(f"Missing huggingface_hub: {exc}") from exc
            self._hf_api = HfApi()
        return self._hf_api

    def _is_hf_commit_rate_limited(self, message: str) -> bool:
        msg = (message or "").lower()
        return "too many requests" in msg and "rate limit for repository commits" in msg

    def _parse_rate_limit_wait_seconds(self, message: str) -> int:
        msg = str(message or "").lower()
        # Default to one hour when HF does not provide an exact duration.
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

    def _wait_for_hf_rate_limit(self, message: str, context: str) -> bool:
        if not self.hf_wait_on_rate_limit:
            return False

        wait_seconds = self._parse_rate_limit_wait_seconds(message)
        if wait_seconds > self.hf_rate_limit_max_wait_seconds:
            print(
                f"   âš ï¸  HF rate-limit wait ({wait_seconds}s) exceeds limit "
                f"({self.hf_rate_limit_max_wait_seconds}s)."
            )
            return False

        self._hf_rate_limit_wait_events += 1
        print(
            f"   â³ HF commit rate limit while {context}. "
            f"Auto-waiting {wait_seconds}s before retry..."
        )

        remaining = wait_seconds
        while remaining > 0:
            step = min(self.hf_rate_limit_status_interval, remaining)
            time.sleep(step)
            remaining -= step
            if remaining > 0:
                print(f"      waiting... {remaining}s remaining")
        return True

    def _ensure_commit_budget(self, total_chunks: int) -> None:
        if not self.hf_upload or total_chunks <= 0:
            return
        target_commits = max(1, int(self.hf_target_commits_per_hour))
        required_batch = (total_chunks + target_commits - 1) // target_commits
        required_batch = max(1, required_batch)
        if required_batch <= self.hf_commit_batch_size:
            return

        old = self.hf_commit_batch_size
        self.hf_commit_batch_size = required_batch
        if self.hf_upload_queue < self.hf_commit_batch_size:
            self.hf_upload_queue = self.hf_commit_batch_size
        print(
            f"   ðŸ“ˆ Auto-adjust commit batch size: {old} -> {self.hf_commit_batch_size} "
            f"(chunks={total_chunks}, target<= {target_commits} commits/hour)"
        )

    def _effective_commit_batch_size(self) -> int:
        size = max(1, int(self.hf_commit_batch_size))
        if self.hf_delete and self.hf_max_inflight > 0:
            size = min(size, self.hf_max_inflight)
        return max(1, size)

    def _hf_upload_file(self, local_path: Path, repo_path: str) -> None:
        api = self._hf_get_api()
        api.upload_file(
            path_or_fileobj=str(local_path),
            path_in_repo=repo_path,
            repo_id=self.hf_repo_id,
            repo_type=self.hf_repo_type,
            revision=self.hf_revision,
            token=self.hf_token,
            create_pr=False,
            commit_message=f"Upload {local_path.name}",
        )

    def _hf_commit_batch(self, items: list[tuple[Path, str]]) -> None:
        if not items:
            return
        try:
            from huggingface_hub import CommitOperationAdd
        except Exception as exc:
            raise RuntimeError(f"Missing huggingface_hub CommitOperationAdd: {exc}") from exc

        operations = [
            CommitOperationAdd(path_in_repo=normalize_path(repo_path), path_or_fileobj=str(local_path))
            for local_path, repo_path in items
        ]
        first_name = items[0][0].name
        last_name = items[-1][0].name
        api = self._hf_get_api()
        api.create_commit(
            repo_id=self.hf_repo_id,
            repo_type=self.hf_repo_type,
            revision=self.hf_revision,
            operations=operations,
            token=self.hf_token,
            create_pr=False,
            commit_message=f"Upload {len(items)} chunks: {first_name} -> {last_name}",
        )

    def _record_upload_error(self, message: str) -> None:
        with self._upload_lock:
            self._upload_errors.append(message)

    def _register_upload_job(self, chunk_path: Path, repo_path: str) -> None:
        normalized = normalize_path(repo_path)
        with self._upload_lock:
            self._upload_jobs[normalized] = chunk_path

    def _mark_uploaded(self, repo_path: str) -> None:
        normalized = normalize_path(repo_path)
        with self._upload_lock:
            self._uploaded_repo_paths.add(normalized)

    def _pending_upload_jobs(self) -> list[tuple[Path, str]]:
        with self._upload_lock:
            pending = [
                (chunk_path, repo_path)
                for repo_path, chunk_path in self._upload_jobs.items()
                if repo_path not in self._uploaded_repo_paths
            ]
        return pending

    def _hf_commit_batch_with_retry(self, items: list[tuple[Path, str]], retries: int | None = None) -> None:
        attempts = max(1, int(retries or self.hf_upload_retries))
        last_exc: Exception | None = None
        attempt = 1
        rate_limit_waits = 0

        while attempt <= attempts:
            try:
                self._hf_commit_batch(items)
                return
            except Exception as exc:
                msg = str(exc)
                if self._is_hf_commit_rate_limited(msg):
                    rate_limit_waits += 1
                    if rate_limit_waits <= attempts and self._wait_for_hf_rate_limit(
                        msg, f"committing batch of {len(items)} chunk(s)"
                    ):
                        continue
                    raise RuntimeError(
                        f"HF commit rate limit reached (128 commits/hour). "
                        f"Increase HF_COMMIT_BATCH_SIZE/--hf-commit-batch-size (current {self.hf_commit_batch_size}), "
                        "or increase HF_RATE_LIMIT_MAX_WAIT_SECONDS to auto-wait longer."
                    ) from exc

                last_exc = exc
                if attempt >= attempts:
                    break
                delay = min(self.hf_retry_base_delay * (2 ** (attempt - 1)), self.hf_retry_max_delay)
                print(f"   ⚠️  Commit retry {attempt}/{attempts - 1} in {delay:.1f}s: {exc}")
                time.sleep(delay)
                attempt += 1

        if last_exc is None:
            raise RuntimeError("Batch upload failed")
        raise RuntimeError(f"Batch upload failed: {last_exc}")

    def _upload_chunk_batch(self, batch: list[tuple[Path, str]]) -> None:
        if not batch:
            return
        existing: list[tuple[Path, str]] = []
        for chunk_path, repo_path in batch:
            if not chunk_path.exists():
                self._record_upload_error(f"Chunk missing before upload: {chunk_path.name}")
                continue
            existing.append((chunk_path, repo_path))
        if not existing:
            return

        try:
            self._hf_commit_batch_with_retry(existing)
        except Exception as exc:
            for chunk_path, _ in existing:
                self._record_upload_error(f"Upload failed for {chunk_path.name}: {exc}")
            return

        for chunk_path, repo_path in existing:
            self._mark_uploaded(repo_path)
            if self.hf_delete:
                deleted = self._safe_delete(chunk_path)
                if not deleted:
                    self._record_upload_error(f"Failed to delete {chunk_path.name}")

    def _hf_upload_with_retry(self, local_path: Path, repo_path: str, retries: int | None = None) -> None:
        attempts = max(1, int(retries or self.hf_upload_retries))
        normalized_repo_path = normalize_path(repo_path)
        last_exc: Exception | None = None
        attempt = 1
        rate_limit_waits = 0

        while attempt <= attempts:
            try:
                self._hf_upload_file(local_path, normalized_repo_path)
                self._mark_uploaded(normalized_repo_path)
                return
            except Exception as exc:
                msg = str(exc)
                if self._is_hf_commit_rate_limited(msg):
                    rate_limit_waits += 1
                    if rate_limit_waits <= attempts and self._wait_for_hf_rate_limit(
                        msg, f"uploading {local_path.name}"
                    ):
                        continue
                    raise RuntimeError(
                        f"HF commit rate limit reached while uploading {local_path.name}. "
                        "Increase HF_COMMIT_BATCH_SIZE and rerun."
                    ) from exc

                last_exc = exc
                if attempt >= attempts:
                    break
                delay = min(self.hf_retry_base_delay * (2 ** (attempt - 1)), self.hf_retry_max_delay)
                print(f"   ⚠️  Upload retry {attempt}/{attempts - 1} for {local_path.name} in {delay:.1f}s: {exc}")
                time.sleep(delay)
                attempt += 1

        if last_exc is None:
            raise RuntimeError(f"Upload failed for {local_path.name}")
        raise RuntimeError(f"Upload failed for {local_path.name}: {last_exc}")

    def _start_upload_workers(self) -> None:
        if not self.hf_upload:
            return
        if self._upload_queue is not None:
            return
        self._upload_queue = Queue(maxsize=self.hf_upload_queue)
        with self._upload_lock:
            self._upload_errors = []
            self._upload_jobs = {}
            self._uploaded_repo_paths = set()
        self._upload_threads = []

        def worker() -> None:
            batch: list[tuple[Path, str]] = []
            batch_size = self._effective_commit_batch_size()
            while True:
                try:
                    item = self._upload_queue.get(timeout=0.5)
                except Empty:
                    continue
                if item is None:
                    self._upload_queue.task_done()
                    if batch:
                        self._upload_chunk_batch(batch)
                        for _ in batch:
                            self._upload_queue.task_done()
                        batch.clear()
                    break
                batch.append(item)
                if len(batch) >= batch_size:
                    self._upload_chunk_batch(batch)
                    for _ in batch:
                        self._upload_queue.task_done()
                    batch.clear()

        for _ in range(self.hf_upload_workers):
            t = threading.Thread(target=worker, daemon=True)
            t.start()
            self._upload_threads.append(t)

    def _stop_upload_workers(self) -> None:
        if not self._upload_queue:
            return
        # Signal workers to stop
        for _ in self._upload_threads:
            self._upload_queue.put(None)
        # Wait for all tasks including sentinels
        self._upload_queue.join()
        for t in self._upload_threads:
            t.join(timeout=1)
        self._upload_queue = None
        self._upload_threads = []

    def _finalize_pending_uploads(self) -> None:
        if not self.hf_upload:
            return

        pending = self._pending_upload_jobs()
        if not pending:
            return

        print(f"âš ï¸  Detected {len(pending)} pending HF uploads. Running final retry phase...")
        batch_size = self._effective_commit_batch_size()
        for round_idx in range(1, self.hf_finalize_rounds + 1):
            if not pending:
                break
            print(f"   Finalize round {round_idx}/{self.hf_finalize_rounds}: {len(pending)} chunks")
            for idx in range(0, len(pending), batch_size):
                self._upload_chunk_batch(pending[idx:idx + batch_size])
            pending = self._pending_upload_jobs()
            if pending and round_idx < self.hf_finalize_rounds:
                time.sleep(self.hf_retry_base_delay)

        pending = self._pending_upload_jobs()
        if pending:
            sample = ", ".join(path.name for path, _ in pending[:5])
            raise RuntimeError(
                f"HF upload incomplete: {len(pending)} pending chunk(s): {sample}. "
                "Please check network/token and rerun to resume."
            )
    
    def _auto_max_inflight(self, output_dir: Path, chunk_size_bytes: int, reserve_gb: float) -> tuple[int, float]:
        try:
            root = output_dir.drive or output_dir.anchor
            if not root:
                root = output_dir.resolve().anchor
            usage = shutil.disk_usage(root or str(output_dir))
            free_gb = usage.free / (1024**3)
            available_gb = max(0.0, free_gb - reserve_gb)
            chunk_mb = max(1.0, chunk_size_bytes / (1024**2))
            inflight = int((available_gb * 1024) / chunk_mb)
            inflight = max(1, inflight)
            inflight = min(inflight, 500)
            return inflight, free_gb
        except Exception:
            return 0, 0.0

    def _wait_for_hf_slot(self) -> None:
        if not self.hf_upload or not self.hf_delete or self.hf_max_inflight <= 0:
            return
        waited = False
        while True:
            try:
                active = len(list(self.output_dir.glob('chunk_*.zip')))
            except Exception:
                return
            if active < self.hf_max_inflight:
                if waited:
                    print('   ? Slot freed, continuing...')
                return
            if not waited:
                print(f'   ? Waiting for upload to free slot ({active}/{self.hf_max_inflight})')
                waited = True
            time.sleep(1)

    def process_chunks(self, chunks: List[List[Dict]]) -> List[Dict]:
        """Xá»­ lÃ½ táº¥t cáº£ chunks"""
        self._ensure_commit_budget(len(chunks))
        print(f"\nðŸ”„ Äang táº¡o {len(chunks)} chunks...")
        print(f"ðŸ—œï¸  Compression: {self.COMPRESSION_LEVELS[self.compression_level]['name']}")
        if self.rollup_archive:
            print(f"???? Rollup archive: {self.rollup_archive}")
            print(f"???? Delete chunks after rollup: {self.delete_after_rollup}")
        if self.hf_upload:
            print(f"???? HF repo: {self.hf_repo_id} ({self.hf_repo_type}:{self.hf_revision})")
            print(f"???? HF folder: {self.hf_folder}")
            print(f"???? Delete after upload: {self.hf_delete}")
            print(f"?? Upload workers: {self.hf_upload_workers} | Queue: {self.hf_upload_queue}")
            print(f"?? Batch size: {self.hf_batch_size}")
            print(f"?? Commit batch size: {self._effective_commit_batch_size()}")
            print(f"?? Upload retries: {self.hf_upload_retries} | Finalize rounds: {self.hf_finalize_rounds}")
        print("-" * 80)
        
        chunks_info = []
        start_time = time.time()
        total_original_size = 0
        total_compressed_size = 0
        if self.hf_upload:
            self._start_upload_workers()
        batch_inflight = 0
        
        for i, chunk_files in enumerate(chunks):
            chunk_start_time = time.time()
            
            print(f"\nðŸ“¦ [{i+1}/{len(chunks)}] Chunk {i:04d}:")
            print(f"   Files: {len(chunk_files)}")
            
            original_size = sum(f['size'] for f in chunk_files)
            print(f"   Size: {original_size / (1024**2):.2f} MB")
            
            # Táº¡o chunk
            if self.hf_upload:
                self._wait_for_hf_slot()
            chunk_info = self.create_chunk_archive(chunk_files, i)
            chunks_info.append(chunk_info)
            chunk_path = self.output_dir / chunk_info['filename']

            if self.rollup_archive:
                self._append_to_rollup(chunk_path)
                if self.delete_after_rollup and not self.hf_upload:
                    deleted = self._safe_delete(chunk_path)
                    if not deleted:
                        print(f"   Warning: Failed to delete {chunk_path.name}")

            if self.hf_upload:
                repo_path = normalize_path(f"{self.hf_folder}/{chunk_path.name}")
                if self._upload_queue is None:
                    self._start_upload_workers()
                self._register_upload_job(chunk_path, repo_path)
                self._upload_queue.put((chunk_path, repo_path))
                # Batch sync: wait after N chunks enqueued (if enabled)
                if self.hf_batch_size > 0 and self.hf_max_inflight <= 0 and self._effective_commit_batch_size() <= 1:
                    batch_inflight += 1
                    if batch_inflight >= self.hf_batch_size:
                        self._upload_queue.join()
                        print("   Batch uploaded + deleted")
                        batch_inflight = 0
            
            compressed_size = chunk_info['size']
            compression_ratio = (1 - compressed_size / original_size) * 100
            
            total_original_size += original_size
            total_compressed_size += compressed_size
            
            chunk_time = time.time() - chunk_start_time
            
            print(f"   âœ… Compressed: {compressed_size / (1024**2):.2f} MB")
            print(f"   ðŸ“Š Ratio: {compression_ratio:.1f}% tiáº¿t kiá»‡m")
            print(f"   â±ï¸  Time: {chunk_time:.1f}s")
            print(f"   ðŸ” Hash: {chunk_info['hash'][:16]}...")
            
            if self.rollup_archive:
                print(f"   Rollup: {self.rollup_archive.name}")
            if self.hf_upload:
                print(f"   HF upload: {self.hf_repo_id}/{self.hf_folder}")
            if self.delete_after_rollup and not self.hf_upload:
                if chunk_path.exists():
                    print("   Delete failed (file still exists)")
                else:
                    print("   Deleted local chunk")
            if self.hf_upload and self.hf_delete:
                print("   Status: queued for upload")
                if chunk_path.exists():
                    print(f"   File: {chunk_path.name}")
                else:
                    print(f"   File deleted: {chunk_path.name}")

            # Progress
            progress = ((i + 1) / len(chunks)) * 100
            elapsed = time.time() - start_time
            eta = (elapsed / (i + 1)) * (len(chunks) - i - 1)
            
            print(f"   ðŸ“ˆ Progress: {progress:.1f}% | ETA: {eta/60:.1f} min")
        
        if self.hf_upload:
            self._stop_upload_workers()
            self._finalize_pending_uploads()
            if self._upload_errors:
                print("??  Upload errors:")
                for err in self._upload_errors[:5]:
                    print(f"   - {err}")
                if len(self._upload_errors) > 5:
                    print(f"   ... and {len(self._upload_errors) - 5} more")
        total_time = time.time() - start_time
        overall_ratio = (1 - total_compressed_size / total_original_size) * 100
        
        print("\n" + "=" * 80)
        print("âœ… HOÃ€N Táº¤T!")
        print("=" * 80)
        print(f"ðŸ“Š Tá»•ng káº¿t:")
        print(f"   - Tá»•ng chunks: {len(chunks)}")
        print(f"   - Dung lÆ°á»£ng gá»‘c: {total_original_size / (1024**3):.2f} GB")
        print(f"   - Sau nÃ©n: {total_compressed_size / (1024**3):.2f} GB")
        print(f"   - Tiáº¿t kiá»‡m: {(total_original_size - total_compressed_size) / (1024**3):.2f} GB ({overall_ratio:.1f}%)")
        print(f"   - Thá»i gian: {total_time / 60:.1f} phÃºt")
        print(f"   - Tá»‘c Ä‘á»™: {total_original_size / (1024**2) / total_time:.1f} MB/s")
        print("=" * 80)
        
        return chunks_info
    
    def _write_local_manifest_cache(self, manifest_file: Path) -> None:
        try:
            cache_root = Path(__file__).resolve().parent
            game_dir = cache_root / self.game_folder.name
            game_dir.mkdir(parents=True, exist_ok=True)
            target = game_dir / manifest_file.name
            shutil.copy2(manifest_file, target)
            latest = game_dir / "manifest.json"
            shutil.copy2(manifest_file, latest)
            print(f"?? Manifest cached: {target}")
        except Exception as exc:
            print(f"Warning: Failed to cache manifest locally: {exc}")

    def create_manifest(self, chunks_info: List[Dict]) -> str:
        """Táº¡o manifest file"""
        safe_game_id = re.sub(r'[^a-z0-9_-]+', '_', self.game_folder.name.lower()).strip('_')
        safe_version = self.sanitize_filename(self.version)
        manifest = {
            'game_id': safe_game_id,
            'slug': safe_game_id,
            'version': self.version,
            'game_name': self.game_folder.name,
            'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'compression': self.COMPRESSION_LEVELS[self.compression_level]['name'],
            'chunk_size_mb': self.chunk_size / (1024**2),
            'total_chunks': len(chunks_info),
            'total_size': sum(c['size'] for c in chunks_info),
            'total_original_size': sum(c['original_size'] for c in chunks_info),
            'compression_ratio': (1 - sum(c['size'] for c in chunks_info) / sum(c['original_size'] for c in chunks_info)) * 100,
            'hash_algorithm': 'sha256',
            'chunks': chunks_info
        }
        if self.steam_app_id:
            manifest['app_id'] = self.steam_app_id
            manifest['steam_app_id'] = self.steam_app_id

        if self.rollup_archive:
            manifest['rollup_archive'] = self.rollup_archive.name
            manifest['rollup_mode'] = 'zip-stored'
            manifest['chunks_in_rollup'] = bool(self.delete_after_rollup)
        if self.hf_upload:
            manifest['hf_repo_id'] = self.hf_repo_id
            manifest['hf_repo'] = self.hf_repo_id
            manifest['hf_repo_type'] = self.hf_repo_type
            manifest['hf_revision'] = self.hf_revision
            manifest['hf_folder'] = self.hf_folder
            manifest['hf_game_path'] = self.hf_folder
            manifest['hf_base_url'] = self.hf_base_url
            manifest['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')

            base_url = self.hf_base_url.rstrip("/")
            for chunk in manifest.get("chunks", []):
                chunk_path = chunk.get("path") or chunk.get("filename")
                if not chunk_path:
                    continue
                chunk["path"] = normalize_path(chunk_path)
                full_path = normalize_path(f"{self.hf_folder}/{chunk['path']}")
                chunk["url"] = f"{base_url}/{quote(full_path)}"

            if self.hf_manifest_root:
                manifest_name = f"manifest_{safe_version}.json"
                root_path = normalize_path(f"{self.hf_manifest_root}/{manifest_name}")
                manifest["manifest_root_path"] = root_path
                manifest["manifest_root_url"] = f"{base_url}/{quote(root_path)}"
                if self.hf_manifest_latest:
                    latest_path = normalize_path(f"{self.hf_manifest_root}/manifest.json")
                    manifest["manifest_latest_path"] = latest_path
                    manifest["manifest_latest_url"] = f"{base_url}/{quote(latest_path)}"
        
        # Sanitize version to avoid invalid filename characters (Windows: ? * < > etc.)
        manifest_file = self.output_dir / f"manifest_{safe_version}.json"
        with open(manifest_file, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)

        self._write_local_manifest_cache(manifest_file)

        if self.rollup_archive:
            self._append_manifest_to_rollup(manifest_file)

        if self.hf_upload:
            manifest_repo_path = normalize_path(f"{self.hf_folder}/{manifest_file.name}")
            self._hf_upload_with_retry(manifest_file, manifest_repo_path)
            if self.hf_manifest_root:
                root_repo_path = normalize_path(f"{self.hf_manifest_root}/{manifest_file.name}")
                try:
                    self._hf_upload_with_retry(manifest_file, root_repo_path)
                except Exception as exc:
                    print(f"Warning: Upload failed for root manifest: {exc}")
                if self.hf_manifest_latest:
                    latest_repo_path = normalize_path(f"{self.hf_manifest_root}/manifest.json")
                    try:
                        self._hf_upload_with_retry(manifest_file, latest_repo_path)
                    except Exception as exc:
                        print(f"Warning: Upload failed for latest manifest: {exc}")
        
        print(f"\nðŸ“„ Manifest saved: {manifest_file}")
        
        return str(manifest_file)
    
    def run(self):
        """Cháº¡y toÃ n bá»™ quy trÃ¬nh"""
        print("\n" + "=" * 80)
        print("ðŸŽ® GAME CHUNKER - Tá»° Äá»˜NG CHIA GAME THÃ€NH CHUNKS")
        print("=" * 80)
        print(f"ðŸ“‚ Input: {self.game_folder}")
        print(f"ðŸ“ Output: {self.output_dir}")
        print(f"ðŸ“¦ Chunk size: {self.chunk_size / (1024**2):.0f} MB")
        print(f"ðŸ—œï¸  Compression: {self.COMPRESSION_LEVELS[self.compression_level]['name']}")
        print("=" * 80)
        
        # BÆ°á»›c 1: Thu tháº­p files
        all_files, total_size = self.get_all_files()
        
        # BÆ°á»›c 2: Chia chunks
        chunks = self.create_chunks_list(all_files)
        if self.max_chunks > 0 and len(chunks) > self.max_chunks:
            chunks = chunks[: self.max_chunks]
            print(f"??  max_chunks enabled: processing only {len(chunks)} chunks")
        
        # BÆ°á»›c 3: Táº¡o chunks
        chunks_info = self.process_chunks(chunks)
        
        # BÆ°á»›c 4: Táº¡o manifest
        manifest_file = self.create_manifest(chunks_info)
        
        print("\nâœ… HOÃ€N Táº¤T Táº¤T Cáº¢!")
        print(f"\nðŸ“¦ Chunks location: {self.output_dir}")
        print(f"ðŸ“„ Manifest: {manifest_file}")
        if self.hf_upload:
            print("\nHF upload completed.")
        else:
            print(f"\nðŸ’¡ Next step: Upload chunks lÃªn Hugging Face!")


def show_menu():
    """Hiá»ƒn thá»‹ menu interactive"""
    load_env()
    print("\n" + "=" * 80)
    print("ðŸŽ® GAME CHUNKER - INTERACTIVE MODE")
    print("=" * 80)
    
    # Input game folder
    print("\nðŸ“‚ BÆ¯á»šC 1: Chá»n game folder")
    game_folder = input("Nháº­p Ä‘Æ°á»ng dáº«n game folder: ").strip().strip('"')
    
    if not os.path.exists(game_folder):
        print(f"âŒ Folder khÃ´ng tá»“n táº¡i: {game_folder}")
        return
    
    # Chunk size
    print("\nðŸ“¦ BÆ¯á»šC 2: Chá»n chunk size")
    print("-" * 80)
    
    # TÃ­nh dung lÆ°á»£ng folder báº±ng static method
    total_size, file_count = GameChunker.scan_folder_size(game_folder)
    total_size_gb = total_size / (1024**3)
    
    print(f"ðŸ“Š Game folder: {total_size_gb:.2f} GB ({file_count} files)")
    print()
    
    # Hiá»ƒn thá»‹ chunk presets vá»›i sá»‘ chunks tÃ­nh toÃ¡n
    for key, preset in GameChunker.CHUNK_PRESETS.items():
        if key <= 6:  # Chá»‰ tÃ­nh cho presets cá»‘ Ä‘á»‹nh
            chunk_count = GameChunker.calculate_chunk_count(total_size_gb, preset['size'])
            print(f"{key}. {preset['name']} ({chunk_count} chunks cho {total_size_gb:.2f}GB)")
        else:
            print(f"{key}. {preset['name']}")
    print("-" * 80)
    
    while True:
        try:
            chunk_choice = int(input("Chá»n (1-8): "))
            if chunk_choice in GameChunker.CHUNK_PRESETS:
                break
            print("âŒ Lá»±a chá»n khÃ´ng há»£p lá»‡!")
        except ValueError:
            print("âŒ Vui lÃ²ng nháº­p sá»‘!")
    
    if chunk_choice == 8:
        # Custom chunk size with smart parsing
        while True:
            try:
                user_input = input("Nháº­p chunk size (VD: 2048, 2GB, 2g): ").strip().lower()
                
                # Parse input
                if 'gb' in user_input or 'g' in user_input:
                    # GB input
                    num = float(user_input.replace('gb', '').replace('g', '').strip())
                    chunk_size = int(num * 1024)  # Convert GB to MB
                elif 'mb' in user_input or 'm' in user_input:
                    # MB input
                    num = float(user_input.replace('mb', '').replace('m', '').strip())
                    chunk_size = int(num)
                else:
                    # Assume MB
                    chunk_size = int(float(user_input))
                
                # Validate
                if chunk_size < 1:
                    print("âŒ Chunk size pháº£i > 0!")
                    continue
                if chunk_size > 10240:  # 10GB
                    print("âš ï¸  Chunk size quÃ¡ lá»›n! Khuyáº¿n nghá»‹ < 10GB")
                    confirm = input("Tiáº¿p tá»¥c? (y/n): ").lower()
                    if confirm != 'y':
                        continue
                
                break
            except ValueError:
                print("âŒ Format khÃ´ng Ä‘Ãºng! VÃ­ dá»¥: 2048, 2GB, 0.5G")
    elif chunk_choice == 7:
        chunk_size = -1  # AUTO
    else:
        chunk_size = GameChunker.CHUNK_PRESETS[chunk_choice]['size']
    
    # Compression level
    print("\nðŸ—œï¸  BÆ¯á»šC 3: Chá»n compression level")
    print("-" * 80)
    for key, comp in GameChunker.COMPRESSION_LEVELS.items():
        print(f"{key}. {comp['name']}")
        if key != 99:
            print(f"   Speed: {comp['speed']} | Ratio: {comp['ratio']}")
    print("-" * 80)
    print("ðŸ’¡ Khuyáº¿n nghá»‹:")
    print("   - AUTO (99): Äá»ƒ script tá»± chá»n dá»±a trÃªn loáº¡i files")
    print("   - Store (0): Testing/nhanh nháº¥t, khÃ´ng nÃ©n")
    print("   - Deflate Fast (1): CÃ¢n báº±ng tá»‘t, nhanh")
    print("   - LZMA (5): NÃ©n máº¡nh nháº¥t, ráº¥t cháº­m nhÆ°ng tiáº¿t kiá»‡m bandwidth")
    print("-" * 80)
    
    while True:
        try:
            comp_input = input("Chá»n (0-5, 99 cho AUTO): ")
            comp_choice = int(comp_input)
            if comp_choice in GameChunker.COMPRESSION_LEVELS or comp_choice == 99:
                break
            print("âŒ Lá»±a chá»n khÃ´ng há»£p lá»‡!")
        except ValueError:
            print("âŒ Vui lÃ²ng nháº­p sá»‘!")
    
    # Output directory
    print("\n?? B??C 4: Output directory")
    default_output = "./chunks"
    output_dir = input(f"Nh?p output folder (Enter = {default_output}): ").strip().strip('"')
    if not output_dir:
        output_dir = default_output

    # HF auto-upload (enable when token + repo are present)
    hf_repo_id = os.getenv("HF_REPO_ID") or ""
    hf_repo_type = os.getenv("HF_REPO_TYPE") or None
    hf_revision = os.getenv("HF_REVISION") or None
    hf_upload = bool(get_token() and hf_repo_id)
    hf_delete = bool(hf_upload)
    hf_max_inflight = int(os.getenv("HF_MAX_INFLIGHT") or 0) if hf_upload else 0
    hf_root = os.getenv("HF_ROOT") or None
    hf_channel = os.getenv("HF_CHANNEL") or None
    hf_version_folder = os.getenv("HF_VERSION_FOLDER") or None
    hf_game_folder = os.getenv("HF_GAME_FOLDER") or None
    hf_folder = os.getenv("HF_FOLDER") or None
    hf_manifest_root = os.getenv("HF_MANIFEST_ROOT") or None
    
    # Optional App ID
    print("\nðŸ“¦ BÆ¯á»šC 5: Steam AppID (optional)")
    app_id = input("Nháº­p appid (Enter Ä‘á»ƒ bá» qua): ").strip()
    
    # ðŸ†• Auto-detect version tá»« appid
    version = DEFAULT_VERSION
    if app_id:
        print("\nðŸ¤– Äang fetch version má»›i nháº¥t tá»« Steam News...")
        detected = detect_version_from_news(app_id, DEFAULT_NEWS_API_BASE, DEFAULT_VERSION_REGEX, verbose=True)
        if detected:
            version = detected
            print(f"âœ… Auto version: {version}")
        else:
            print(f"âš ï¸  KhÃ´ng tÃ¬m Ä‘Æ°á»£c version, dÃ¹ng default: {DEFAULT_VERSION}")
    
    if hf_upload:
        parent_default = hf_root or game_folder.split('\\')[-1]
        game_default = hf_game_folder or game_folder.split('\\')[-1]
        parent_input = input(f"Nhap ten folder me tren HF (Enter = {parent_default}): " ).strip()
        game_input = input(f"Nhap ten folder game con tren HF (Enter = {game_default}): " ).strip()
        channel_input = input("Nhap channel (game/crack/dlc) (Enter = game): " ).strip().lower()
        if parent_input:
            hf_root = parent_input
        else:
            hf_root = parent_default
        if game_input:
            hf_game_folder = game_input
        else:
            hf_game_folder = game_default
        if channel_input:
            hf_channel = channel_input
        else:
            hf_channel = hf_channel or 'game'

    # Confirm
    print("\n" + "=" * 80)
    print("ðŸ“‹ XÃC NHáº¬N:")
    print("=" * 80)
    print(f"ðŸ“‚ Game folder: {game_folder}")
    if chunk_size == -1:
        print(f"ðŸ“¦ Chunk size: AUTO (tá»± Ä‘á»™ng)")
    else:
        print(f"ðŸ“¦ Chunk size: {chunk_size} MB")
    
    if comp_choice == 99:
        print(f"ðŸ—œï¸  Compression: AUTO (tá»± Ä‘á»™ng)")
    else:
        print(f"ðŸ—œï¸  Compression: {GameChunker.COMPRESSION_LEVELS[comp_choice]['name']}")
    
    print(f"ðŸ“ Output: {output_dir}")
    print(f"ðŸ·ï¸  Version: {version}")
    if hf_upload:
        print(f"??  HF upload: enabled -> {hf_repo_id}")
        print("?? HF delete: enabled")
        channel_folder = (hf_game_folder or game_folder.split("\\")[-1]) if (hf_channel or "game") == "game" else (hf_channel or "game")
        version_folder = hf_version_folder or f"{hf_root} {version}"
        print(f"?? HF path: {hf_root}/{channel_folder}/{version_folder}")
        if hf_max_inflight:
            print(f"?? Max inflight chunks: {hf_max_inflight}")
    else:
        print("??  HF upload: disabled (missing HF_TOKEN or HF_REPO_ID)")
    print("=" * 80)
    
    confirm = input("\nâœ… Báº¯t Ä‘áº§u? (y/n): ").lower()
    if confirm != 'y':
        print("âŒ ÄÃ£ há»§y!")
        return
    
    # Run chunker
    try:
        chunker = GameChunker(
            game_folder=game_folder,
            output_dir=output_dir,
            chunk_size_mb=chunk_size,
            compression_level=comp_choice,
            version=version,
            steam_app_id=app_id or None,
            split_large_files=True,  # Always enabled in interactive mode
            hf_upload=hf_upload,
            hf_repo_id=hf_repo_id or None,
            hf_repo_type=hf_repo_type,
            hf_revision=hf_revision,
            hf_delete=hf_delete,
            hf_max_inflight=hf_max_inflight,
            hf_batch_size=0,
            hf_root=hf_root,
            hf_channel=hf_channel,
            hf_version_folder=hf_version_folder,
            hf_game_folder=hf_game_folder,
            hf_folder=hf_folder,
            hf_manifest_root=hf_manifest_root,
        )
        chunker.run()
    except Exception as e:
        print(f"\nâŒ Lá»–I: {e}")
        import traceback
        traceback.print_exc()


def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description='Game Chunker - Chia game thÃ nh chunks vá»›i compression',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Interactive mode
  python game_chunker.py
  
  # Full AUTO mode (recommended)
  python game_chunker.py --auto -i "E:/Games/SILENT HILL f"
  python game_chunker.py --auto -i "E:/Games/SILENT HILL f" -o "./output"
  
  # Command line mode with manual settings
  python game_chunker.py --input "E:/Games/SILENT HILL f" --chunk-size 50 --compression 5
  
  # Auto compression, manual chunk size
  python game_chunker.py -i "E:/Games/SILENT HILL f" -c 50 --compression 99
  
  # Quick test (no compression)
  python game_chunker.py --input "E:/Games/SILENT HILL f" --chunk-size 100 --compression 0
        """
    )
    
    parser.add_argument('--input', '-i', help='Game folder path')
    parser.add_argument('--output', '-o', default='./chunks', help='Output directory (default: ./chunks)')
    parser.add_argument('--chunk-size', '-c', type=int, help='Chunk size in MB (e.g., 50, 100, 200, or -1 for AUTO)')
    parser.add_argument('--compression', '-comp', type=int, choices=[0,1,2,3,4,5,99], 
                        help='Compression level (0=Store, 1=Fast, 2=Normal, 3=Max, 4=BZIP2, 5=LZMA, 99=AUTO)')
    parser.add_argument('--version', '-v', default=DEFAULT_VERSION, help=f'Version string (default: {DEFAULT_VERSION})')
    parser.add_argument('--auto', '-a', action='store_true', help='Full AUTO mode (auto-detect everything)')
    parser.add_argument('--no-split', action='store_true', help='Disable splitting large files (NOT recommended)')
    parser.add_argument('--rollup-archive', help='Append each chunk zip into a single .zip (store) file')
    parser.add_argument('--delete-chunks', action='store_true', help='Delete chunk zips after adding to rollup archive')
    parser.add_argument('--hf-upload', action='store_true', help='Upload each chunk to Hugging Face as it is created')
    parser.add_argument('--hf-folder', help='Target folder path in HF repo (overrides hf-root/channel/version-folder)')
    parser.add_argument('--hf-root', help='Root folder name for a game (default: local game folder name)')
    parser.add_argument('--hf-channel', help='Second-level folder: game|crack|dlc (default: game)')
    parser.add_argument('--hf-version-folder', help='Third-level folder name (default: "<root> <version>")')
    parser.add_argument('--hf-game-folder', help='Folder name for game channel (default: game folder name)')
    parser.add_argument('--hf-repo-id', help='HF repo id (default: env HF_REPO_ID)')
    parser.add_argument('--hf-repo-type', default=None, help='HF repo type: dataset|model|space (default: env or dataset)')
    parser.add_argument('--hf-revision', default=None, help='HF revision (default: env or main)')
    parser.add_argument('--hf-delete', action='store_true', help='Delete chunk after successful HF upload')
    parser.add_argument('--hf-manifest-root', help='Upload a copy of manifest to this HF root folder (default: hf-root)')
    parser.add_argument('--hf-manifest-latest', action='store_true', help='Also upload manifest.json into hf-manifest-root')
    parser.add_argument('--hf-upload-workers', type=int, default=1, help='Number of HF upload workers (default: 1)')
    parser.add_argument('--hf-upload-queue', type=int, default=1, help='Max in-flight upload queue size (default: 1)')
    parser.add_argument('--hf-batch-size', type=int, default=0, help='Force queue sync after N chunks (default: 0 = disabled)')
    parser.add_argument('--hf-commit-batch-size', type=int, default=16, help='Files per HF commit (default: 16)')
    parser.add_argument('--hf-target-commits-per-hour', type=int, default=96, help='Auto-tune commit batch size for this commit budget (default: 96)')
    parser.add_argument('--hf-max-inflight', type=int, default=0, help='Max chunk files kept on disk during HF upload (default: 0 = unlimited)')
    parser.add_argument('--hf-wait-on-rate-limit', action='store_true', default=True, help='Wait and auto-resume when HF commit limit (429) is hit')
    parser.add_argument('--no-hf-wait-on-rate-limit', action='store_false', dest='hf_wait_on_rate_limit', help='Fail fast on HF commit rate limit')
    parser.add_argument('--hf-rate-limit-max-wait', type=int, default=3900, help='Max seconds to wait for HF commit rate-limit reset (default: 3900)')
    parser.add_argument('--max-chunks', type=int, default=0, help='Process only N chunks (testing)')
    parser.add_argument('--partial-scan', action='store_true', help='Stop scanning once enough data for max-chunks (testing)')
    parser.add_argument('--steam-app-id', help='Steam app id to auto-detect version from news cache')
    parser.add_argument('--news-api-base', default=DEFAULT_NEWS_API_BASE, help=f'Backend base URL for news (default: {DEFAULT_NEWS_API_BASE})')
    parser.add_argument('--version-regex', default=DEFAULT_VERSION_REGEX, help='Regex to extract version from news title')
    parser.add_argument('--auto-version', action='store_true', help='Auto-detect version from news if steam-app-id is provided')
    parser.add_argument('--news-debug', action='store_true', help='Print debug info while fetching news for version detection')
    parser.add_argument('--env-file', help='Optional .env path to load HF token')
    
    # ðŸ†• DYNAMIC MODE ARGUMENTS
    parser.add_argument('--dynamic', action='store_true', help='Enable dynamic chunk management (auto-create chunks, keep 20-24 active)')
    parser.add_argument('--dynamic-target', type=int, default=24, help='Target chunk count in dynamic mode (default: 24)')
    parser.add_argument('--dynamic-min', type=int, default=20, help='Minimum chunk count in dynamic mode (default: 20)')
    parser.add_argument('--dynamic-output', help='Output folder for dynamic chunks (default: ./dynamic_chunks)')
    
    # ðŸ†• MAX SPEED UPLOAD ARGUMENTS
    parser.add_argument('--max-speed', action='store_true', help='Enable max-speed upload mode (16 workers, optimized for speed)')
    parser.add_argument('--max-workers', type=int, default=16, help='Max upload workers for --max-speed (default: 16)')
    parser.add_argument('--monitor-drive', default='E', help='Monitor disk drive (default: E)')
    
    args = parser.parse_args()

    if args.env_file:
        load_env_file(Path(args.env_file))
    load_env()
    os.environ["HF_WAIT_ON_RATE_LIMIT"] = "1" if args.hf_wait_on_rate_limit else "0"
    os.environ["HF_RATE_LIMIT_MAX_WAIT_SECONDS"] = str(max(60, int(args.hf_rate_limit_max_wait)))
    os.environ["HF_TARGET_COMMITS_PER_HOUR"] = str(max(1, int(args.hf_target_commits_per_hour)))
    
    # ðŸ†• DYNAMIC MODE SETUP
    if args.dynamic:
        print("\n" + "=" * 80)
        print("ðŸš€ DYNAMIC CHUNK MODE ACTIVATED")
        print("=" * 80)
        
        # Check disk space
        monitor = DiskSpaceMonitor()
        free_gb, total_gb = monitor.get_disk_space(f"{args.monitor_drive}:")
        
        print(f"ðŸ“Š Disk {args.monitor_drive}: {free_gb:.2f} GB free / {total_gb:.2f} GB total")
        
        # Auto suggest chunk count
        suggested_chunks = monitor.suggest_chunk_count(free_gb, args.dynamic_min, args.dynamic_target)
        print(f"ðŸ’¡ Auto-suggested chunks: {suggested_chunks} (based on free space)")
        
        # Create dynamic manager
        dynamic_output = args.dynamic_output or "./dynamic_chunks"
        dynamic_manager = DynamicChunkManager(
            Path(dynamic_output),
            target_count=args.dynamic_target,
            min_chunks=args.dynamic_min
        )
        dynamic_manager.report_status()
        print("=" * 80)
    
    # ðŸ†• MAX-SPEED MODE SETUP
    if args.max_speed:
        print("\n" + "=" * 80)
        print("âš¡ MAX-SPEED UPLOAD MODE ACTIVATED")
        print("=" * 80)
        print(f"ðŸ”§ Upload workers: {args.max_workers}")
        print(f"âš™ï¸  Override: --hf-upload-workers = {args.max_workers}")
        print("=" * 80)
        # Override workers
        args.hf_upload_workers = args.max_workers
        args.hf_upload = True  # Force HF upload
    
    # Náº¿u khÃ´ng cÃ³ arguments â†’ Interactive mode
    if not args.input or (args.chunk_size is None and not args.auto and not args.dynamic) or (args.compression is None and not args.auto and not args.dynamic):
        show_menu()
    else:
        # Command line mode
        try:
            # Auto mode override
            if args.auto:
                chunk_size = -1  # AUTO
                compression = 99  # AUTO
            else:
                chunk_size = args.chunk_size
                compression = args.compression

            version = args.version
            if args.steam_app_id and (args.auto_version or args.version == DEFAULT_VERSION):
                detected = detect_version_from_news(args.steam_app_id, args.news_api_base, args.version_regex, verbose=args.news_debug)
                if detected:
                    version = detected
                    print(f"Auto-detected version from news: {version}")
                else:
                    print("Warning: Could not detect version from news; using provided version.")
            
            chunker = GameChunker(
                game_folder=args.input,
                output_dir=args.output,
                chunk_size_mb=chunk_size,
                compression_level=compression,
                version=version,
                steam_app_id=args.steam_app_id,
                auto_mode=args.auto,
                split_large_files=not args.no_split,  # Default: True (split enabled)
                rollup_archive=args.rollup_archive,
                delete_after_rollup=args.delete_chunks,
                hf_upload=args.hf_upload,
                hf_folder=args.hf_folder,
                hf_repo_id=args.hf_repo_id,
                hf_repo_type=args.hf_repo_type,
                hf_revision=args.hf_revision,
                hf_delete=args.hf_delete,
                hf_manifest_root=args.hf_manifest_root,
                hf_manifest_latest=args.hf_manifest_latest,
                hf_root=args.hf_root,
                hf_channel=args.hf_channel,
                hf_version_folder=args.hf_version_folder,
                hf_game_folder=args.hf_game_folder,
                hf_upload_workers=args.hf_upload_workers,
                hf_upload_queue=args.hf_upload_queue,
                hf_batch_size=args.hf_batch_size,
                hf_max_inflight=args.hf_max_inflight,
                hf_commit_batch_size=args.hf_commit_batch_size,
                max_chunks=args.max_chunks,
                partial_scan=args.partial_scan
            )
            
            # ðŸ†• MAX-SPEED UPLOADER
            if args.max_speed and args.hf_upload:
                token = get_token()
                if token and args.hf_repo_id:
                    print("\nâš¡ Initializing MaxSpeedUploader...")
                    uploader = MaxSpeedUploader(
                        token=token,
                        repo_id=args.hf_repo_id,
                        repo_type=args.hf_repo_type or "dataset",
                        revision=args.hf_revision or "main",
                        workers=args.max_workers
                    )
                    uploader.stats['start_time'] = time.time()
                    print(f"ðŸš€ Max-speed upload ready with {uploader.workers} workers!")
                    chunker.run()
                    uploader.report_speed()
                else:
                    chunker.run()
            else:
                chunker.run()
        except Exception as e:
            print(f"\nâŒ Lá»–I: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()


