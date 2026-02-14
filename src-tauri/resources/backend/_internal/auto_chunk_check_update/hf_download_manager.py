#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HuggingFace Download Manager
Handles downloading games from HuggingFace repository
"""

import os
import json
from pathlib import Path
from typing import Optional, Dict, List, Callable
import logging
from huggingface_hub import [REDACTED_HF_TOKEN], list_repo_files

logger = logging.getLogger(__name__)

class HFDownloadManager:
    """Manage downloads from HuggingFace"""
    
    def __init__(self, [REDACTED_HF_TOKEN]: Optional[str] = None):
        """
        Initialize HF download manager
        
        Args:
            [REDACTED_HF_TOKEN]: HF token (loads from HF_TOKEN env if not provided)
        """
        self.[REDACTED_HF_TOKEN] = [REDACTED_HF_TOKEN] or os.getenv("HUGGING_FACE_TOKEN")
        if not self.[REDACTED_HF_TOKEN]:
            self.[REDACTED_HF_TOKEN] = self._load_token_from_env()
        
        self.repo_id = "MangaVNteam/Assassin-Creed-Odyssey-Crack"
        self.repo_type = "dataset"
    
    def _load_token_from_env(self) -> Optional[str]:
        """Load token from .env file"""
        for env_path in [".env", "../.env", "../../.env"]:
            env_file = Path(env_path)
            if env_file.exists():
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.startswith("HF_TOKEN="):
                            return line.replace("HF_TOKEN=", "").strip()
        return None
    
    def list_files(self) -> List[str]:
        """List all files in repository"""
        try:
            files = list_repo_files(
                repo_id=self.repo_id,
                repo_type=self.repo_type,
                token=self.[REDACTED_HF_TOKEN]
            )
            return list(files)
        except Exception as e:
            logger.error(f"Failed to list files: {e}")
            return []
    
    def download_file(
        self,
        filename: str,
        output_dir: str = "./downloads",
        progress_callback: Optional[Callable] = None
    ) -> Optional[str]:
        """
        Download file from HF repository
        
        Args:
            filename: File to download (e.g., "Among Us/Among Us.rar")
            output_dir: Where to save file
            progress_callback: Callback for progress updates
        
        Returns:
            Path to downloaded file or None on error
        """
        try:
            Path(output_dir).mkdir(parents=True, exist_ok=True)
            
            logger.info(f"Downloading: {filename}")
            
            file_path = [REDACTED_HF_TOKEN](
                repo_id=self.repo_id,
                filename=filename,
                repo_type=self.repo_type,
                cache_dir=str(Path(output_dir) / "cache"),
                local_dir=str(output_dir),
                token=self.[REDACTED_HF_TOKEN]
            )
            
            logger.info(f"Downloaded to: {file_path}")
            return file_path
            
        except Exception as e:
            logger.error(f"Download failed: {e}")
            return None
    
    def download_game_version(
        self,
        game_id: str,
        version: str,
        output_dir: str = "./downloads",
        progress_callback: Optional[Callable] = None
    ) -> Optional[str]:
        """
        Download specific game version
        
        Args:
            game_id: Game identifier
            version: Version (e.g., "v1.0")
            output_dir: Output directory
            progress_callback: Progress callback
        
        Returns:
            Path to downloaded file
        """
        # Map game_id to HF filename
        # e.g., "assassins_creed_odyssey" -> "Assassin's Creed Odyssey Crack.zip"
        
        game_mapping = {
            "assassins_creed_odyssey": "Assassin's Creed Odyssey Crack.zip",
            "among_us": "Among Us/Among Us.rar",
            "dark_souls_3": "DARKSOULSIII online-fix.rar",
            "gta_v": "GRAND THEFT AUTO V ENHANCED c.zip",
            "elden_ring": "ELDENRINGNIGHTREIGN online-fix.zip",
        }
        
        filename = game_mapping.get(game_id)
        if not filename:
            logger.error(f"Game not found: {game_id}")
            return None
        
        return self.download_file(filename, output_dir, progress_callback)
    
    def get_file_info(self, filename: str) -> Optional[Dict]:
        """Get file info from repository"""
        try:
            files = self.list_files()
            if filename in files:
                return {
                    "name": filename,
                    "exists": True,
                    "repo": self.repo_id
                }
            return None
        except Exception as e:
            logger.error(f"Failed to get file info: {e}")
            return None


def download_with_progress(
    filename: str,
    output_dir: str = "./downloads",
    repo_id: str = "MangaVNteam/Assassin-Creed-Odyssey-Crack"
) -> Optional[str]:
    """
    Helper function: Download file with progress
    
    Args:
        filename: File to download
        output_dir: Output directory
        repo_id: Repository ID
    
    Returns:
        Path to downloaded file
    """
    manager = HFDownloadManager()
    return manager.download_file(filename, output_dir)


if __name__ == "__main__":
    # Test
    print("\n" + "="*70)
    print("🎮 HuggingFace Download Manager Test")
    print("="*70)
    
    manager = HFDownloadManager()
    
    # List files
    print("\n📁 Listing repository files...")
    files = manager.list_files()
    print(f"✅ Found {len(files)} files")
    for f in files[:5]:
        print(f"   {f}")
    
    print("\n" + "="*70)
    print("✅ Manager Ready for Use")
    print("="*70)
