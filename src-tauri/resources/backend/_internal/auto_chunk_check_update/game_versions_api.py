#!/usr/bin/env python3
"""
GAME VERSIONS API - Backend API để list versions và serve downloads
Cung cấp data cho dropdown UI
"""

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
import json
from pathlib import Path
from typing import Dict, List
import logging
from datetime import datetime
import os

# Import HF manager
try:
    from [REDACTED_HF_TOKEN] import HFDownloadManager
    HF_AVAILABLE = True
except ImportError:
    HF_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configuration
GAMES_DIR = Path('./games')  # Folder chứa tất cả games
VERSIONS_FILE = Path('./game_versions.json')
DOWNLOADS_DIR = Path('./downloads')  # Folder để save downloaded games
HF_REPO_BASE = 'MangaVNteam/Assassin-Creed-Odyssey-Crack'

# Initialize HF manager
if HF_AVAILABLE:
    [REDACTED_HF_TOKEN] = HFDownloadManager()
else:
    [REDACTED_HF_TOKEN] = None


class GameVersionsManager:
    """Quản lý versions của games"""
    
    def __init__(self):
        self.versions_file = VERSIONS_FILE
        self.games_dir = GAMES_DIR
    
    def load_versions(self) -> Dict:
        """Load game_versions.json"""
        if not self.versions_file.exists():
            return {'games': {}}
        
        with open(self.versions_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def get_all_games(self) -> List[Dict]:
        """Get list tất cả games"""
        versions = self.load_versions()
        games = []
        
        for game_id, game_info in versions.get('games', {}).items():
            games.append({
                'id': game_id,
                'name': game_info.get('name', game_id),
                'version_count': len(game_info.get('versions', [])),
                'latest_version': game_info.get('versions', [{}])[0].get('version') if game_info.get('versions') else None,
                'latest_size_gb': game_info.get('versions', [{}])[0].get('size_gb', 0) if game_info.get('versions') else 0
            })
        
        return games
    
    def get_game_versions(self, game_id: str) -> List[Dict]:
        """Get all versions của 1 game"""
        versions = self.load_versions()
        
        if game_id not in versions.get('games', {}):
            return []
        
        game_versions = versions['games'][game_id].get('versions', [])
        
        # Add download URL
        for v in game_versions:
            v['download_url'] = f"/api/download/{game_id}/{v['version']}"
        
        return game_versions
    
    def get_game_info(self, game_id: str) -> Dict:
        """Get thông tin chi tiết của 1 game"""
        versions = self.load_versions()
        
        if game_id not in versions.get('games', {}):
            return None
        
        game = versions['games'][game_id]
        versions_list = game.get('versions', [])
        
        # Add download URLs
        for v in versions_list:
            v['download_url'] = f"/api/download/{game_id}/{v['version']}"
        
        return {
            'id': game_id,
            'name': game.get('name', game_id),
            'versions': versions_list,
            'total_versions': len(versions_list),
            'latest': versions_list[0] if versions_list else None
        }


manager = GameVersionsManager()


# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.route('/api/games', methods=['GET'])
def list_games():
    """List tất cả games"""
    try:
        games = manager.get_all_games()
        return jsonify({
            'status': 'success',
            'count': len(games),
            'games': games
        })
    except Exception as e:
        logger.error(f"Error listing games: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/games/<game_id>', methods=['GET'])
def get_game(game_id):
    """Get thông tin chi tiết của 1 game"""
    try:
        game_info = manager.get_game_info(game_id)
        
        if not game_info:
            return jsonify({'status': 'error', 'message': 'Game not found'}), 404
        
        return jsonify({
            'status': 'success',
            'game': game_info
        })
    except Exception as e:
        logger.error(f"Error getting game: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/games/<game_id>/versions', methods=['GET'])
def get_versions(game_id):
    """Get list versions của 1 game"""
    try:
        versions = manager.get_game_versions(game_id)
        
        if not versions:
            return jsonify({'status': 'error', 'message': 'Game not found'}), 404
        
        return jsonify({
            'status': 'success',
            'game_id': game_id,
            'count': len(versions),
            'versions': versions
        })
    except Exception as e:
        logger.error(f"Error getting versions: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/download/<game_id>/<version>', methods=['GET'])
def download_info(game_id, version):
    """Get download info cho 1 version"""
    try:
        game_info = manager.get_game_info(game_id)
        
        if not game_info:
            return jsonify({'status': 'error', 'message': 'Game not found'}), 404
        
        version_info = next((v for v in game_info['versions'] if v['version'] == version), None)
        
        if not version_info:
            return jsonify({'status': 'error', 'message': 'Version not found'}), 404
        
        return jsonify({
            'status': 'success',
            'game_id': game_id,
            'version': version_info,
            '[REDACTED_HF_TOKEN]': f"https://huggingface.co/{HF_REPO_BASE}/blob/main/{game_id}/{version}/manifest_{version}.json",
            'download_url': f"https://huggingface.co/{HF_REPO_BASE}/tree/main/{game_id}/{version}"
        })
    except Exception as e:
        logger.error(f"Error getting download info: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/manifest/<game_id>/<version>', methods=['GET'])
def get_manifest(game_id, version):
    """Get manifest của 1 version"""
    try:
        # Look for manifest in local storage or HF
        local_manifest = Path(f"./games/{game_id}/{version}/manifest_{version}.json")
        
        if local_manifest.exists():
            with open(local_manifest, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
            return jsonify({
                'status': 'success',
                'manifest': manifest
            })
        
        return jsonify({'status': 'error', 'message': 'Manifest not found'}), 404
        
    except Exception as e:
        logger.error(f"Error getting manifest: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/download/<game_id>/<version>', methods=['GET'])
def download_game(game_id, version):
    """
    Download game from HuggingFace
    
    Query params:
    - action: 'info' (get info), 'url' (get download url), 'download' (start download)
    """
    try:
        action = request.args.get('action', 'info')
        
        # Get game info from versions file
        versions = manager.load_versions()
        game_info = versions.get('games', {}).get(game_id)
        
        if not game_info:
            return jsonify({'status': 'error', 'message': 'Game not found'}), 404
        
        version_info = None
        for v in game_info.get('versions', []):
            if v.get('version') == version:
                version_info = v
                break
        
        if not version_info:
            return jsonify({'status': 'error', 'message': 'Version not found'}), 404
        
        # Action: Get info
        if action == 'info':
            return jsonify({
                'status': 'success',
                'game_id': game_id,
                'version': version,
                'size': version_info.get('size'),
                'chunks': version_info.get('chunks'),
                '[REDACTED_HF_TOKEN]': HF_REPO_BASE,
                'download_url': f'/api/download/{game_id}/{version}?action=url'
            })
        
        # Action: Get download URL (HF direct link)
        elif action == 'url':
            if not [REDACTED_HF_TOKEN]:
                return jsonify({'status': 'error', 'message': 'HF manager not available'}), 500
            
            # Get HF file info
            [REDACTED_HF_TOKEN] = [REDACTED_HF_TOKEN].list_files()
            game_file = None
            
            for f in [REDACTED_HF_TOKEN]:
                if game_id.replace('_', ' ').lower() in f.lower():
                    game_file = f
                    break
            
            if not game_file:
                return jsonify({'status': 'error', 'message': 'Game file not found on HF'}), 404
            
            return jsonify({
                'status': 'success',
                'download_url': f'https://huggingface.co/datasets/{HF_REPO_BASE}/resolve/main/{game_file}',
                'file': game_file,
                'size': version_info.get('size')
            })
        
        # Action: Start download (server-side)
        elif action == 'download':
            if not [REDACTED_HF_TOKEN]:
                return jsonify({'status': 'error', 'message': 'HF manager not available'}), 500
            
            # Find game file
            [REDACTED_HF_TOKEN] = [REDACTED_HF_TOKEN].list_files()
            game_file = None
            
            for f in [REDACTED_HF_TOKEN]:
                if game_id.replace('_', ' ').lower() in f.lower():
                    game_file = f
                    break
            
            if not game_file:
                return jsonify({'status': 'error', 'message': 'Game file not found on HF'}), 404
            
            # Download file
            DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
            file_path = [REDACTED_HF_TOKEN].download_file(game_file, str(DOWNLOADS_DIR))
            
            if not file_path:
                return jsonify({'status': 'error', 'message': 'Download failed'}), 500
            
            return jsonify({
                'status': 'success',
                'message': 'Download completed',
                'file': file_path,
                'size': Path(file_path).stat().st_size
            })
        
        else:
            return jsonify({'status': 'error', 'message': 'Invalid action'}), 400
        
    except Exception as e:
        logger.error(f"Download error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health():
    """Health check"""
    try:
        games = manager.get_all_games()
        return jsonify({
            'status': 'ok',
            'timestamp': datetime.now().isoformat(),
            'games_count': len(games)
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


# ============================================================================
# Static files
# ============================================================================

@app.route('/versions.json', methods=['GET'])
def get_versions_json():
    """Serve game_versions.json"""
    if VERSIONS_FILE.exists():
        return send_file(VERSIONS_FILE, mimetype='application/json')
    return jsonify({'games': {}}), 200


# ============================================================================
# UI routes
# ============================================================================

@app.route('/', methods=['GET'])
def index():
    """Simple UI"""
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Game Versions API</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 20px;
                background: #1a1a1a;
                color: #fff;
            }
            .container {
                max-width: 1000px;
                margin: 0 auto;
            }
            h1 {
                color: #00bfff;
            }
            .api-endpoint {
                background: #2a2a2a;
                padding: 15px;
                margin: 10px 0;
                border-left: 4px solid #00bfff;
                border-radius: 4px;
            }
            .api-endpoint code {
                background: #1a1a1a;
                padding: 2px 6px;
                border-radius: 3px;
                color: #00ff00;
            }
            .example {
                background: #1a1a1a;
                padding: 10px;
                margin-top: 10px;
                border-radius: 3px;
                overflow-x: auto;
            }
            .example pre {
                margin: 0;
                color: #00ff00;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎮 Game Versions API</h1>
            <p>Backend API để quản lý game versions và downloads</p>
            
            <h2>📚 API Endpoints</h2>
            
            <div class="api-endpoint">
                <strong>GET /api/games</strong>
                <p>List tất cả games</p>
                <div class="example">
                    <pre>curl http://localhost:5000/api/games</pre>
                </div>
            </div>
            
            <div class="api-endpoint">
                <strong>GET /api/games/&lt;game_id&gt;</strong>
                <p>Get thông tin chi tiết của 1 game</p>
                <div class="example">
                    <pre>curl http://localhost:5000/api/games/dirt5</pre>
                </div>
            </div>
            
            <div class="api-endpoint">
                <strong>GET /api/games/&lt;game_id&gt;/versions</strong>
                <p>Get list versions của 1 game</p>
                <div class="example">
                    <pre>curl http://localhost:5000/api/games/dirt5/versions</pre>
                </div>
            </div>
            
            <div class="api-endpoint">
                <strong>GET /api/download/&lt;game_id&gt;/&lt;version&gt;</strong>
                <p>Get download info cho 1 version</p>
                <div class="example">
                    <pre>curl http://localhost:5000/api/download/dirt5/v1.0</pre>
                </div>
            </div>
            
            <div class="api-endpoint">
                <strong>GET /api/manifest/&lt;game_id&gt;/&lt;version&gt;</strong>
                <p>Get manifest của 1 version</p>
                <div class="example">
                    <pre>curl http://localhost:5000/api/manifest/dirt5/v1.0</pre>
                </div>
            </div>
            
            <div class="api-endpoint">
                <strong>GET /api/health</strong>
                <p>Health check</p>
                <div class="example">
                    <pre>curl http://localhost:5000/api/health</pre>
                </div>
            </div>
            
            <div class="api-endpoint">
                <strong>GET /versions.json</strong>
                <p>Get game_versions.json</p>
                <div class="example">
                    <pre>curl http://localhost:5000/versions.json</pre>
                </div>
            </div>
            
            <h2>🚀 Quick Start</h2>
            <div class="example">
                <pre>pip install flask flask-cors
python game_versions_api.py</pre>
            </div>
            
            <p style="margin-top: 30px; color: #888;">Server running on http://localhost:5000</p>
        </div>
    </body>
    </html>
    '''


@app.route('/api/download-strategy/<game_id>/<version>', methods=['GET'])
def get_download_strategy(game_id, version):
    """
    Determine download strategy: chunks vs link
    Returns: { strategy: "chunks" | "link", url?: string, chunks?: [...] }
    """
    try:
        # Load versions
        with open(VERSIONS_FILE) as f:
            versions_data = json.load(f)
        
        if game_id not in versions_data:
            return jsonify({'status': 'error', 'message': f'Game {game_id} not found'}), 404
        
        game_versions = versions_data[game_id]
        if version not in game_versions:
            return jsonify({'status': 'error', 'message': f'Version {version} not found'}), 404
        
        version_info = game_versions[version]
        
        # Check if game has chunks (new system)
        has_chunks = version_info.get('chunks') and len(version_info.get('chunks', [])) > 0
        
        if has_chunks:
            # Return chunks strategy
            return jsonify({
                'status': 'success',
                'strategy': 'chunks',
                'chunks': version_info['chunks'],
                '[REDACTED_HF_TOKEN]': HF_REPO_BASE,
                'size': version_info.get('size'),
                'download_url': f'/api/download/{game_id}/{version}?action=download'
            })
        else:
            # Fallback to link-based download (legacy)
            # Get link from HF or hardcoded sources
            if not [REDACTED_HF_TOKEN]:
                return jsonify({'status': 'error', 'message': 'HF manager not available'}), 500
            
            [REDACTED_HF_TOKEN] = [REDACTED_HF_TOKEN].list_files()
            game_file = None
            
            for f in [REDACTED_HF_TOKEN]:
                if game_id.replace('_', ' ').lower() in f.lower():
                    game_file = f
                    break
            
            if game_file:
                download_link = f'https://huggingface.co/datasets/{HF_REPO_BASE}/resolve/main/{game_file}'
                return jsonify({
                    'status': 'success',
                    'strategy': 'link',
                    'download_url': download_link,
                    'size': version_info.get('size'),
                    'file': game_file
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'No download method available (no chunks and no HF file found)'
                }), 404
    
    except Exception as e:
        logger.error(f'Error determining download strategy: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


if __name__ == '__main__':
    logger.info("🎮 Game Versions API starting...")
    logger.info("📚 Endpoints: http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
