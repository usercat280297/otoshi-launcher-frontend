CREATE TABLE IF NOT EXISTS game_launch_prefs (
    game_id TEXT PRIMARY KEY,
    require_admin INTEGER NOT NULL DEFAULT 0,
    ask_every_time INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS play_sessions_local (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER,
    synced INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_play_sessions_local_game_id
    ON play_sessions_local(game_id);

CREATE INDEX IF NOT EXISTS idx_play_sessions_local_synced
    ON play_sessions_local(synced);
