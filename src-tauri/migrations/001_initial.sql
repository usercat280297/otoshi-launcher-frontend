CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    header_image TEXT,
    install_path TEXT,
    installed_version TEXT,
    last_played INTEGER,
    playtime_seconds INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL
);