CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    speed_mbps REAL NOT NULL DEFAULT 0,
    eta_minutes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_downloads_game_id ON downloads(game_id);