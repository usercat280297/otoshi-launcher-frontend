#!/usr/bin/env python3
"""
AUTO FULL PIPELINE - Tự động từ đầu đến cuối
Phát hiện thay đổi → Export chunks → Upload HF → Ready!

Workflow:
1. Scan game mới vs manifest cũ
2. Phát hiện thay đổi (file-level)
3. Tạo chunks mới tự động
4. Copy ONLY changed chunks
5. Upload lên HuggingFace
6. Update manifest_latest.json
7. Tạo game_versions.json cho UI
"""

import os
import sys
import json
import shutil
import hashlib
import zipfile
import time
import logging
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from datetime import datetime

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('auto_pipeline.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class AutoFullPipeline:
    """
    Tự động xử lý toàn bộ quy trình update game
    """
    
    def __init__(self, config_path: str = None):
        self.config = self._load_config(config_path)
        self.game_folder = None
        self.old_manifest_path = None
        self.output_folder = None
        self.temp_chunks_folder = None
        self.game_id = None
        
    def _load_config(self, config_path: str = None) -> Dict:
        """Load cấu hình"""
        if config_path and Path(config_path).exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        
        return {
            'chunk_size_mb': 100,
            'compression_level': 0,
            'hugging_face': {
                'token': os.getenv('HUGGING_FACE_TOKEN'),
                'repo': None  # Sẽ được cập nhật sau
            },
            'auto_upload': False,  # Set True để upload tự động
            'workers': 3
        }
    
    @staticmethod
    def calculate_hash(filepath: str) -> str:
        """Tính SHA256 hash"""
        sha256 = hashlib.sha256()
        try:
            with open(filepath, 'rb') as f:
                for block in iter(lambda: f.read(65536), b''):
                    sha256.update(block)
            return sha256.hexdigest()
        except Exception as e:
            logger.error(f"❌ Error hashing {filepath}: {e}")
            raise
    
    def step1_select_game(self, game_path: str = None) -> bool:
        """Step 1: Chọn game folder"""
        logger.info("\n" + "=" * 80)
        logger.info("📂 STEP 1: Select game folder")
        logger.info("=" * 80)
        
        if game_path:
            path_obj = Path(game_path)
        else:
            while True:
                path = input("Game folder path: ").strip().strip('"')
                path_obj = Path(path)
                
                if not path_obj.exists():
                    logger.error(f"❌ Folder not found: {path}")
                    continue
                
                if not path_obj.is_dir():
                    logger.error(f"❌ Not a directory!")
                    continue
                
                files = list(path_obj.rglob('*'))
                if not files:
                    logger.warning(f"⚠️  Folder is empty!")
                
                break
        
        self.game_folder = path_obj
        
        # Calculate size
        total_size = sum(f.stat().st_size for f in path_obj.rglob('*') if f.is_file())
        logger.info(f"✅ Game folder: {self.game_folder}")
        logger.info(f"📊 Size: {total_size / (1024**3):.2f} GB")
        
        return True
    
    def step2_select_old_manifest(self, manifest_path: str = None) -> bool:
        """Step 2: Chọn manifest cũ"""
        logger.info("\n" + "=" * 80)
        logger.info("📄 STEP 2: Select old manifest (previous version)")
        logger.info("=" * 80)
        
        if manifest_path:
            path_obj = Path(manifest_path)
        else:
            # Auto-find manifests in current folder
            current_dir = Path('.')
            manifests = list(current_dir.glob('manifest_*.json'))
            
            if manifests:
                logger.info(f"✅ Found {len(manifests)} manifest files:")
                for i, m in enumerate(manifests, 1):
                    logger.info(f"   {i}. {m.name}")
                
                choice = input(f"Select (1-{len(manifests)}): ").strip()
                try:
                    path_obj = manifests[int(choice) - 1]
                except:
                    logger.error("❌ Invalid choice!")
                    return False
            else:
                while True:
                    path = input("Manifest file path: ").strip().strip('"')
                    path_obj = Path(path)
                    
                    if not path_obj.exists():
                        logger.error(f"❌ File not found: {path}")
                        continue
                    break
        
        # Validate
        try:
            with open(path_obj, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
            
            if 'version' not in manifest or 'chunks' not in manifest:
                logger.error("❌ Invalid manifest format!")
                return False
            
            self.old_manifest_path = path_obj
            logger.info(f"✅ Manifest: {self.old_manifest_path.name}")
            logger.info(f"📊 Version: {manifest['version']}")
            logger.info(f"📊 Chunks: {len(manifest['chunks'])}")
            
            return True
            
        except json.JSONDecodeError:
            logger.error("❌ Invalid JSON!")
            return False
    
    def step3_detect_game_id(self) -> str:
        """Step 3: Phát hiện/chọn game ID"""
        logger.info("\n" + "=" * 80)
        logger.info("🎮 STEP 3: Select game ID")
        logger.info("=" * 80)
        
        # Suggest from folder name
        game_id = self.game_folder.name.lower().replace(' ', '_')
        
        logger.info(f"Suggested game ID: {game_id}")
        custom = input("Use this ID? (y/n, or enter custom): ").strip()
        
        if custom.lower() == 'n':
            game_id = input("Enter game ID: ").strip().lower().replace(' ', '_')
        elif custom and custom.lower() != 'y':
            game_id = custom
        
        self.game_id = game_id
        logger.info(f"✅ Game ID: {self.game_id}")
        
        return game_id
    
    def step4_scan_and_compare(self) -> Optional[Dict]:
        """Step 4: Scan game mới và so sánh với manifest cũ"""
        logger.info("\n" + "=" * 80)
        logger.info("🔍 STEP 4: Scan game and compare")
        logger.info("=" * 80)
        
        # Load old manifest
        with open(self.old_manifest_path, 'r', encoding='utf-8') as f:
            old_manifest = json.load(f)
        
        old_version = old_manifest['version']
        
        # Scan new game folder
        logger.info("📂 Scanning new game folder...")
        new_files = {}
        
        for file_path in self.game_folder.rglob('*'):
            if file_path.is_file():
                rel_path = file_path.relative_to(self.game_folder)
                rel_str = str(rel_path).replace('\\', '/')
                
                file_hash = self.calculate_hash(str(file_path))
                file_size = file_path.stat().st_size
                
                new_files[rel_str] = {
                    'hash': file_hash,
                    'size': file_size,
                    'path': rel_str
                }
        
        logger.info(f"✅ Scanned {len(new_files)} files")
        
        # Create file hash map from old manifest
        old_files = {}
        for chunk in old_manifest['chunks']:
            for file_info in chunk.get('files', []):
                old_files[file_info['path']] = {
                    'hash': file_info['hash'],
                    'size': file_info['size'],
                    'chunk_id': chunk['id']
                }
        
        # Detect changes
        added = []
        removed = []
        modified = []
        unchanged = 0
        
        for filepath, new_info in new_files.items():
            if filepath not in old_files:
                added.append(filepath)
            elif old_files[filepath]['hash'] != new_info['hash']:
                modified.append(filepath)
            else:
                unchanged += 1
        
        for filepath in old_files:
            if filepath not in new_files:
                removed.append(filepath)
        
        # Log results
        logger.info(f"\n📊 COMPARISON RESULTS:")
        logger.info(f"   Added files: {len(added)}")
        logger.info(f"   Removed files: {len(removed)}")
        logger.info(f"   Modified files: {len(modified)}")
        logger.info(f"   Unchanged files: {unchanged}")
        logger.info(f"   Total files: {len(new_files)}")
        
        total_changes = len(added) + len(removed) + len(modified)
        
        if total_changes == 0:
            logger.warning("⚠️  NO CHANGES DETECTED! Game is identical to old version.")
            return None
        
        # Suggest new version
        parts = old_version.lstrip('v').split('.')
        try:
            major, minor = int(parts[0]), int(parts[1])
            new_version = f"v{major}.{minor + 1}"
        except:
            new_version = "v1.1"
        
        # Ask for custom version
        custom_version = input(f"\nNew version? (default={new_version}): ").strip()
        if custom_version:
            new_version = custom_version
        
        logger.info(f"\n✅ New version: {new_version}")
        
        return {
            'old_version': old_version,
            'new_version': new_version,
            'new_files': new_files,
            'old_files': old_files,
            'added': added,
            'removed': removed,
            'modified': modified,
            'unchanged': unchanged,
            'total_changes': total_changes
        }
    
    def step5_chunk_game(self, comparison: Dict) -> Optional[Dict]:
        """Step 5: Chunk game mới"""
        logger.info("\n" + "=" * 80)
        logger.info("📦 STEP 5: Chunk new game")
        logger.info("=" * 80)
        
        new_version = comparison['new_version']
        new_files = comparison['new_files']
        
        # Create temp folder
        self.temp_chunks_folder = Path(f"./temp_chunks_{int(time.time())}")
        self.temp_chunks_folder.mkdir(parents=True, exist_ok=True)
        
        chunk_size_bytes = self.config['chunk_size_mb'] * 1024 * 1024
        
        chunks = []
        chunk_id = 1
        current_chunk_files = []
        current_chunk_size = 0
        
        logger.info(f"Chunking with {self.config['chunk_size_mb']} MB per chunk...")
        
        # Sort files by path
        sorted_files = sorted(new_files.items())
        
        for rel_path, file_info in sorted_files:
            file_path = self.game_folder / rel_path
            file_size = file_info['size']
            
            # Check if need new chunk
            if current_chunk_size + file_size > chunk_size_bytes and current_chunk_files:
                # Save current chunk
                chunk_info = self._create_chunk(
                    chunk_id, current_chunk_files, new_version
                )
                if chunk_info:
                    chunks.append(chunk_info)
                    chunk_id += 1
                
                current_chunk_files = []
                current_chunk_size = 0
            
            current_chunk_files.append((rel_path, file_path, file_info))
            current_chunk_size += file_size
        
        # Save last chunk
        if current_chunk_files:
            chunk_info = self._create_chunk(
                chunk_id, current_chunk_files, new_version
            )
            if chunk_info:
                chunks.append(chunk_info)
        
        logger.info(f"✅ Created {len(chunks)} chunks")
        
        # Create manifest
        manifest = {
            'version': new_version,
            'timestamp': datetime.now().isoformat(),
            'game_id': self.game_id,
            'total_size': sum(f['size'] for f in new_files.values()),
            'chunk_size_mb': self.config['chunk_size_mb'],
            'chunks': chunks,
            'files': new_files
        }
        
        manifest_path = self.temp_chunks_folder / f"manifest_{new_version}.json"
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        
        logger.info(f"✅ Created manifest: {manifest_path.name}")
        
        return {
            'manifest': manifest,
            'manifest_path': manifest_path,
            'chunks': chunks
        }
    
    def _create_chunk(self, chunk_id: int, files: List, version: str) -> Dict:
        """Tạo 1 chunk"""
        chunk_filename = f"chunk_{chunk_id:03d}.zip"
        chunk_path = self.temp_chunks_folder / chunk_filename
        
        # Create ZIP
        with zipfile.ZipFile(chunk_path, 'w', zipfile.ZIP_STORED) as zf:
            for rel_path, file_path, file_info in files:
                try:
                    zf.write(file_path, arcname=rel_path)
                except Exception as e:
                    logger.error(f"❌ Error adding {rel_path}: {e}")
        
        # Calculate hash
        chunk_hash = self.calculate_hash(str(chunk_path))
        chunk_size = chunk_path.stat().st_size
        
        logger.info(f"   Chunk {chunk_id}: {chunk_filename} ({chunk_size / (1024**2):.2f} MB)")
        
        return {
            'id': f"chunk_{chunk_id:03d}",
            'filename': chunk_filename,
            'hash': chunk_hash,
            'size': chunk_size,
            'file_count': len(files),
            'files': [
                {
                    'path': rel_path,
                    'hash': file_info['hash'],
                    'size': file_info['size']
                }
                for rel_path, _, file_info in files
            ]
        }
    
    def step6_export_changed_chunks(self, comparison: Dict, 
                                    chunked: Dict, output_path: str = None) -> Path:
        """Step 6: Export ONLY changed chunks"""
        logger.info("\n" + "=" * 80)
        logger.info("📁 STEP 6: Export changed chunks")
        logger.info("=" * 80)
        
        if not output_path:
            output_path = Path(f"./update_{comparison['new_version']}")
        else:
            output_path = Path(output_path)
        
        output_path.mkdir(parents=True, exist_ok=True)
        self.output_folder = output_path
        
        new_version = comparison['new_version']
        old_files = comparison['old_files']
        new_files = comparison['new_files']
        
        # Determine which chunks need upload
        chunks_to_upload = []
        
        for chunk in chunked['chunks']:
            needs_upload = False
            
            for file_info in chunk['files']:
                rel_path = file_info['path']
                
                # Check if file is new or modified
                if rel_path in comparison['added'] or rel_path in comparison['modified']:
                    needs_upload = True
                    break
            
            if needs_upload:
                chunks_to_upload.append(chunk)
        
        logger.info(f"Total chunks: {len(chunked['chunks'])}")
        logger.info(f"Chunks to upload: {len(chunks_to_upload)}")
        
        # Copy changed chunks
        for chunk in chunks_to_upload:
            src = self.temp_chunks_folder / chunk['filename']
            dst = output_path / chunk['filename']
            
            if src.exists():
                shutil.copy2(src, dst)
                logger.info(f"   Copied: {chunk['filename']} ({chunk['size'] / (1024**2):.2f} MB)")
        
        # Copy manifest
        manifest_src = chunked['manifest_path']
        manifest_dst = output_path / f"manifest_{new_version}.json"
        shutil.copy2(manifest_src, manifest_dst)
        logger.info(f"✅ Copied manifest: {manifest_dst.name}")
        
        # Calculate bandwidth savings
        total_size = sum(f['size'] for f in chunked['chunks'])
        upload_size = sum(f['size'] for f in chunks_to_upload)
        savings = (1 - upload_size / total_size) * 100 if total_size > 0 else 0
        
        logger.info(f"\n💾 BANDWIDTH ANALYSIS:")
        logger.info(f"   Total game size: {total_size / (1024**3):.2f} GB")
        logger.info(f"   Upload size: {upload_size / (1024**3):.2f} GB")
        logger.info(f"   Savings: {savings:.1f}%")
        
        return output_path
    
    def step7_upload_to_hf(self, output_path: Path) -> bool:
        """Step 7: Upload lên HuggingFace"""
        logger.info("\n" + "=" * 80)
        logger.info("☁️  STEP 7: Upload to HuggingFace")
        logger.info("=" * 80)
        
        if not self.config['hugging_face']['token']:
            logger.warning("⚠️  No HuggingFace token set!")
            logger.info("Set HUGGING_FACE_TOKEN environment variable to enable auto-upload")
            return False
        
        if not self.config['hugging_face']['repo']:
            repo = input("Enter HuggingFace repo (user/repo): ").strip()
            self.config['hugging_face']['repo'] = repo
        
        try:
            from huggingface_hub import HfApi
            
            api = HfApi(token=self.config['hugging_face']['token'])
            repo_id = self.config['hugging_face']['repo']
            
            # Upload files
            files = list(output_path.glob('*'))
            logger.info(f"Uploading {len(files)} files to {repo_id}...")
            
            for file_path in files:
                logger.info(f"   Uploading: {file_path.name}")
                
                # Get new version from manifest
                if file_path.name.startswith('manifest_'):
                    version = file_path.name.replace('manifest_', '').replace('.json', '')
                    path_in_repo = f"{self.game_id}/{version}/{file_path.name}"
                else:
                    version = self.config['hugging_face'].get('current_version', 'v1.0')
                    path_in_repo = f"{self.game_id}/{version}/{file_path.name}"
                
                api.upload_file(
                    path_or_fileobj=str(file_path),
                    path_in_repo=path_in_repo,
                    repo_id=repo_id,
                    repo_type="model"
                )
            
            logger.info(f"✅ Upload complete!")
            return True
            
        except ImportError:
            logger.error("❌ huggingface_hub not installed!")
            logger.info("Run: pip install huggingface_hub")
            return False
        except Exception as e:
            logger.error(f"❌ Upload failed: {e}")
            return False
    
    def step8_create_game_versions_json(self) -> Path:
        """Step 8: Tạo game_versions.json cho UI"""
        logger.info("\n" + "=" * 80)
        logger.info("🎮 STEP 8: Create game_versions.json for UI")
        logger.info("=" * 80)
        
        # Load existing game versions if exist
        versions_file = Path('./game_versions.json')
        
        if versions_file.exists():
            with open(versions_file, 'r', encoding='utf-8') as f:
                versions_data = json.load(f)
        else:
            versions_data = {'games': {}}
        
        # Update game versions
        if self.game_id not in versions_data['games']:
            versions_data['games'][self.game_id] = {
                'name': self.game_folder.name,
                'versions': []
            }
        
        # Get latest manifest
        manifest_files = list(self.output_folder.glob('manifest_*.json'))
        if manifest_files:
            latest_manifest_path = manifest_files[0]
            
            with open(latest_manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
            
            version_info = {
                'version': manifest['version'],
                'timestamp': manifest.get('timestamp', datetime.now().isoformat()),
                'size_mb': manifest['total_size'] / (1024**2),
                'size_gb': manifest['total_size'] / (1024**3),
                'chunks': len(manifest['chunks']),
                'files': len(manifest.get('files', {}))
            }
            
            # Add to versions
            existing_versions = versions_data['games'][self.game_id]['versions']
            
            # Check if version already exists
            version_exists = any(v['version'] == version_info['version'] for v in existing_versions)
            
            if not version_exists:
                existing_versions.insert(0, version_info)  # Add at beginning (latest first)
            
            # Save updated file
            with open(versions_file, 'w', encoding='utf-8') as f:
                json.dump(versions_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"✅ Created: {versions_file.name}")
            logger.info(f"   Game: {self.game_id}")
            logger.info(f"   Versions: {len(existing_versions)}")
        
        return versions_file
    
    def cleanup(self):
        """Dọn dẹp temp files"""
        if self.temp_chunks_folder and self.temp_chunks_folder.exists():
            logger.info(f"\n🗑️  Cleaning up temp folder...")
            shutil.rmtree(self.temp_chunks_folder)
            logger.info(f"✅ Cleaned up: {self.temp_chunks_folder}")
    
    def run(self, game_path: str = None, manifest_path: str = None, 
            auto_upload: bool = False):
        """Main workflow"""
        logger.info("\n" + "=" * 80)
        logger.info("🚀 AUTO FULL PIPELINE - Complete Update Automation")
        logger.info("=" * 80)
        
        try:
            # Step 1
            if not self.step1_select_game(game_path):
                logger.error("❌ Cancelled!")
                return False
            
            # Step 2
            if not self.step2_select_old_manifest(manifest_path):
                logger.error("❌ Cancelled!")
                return False
            
            # Step 3
            self.step3_detect_game_id()
            
            # Step 4
            comparison = self.step4_scan_and_compare()
            if not comparison:
                logger.warning("⚠️  No changes detected!")
                return False
            
            # Confirm
            logger.info("\n" + "=" * 80)
            logger.info("📋 CONFIRM:")
            logger.info("=" * 80)
            logger.info(f"Game ID: {self.game_id}")
            logger.info(f"Old version: {comparison['old_version']}")
            logger.info(f"New version: {comparison['new_version']}")
            logger.info(f"Changes: +{len(comparison['added'])} -{len(comparison['removed'])} ✏️ {len(comparison['modified'])}")
            logger.info("=" * 80)
            
            confirm = input("\n✅ Proceed? (y/n): ").strip().lower()
            if confirm != 'y':
                logger.info("❌ Cancelled!")
                return False
            
            # Step 5
            chunked = self.step5_chunk_game(comparison)
            if not chunked:
                logger.error("❌ Chunking failed!")
                return False
            
            # Step 6
            self.step6_export_changed_chunks(comparison, chunked)
            
            # Step 7
            if auto_upload or input("\nUpload to HuggingFace? (y/n): ").strip().lower() == 'y':
                self.step7_upload_to_hf(self.output_folder)
            
            # Step 8
            self.step8_create_game_versions_json()
            
            # Cleanup
            self.cleanup()
            
            # Done!
            logger.info("\n" + "=" * 80)
            logger.info("✅ COMPLETE!")
            logger.info("=" * 80)
            logger.info(f"\n📁 Output: {self.output_folder.absolute()}")
            logger.info(f"📊 Ready for download in launcher!")
            logger.info("=" * 80)
            
            return True
            
        except KeyboardInterrupt:
            logger.info("\n❌ Cancelled by user!")
            self.cleanup()
            return False
        except Exception as e:
            logger.error(f"\n❌ ERROR: {e}")
            import traceback
            traceback.print_exc()
            self.cleanup()
            return False


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Auto Full Pipeline - Complete Game Update Automation')
    parser.add_argument('--game', help='Game folder path')
    parser.add_argument('--manifest', help='Old manifest file path')
    parser.add_argument('--config', help='Config file path')
    parser.add_argument('--auto-upload', action='store_true', help='Auto upload to HuggingFace')
    
    args = parser.parse_args()
    
    pipeline = AutoFullPipeline(args.config)
    pipeline.run(args.game, args.manifest, args.auto_upload)


if __name__ == "__main__":
    main()
