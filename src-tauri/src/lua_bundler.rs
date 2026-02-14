// Lua Files Bundler for Portable & Installer
// Handles embedding and extracting lua files
// Supports: dev mode, PyInstaller, portable exe, NSIS installer

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::Lazy;

static LUA_CACHE: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

/// Configuration for lua bundler
pub struct LuaBundlerConfig {
    pub lua_source_dir: PathBuf,
    pub lua_dest_dir: PathBuf,
    pub chunk_size: usize,
}

impl Default for LuaBundlerConfig {
    fn default() -> Self {
        Self {
            lua_source_dir: PathBuf::from("./lua_files"),
            lua_dest_dir: Self::get_app_data_dir().join("lua_files"),
            chunk_size: 1024 * 1024 * 10, // 10MB chunks
        }
    }
}

impl LuaBundlerConfig {
    fn get_app_data_dir() -> PathBuf {
        if let Ok(app_data) = std::env::var("APPDATA") {
            PathBuf::from(app_data).join("otoshi_launcher")
        } else if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home).join(".otoshi_launcher")
        } else {
            PathBuf::from("./otoshi_launcher")
        }
    }
}

/// Lua bundler for embedding lua files in portable/installer
pub struct LuaBundler {
    config: LuaBundlerConfig,
}

impl LuaBundler {
    pub fn new(config: LuaBundlerConfig) -> Self {
        Self { config }
    }

    /// Extract lua files from bundle to destination
    pub fn extract_lua_files(&self) -> Result<(), String> {
        let dest_dir = &self.config.lua_dest_dir;

        // Check cache first
        if let Ok(cache) = LUA_CACHE.lock() {
            if let Some(cached_path) = cache.as_ref() {
                if cached_path.exists() && self.verify_lua_files_at(cached_path).unwrap_or(false) {
                    return Ok(());
                }
            }
        }

        // If lua files already exist and valid, skip
        if dest_dir.exists() && self.verify_lua_files().unwrap_or(false) {
            if let Ok(mut cache) = LUA_CACHE.lock() {
                *cache = Some(dest_dir.clone());
            }
            return Ok(());
        }

        // Create destination directory
        fs::create_dir_all(dest_dir)
            .map_err(|e| format!("Failed to create lua directory: {}", e))?;

        // Try to copy from source directory (dev mode or bundled)
        if self.config.lua_source_dir.exists() {
            self.copy_directory(&self.config.lua_source_dir, dest_dir)
                .map_err(|e| format!("Failed to copy lua files: {}", e))?;

            if let Ok(mut cache) = LUA_CACHE.lock() {
                *cache = Some(dest_dir.clone());
            }
            return Ok(());
        }

        // Try to find bundled lua files (multiple search paths)
        let bundled_paths = vec![
            // Current directory
            PathBuf::from("./lua_files"),
            // Parent directory
            PathBuf::from("../lua_files"),
            // Resources directory (NSIS/portable)
            PathBuf::from("./resources/lua_files"),
            // Application directory
            Self::get_exe_dir().join("lua_files"),
            // Portable application directory
            Self::get_exe_dir().join("app").join("lua_files"),
            // Development
            Self::get_exe_dir()
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("lua_files"))
                .unwrap_or_default(),
        ];

        for bundled_path in bundled_paths {
            if bundled_path.exists() && self.has_lua_files(&bundled_path).unwrap_or(false) {
                self.copy_directory(&bundled_path, dest_dir)
                    .map_err(|e| format!("Failed to copy bundled lua: {}", e))?;

                if let Ok(mut cache) = LUA_CACHE.lock() {
                    *cache = Some(dest_dir.clone());
                }
                return Ok(());
            }
        }

        Err("No lua files found (source or bundled)".to_string())
    }

    /// Get executable directory
    fn get_exe_dir() -> PathBuf {
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    }

    /// Check if directory has lua files
    fn has_lua_files(&self, path: &Path) -> Result<bool, String> {
        if !path.exists() {
            return Ok(false);
        }

        let has_files = fs::read_dir(path)
            .map_err(|e| format!("Failed to read directory: {}", e))?
            .any(|entry| {
                entry.ok().map_or(false, |e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "lua")
                        .unwrap_or(false)
                })
            });

        Ok(has_files)
    }

    /// Copy directory recursively
    fn copy_directory(&self, src: &Path, dest: &Path) -> io::Result<()> {
        if !dest.exists() {
            fs::create_dir_all(dest)?;
        }

        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let path = entry.path();
            let filename = entry.file_name();
            let new_path = dest.join(&filename);

            if path.is_dir() {
                self.copy_directory(&path, &new_path)?;
            } else {
                fs::copy(&path, &new_path)?;
            }
        }

        Ok(())
    }

    /// Get lua files directory path
    pub fn get_lua_dir(&self) -> PathBuf {
        self.config.lua_dest_dir.clone()
    }

    /// Verify lua files integrity at specific path
    fn verify_lua_files_at(&self, path: &Path) -> Result<bool, String> {
        if !path.exists() {
            return Ok(false);
        }

        let entries =
            fs::read_dir(path).map_err(|e| format!("Failed to read lua directory: {}", e))?;

        let lua_count = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "lua")
                    .unwrap_or(false)
            })
            .count();

        Ok(lua_count > 0)
    }

    /// Verify lua files integrity
    pub fn verify_lua_files(&self) -> Result<bool, String> {
        self.verify_lua_files_at(&self.config.lua_dest_dir)
    }

    /// Get lua files count
    pub fn get_lua_files_count(&self) -> Result<usize, String> {
        let entries = fs::read_dir(&self.config.lua_dest_dir)
            .map_err(|e| format!("Failed to read lua directory: {}", e))?;

        Ok(entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "lua")
                    .unwrap_or(false)
            })
            .count())
    }
}
