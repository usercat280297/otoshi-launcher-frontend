CREATE TABLE IF NOT EXISTS download_states (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    status TEXT NOT NULL,
    install_dir TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS download_chunks (
    download_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (download_id, file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_download_chunks_download_id
    ON download_chunks(download_id);