CREATE TABLE IF NOT EXISTS file_index_v2 (
    game_id TEXT NOT NULL,
    install_path TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    modified_at INTEGER NOT NULL DEFAULT 0,
    fast_hash TEXT,
    canonical_hash TEXT,
    status TEXT NOT NULL DEFAULT 'unknown',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, install_path, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_file_index_v2_status
    ON file_index_v2(status);

CREATE TABLE IF NOT EXISTS integrity_events_v2 (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    install_path TEXT NOT NULL,
    scan_engine TEXT NOT NULL,
    total_files INTEGER NOT NULL DEFAULT 0,
    verified_files INTEGER NOT NULL DEFAULT 0,
    missing_files INTEGER NOT NULL DEFAULT 0,
    corrupt_files INTEGER NOT NULL DEFAULT 0,
    repair_queue_count INTEGER NOT NULL DEFAULT 0,
    report_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_integrity_events_v2_game_id
    ON integrity_events_v2(game_id);

