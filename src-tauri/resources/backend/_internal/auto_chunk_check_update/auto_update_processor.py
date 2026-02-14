#!/usr/bin/env python3
"""
AUTO UPDATE SCRIPT - Tự động phát hiện và xuất chunks thay đổi

Workflow:
1. Chọn thư mục game mới (đã update)
2. Chọn manifest cũ (v1.0)
3. Chọn thư mục output
4. Script tự động:
   - Chunk game mới
   - So sánh với manifest cũ
   - Copy ONLY changed chunks vào output
   - Tạo manifest mới
   - Tạo upload instructions
"""

import os
import sys
import json
import shutil
import hashlib
import zipfile
import time
from pathlib import Path
from typing import Dict, List

class AutoUpdateProcessor:
    """
    Tự động xử lý update game
    """
    
    def __init__(self):
        self.game_folder = None
        self.old_manifest_path = None
        self.output_folder = None
        self.temp_chunks_folder = None
        
    def select_game_folder(self):
        """Chọn thư mục game mới"""
        print("\n" + "=" * 80)
        print("📂 BƯỚC 1: Chọn thư mục GAME MỚI (đã update)")
        print("=" * 80)
        print("Nhập đường dẫn đến game folder:")
        print("Ví dụ: E:/Games/SILENT HILL f/Silent Hill F DLC")
        print("-" * 80)
        
        while True:
            path = input("Game folder: ").strip().strip('"')
            
            if not path:
                print("❌ Vui lòng nhập đường dẫn!")
                continue
            
            path_obj = Path(path)
            if not path_obj.exists():
                print(f"❌ Thư mục không tồn tại: {path}")
                retry = input("Thử lại? (y/n): ").lower()
                if retry != 'y':
                    return False
                continue
            
            if not path_obj.is_dir():
                print(f"❌ Đây không phải thư mục!")
                continue
            
            # Check if folder has files
            files = list(path_obj.rglob('*'))
            if not files:
                print(f"⚠️  Thư mục trống!")
                confirm = input("Tiếp tục? (y/n): ").lower()
                if confirm != 'y':
                    continue
            
            self.game_folder = path_obj
            print(f"✅ Game folder: {self.game_folder}")
            
            # Show size
            total_size = sum(f.stat().st_size for f in path_obj.rglob('*') if f.is_file())
            print(f"📊 Dung lượng: {total_size / (1024**3):.2f} GB")
            
            return True
    
    def select_old_manifest(self):
        """Chọn manifest cũ"""
        print("\n" + "=" * 80)
        print("📄 BƯỚC 2: Chọn MANIFEST CŨ (version trước)")
        print("=" * 80)
        print("Nhập đường dẫn đến manifest.json của version cũ:")
        print("Ví dụ: ./chunks_v1.0/manifest_v1.0.json")
        print("-" * 80)
        
        while True:
            path = input("Manifest file: ").strip().strip('"')
            
            if not path:
                print("❌ Vui lòng nhập đường dẫn!")
                continue
            
            path_obj = Path(path)
            if not path_obj.exists():
                print(f"❌ File không tồn tại: {path}")
                retry = input("Thử lại? (y/n): ").lower()
                if retry != 'y':
                    return False
                continue
            
            # Validate JSON
            try:
                with open(path_obj, 'r', encoding='utf-8') as f:
                    manifest = json.load(f)
                
                # Check structure
                if 'version' not in manifest or 'chunks' not in manifest:
                    print("❌ Manifest không đúng format!")
                    continue
                
                self.old_manifest_path = path_obj
                print(f"✅ Manifest: {self.old_manifest_path}")
                print(f"📊 Version: {manifest['version']}")
                print(f"📊 Chunks: {len(manifest['chunks'])}")
                print(f"📊 Total size: {manifest.get('total_size', 0) / (1024**3):.2f} GB")
                
                return True
                
            except json.JSONDecodeError:
                print("❌ File không phải JSON hợp lệ!")
                continue
            except Exception as e:
                print(f"❌ Lỗi đọc file: {e}")
                continue
    
    def select_output_folder(self):
        """Chọn thư mục output"""
        print("\n" + "=" * 80)
        print("📁 BƯỚC 3: Chọn THƯ MỤC OUTPUT (lưu chunks update)")
        print("=" * 80)
        print("Nhập đường dẫn thư mục để lưu chunks thay đổi:")
        print("Ví dụ: ./update_v1.1")
        print("(Thư mục sẽ được tạo nếu chưa tồn tại)")
        print("-" * 80)
        
        while True:
            path = input("Output folder: ").strip().strip('"')
            
            if not path:
                print("❌ Vui lòng nhập đường dẫn!")
                continue
            
            path_obj = Path(path)
            
            # Check if exists and not empty
            if path_obj.exists() and list(path_obj.iterdir()):
                print(f"⚠️  Thư mục đã tồn tại và có files!")
                choice = input("(1) Xóa và tạo mới  (2) Sử dụng  (3) Chọn thư mục khác: ").strip()
                
                if choice == '1':
                    shutil.rmtree(path_obj)
                    path_obj.mkdir(parents=True, exist_ok=True)
                elif choice == '2':
                    pass
                elif choice == '3':
                    continue
                else:
                    continue
            else:
                # Create folder
                path_obj.mkdir(parents=True, exist_ok=True)
            
            self.output_folder = path_obj
            print(f"✅ Output folder: {self.output_folder}")
            
            return True
    
    def detect_new_version(self, old_version: str) -> str:
        """Tự động phát hiện version mới"""
        # Parse old version
        if old_version.startswith('v'):
            old_version = old_version[1:]
        
        parts = old_version.split('.')
        
        # Increment minor version
        if len(parts) >= 2:
            try:
                major = int(parts[0])
                minor = int(parts[1])
                new_version = f"v{major}.{minor + 1}"
            except:
                new_version = "v1.1"
        else:
            new_version = "v1.1"
        
        return new_version
    
    def chunk_new_game(self, new_version: str) -> Path:
        """Chunk game mới"""
        print("\n" + "=" * 80)
        print("⚙️  ĐANG XỬ LÝ...")
        print("=" * 80)
        
        # Create temp folder
        self.temp_chunks_folder = Path(f"./temp_chunks_{int(time.time())}")
        self.temp_chunks_folder.mkdir(parents=True, exist_ok=True)
        
        print(f"\n📦 Chunking game version {new_version}...")
        print(f"   Game: {self.game_folder}")
        print(f"   Temp output: {self.temp_chunks_folder}")
        
        # Import chunker
        from game_chunker import GameChunker
        
        try:
            # Load old manifest to get same settings
            with open(self.old_manifest_path, 'r', encoding='utf-8') as f:
                old_manifest = json.load(f)
            
            chunk_size_mb = old_manifest.get('chunk_size_mb', 25)
            
            print(f"   Using same chunk size: {chunk_size_mb} MB")
            
            # Create chunker
            chunker = GameChunker(
                game_folder=str(self.game_folder),
                output_dir=str(self.temp_chunks_folder),
                chunk_size_mb=int(chunk_size_mb),
                compression_level=0,  # Store - nhanh nhất
                version=new_version,
                split_large_files=True
            )
            
            # Run chunking
            chunker.run()
            
            # Find new manifest
            new_manifest_path = self.temp_chunks_folder / f"manifest_{new_version}.json"
            
            if not new_manifest_path.exists():
                print(f"❌ Không tìm thấy manifest mới!")
                return None
            
            print(f"✅ Chunking complete!")
            return new_manifest_path
            
        except Exception as e:
            print(f"❌ Lỗi khi chunking: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def compare_and_extract(self, new_manifest_path: Path):
        """So sánh manifests và copy chunks thay đổi"""
        print(f"\n🔍 So sánh manifests...")
        
        # Load manifests
        with open(self.old_manifest_path, 'r', encoding='utf-8') as f:
            old_manifest = json.load(f)
        
        with open(new_manifest_path, 'r', encoding='utf-8') as f:
            new_manifest = json.load(f)
        
        # Create hash maps
        old_chunks = {c['id']: c for c in old_manifest['chunks']}
        new_chunks = {c['id']: c for c in new_manifest['chunks']}
        
        # Find changes
        changed_chunks = []
        new_chunks_list = []
        unchanged = 0
        
        for chunk_id, new_chunk in new_chunks.items():
            if chunk_id not in old_chunks:
                # New chunk
                new_chunks_list.append(new_chunk)
            elif old_chunks[chunk_id]['hash'] != new_chunk['hash']:
                # Changed
                changed_chunks.append(new_chunk)
            else:
                # Unchanged
                unchanged += 1
        
        total_changed = len(changed_chunks) + len(new_chunks_list)
        
        print(f"\n📊 KẾT QUẢ SO SÁNH:")
        print(f"   Total chunks old: {len(old_chunks)}")
        print(f"   Total chunks new: {len(new_chunks)}")
        print(f"   Unchanged: {unchanged} ({unchanged/len(new_chunks)*100:.1f}%)")
        print(f"   Changed: {len(changed_chunks)}")
        print(f"   New added: {len(new_chunks_list)}")
        print(f"   Total to upload: {total_changed}")
        
        if total_changed == 0:
            print("\n✅ KHÔNG CÓ THAY ĐỔI! Game giống y hệt version cũ.")
            return None
        
        # Calculate sizes
        upload_size = sum(c['size'] for c in changed_chunks + new_chunks_list)
        total_size = new_manifest['total_size']
        savings = (1 - upload_size / total_size) * 100
        
        print(f"\n💾 DUNG LƯỢNG:")
        print(f"   Total game size: {total_size / (1024**3):.2f} GB")
        print(f"   Upload needed: {upload_size / (1024**3):.2f} GB")
        print(f"   Bandwidth saved: {savings:.1f}%")
        
        # Copy changed chunks to output
        print(f"\n📁 Copying changed chunks to output...")
        
        chunks_to_copy = changed_chunks + new_chunks_list
        
        for i, chunk in enumerate(chunks_to_copy, 1):
            src = self.temp_chunks_folder / chunk['filename']
            dst = self.output_folder / chunk['filename']
            
            print(f"   [{i}/{len(chunks_to_copy)}] {chunk['filename']} ({chunk['size'] / (1024**2):.2f} MB)")
            shutil.copy2(src, dst)
        
        # Copy new manifest
        dst_manifest = self.output_folder / f"manifest_{new_manifest['version']}.json"
        shutil.copy2(new_manifest_path, dst_manifest)
        print(f"\n✅ Copied manifest: {dst_manifest.name}")
        
        # Create summary file
        summary = {
            'old_version': old_manifest['version'],
            'new_version': new_manifest['version'],
            'total_chunks_old': len(old_chunks),
            'total_chunks_new': len(new_chunks),
            'unchanged_chunks': unchanged,
            'changed_chunks': len(changed_chunks),
            'new_chunks': len(new_chunks_list),
            'total_upload': total_changed,
            'upload_size_bytes': upload_size,
            'upload_size_gb': upload_size / (1024**3),
            'total_size_gb': total_size / (1024**3),
            'savings_percent': savings,
            'changed_chunk_list': [c['filename'] for c in changed_chunks],
            'new_chunk_list': [c['filename'] for c in new_chunks_list]
        }
        
        summary_path = self.output_folder / 'update_summary.json'
        with open(summary_path, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Created summary: {summary_path.name}")
        
        return summary
    
    def create_upload_instructions(self, summary: Dict, new_version: str):
        """Tạo hướng dẫn upload"""
        instructions_path = self.output_folder / 'UPLOAD_INSTRUCTIONS.txt'
        
        with open(instructions_path, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("📦 HƯỚNG DẪN UPLOAD LÊN HUGGING FACE\n")
            f.write("=" * 80 + "\n\n")
            
            f.write(f"Old version: {summary['old_version']}\n")
            f.write(f"New version: {summary['new_version']}\n")
            f.write(f"Total files to upload: {summary['total_upload']}\n")
            f.write(f"Upload size: {summary['upload_size_gb']:.2f} GB\n")
            f.write(f"Bandwidth saved: {summary['savings_percent']:.1f}%\n\n")
            
            f.write("=" * 80 + "\n")
            f.write("📋 FILES TO UPLOAD:\n")
            f.write("=" * 80 + "\n\n")
            
            f.write(f"1. manifest_{new_version}.json\n")
            for filename in sorted(summary['changed_chunk_list'] + summary['new_chunk_list']):
                f.write(f"   {filename}\n")
            
            f.write("\n" + "=" * 80 + "\n")
            f.write("💻 UPLOAD COMMANDS:\n")
            f.write("=" * 80 + "\n\n")
            
            f.write("# Replace 'your-repo/game' with your actual repo name\n\n")
            
            f.write("# 1. Upload manifest\n")
            f.write(f"huggingface-cli upload your-repo/game \\\n")
            f.write(f"  manifest_{new_version}.json \\\n")
            f.write(f"  --path-in-repo {new_version}/manifest.json\n\n")
            
            f.write("# 2. Upload changed chunks\n")
            for filename in sorted(summary['changed_chunk_list'] + summary['new_chunk_list']):
                f.write(f"huggingface-cli upload your-repo/game \\\n")
                f.write(f"  {filename} \\\n")
                f.write(f"  --path-in-repo {new_version}/{filename}\n\n")
            
            f.write("# 3. Update latest manifest\n")
            f.write(f"huggingface-cli upload your-repo/game \\\n")
            f.write(f"  manifest_{new_version}.json \\\n")
            f.write(f"  --path-in-repo manifest_latest.json\n\n")
            
            f.write("=" * 80 + "\n")
            f.write("✅ DONE!\n")
            f.write("=" * 80 + "\n")
        
        print(f"\n✅ Created upload instructions: {instructions_path.name}")
    
    def cleanup(self):
        """Dọn dẹp temp folder"""
        if self.temp_chunks_folder and self.temp_chunks_folder.exists():
            print(f"\n🗑️  Cleaning up temp folder...")
            shutil.rmtree(self.temp_chunks_folder)
            print(f"✅ Cleaned up: {self.temp_chunks_folder}")
    
    def run(self):
        """Main workflow"""
        print("\n" + "=" * 80)
        print("🚀 AUTO UPDATE PROCESSOR")
        print("=" * 80)
        print("Script tự động phát hiện và xuất chunks thay đổi")
        print("=" * 80)
        
        try:
            # Step 1: Select game folder
            if not self.select_game_folder():
                print("\n❌ Đã hủy!")
                return
            
            # Step 2: Select old manifest
            if not self.select_old_manifest():
                print("\n❌ Đã hủy!")
                return
            
            # Step 3: Select output folder
            if not self.select_output_folder():
                print("\n❌ Đã hủy!")
                return
            
            # Confirm
            print("\n" + "=" * 80)
            print("📋 XÁC NHẬN:")
            print("=" * 80)
            print(f"Game folder: {self.game_folder}")
            print(f"Old manifest: {self.old_manifest_path}")
            print(f"Output folder: {self.output_folder}")
            print("=" * 80)
            
            confirm = input("\n✅ Bắt đầu xử lý? (y/n): ").lower()
            if confirm != 'y':
                print("\n❌ Đã hủy!")
                return
            
            # Load old manifest to get version
            with open(self.old_manifest_path, 'r', encoding='utf-8') as f:
                old_manifest = json.load(f)
            
            old_version = old_manifest['version']
            new_version = self.detect_new_version(old_version)
            
            print(f"\n📌 Detected versions:")
            print(f"   Old: {old_version}")
            print(f"   New: {new_version}")
            
            custom = input(f"\nThay đổi version mới? (Enter = {new_version}): ").strip()
            if custom:
                new_version = custom
            
            # Step 4: Chunk new game
            new_manifest_path = self.chunk_new_game(new_version)
            
            if not new_manifest_path:
                print("\n❌ Chunking failed!")
                return
            
            # Step 5: Compare and extract
            summary = self.compare_and_extract(new_manifest_path)
            
            if not summary:
                print("\n⚠️  No changes detected!")
                self.cleanup()
                return
            
            # Step 6: Create upload instructions
            self.create_upload_instructions(summary, new_version)
            
            # Step 7: Cleanup
            self.cleanup()
            
            # Done!
            print("\n" + "=" * 80)
            print("✅ HOÀN TẤT!")
            print("=" * 80)
            print(f"\n📁 Output folder: {self.output_folder.absolute()}")
            print(f"\n📄 Files created:")
            print(f"   - manifest_{new_version}.json")
            print(f"   - {summary['total_upload']} chunks ({summary['upload_size_gb']:.2f} GB)")
            print(f"   - update_summary.json")
            print(f"   - UPLOAD_INSTRUCTIONS.txt")
            print(f"\n💡 Next step: Đọc UPLOAD_INSTRUCTIONS.txt để upload lên Hugging Face!")
            print("=" * 80)
            
        except KeyboardInterrupt:
            print("\n\n❌ Đã hủy bởi người dùng!")
            self.cleanup()
        except Exception as e:
            print(f"\n❌ LỖI: {e}")
            import traceback
            traceback.print_exc()
            self.cleanup()

def main():
    processor = AutoUpdateProcessor()
    processor.run()

if __name__ == "__main__":
    main()