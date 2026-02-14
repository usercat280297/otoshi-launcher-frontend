// Lua file commands for Tauri
// Provides access to lua files from frontend

use crate::lua_bundler::LuaBundler;
use std::path::PathBuf;

#[tauri::command]
pub fn get_lua_files_path() -> Result<String, String> {
    let bundler = LuaBundler::new(Default::default());
    bundler
        .extract_lua_files()
        .map_err(|e| format!("Failed to extract lua files: {}", e))?;

    Ok(bundler.get_lua_dir().to_string_lossy().to_string())
}

#[tauri::command]
pub fn verify_lua_files() -> Result<bool, String> {
    let bundler = LuaBundler::new(Default::default());
    bundler.verify_lua_files()
}

#[tauri::command]
pub fn get_lua_files_count() -> Result<usize, String> {
    let bundler = LuaBundler::new(Default::default());
    bundler.get_lua_files_count()
}

#[tauri::command]
pub fn check_lua_file_exists(filename: String) -> Result<bool, String> {
    let bundler = LuaBundler::new(Default::default());
    let lua_dir = bundler.get_lua_dir();
    let file_path = lua_dir.join(&filename);

    Ok(file_path.exists())
}

#[tauri::command]
pub fn read_lua_file(filename: String) -> Result<String, String> {
    let bundler = LuaBundler::new(Default::default());
    let lua_dir = bundler.get_lua_dir();
    let file_path = lua_dir.join(&filename);

    std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read lua file: {}", e))
}

#[tauri::command]
pub fn list_lua_files() -> Result<Vec<String>, String> {
    let bundler = LuaBundler::new(Default::default());
    let lua_dir = bundler.get_lua_dir();

    let mut files = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&lua_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|ext| ext == "lua").unwrap_or(false) {
                if let Some(filename) = path.file_name() {
                    files.push(filename.to_string_lossy().to_string());
                }
            }
        }
    }

    files.sort();
    Ok(files)
}
