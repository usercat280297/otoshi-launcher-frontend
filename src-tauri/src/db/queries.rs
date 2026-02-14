use rusqlite::{params, OptionalExtension};

use crate::db::Database;
use crate::errors::Result;
use crate::models::{
    DownloadChunk, DownloadState, GameLaunchPref, LocalDownload, LocalGame, PlaySessionLocal,
};

pub trait SettingsQueries {
    fn set_setting(&self, key: &str, value: &str) -> Result<()>;
    fn get_setting(&self, key: &str) -> Result<Option<String>>;
    fn delete_setting(&self, key: &str) -> Result<()>;
}

pub trait GameQueries {
    fn upsert_game(&self, game: &LocalGame) -> Result<()>;
    fn get_games(&self) -> Result<Vec<LocalGame>>;
    fn update_playtime(&self, game_id: &str, seconds: i64) -> Result<()>;
}

pub trait DownloadQueries {
    fn upsert_download(&self, download: &LocalDownload) -> Result<()>;
    fn get_downloads(&self) -> Result<Vec<LocalDownload>>;
    fn remove_download(&self, download_id: &str) -> Result<()>;
}

pub trait LaunchPrefQueries {
    fn upsert_launch_pref(&self, pref: &GameLaunchPref) -> Result<()>;
    fn get_launch_pref(&self, game_id: &str) -> Result<Option<GameLaunchPref>>;
}

pub trait PlaySessionQueries {
    fn upsert_play_session(&self, session: &PlaySessionLocal) -> Result<()>;
    fn get_active_play_session(&self, game_id: &str) -> Result<Option<PlaySessionLocal>>;
    fn list_unsynced_play_sessions(&self) -> Result<Vec<PlaySessionLocal>>;
    fn mark_play_session_synced(&self, session_id: &str) -> Result<()>;
}

pub trait DownloadStateQueries {
    fn save_download_state(&self, state: &DownloadState) -> Result<()>;
    fn get_download_state(&self, download_id: &str) -> Result<Option<DownloadState>>;
    fn update_download_status(&self, download_id: &str, status: &str) -> Result<()>;
    fn clear_download_state(&self, download_id: &str) -> Result<()>;
    fn upsert_download_chunk(&self, chunk: &DownloadChunk) -> Result<()>;
    fn list_completed_chunks(&self, download_id: &str) -> Result<Vec<DownloadChunk>>;
    fn clear_download_chunks(&self, download_id: &str) -> Result<()>;
}

impl SettingsQueries for Database {
    fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, chrono::Utc::now().timestamp()],
        )?;
        Ok(())
    }

    fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.connection()?;
        let value = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value)
    }

    fn delete_setting(&self, key: &str) -> Result<()> {
        let conn = self.connection()?;
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}

impl GameQueries for Database {
    fn upsert_game(&self, game: &LocalGame) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO games (id, slug, title, header_image, install_path, installed_version, last_played, playtime_seconds, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                game.id,
                game.slug,
                game.title,
                game.header_image,
                game.install_path,
                game.installed_version,
                game.last_played,
                game.playtime_seconds,
                chrono::Utc::now().timestamp(),
            ],
        )?;
        Ok(())
    }

    fn get_games(&self) -> Result<Vec<LocalGame>> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, slug, title, header_image, install_path, installed_version, last_played, playtime_seconds
             FROM games ORDER BY last_played DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(LocalGame {
                id: row.get(0)?,
                slug: row.get(1)?,
                title: row.get(2)?,
                header_image: row.get(3)?,
                install_path: row.get(4)?,
                installed_version: row.get(5)?,
                last_played: row.get(6)?,
                playtime_seconds: row.get(7)?,
            })
        })?;

        let mut games = Vec::new();
        for item in rows {
            games.push(item?);
        }
        Ok(games)
    }

    fn update_playtime(&self, game_id: &str, seconds: i64) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "UPDATE games SET playtime_seconds = playtime_seconds + ?1, last_played = ?2 WHERE id = ?3",
            params![seconds, chrono::Utc::now().timestamp(), game_id],
        )?;
        Ok(())
    }
}

impl DownloadQueries for Database {
    fn upsert_download(&self, download: &LocalDownload) -> Result<()> {
        let conn = self.connection()?;
        let speed_history_json =
            serde_json::to_string(&download.speed_history).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO downloads (
                id, game_id, status, progress, speed_mbps, eta_minutes,
                downloaded_bytes, total_bytes, network_bps, disk_read_bps, disk_write_bps,
                read_bytes, written_bytes, remaining_bytes, speed_history_json, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                download.id,
                download.game_id,
                download.status,
                download.progress,
                download.speed_mbps,
                download.eta_minutes,
                download.downloaded_bytes,
                download.total_bytes,
                download.network_bps,
                download.disk_read_bps,
                download.disk_write_bps,
                download.read_bytes,
                download.written_bytes,
                download.remaining_bytes,
                speed_history_json,
                download.updated_at,
            ],
        )?;
        Ok(())
    }

    fn get_downloads(&self) -> Result<Vec<LocalDownload>> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            "SELECT
                id, game_id, status, progress, speed_mbps, eta_minutes,
                downloaded_bytes, total_bytes, network_bps, disk_read_bps, disk_write_bps,
                read_bytes, written_bytes, remaining_bytes, speed_history_json, updated_at
             FROM downloads
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let speed_history_raw: String = row.get(14)?;
            let speed_history: Vec<f64> = serde_json::from_str(&speed_history_raw).unwrap_or_default();
            Ok(LocalDownload {
                id: row.get(0)?,
                game_id: row.get(1)?,
                status: row.get(2)?,
                progress: row.get(3)?,
                speed_mbps: row.get(4)?,
                eta_minutes: row.get(5)?,
                downloaded_bytes: row.get(6)?,
                total_bytes: row.get(7)?,
                network_bps: row.get(8)?,
                disk_read_bps: row.get(9)?,
                disk_write_bps: row.get(10)?,
                read_bytes: row.get(11)?,
                written_bytes: row.get(12)?,
                remaining_bytes: row.get(13)?,
                speed_history,
                updated_at: row.get(15)?,
            })
        })?;

        let mut downloads = Vec::new();
        for item in rows {
            downloads.push(item?);
        }
        Ok(downloads)
    }

    fn remove_download(&self, download_id: &str) -> Result<()> {
        let conn = self.connection()?;
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![download_id])?;
        Ok(())
    }
}

impl LaunchPrefQueries for Database {
    fn upsert_launch_pref(&self, pref: &GameLaunchPref) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO game_launch_prefs (game_id, require_admin, ask_every_time, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                pref.game_id,
                if pref.require_admin { 1 } else { 0 },
                if pref.ask_every_time { 1 } else { 0 },
                pref.updated_at,
            ],
        )?;
        Ok(())
    }

    fn get_launch_pref(&self, game_id: &str) -> Result<Option<GameLaunchPref>> {
        let conn = self.connection()?;
        let pref = conn
            .query_row(
                "SELECT game_id, require_admin, ask_every_time, updated_at
                 FROM game_launch_prefs WHERE game_id = ?1",
                params![game_id],
                |row| {
                    Ok(GameLaunchPref {
                        game_id: row.get(0)?,
                        require_admin: row.get::<_, i64>(1)? > 0,
                        ask_every_time: row.get::<_, i64>(2)? > 0,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()?;
        Ok(pref)
    }
}

impl PlaySessionQueries for Database {
    fn upsert_play_session(&self, session: &PlaySessionLocal) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO play_sessions_local
                (id, game_id, started_at, ended_at, duration_sec, exit_code, synced, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session.id,
                session.game_id,
                session.started_at,
                session.ended_at,
                session.duration_sec,
                session.exit_code,
                if session.synced { 1 } else { 0 },
                session.updated_at,
            ],
        )?;
        Ok(())
    }

    fn get_active_play_session(&self, game_id: &str) -> Result<Option<PlaySessionLocal>> {
        let conn = self.connection()?;
        let session = conn
            .query_row(
                "SELECT id, game_id, started_at, ended_at, duration_sec, exit_code, synced, updated_at
                 FROM play_sessions_local
                 WHERE game_id = ?1 AND ended_at IS NULL
                 ORDER BY started_at DESC
                 LIMIT 1",
                params![game_id],
                |row| {
                    Ok(PlaySessionLocal {
                        id: row.get(0)?,
                        game_id: row.get(1)?,
                        started_at: row.get(2)?,
                        ended_at: row.get(3)?,
                        duration_sec: row.get(4)?,
                        exit_code: row.get(5)?,
                        synced: row.get::<_, i64>(6)? > 0,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .optional()?;
        Ok(session)
    }

    fn list_unsynced_play_sessions(&self) -> Result<Vec<PlaySessionLocal>> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, game_id, started_at, ended_at, duration_sec, exit_code, synced, updated_at
             FROM play_sessions_local
             WHERE synced = 0 AND ended_at IS NOT NULL
             ORDER BY updated_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PlaySessionLocal {
                id: row.get(0)?,
                game_id: row.get(1)?,
                started_at: row.get(2)?,
                ended_at: row.get(3)?,
                duration_sec: row.get(4)?,
                exit_code: row.get(5)?,
                synced: row.get::<_, i64>(6)? > 0,
                updated_at: row.get(7)?,
            })
        })?;

        let mut sessions = Vec::new();
        for item in rows {
            sessions.push(item?);
        }
        Ok(sessions)
    }

    fn mark_play_session_synced(&self, session_id: &str) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "UPDATE play_sessions_local SET synced = 1, updated_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().timestamp(), session_id],
        )?;
        Ok(())
    }
}

impl DownloadStateQueries for Database {
    fn save_download_state(&self, state: &DownloadState) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO download_states (id, game_id, slug, status, install_dir, manifest_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                state.id,
                state.game_id,
                state.slug,
                state.status,
                state.install_dir,
                state.manifest_json,
                state.updated_at,
            ],
        )?;
        Ok(())
    }

    fn get_download_state(&self, download_id: &str) -> Result<Option<DownloadState>> {
        let conn = self.connection()?;
        let state = conn
            .query_row(
                "SELECT id, game_id, slug, status, install_dir, manifest_json, updated_at
                 FROM download_states WHERE id = ?1",
                params![download_id],
                |row| {
                    Ok(DownloadState {
                        id: row.get(0)?,
                        game_id: row.get(1)?,
                        slug: row.get(2)?,
                        status: row.get(3)?,
                        install_dir: row.get(4)?,
                        manifest_json: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                },
            )
            .optional()?;
        Ok(state)
    }

    fn update_download_status(&self, download_id: &str, status: &str) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "UPDATE download_states SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, chrono::Utc::now().timestamp(), download_id],
        )?;
        Ok(())
    }

    fn clear_download_state(&self, download_id: &str) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "DELETE FROM download_states WHERE id = ?1",
            params![download_id],
        )?;
        Ok(())
    }

    fn upsert_download_chunk(&self, chunk: &DownloadChunk) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO download_chunks (download_id, file_id, chunk_index, hash, size, status, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                chunk.download_id,
                chunk.file_id,
                chunk.chunk_index,
                chunk.hash,
                chunk.size,
                chunk.status,
                chunk.updated_at,
            ],
        )?;
        Ok(())
    }

    fn list_completed_chunks(&self, download_id: &str) -> Result<Vec<DownloadChunk>> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            "SELECT download_id, file_id, chunk_index, hash, size, status, updated_at
             FROM download_chunks WHERE download_id = ?1 AND status = 'completed'",
        )?;
        let rows = stmt.query_map(params![download_id], |row| {
            Ok(DownloadChunk {
                download_id: row.get(0)?,
                file_id: row.get(1)?,
                chunk_index: row.get(2)?,
                hash: row.get(3)?,
                size: row.get(4)?,
                status: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        let mut chunks = Vec::new();
        for item in rows {
            chunks.push(item?);
        }
        Ok(chunks)
    }

    fn clear_download_chunks(&self, download_id: &str) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "DELETE FROM download_chunks WHERE download_id = ?1",
            params![download_id],
        )?;
        Ok(())
    }
}
