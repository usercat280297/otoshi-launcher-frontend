use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::AppHandle;

use crate::errors::{LauncherError, Result};
use crate::utils::paths::{resolve_cache_dir, resolve_data_dir};

pub mod queries;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
    path: PathBuf,
}

impl Database {
    pub fn new(path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = 100000;
             PRAGMA temp_store = MEMORY;",
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path,
        })
    }

    pub fn run_migrations(&self) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LauncherError::Config("database lock poisoned".to_string()))?;

        conn.execute_batch(include_str!("../../migrations/001_initial.sql"))?;
        conn.execute_batch(include_str!("../../migrations/002_downloads.sql"))?;
        conn.execute_batch(include_str!("../../migrations/003_download_state.sql"))?;
        conn.execute_batch(include_str!("../../migrations/004_download_runtime.sql"))?;
        conn.execute_batch(include_str!("../../migrations/005_download_v2.sql"))?;
        conn.execute_batch(include_str!("../../migrations/006_self_heal_v2.sql"))?;
        ensure_download_runtime_columns(&conn)?;
        Ok(())
    }

    pub fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| LauncherError::Config("database lock poisoned".to_string()))
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

pub fn init(app: &AppHandle) -> Result<Database> {
    let data_dir = resolve_data_dir(app);
    let cache_dir = resolve_cache_dir(app);
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&cache_dir)?;

    let db_path = cache_dir.join("launcher.db");
    let legacy_db = data_dir.join("launcher.db");
    if !db_path.exists() && legacy_db.exists() {
        let _ = std::fs::rename(&legacy_db, &db_path);
    }
    let db = Database::new(db_path)?;
    db.run_migrations()?;

    Ok(db)
}

fn ensure_download_runtime_columns(conn: &Connection) -> Result<()> {
    ensure_column(
        conn,
        "downloads",
        "downloaded_bytes",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(conn, "downloads", "total_bytes", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "downloads", "network_bps", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "downloads", "disk_read_bps", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(
        conn,
        "downloads",
        "disk_write_bps",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(conn, "downloads", "read_bytes", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "downloads", "written_bytes", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(
        conn,
        "downloads",
        "remaining_bytes",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "downloads",
        "speed_history_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}
