use std::ffi::CString;

use crate::errors::{LauncherError, Result};

#[derive(Clone, Default)]
pub struct ManifestService;

impl ManifestService {
    pub fn new() -> Self {
        Self
    }

    pub fn build_manifest(
        &self,
        source_dir: &str,
        output_path: &str,
        chunk_size: u32,
    ) -> Result<()> {
        let dir = CString::new(source_dir)
            .map_err(|_| LauncherError::Config("invalid source directory".to_string()))?;
        let out = CString::new(output_path)
            .map_err(|_| LauncherError::Config("invalid output path".to_string()))?;

        let result = launcher_core::launcher_build_manifest(dir.as_ptr(), out.as_ptr(), chunk_size);
        if result != 0 {
            return Err(LauncherError::Config(last_error()));
        }
        Ok(())
    }
}

fn last_error() -> String {
    let mut buffer = vec![0u8; 512];
    launcher_core::launcher_last_error(buffer.as_mut_ptr(), buffer.len());
    let end = buffer.iter().position(|b| *b == 0).unwrap_or(buffer.len());
    String::from_utf8_lossy(&buffer[..end]).to_string()
}
