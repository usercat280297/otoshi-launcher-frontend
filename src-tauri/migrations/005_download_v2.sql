CREATE TABLE IF NOT EXISTS download_sessions_v2 (
    id TEXT PRIMARY KEY,
    download_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'stable',
    method TEXT NOT NULL DEFAULT 'chunks',
    version TEXT NOT NULL DEFAULT 'latest',
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'manifest_fetch',
    install_path TEXT,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_sessions_v2_download_id
    ON download_sessions_v2(download_id);

CREATE INDEX IF NOT EXISTS idx_download_sessions_v2_game_id
    ON download_sessions_v2(game_id);

