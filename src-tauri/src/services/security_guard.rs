use std::env;
use std::path::PathBuf;

use libloading::{Library, Symbol};
use serde::{Deserialize, Serialize};
use sysinfo::System;

use crate::errors::{LauncherError, Result};

const KNOWN_DEBUGGER_PROCESSES: &[&str] = &[
    "x64dbg.exe",
    "x32dbg.exe",
    "ida64.exe",
    "ida.exe",
    "ollydbg.exe",
    "ghidra.exe",
    "processhacker.exe",
    "cheatengine.exe",
    "cheatengine-x86_64.exe",
    "dnspy.exe",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityVerdictV2 {
    pub action: String,
    pub blocked: bool,
    pub status: String,
    pub reasons: Vec<String>,
    pub detections: Vec<String>,
    pub checked_at: i64,
}

#[derive(Clone)]
pub struct SecurityGuardService {
    enabled: bool,
    hard_block: bool,
}

impl SecurityGuardService {
    pub fn new() -> Self {
        Self {
            enabled: env_truthy("ANTI_DEBUG_V2_ENABLED", true),
            hard_block: env_truthy("ANTI_DEBUG_V2_HARD_BLOCK", true),
        }
    }

    pub fn evaluate(&self, action: &str) -> SecurityVerdictV2 {
        let mut detections: Vec<String> = Vec::new();
        let mut reasons: Vec<String> = Vec::new();
        if !self.enabled {
            return SecurityVerdictV2 {
                action: action.to_string(),
                blocked: false,
                status: "disabled".to_string(),
                reasons,
                detections,
                checked_at: chrono::Utc::now().timestamp(),
            };
        }

        if cfg!(target_os = "windows") && is_debugger_attached_windows() {
            detections.push("debugger_attached".to_string());
            reasons.push("Windows debugger presence detected".to_string());
        }

        let mut system = System::new_all();
        system.refresh_processes();
        for process in system.processes().values() {
            let name = process.name().to_ascii_lowercase();
            if KNOWN_DEBUGGER_PROCESSES.iter().any(|candidate| *candidate == name) {
                detections.push(format!("process:{name}"));
                reasons.push(format!("blocked process detected: {name}"));
            }
        }

        if let Some(native_flags) = scan_native_guard_flags() {
            if native_flags != 0 {
                detections.push(format!("native_guard_flags:{native_flags:#010x}"));
                reasons.extend(native_guard_reasons(native_flags));
            }
        }

        let blocked = self.hard_block && !detections.is_empty();
        SecurityVerdictV2 {
            action: action.to_string(),
            blocked,
            status: if blocked {
                "blocked".to_string()
            } else if detections.is_empty() {
                "ok".to_string()
            } else {
                "warn".to_string()
            },
            reasons,
            detections,
            checked_at: chrono::Utc::now().timestamp(),
        }
    }

    pub fn enforce(&self, action: &str) -> Result<SecurityVerdictV2> {
        let verdict = self.evaluate(action);
        if verdict.blocked {
            return Err(LauncherError::Auth(format!(
                "Security policy blocked action '{}': {}",
                action,
                verdict.reasons.join("; ")
            )));
        }
        Ok(verdict)
    }
}

fn env_truthy(name: &str, default: bool) -> bool {
    match env::var(name) {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => default,
    }
}

#[cfg(target_os = "windows")]
fn is_debugger_attached_windows() -> bool {
    unsafe {
        let direct = is_debugger_present() != 0;
        let mut remote_present = 0_i32;
        let ok = check_remote_debugger_present(get_current_process(), &mut remote_present as *mut i32);
        direct || (ok != 0 && remote_present != 0)
    }
}

#[cfg(not(target_os = "windows"))]
fn is_debugger_attached_windows() -> bool {
    false
}

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn IsDebuggerPresent() -> i32;
    fn CheckRemoteDebuggerPresent(hProcess: *mut core::ffi::c_void, pbDebuggerPresent: *mut i32) -> i32;
    fn GetCurrentProcess() -> *mut core::ffi::c_void;
}

#[cfg(target_os = "windows")]
unsafe fn is_debugger_present() -> i32 {
    IsDebuggerPresent()
}

#[cfg(target_os = "windows")]
unsafe fn check_remote_debugger_present(handle: *mut core::ffi::c_void, value: *mut i32) -> i32 {
    CheckRemoteDebuggerPresent(handle, value)
}

#[cfg(target_os = "windows")]
unsafe fn get_current_process() -> *mut core::ffi::c_void {
    GetCurrentProcess()
}

fn scan_native_guard_flags() -> Option<u32> {
    let dll_path = resolve_native_guard_path()?;
    if !dll_path.exists() {
        return None;
    }

    unsafe {
        let library = Library::new(&dll_path).ok()?;
        let symbol: Symbol<unsafe extern "C" fn(*mut u32) -> i32> =
            library.get(b"win_guard_scan").ok()?;
        let mut flags = 0_u32;
        let result = symbol(&mut flags as *mut u32);
        if result != 0 {
            return None;
        }
        Some(flags)
    }
}

fn resolve_native_guard_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("WIN_GUARD_DLL_PATH") {
        let value = path.trim();
        if !value.is_empty() {
            return Some(PathBuf::from(value));
        }
    }

    if let Ok(current) = env::current_exe() {
        if let Some(parent) = current.parent() {
            return Some(parent.join("win_guard.dll"));
        }
    }
    None
}

fn native_guard_reasons(flags: u32) -> Vec<String> {
    let mut reasons = Vec::new();
    if flags & 0x1 != 0 {
        reasons.push("native guard detected active debugger".to_string());
    }
    if flags & 0x2 != 0 {
        reasons.push("native guard detected reverse engineering process".to_string());
    }
    if flags & 0x4 != 0 {
        reasons.push("native guard detected thread debug flags".to_string());
    }
    reasons
}
